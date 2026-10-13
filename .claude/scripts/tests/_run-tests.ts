/**
 * `npm test`: run the suite with QMD's cache and config redirected to a temp
 * folder, and fail if the run still wrote into the user's own.
 *
 * Any test that spawns a hook script can reach a real `qmd`. SessionStart
 * derives an index name from its temp vault's folder and runs `qmd status`,
 * `update` or the bootstrap against it, and qmd writes
 * `<cache>/qmd/<index>.sqlite` (and can write `<config>/qmd/<index>.yml`)
 * for every name it meets. Left alone, every run on a machine with qmd
 * installed added one store per temp vault to the user's cache.
 *
 * This wrapper:
 * 1. records the stores (`.sqlite`) and configs (`.yml`) already in the
 *    user's qmd folders;
 * 2. sets `XDG_CACHE_HOME` and `QMD_CONFIG_DIR` to a fresh temp folder for
 *    the runner, which every test file and every subprocess inherits. qmd
 *    reads both (config: `QMD_CONFIG_DIR`, then `XDG_CONFIG_HOME/qmd`, then
 *    `~/.config/qmd`), and so do OM's own path helpers. `XDG_CONFIG_HOME`
 *    itself is left alone: it also moves git's global config, which the
 *    tests' git calls must keep seeing;
 * 3. after the run, fails if a new store or config appeared in the user's
 *    folders, naming each, then removes the temp folder.
 *
 * It also keeps the run from leaving QMD refresh workers behind. A hook a
 * test runs can trigger the index refresh, which spawns a detached worker
 * that outlives the test and calls qmd later; several suites at once pile
 * them up. The runner sets VAULT_QMD_REFRESH=off, which the trigger honours
 * by spawning nothing, and points TMPDIR, TEMP and TMP into its temp folder,
 * so a trailing worker a test starts names that folder in its arguments, as
 * does a refresh-run worker the qmd extension starts for a vault in that
 * folder (`--vault`). An immediate
 * worker of the hooks' own trigger carries no arguments, so the guard can't
 * attribute it; the switch is what stops that one. After the run it looks for
 * such workers: it names each one, kills it, and fails the run, since a
 * guard that only killed would hide the leak.
 *
 * A test that builds a subprocess env from scratch, without `process.env`,
 * escapes the redirect; step 3 is what catches it. It escapes the refresh
 * switch and the temp folder too, so its worker wouldn't name the folder and
 * the guard can't attribute it: build a test's env from `process.env`. The wrapper exists
 * because Node's runner applies `--import` to each test file's process and
 * never to itself, so a preload cannot see the run as a whole.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const env = process.env;
const watched: readonly { readonly dir: string; readonly ext: string }[] = [
	{ dir: join(env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"), "qmd"), ext: ".sqlite" },
	{
		dir: env["QMD_CONFIG_DIR"] ?? join(env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "qmd"),
		ext: ".yml",
	},
];

function listing(dir: string, ext: string): Set<string> {
	try {
		return new Set(readdirSync(dir).filter((f) => f.endsWith(ext)));
	} catch {
		return new Set();
	}
}

/**
 * The processes running a refresh worker with `marker` in their command
 * line: the refresh workers this run's tests started. A worker is the
 * hooks' own `qmd-refresh-run.ts` or the qmd extension's
 * `extensions/qmd/refresh-run.ts`; `refresh-run` matches both. Listing
 * failures read as none; the run's own result still stands.
 */
