/**
 * Invariant 1 and Invariant 2 (SPEC.md §8): `shardmind install --defaults`
 * equals a plain clone.
 *
 * ShardMind installs a shard from GitHub, so this test installs the commit
 * named by WIKI_CONTRACT_REF (CI passes the PR head) into an empty folder and
 * compares it with what the repo says a vault gets (_shard.ts: the tracked
 * files, minus Tier 1, minus .shardmindignore):
 * - Invariant 1: the same paths, every file byte-identical. The install adds
 *   only ShardMind's metadata, `.shardmind/` and `shard-values.yaml`.
 * - Invariant 2: a defaults install touches no managed file. A hook edit on
 *   a defaults install would break the byte equality above, so the same
 *   comparison holds it.
 * - No test file installs (#40).
 *
 * Without WIKI_CONTRACT_REF the test is skipped: it needs the network and a
 * pushed commit. WIKI_CONTRACT_CLI may point at a local shardmind cli.js;
 * otherwise `npx shardmind@<the version CI pins>` runs it.
 */
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmTemp } from "./_helpers.ts";
import { installSet } from "./_shard.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REF = process.env["WIKI_CONTRACT_REF"] ?? "";
const SHARD = `github:breferrari/wiki-mind#${REF}`;
let target = "";
after(() => rmTemp(target));

/** Every file under `dir`, relative and with forward slashes. */
function listFiles(dir: string, prefix = ""): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const rel = prefix === "" ? name : `${prefix}/${name}`;
		if (statSync(join(dir, name)).isDirectory()) out.push(...listFiles(join(dir, name), rel));
		else out.push(rel);
	}
	return out;
}

function install(into: string) {
	const cli = process.env["WIKI_CONTRACT_CLI"];
	if (cli !== undefined && cli !== "") {
		return spawnSync(process.execPath, [cli, "install", "--defaults", SHARD], { cwd: into, encoding: "utf-8", timeout: 300_000 });
	}
	const version = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf-8").match(/SHARDMIND_VERSION:\s*([0-9.]+)/)?.[1];
	assert.ok(version, "ci.yml pins SHARDMIND_VERSION");
	// npx is a .cmd on Windows, which needs a shell; the arguments are fixed strings.
	return spawnSync(`npx --yes shardmind@${version} install --defaults ${SHARD}`, { cwd: into, encoding: "utf-8", shell: true, timeout: 300_000 });
}

describe("Invariant 1 and Invariant 2: install --defaults equals a clone", { skip: REF === "" ? "WIKI_CONTRACT_REF is unset (CI sets it to the PR head)" : false }, () => {
	test(`a defaults install of ${SHARD} is the clone, byte for byte, plus ShardMind's metadata`, () => {
		target = mkdtempSync(join(tmpdir(), "wiki-contract-"));
		const run = install(target);
		assert.equal(run.status, 0, `install failed:\n${run.stdout}\n${run.stderr}`);

		const expected = installSet(REPO);
		// Besides ShardMind's metadata, the bootstrap hook's unmanaged outputs
		// are not part of the comparison: `git init` (.git/) and the QMD index
		// (.qmd/, when QMD is installed). Invariant 1 compares managed files.
		const unmanaged = (f: string) => f.startsWith(".shardmind/") || f === "shard-values.yaml" || f.startsWith(".git/") || f.startsWith(".qmd/");
		const installed = listFiles(target).filter((f) => !unmanaged(f));
		const missing = [...expected].filter((f) => !installed.includes(f)).sort();
		const extra = installed.filter((f) => !expected.has(f)).sort();
		assert.deepEqual({ missing, extra }, { missing: [], extra: [] });

		const differ = installed.filter((f) => !readFileSync(join(REPO, f)).equals(readFileSync(join(target, f))));
		assert.deepEqual(differ, [], "Invariant 1: every installed file is byte-identical to the clone's");

		assert.ok(listFiles(target).includes("shard-values.yaml"), "the install records its values");
		assert.ok(listFiles(target).includes(".git/HEAD"), "the bootstrap hook ran: git init");
		assert.deepEqual(installed.filter((f) => /\.test\.ts$/.test(f)), [], "no test file installs");
	});
});
