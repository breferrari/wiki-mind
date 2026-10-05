/**
 * wiki-mind's four hook entry points, spawned the way .claude/settings.json
 * runs them, in a temp vault that holds a copy of .claude/ and the
 * manifest. Each test holds one protocol obligation the entry points keep
 * from obsidian-mind's (SPEC.md §7.2), or one registry guarantee as the hook
 * delivers it (§7.4).
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmTemp, runScript } from "./_helpers.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUNTIME_STATE = new Set(["node_modules", ".stop-handoff", ".hint-state.json", ".checklist-state.json", ".qmd-refresh-sentinel", "session-context.md"]);

let vault = "";
let state = "";
const fm = (fields: Record<string, string>) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
const BASE = { date: "2026-10-05", description: "d", tags: "[t]" };

function manifest(extra: Record<string, unknown> = {}, extensions?: unknown[]): void {
	const base = JSON.parse(readFileSync(join(REPO, "vault-manifest.json"), "utf-8")) as Record<string, unknown>;
	writeFileSync(join(vault, "vault-manifest.json"), JSON.stringify({ ...base, ...extra, ...(extensions === undefined ? {} : { extensions }) }));
}

function run(script: string, stdin: string | object | null, env: Record<string, string> = {}) {
	return runScript(join(vault, ".claude", "scripts", `${script}.ts`), stdin, {
		CLAUDE_PROJECT_DIR: vault,
		STOP_CHECKLIST_STATE: join(state, "checklist.json"),
		CLASSIFY_HINT_STATE: join(state, "hints.json"),
		STOP_HANDOFF_DIR: join(state, "handoff"),
		...env,
	});
}

before(() => {
	vault = mkdtempSync(join(tmpdir(), "wiki-entry-"));
	state = mkdtempSync(join(tmpdir(), "wiki-entry-state-"));
	cpSync(join(REPO, ".claude"), join(vault, ".claude"), { recursive: true, filter: (src) => !RUNTIME_STATE.has(basename(src)) });
	manifest();
	for (const folder of ["sources", "concepts", "questions"]) mkdirSync(join(vault, folder));
	writeFileSync(join(vault, "sources", "Paper.md"), fm({ ...BASE, authors: "A", year: "2024", url: "https://a" }));
	writeFileSync(join(vault, "concepts", "Lonely.md"), fm(BASE) + "no citation\n");
	writeFileSync(join(vault, "questions", "Why.md"), fm({ ...BASE, description: "why slow", status: "open" }));
	writeFileSync(join(vault, "Index.md"), "# Index\n- [[Paper]]\n");
});
after(() => {
	rmTemp(vault);
	rmTemp(state);
});

describe("session-start", () => {
	test("a startup gets the core sections, then the extension's, under the meter", () => {
		const { stdout, code } = run("session-start", { source: "startup" });
		assert.equal(code, 0);
		const order = ["## Session Context", "### Date", "### Wiki", "### Open questions", "### Recent sources", "### Index"].map((h) => stdout.indexOf(h));
		assert.ok(order.every((i) => i >= 0), stdout);
		assert.deepEqual([...order].sort((a, b) => a - b), order);
		assert.match(stdout, /- \[\[Why\]\] — why slow/);
		assert.match(stdout, /_context injected: [\d.]+kB \/ [\d.]+kB budget_\n$/);
	});

	test("a resume gets pointers for the sections that have one", () => {
		const { stdout } = run("session-start", { source: "resume" });
		assert.match(stdout, /### Wiki\nsources: 1/);
		assert.match(stdout, /### Open questions\n\(Over budget: list questions\//);
		assert.doesNotMatch(stdout, /why slow/);
	});

	test("under the mod: standdown writes nothing, deliver writes the full layer", () => {
		assert.equal(run("session-start", { source: "startup", om_mod: "standdown" }).stdout, "");
		const delivered = run("session-start", { source: "resume", om_mod: "deliver" }).stdout;
		assert.match(delivered, /why slow/);
		assert.match(delivered, /budget_\n$/);
	});

	test("VAULT_PATH is exported to CLAUDE_ENV_FILE, even when standing down", () => {
		const envFile = join(state, "env");
		run("session-start", { om_mod: "standdown" }, { CLAUDE_ENV_FILE: envFile });
		assert.match(readFileSync(envFile, "utf-8"), /^export VAULT_PATH=/m);
	});

	test("over budget, the meter names what was given up", () => {
		writeFileSync(join(vault, "Index.md"), "# Index\n- [[Paper]]\n" + "filler line\n".repeat(30));
		manifest({ eager_layer_budget_bytes: 300 });
		const { stdout } = run("session-start", { source: "startup" });
		manifest();
		writeFileSync(join(vault, "Index.md"), "# Index\n- [[Paper]]\n");
		assert.match(stdout, /collapsed: [^\n]*Index/);
		assert.match(stdout, /### Wiki\nsources: 1/, "the load-bearing section stays");
	});

	test("a broken extension is reported and skipped; the working one still renders", () => {
		manifest({}, [
			{ id: "wiki", module: ".claude/extensions/wiki/index.ts", events: ["session-start", "stop", "prompt", "write"], priority: 100 },
			{ id: "broken", module: ".claude/extensions/missing.ts", events: ["session-start"] },
		]);
		const { stdout, code } = run("session-start", { source: "startup" });
		manifest();
		assert.equal(code, 0);
		assert.match(stdout, /### Extensions\n⚠️  extension broken: skipped/);
		assert.match(stdout, /### Open questions/);
	});

	test("VAULT_EXTENSIONS=off runs no extension and says so", () => {
		const { stdout } = run("session-start", { source: "startup" }, { VAULT_EXTENSIONS: "off" });
		assert.match(stdout, /extensions are off \(VAULT_EXTENSIONS=off\)/);
		assert.doesNotMatch(stdout, /### Wiki/);
	});
});

describe("stop-checklist and the handoff through classify-message", () => {
	test("standdown and a re-entry write the empty envelope", () => {
		assert.equal(run("stop-checklist", { hook_event_name: "Stop", session_id: "s0", om_mod: "standdown" }).stdout, "{}");
		assert.equal(run("stop-checklist", { hook_event_name: "Stop", session_id: "s0", stop_hook_active: true }).stdout, "{}");
	});

	test("a Stop shows the summary once per change, and the next prompt carries the full report", () => {
		const first = JSON.parse(run("stop-checklist", { hook_event_name: "Stop", session_id: "s1" }).stdout) as { systemMessage: string };
		assert.match(first.systemMessage, /^Wrap-up checklist: update Index\.md/);
		assert.match(first.systemMessage, /1 concept or entity note cites no source/);
		assert.equal(run("stop-checklist", { hook_event_name: "Stop", session_id: "s1" }).stdout, "{}", "unchanged findings stay silent");
		const next = JSON.parse(run("classify-message", { hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "ok" }).stdout) as {
			hookSpecificOutput: { additionalContext: string };
		};
		assert.match(next.hookSpecificOutput.additionalContext, /^Stop hook report, handed over/);
		assert.match(next.hookSpecificOutput.additionalContext, /- concepts\/Lonely\.md/);
		assert.equal(run("classify-message", { hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "ok" }).stdout, "", "a report is handed over once");
	});

	test("a detector of the wrong shape, or an import that never settles, still leaves exactly one JSON object", () => {
		mkdirSync(join(vault, ".claude", "extensions", "bad"), { recursive: true });
		writeFileSync(join(vault, ".claude", "extensions", "bad", "shape.mjs"), "export default { id: 'shape', detectors: [{ id: 'undef', detect: () => undefined }] };\n");
		writeFileSync(join(vault, ".claude", "extensions", "bad", "hang.mjs"), "await new Promise(() => {});\nexport default { id: 'hang' };\n");
		manifest({}, [
			{ id: "shape", module: ".claude/extensions/bad/shape.mjs", events: ["stop"] },
			{ id: "hang", module: ".claude/extensions/bad/hang.mjs", events: ["stop"], timeoutMs: 200 },
		]);
		const { stdout, code } = run("stop-checklist", { hook_event_name: "SessionEnd", session_id: "s4" });
		const report = run("stop-checklist", { hook_event_name: "Stop", session_id: "s5", om_mod: "report" }).stdout;
		manifest();
		assert.equal(code, 0);
		const parsed = JSON.parse(stdout) as { systemMessage: string };
		assert.match(parsed.systemMessage, /extension shape, detector undef: skipped \(returned undefined, not a list of findings\)/);
		assert.match(parsed.systemMessage, /extension hang: skipped \(timed out after 200 ms\)/);
		assert.ok((JSON.parse(report) as { report: { claims: string[] } }).report.claims.includes("2 extension failure(s)"));
	});

	test("SessionEnd reports in full", () => {
		const end = JSON.parse(run("stop-checklist", { hook_event_name: "SessionEnd", session_id: "s2" }).stdout) as { systemMessage: string };
		assert.match(end.systemMessage, /^Wrap-up checklist:\n- Update Index\.md/);
	});

	test("the mod's report run gets the report as data", () => {
		const out = JSON.parse(run("stop-checklist", { hook_event_name: "Stop", session_id: "s3", om_mod: "report" }).stdout) as {
			report: { key: string; claims: string[]; agentText: string };
		};
		assert.equal(typeof out.report.key, "string");
		assert.ok(out.report.claims.includes("1 concept or entity note cites no source"));
		assert.match(out.report.agentText, /Wrap-up checklist/);
	});
});

describe("classify-message", () => {
	test("bad input writes nothing", () => {
		assert.equal(run("classify-message", "not json").stdout, "");
	});

	test("a matching prompt gets its hint once per session", () => {
		const prompt = { hook_event_name: "UserPromptSubmit", session_id: "h1", prompt: "ingest https://arxiv.org/abs/2" };
		assert.match(run("classify-message", prompt).stdout, /NEW SOURCE/);
		assert.equal(run("classify-message", prompt).stdout, "");
	});
});

describe("validate-write", () => {
	const write = (file: string) => run("validate-write", { hook_event_name: "PostToolUse", tool_input: { file_path: file } });

	test("no file_path, a file outside the vault, and a README write nothing", () => {
		assert.equal(run("validate-write", { tool_input: {} }).stdout, "");
		assert.equal(write(join(state, "elsewhere.md")).stdout, "");
		writeFileSync(join(vault, "sources", "README.md"), "no frontmatter");
		assert.equal(write(join(vault, "sources", "README.md")).stdout, "");
	});

	test("a note that breaks SPEC.md §2 gets its warnings", () => {
		const out = JSON.parse(write(join(vault, "concepts", "Lonely.md")).stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
		assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
		assert.match(out.hookSpecificOutput.additionalContext, /concepts\/Lonely\.md:\n- Cites no source/);
	});

	test("a valid note writes nothing", () => {
		writeFileSync(join(vault, "concepts", "Good.md"), fm(BASE) + "[[Paper]]\n");
		assert.equal(write(join(vault, "concepts", "Good.md")).stdout, "");
	});

	test("a vault that sits under a templates/ folder is still validated", () => {
		const outer = mkdtempSync(join(tmpdir(), "wiki-entry-outer-"));
		const nested = join(outer, "templates", "vault");
		mkdirSync(join(nested, "concepts"), { recursive: true });
		cpSync(join(vault, ".claude"), join(nested, ".claude"), { recursive: true });
		cpSync(join(vault, "vault-manifest.json"), join(nested, "vault-manifest.json"));
		writeFileSync(join(nested, "concepts", "C.md"), "no frontmatter");
		const out = runScript(join(nested, ".claude", "scripts", "validate-write.ts"), { tool_input: { file_path: join(nested, "concepts", "C.md") } }, { CLAUDE_PROJECT_DIR: nested });
		rmTemp(outer);
		assert.match(out.stdout, /Missing YAML frontmatter/);
	});

	test("on Windows, a path whose case differs from the vault root's is still inside it", { skip: process.platform !== "win32" }, () => {
		const out = write(join(vault, "concepts", "Lonely.md").toUpperCase().replace("LONELY.MD", "Lonely.md").replace("CONCEPTS", "concepts"));
		assert.match(out.stdout, /Cites no source/);
	});

	test("no hook left runtime state inside the vault copy", () => {
		const leaked = readdirSync(join(vault, ".claude", "scripts")).filter((f) => RUNTIME_STATE.has(f));
		assert.deepEqual(leaked, []);
		assert.equal(existsSync(join(vault, ".claude", "scripts", ".stop-handoff")), false);
	});
});