function refreshWorkers(marker: string): { pid: number; cmd: string }[] {
	const windows = process.platform === "win32";
	// Filter on the command line, not the image name: a worker runs under
	// process.execPath, which a version manager may name other than node.exe.
	const listed = windows
		? spawnSync(
				"powershell.exe",
				["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process -Filter \"CommandLine LIKE '%refresh-run%'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"],
				{ encoding: "utf-8", timeout: 30_000, windowsHide: true },
			)
		: spawnSync("ps", ["-ax", "-ww", "-o", "pid=,args="], { encoding: "utf-8", timeout: 30_000 });
	if (listed.error !== undefined || listed.status !== 0) {
		const why = listed.error?.message ?? (listed.signal !== null ? `killed by ${listed.signal}` : `exit ${listed.status}`);
		process.stderr.write(`refresh-worker guard: couldn't list processes (${why}); leftover workers were not checked.\n`);
		return [];
	}
	const fold = (t: string) => (windows ? t.toLowerCase() : t);
	return (listed.stdout ?? "")
		.split(/\r?\n/)
		.map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => ({ pid: Number(m[1]), cmd: m[2] ?? "" }))
		.filter((p) => p.cmd.includes("refresh-run") && fold(p.cmd).includes(fold(marker)));
}

const before = watched.map(({ dir, ext }) => listing(dir, ext));
const isolated = mkdtempSync(join(tmpdir(), "om-test-qmd-"));
const testTmp = join(isolated, "tmp");
mkdirSync(testTmp);

const run = spawnSync(
	process.execPath,
	["--experimental-strip-types", "--import", "./tests/_qmd-cache-guard.ts", "--test", ...process.argv.slice(2)],
	{
		stdio: "inherit",
		env: {
			...env,
			XDG_CACHE_HOME: join(isolated, "cache"),
			QMD_CONFIG_DIR: join(isolated, "config", "qmd"),
			OM_QMD_ISOLATED: isolated,
			VAULT_QMD_REFRESH: "off",
			TMPDIR: testTmp,
			TEMP: testTmp,
			TMP: testTmp,
		},
	},
);

// Name each leftover refresh worker, kill it, then fail: three steps, each visible.
const leftover = refreshWorkers(isolated);
if (leftover.length > 0) {
	process.stderr.write(`\nrefresh-worker guard: the test run left ${leftover.length} QMD refresh worker(s) running:\n`);
	for (const w of leftover) process.stderr.write(`  ${w.pid}  ${w.cmd}\n`);
	// Kill each worker with what it started: a worker blocked in `qmd embed`
	// leaves qmd running if only the worker dies. The worker was spawned
	// detached, so on POSIX it leads its own process group.
	for (const w of leftover) {
		try {
			if (process.platform === "win32") {
				const r = spawnSync("taskkill", ["/T", "/F", "/PID", String(w.pid)], { encoding: "utf-8", timeout: 30_000, windowsHide: true });
				// 128: no such process, already gone with an earlier tree.
				if (r.status === 128) {
					process.stderr.write(`  ${w.pid} already gone\n`);
					continue;
				}
				if (r.status !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.status}`).trim());
			} else {
				try {
					process.kill(-w.pid);
				} catch {
					// Not a group leader: kill the process alone.
					process.kill(w.pid);
				}
			}
			process.stderr.write(`  killed ${w.pid} and its children\n`);
		} catch (err) {
			process.stderr.write(`  could not kill ${w.pid}: ${(err as Error).message}\n`);
		}
	}
	process.stderr.write("A test started the detached refresh worker. The trigger must see VAULT_QMD_REFRESH=off in its env.\n");
}

const added = watched.flatMap(({ dir, ext }, i) =>
	[...listing(dir, ext)].filter((f) => !before[i]!.has(f)).sort().map((f) => join(dir, f)),
);
try {
	rmSync(isolated, { recursive: true, force: true });
} catch {
	/* a detached qmd may still hold a file; the OS cleans temp */
}

if (added.length > 0) {
	process.stderr.write(
		`\nqmd cache guard: the test run created ${added.length} file(s) in the user's qmd folders:\n` +
			added.map((f) => `  ${f}`).join("\n") +
			"\nA test reached qmd with the user's environment. Route its subprocess env through process.env.\n",
	);
	process.exit(1);
}
if (leftover.length > 0) process.exit(1);
process.exit(run.status ?? 1);
