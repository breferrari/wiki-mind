/**
 * Nothing a wiki-mind user, its model or its UI sees at runtime names the
 * upstream vault (#41). Every entry point runs in each of its modes, and so
 * do both bootstraps, in a temp vault. Their output, and the installed text
 * that names the shard (the mod's plugin.json, the package descriptions),
 * must never say "obsidian-mind". Code comments citing upstream provenance
 * are not output and are not checked.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rmTemp, runScript } from "./_helpers.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const UPSTREAM = /obsidian-mind/i;
const RUNTIME_STATE = new Set(["node_modules", ".stop-handoff", ".hint-state.json", ".checklist-state.json", ".qmd-refresh-sentinel", "session-context.md"]);
const fm = (fields: Record<string, string>) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;

let parent = "";
let vault = "";
let state = "";

before(() => {
	parent = mkdtempSync(join(tmpdir(), "wiki-upstream-"));
	vault = join(parent, "vault");
	state = join(parent, "state");
	mkdirSync(state);
	cpSync(join(REPO, ".claude"), join(vault, ".claude"), { recursive: true, filter: (src) => !RUNTIME_STATE.has(basename(src)) });
	cpSync(join(REPO, ".scripts"), join(vault, ".scripts"), { recursive: true });
	cpSync(join(REPO, "vault-manifest.json"), join(vault, "vault-manifest.json"));
	for (const folder of ["sources", "concepts", "syntheses", "questions"]) mkdirSync(join(vault, folder));
	writeFileSync(join(vault, "concepts", "Lonely.md"), fm({ date: "2026-10-05", description: "d", tags: "[t]" }) + "no source\n");
	writeFileSync(join(vault, "syntheses", "Half.md"), fm({ date: "2026-10-05", description: "d", tags: "[t]", sides: "[[[A]]]" }));
	writeFileSync(join(vault, "questions", "Q.md"), fm({ date: "2026-10-05", description: "why", tags: "[t]", status: "open" }));
	writeFileSync(join(vault, "Index.md"), "# Index\n");
	// A stand-in QMD for the bootstrap, resolved as lib/qmd.ts resolves the real one.
	const fake = join(vault, ".claude", "scripts", "node_modules", "@tobilu", "qmd");
	mkdirSync(join(fake, "dist", "cli"), { recursive: true });
	writeFileSync(join(fake, "package.json"), JSON.stringify({ name: "@tobilu/qmd", version: "2.1.0" }));
	writeFileSync(join(fake, "dist", "cli", "qmd.js"), "if (process.argv.includes('--version')) console.log('qmd 2.1.0');\n");
});
after(() => rmTemp(parent));

function hook(script: string, stdin: object) {
	const r = runScript(join(vault, ".claude", "scripts", `${script}.ts`), stdin, {
		CLAUDE_PROJECT_DIR: vault,
		STOP_CHECKLIST_STATE: join(state, "checklist.json"),
		CLASSIFY_HINT_STATE: join(state, "hints.json"),
		STOP_HANDOFF_DIR: join(state, "handoff"),
		// Never reach a real QMD: its index store lives in the user's cache.
		VAULT_QMD: "off",
	});
	return r.stdout + r.stderr;
}

describe("no runtime output names the upstream vault", () => {
	test("every entry point, in each of its modes", () => {
		const outputs: Record<string, string> = {
			"session-start startup": hook("session-start", { source: "startup" }),
			"session-start resume": hook("session-start", { source: "resume" }),
			"session-start deliver": hook("session-start", { source: "startup", om_mod: "deliver" }),
			"stop": hook("stop-checklist", { hook_event_name: "Stop", session_id: "u1" }),
			"prompt with the handoff and hints": hook("classify-message", {
				hook_event_name: "UserPromptSubmit",
				session_id: "u1",
				prompt: "ingest https://arxiv.org/abs/1 and compare A vs B; I wonder why",
			}),
			"stop as the mod's report": hook("stop-checklist", { hook_event_name: "Stop", session_id: "u2", om_mod: "report" }),
			"session end": hook("stop-checklist", { hook_event_name: "SessionEnd", session_id: "u3" }),
			"write": hook("validate-write", { hook_event_name: "PostToolUse", tool_input: { file_path: join(vault, "concepts", "Lonely.md") } }),
			"pre-compact": hook("pre-compact", { hook_event_name: "PreCompact", session_id: "u1", trigger: "auto" }),
		};
		for (const [name, out] of Object.entries(outputs)) {
			assert.ok(out.length > 0 || name === "pre-compact", `${name} wrote nothing, so the check would be empty`);
			assert.doesNotMatch(out, UPSTREAM, name);
		}
		assert.match(outputs["prompt with the handoff and hints"] ?? "", /Stop hook report/, "the handoff text was checked");
		assert.match(outputs["stop as the mod's report"] ?? "", /wiki-mind plugin/, "the mod's framing was checked");
	});

	test("the QMD bootstrap script", () => {
		const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", join(".scripts", "qmd-bootstrap.ts")], {
			cwd: vault,
			encoding: "utf-8",
			timeout: 30_000,
		});
		assert.equal(r.status, 0, r.stderr);
		assert.doesNotMatch(r.stdout + r.stderr, UPSTREAM);
	});

	test("the ShardMind bootstrap hook, with QMD on and off", async () => {
		const mod = (await import(pathToFileURL(join(REPO, ".shardmind", "hooks", "bootstrap.ts")).href)) as {
			default: (ctx: unknown) => Promise<void>;
		};
		for (const qmd of [false, true]) {
			const lines: string[] = [];
			const original = { log: console.log, error: console.error, warn: console.warn };
			const path = process.env["PATH"];
			console.log = (...a: unknown[]) => void lines.push(a.join(" "));
			console.error = console.log;
			console.warn = console.log;
			// A PATH where no `qmd` can be found: the hook must take its
			// "not installed" branch and never reach a real QMD, whose index
			// store lives in the user's cache.
			process.env["PATH"] = dirname(process.execPath);
			try {
				await mod.default({ slot: "bootstrap", vaultRoot: vault, values: { qmd_enabled: qmd }, modules: {}, shard: { name: "wiki-mind", version: "0.1.0" } });
			} finally {
				Object.assign(console, original);
				process.env["PATH"] = path;
			}
			assert.ok(lines.length > 0, "the hook said something");
			assert.doesNotMatch(lines.join("\n"), UPSTREAM, `qmd_enabled: ${qmd}`);
		}
	});

	test("the installed text that names the shard", () => {
		for (const file of [
			".claude/skills/wiki-mind/.claude-plugin/plugin.json",
			".claude/scripts/package.json",
			".shardmind/hooks/package.json",
			".scripts/package.json",
			".mcp.json",
			"vault-manifest.json",
		]) {
			assert.doesNotMatch(readFileSync(join(REPO, file), "utf-8"), UPSTREAM, file);
		}
	});
});
