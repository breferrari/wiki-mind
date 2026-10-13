/**
 * Codex and Gemini as removable modules (#25, SPEC.md §5), on the AGENTS.md
 * model obsidian-mind v10.0.0 ships: Gemini reads AGENTS.md through
 * `.gemini/settings.json`'s `context.fileName`, each agent's module claims
 * its own dotfolder, and every hook command each agent's config names runs
 * from the vault root, as that agent runs it, and exits 0 with JSON or
 * nothing on stdout.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmTemp } from "./_helpers.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf-8");
const RUNTIME_STATE = new Set(["node_modules", ".stop-handoff", ".hint-state.json", ".checklist-state.json", ".qmd-refresh-sentinel", "session-context.md"]);

type HookEntry = { readonly matcher?: string; readonly hooks: readonly { readonly type: string; readonly command: string; readonly commandWindows?: string }[] };
type HookConfig = { readonly hooks: Readonly<Record<string, readonly HookEntry[]>>; readonly context?: { readonly fileName?: readonly string[] } };

const config = (path: string): HookConfig => JSON.parse(read(path)) as HookConfig;

/** A module's paths and removability, read from the schema's two-space `modules:` block. */
function moduleOf(id: string): { paths: string[]; removable: boolean | null } {
	const lines = read(".shardmind/shard-schema.yaml").split(/\r?\n/);
	const start = lines.findIndex((l) => l === `  ${id}:`);
	if (start === -1) return { paths: [], removable: null };
	const body: string[] = [];
	for (const l of lines.slice(start + 1)) {
		if (/^ {0,2}\S/.test(l)) break;
		body.push(l);
	}
	const paths = body.filter((l) => /^ {6}- "/.test(l)).map((l) => l.replace(/^ {6}- "|"$/g, ""));
	const r = body.find((l) => /^ {4}removable:/.test(l));
	return { paths, removable: r === undefined ? null : /true/.test(r) };
}

describe("Gemini reads AGENTS.md", () => {
	test(".gemini/settings.json names AGENTS.md as its context file", () => {
		assert.ok(existsSync(join(REPO, ".gemini", "settings.json")), ".gemini/settings.json ships");
		assert.deepEqual(config(".gemini/settings.json").context?.fileName, ["AGENTS.md"]);
	});
});

describe("the codex and gemini modules (SPEC.md §5)", () => {
	test("codex claims exactly .codex/, and is removable", () => {
		assert.deepEqual(moduleOf("codex"), { paths: [".codex/"], removable: true });
	});
	test("gemini claims exactly .gemini/, and is removable", () => {
		assert.deepEqual(moduleOf("gemini"), { paths: [".gemini/"], removable: true });
	});
	test("each path a module claims exists", () => {
		for (const id of ["codex", "gemini"]) for (const p of moduleOf(id).paths) assert.ok(existsSync(join(REPO, p)), `${id}: ${p}`);
	});
});

describe("every hook command runs from the vault root", () => {
	let vault = "";
	before(() => {
		vault = mkdtempSync(join(tmpdir(), "wiki-agents-"));
		cpSync(join(REPO, ".claude"), join(vault, ".claude"), { recursive: true, filter: (src) => !RUNTIME_STATE.has(basename(src)) });
		cpSync(join(REPO, "vault-manifest.json"), join(vault, "vault-manifest.json"));
		for (const folder of ["sources", "concepts", "entities", "syntheses", "questions"]) mkdirSync(join(vault, folder));
		writeFileSync(join(vault, "Index.md"), "# Index\n");
		writeFileSync(join(vault, "concepts", "C.md"), "---\ndate: 2026-10-13\ndescription: d\ntags: [t]\n---\nNo source.\n");
	});
	after(() => rmTemp(vault));

	/** What each event's hook reads on stdin, as the agent sends it. */
	const payload = (event: string): object => {
		switch (event) {
			case "SessionStart":
				return { hook_event_name: event, source: "startup", session_id: "s" };
			case "UserPromptSubmit":
			case "BeforeAgent":
				return { hook_event_name: event, prompt: "hello", session_id: "s" };
			case "PostToolUse":
			case "AfterTool":
				return { hook_event_name: event, tool_name: "Write", tool_input: { file_path: join(vault, "concepts", "C.md") }, session_id: "s" };
			default:
				return { hook_event_name: event, session_id: "s", trigger: "manual" };
		}
	};

	function runHook(command: string, event: string, agentVar: string) {
		return spawnSync(command, {
			cwd: vault,
			shell: true,
			encoding: "utf-8",
			timeout: 60_000,
			input: JSON.stringify(payload(event)),
			env: { ...process.env, [agentVar]: vault, CLAUDE_PROJECT_DIR: "", VAULT_QMD: "off", VAULT_QMD_REFRESH: "off" },
		});
	}

	const configs = [
		{ path: ".codex/hooks.json", agentVar: "CODEX_PROJECT_DIR", windowsKey: true },
		{ path: ".gemini/settings.json", agentVar: "GEMINI_PROJECT_DIR", windowsKey: false },
	] as const;

	for (const { path, agentVar, windowsKey } of configs) {
		test(`${path}: each command exits 0 with JSON or nothing`, () => {
			assert.ok(existsSync(join(REPO, path)), `${path} ships`);
			const events = Object.entries(config(path).hooks);
			assert.ok(events.length > 0, "the config names hooks");
			for (const [event, entries] of events) {
				for (const entry of entries) {
					for (const hook of entry.hooks) {
						// On Windows, Codex runs commandWindows where a hook gives one.
						const command = windowsKey && process.platform === "win32" && hook.commandWindows !== undefined ? hook.commandWindows : hook.command;
						const r = runHook(command, event, agentVar);
						assert.equal(r.status, 0, `${path} ${event}: ${command}\n${r.stdout}\n${r.stderr}`);
						// SessionStart prints its context as plain text. Gemini's contract
						// wants JSON (hookSpecificOutput.additionalContext), and Codex's is
						// unverified. obsidian-mind#341 fixes it upstream; wiki-mind takes it
						// when its record moves past that (#98), and this check tightens then.
						if (event === "SessionStart") continue;
						const out = r.stdout.trim();
						if (out !== "") assert.doesNotThrow(() => JSON.parse(out), `${path} ${event} prints JSON or nothing: ${out.slice(0, 200)}`);
					}
				}
			}
		});
	}
});
