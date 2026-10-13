/**
 * wiki-mind's hook entry points, spawned the way .claude/settings.json
 * runs them, in a temp vault that holds a copy of .claude/ and the
 * manifest. Each test holds one protocol obligation the entry points keep
 * from obsidian-mind's (SPEC.md §7.2), or one registry guarantee as the hook
 * delivers it (§7.4).
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOOK_OUTPUT_MAX_CHARS, parseHookContext } from "../lib/hook-io.ts";
import { METER_HEADROOM } from "../lib/session-start.ts";
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
		// Never reach a real QMD: its index store lives in the user's cache.
		VAULT_QMD: "off",
		...env,
	});
}

/**
 * session-start on the hook path: the context its SessionStart envelope
 * carries. It never throws, so a test's state restore still runs; output
 * that is not the envelope comes back as a context no assertion matches,
 * with the exit code and stderr.
 */
function startContext(stdin: object, env: Record<string, string> = {}) {
	const { stdout, stderr, code } = run("session-start", stdin, env);
	let context: string;
	try {
		context = parseHookContext(stdout, "SessionStart");
	} catch (err) {
		context = `<${err instanceof Error ? err.message : String(err)}; exit ${code}; stderr: ${stderr}>`;
	}
	return { code, stdout, context };
}

/** validate-write given a Codex apply_patch, which names its files in the patch, relative to the session's cwd (#100). */
function applyPatch(command: string, env: Record<string, string> = {}) {
	return run("validate-write", { hook_event_name: "PostToolUse", tool_name: "apply_patch", cwd: vault, tool_input: { command } }, env);
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
	test("started in a vault subfolder, it walks up to vault-manifest.json and serves the vault (SPEC.md §7.3)", () => {
		const { context } = startContext({ source: "startup" }, { CLAUDE_PROJECT_DIR: join(vault, "questions") });
		assert.match(context, /### Open questions\n- \[\[Why\]\]/);
	});

	test("a vault that sets QMD keys without declaring the qmd extension sees how to declare it on the meter (#102)", () => {
		const declared = (JSON.parse(readFileSync(join(REPO, "vault-manifest.json"), "utf-8")) as { extensions: { id: string }[] }).extensions;
		manifest({}, declared.filter((d) => d.id !== "qmd"));
		let context: string;
		try {
			context = startContext({ source: "startup" }).context;
		} finally {
			manifest();
		}
		assert.match(context, /QMD off: extensions needs \{"id":"qmd"/);
	});

	test("a startup gets the core sections, then the extension's, under the meter", () => {
		const { context, code } = startContext({ source: "startup" });
		assert.equal(code, 0);
		const order = ["## Session Context", "### Date", "### Wiki", "### Open questions", "### Recent sources", "### Index"].map((h) => context.indexOf(h));
		assert.ok(order.every((i) => i >= 0), context);
		assert.deepEqual([...order].sort((a, b) => a - b), order);
		assert.match(context, /- \[\[Why\]\] — why slow/);
		assert.match(context, /_context injected: [\d.]+kB \/ [\d.]+kB budget_\n$/);
		assert.doesNotMatch(context, /configured, held under/, "the shipped budget is under the core's ceiling");
	});

	test("on the hook path, the context goes out in one SessionStart envelope within the hook output cap (#98)", () => {
		// JSON escapes double a quote, a backslash or a tab. The Index section
		// shows Index.md's head, about 7 kB in UTF-8 bytes here and twice that
		// encoded. Measured in bytes, the budget would keep it whole and the cap
		// would then cut it: the "truncated to fit" check is the guard.
		const line = "- " + '"\\\t'.repeat(60) + " 🧪\n";
		writeFileSync(join(vault, "Index.md"), "# Index\n" + line.repeat(40));
		let out: ReturnType<typeof startContext>;
		try {
			out = startContext({ source: "startup" });
		} finally {
			writeFileSync(join(vault, "Index.md"), "# Index\n- [[Paper]]\n");
		}
		assert.ok(out.stdout.length <= HOOK_OUTPUT_MAX_CHARS, `${out.stdout.length} characters is over the cap`);
		assert.match(out.context, /^## Session Context\n/);
		assert.match(out.context, /_context injected: [^\n]*budget[^\n]*_\n$/);
		assert.doesNotMatch(out.context, /truncated to fit/, "the budget gives sections up before the cap cuts");
	});

	test("a load-bearing section over the cap is cut to the envelope's limit, and the meter survives (#98)", () => {
		// A section without a pointer is never given up, so only the cap holds
		// it. 6000 quotes fit the plain cap as characters but not encoded: cut
		// to the plain cap, the envelope would lose the meter.
		mkdirSync(join(vault, ".claude", "extensions", "big"), { recursive: true });
		writeFileSync(
			join(vault, ".claude", "extensions", "big", "big.mjs"),
			`export default { id: "big", sections: [{ id: "big.quotes", header: "### Quotes", render: () => ${JSON.stringify('"'.repeat(6000))} }] };\n`,
		);
		const declared = (JSON.parse(readFileSync(join(REPO, "vault-manifest.json"), "utf-8")) as { extensions: unknown[] }).extensions;
		manifest({}, [...declared, { id: "big", module: ".claude/extensions/big/big.mjs", events: ["session-start"] }]);
		let out: ReturnType<typeof startContext>;
		try {
			out = startContext({ source: "startup" });
		} finally {
			manifest();
		}
		assert.ok(out.stdout.length <= HOOK_OUTPUT_MAX_CHARS, `${out.stdout.length} characters is over the cap`);
		assert.match(out.context, /_context injected: [^\n]*truncated to fit the hook output cap[^\n]*\n$/);
	});

	test("a resume gets pointers for the sections that have one", () => {
		const { context } = startContext({ source: "resume" });
		assert.match(context, /### Wiki\nsources: 1/);
		assert.match(context, /### Open questions\n\(Over budget: list questions\//);
		assert.doesNotMatch(context, /why slow/);
	});

	test("under the mod: standdown writes nothing, deliver writes the full layer as plain text", () => {
		assert.equal(run("session-start", { source: "startup", om_mod: "standdown" }).stdout, "");
		const delivered = run("session-start", { source: "resume", om_mod: "deliver" }).stdout;
		assert.match(delivered, /^## Session Context\n/, "the instruction file gets Markdown, not the hook envelope");
		assert.match(delivered, /why slow/);
		assert.match(delivered, /budget_\n$/);
	});

	test("under the mod, deliver holds the layer to the instruction budget, in UTF-8 bytes", () => {
		// About 1.7 kB as UTF-8 and 3 kB JSON-encoded: the Index fits a 2000 B
		// instruction budget only when deliver measures bytes, as it should.
		writeFileSync(join(vault, "Index.md"), "# Index\n" + `- ${'"'.repeat(30)}\n`.repeat(40));
		manifest({ eager_layer_instruction_budget_bytes: 2000 });
		let result: ReturnType<typeof run>;
		try {
			result = run("session-start", { source: "startup", om_mod: "deliver" });
		} finally {
			manifest();
			writeFileSync(join(vault, "Index.md"), "# Index\n- [[Paper]]\n");
		}
		const delivered = result.stdout;
		assert.match(delivered, /^## Session Context\n/, `exit ${result.code}; stderr: ${result.stderr}`);
		assert.ok(Buffer.byteLength(delivered) <= 2000 + METER_HEADROOM, `${Buffer.byteLength(delivered)} B`);
		assert.doesNotMatch(delivered, /collapsed: [^\n]*Index/, "measured in bytes, the Index fits");
		assert.match(delivered, /### Index\n# Index\n- """/);
	});

	test("VAULT_PATH is exported to CLAUDE_ENV_FILE, even when standing down", () => {
		const envFile = join(state, "env");
		run("session-start", { om_mod: "standdown" }, { CLAUDE_ENV_FILE: envFile });
		assert.match(readFileSync(envFile, "utf-8"), /^export VAULT_PATH=/m);
	});

	test("over budget, the meter names what was given up", () => {
		writeFileSync(join(vault, "Index.md"), "# Index\n- [[Paper]]\n" + "filler line\n".repeat(30));
		manifest({ eager_layer_budget_bytes: 300 });
		const { context } = startContext({ source: "startup" });
		manifest();
		writeFileSync(join(vault, "Index.md"), "# Index\n- [[Paper]]\n");
		assert.match(context, /collapsed: [^\n]*Index/);
		assert.match(context, /### Wiki\nsources: 1/, "the load-bearing section stays");
	});

	test("a broken extension is reported and skipped; the working one still renders", () => {
		manifest({}, [
			{ id: "wiki", module: ".claude/extensions/wiki/index.ts", events: ["session-start", "stop", "prompt", "write"], priority: 100 },
			{ id: "broken", module: ".claude/extensions/missing.ts", events: ["session-start"] },
		]);
		const { context, code } = startContext({ source: "startup" });
		manifest();
		assert.equal(code, 0);
		assert.match(context, /### Extensions\n⚠️  extension broken: skipped/);
		assert.match(context, /### Open questions/);
	});

	test("VAULT_EXTENSIONS=off runs no extension and says so", () => {
		const { context } = startContext({ source: "startup" }, { VAULT_EXTENSIONS: "off" });
		assert.match(context, /extensions are off \(VAULT_EXTENSIONS=off\)/);
		assert.doesNotMatch(context, /### Wiki/);
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
		// The report names the vault's own mod, as its plugin.json does (SPEC.md §7.2, S6).
		const plugin = JSON.parse(readFileSync(join(REPO, ".claude", "skills", "wiki-mind", ".claude-plugin", "plugin.json"), "utf-8")) as { name: string };
		assert.equal(plugin.name, "wiki-mind");
		assert.ok(out.report.agentText.includes(`a vault notice from the ${plugin.name} plugin`));
		assert.ok(!out.report.agentText.includes("obsidian-mind"));
	});
});

describe("rule 3 across the hooks", () => {
	test("an extension declared for session-start only is imported, and fails, in session-start only", () => {
		const marker = join(state, "side-imported.txt");
		mkdirSync(join(vault, ".claude", "extensions", "only"), { recursive: true });
		writeFileSync(
			join(vault, ".claude", "extensions", "only", "side.mjs"),
			`import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "x");\nexport default { id: "side" };\n`,
		);
		manifest({}, [
			{ id: "wiki", module: ".claude/extensions/wiki/index.ts", events: ["session-start", "stop", "prompt", "write"], priority: 100 },
			{ id: "side", module: ".claude/extensions/only/side.mjs", events: ["session-start"] },
			{ id: "gone", module: ".claude/extensions/only/missing.mjs", events: ["session-start"] },
		]);
		const others = [
			run("stop-checklist", { hook_event_name: "SessionEnd", session_id: "r3" }).stdout,
			run("classify-message", { hook_event_name: "UserPromptSubmit", session_id: "r3", prompt: "see https://example.org/paper.pdf" }).stdout,
			run("validate-write", { hook_event_name: "PostToolUse", tool_input: { file_path: join(vault, "concepts", "Lonely.md") } }).stdout,
		];
		const imported = existsSync(marker);
		const start = startContext({ source: "startup" }).context;
		manifest();
		assert.equal(imported, false, "stop, prompt or write imported a session-start extension");
		for (const out of others) assert.doesNotMatch(out, /extension (side|gone)/);
		assert.equal(existsSync(marker), true, "session-start imports it");
		assert.match(start, /⚠️  extension gone: skipped/);
	});
});

describe("lint (the /wiki-lint report)", () => {
	test("prints every Stop detector's findings as plain text, with the notes they name", () => {
		const { stdout, code } = run("lint", null);
		assert.equal(code, 0);
		assert.match(stdout, /⚠️  1 concept or entity note cites no source:\n- concepts\/Lonely\.md/);
		assert.doesNotMatch(stdout, /^\{/, "plain text, not a hook envelope");
	});

	test("says when the extensions are off, so an empty report is not mistaken for a clean wiki", () => {
		assert.match(run("lint", null, { VAULT_EXTENSIONS: "off" }).stdout, /nothing was checked/);
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

	describe("a Codex apply_patch, whose payload names its files in the patch (#100)", () => {

		test("each note it adds, updates or moves to is validated, in one envelope; CRLF and an absolute path too", () => {
			writeFileSync(join(vault, "concepts", "Added.md"), "no frontmatter");
			writeFileSync(join(vault, "concepts", "Moved.md"), fm(BASE) + "no citation\n");
			// A moved note's old path is never validated, even while a file is there.
			writeFileSync(join(vault, "concepts", "Old.md"), "no frontmatter");
			const command = [
				"*** Begin Patch",
				"*** Add File: concepts/Added.md",
				"+no frontmatter",
				`*** Update File: ${join(vault, "concepts", "Lonely.md")}`,
				"@@",
				"+x",
				"*** Update File: concepts/Old.md",
				"*** Move to: concepts/Moved.md",
				"*** End Patch",
			].join("\r\n");
			let stdout: string;
			try {
				stdout = applyPatch(command).stdout;
			} finally {
				rmSync(join(vault, "concepts", "Old.md"));
			}
			const context = parseHookContext(stdout, "PostToolUse");
			assert.match(context, /concepts\/Added\.md:\n- Missing YAML frontmatter/);
			assert.match(context, /concepts\/Lonely\.md:\n- Cites no source/);
			assert.match(context, /concepts\/Moved\.md:\n- Cites no source/);
			assert.doesNotMatch(context, /Old\.md/);
		});

		test("on Windows, one note named in two cases is validated once, and a case-only rename under its new name", { skip: process.platform !== "win32" }, () => {
			const twice = applyPatch("*** Begin Patch\n*** Update File: concepts/Lonely.md\n*** Update File: CONCEPTS/lonely.md\n*** End Patch\n");
			assert.equal(parseHookContext(twice.stdout, "PostToolUse").match(/Cites no source/g)?.length, 1);
			const renamed = applyPatch("*** Begin Patch\n*** Update File: concepts/LONELY.md\n*** Move to: concepts/Lonely.md\n*** End Patch\n");
			assert.match(parseHookContext(renamed.stdout, "PostToolUse"), /concepts\/Lonely\.md:\n- Cites no source/);
		});

		test("a patch that only deletes, or writes only outside the vault or no Markdown, writes nothing", () => {
			assert.equal(applyPatch("*** Begin Patch\n*** Delete File: concepts/Lonely.md\n*** End Patch\n").stdout, "");
			writeFileSync(join(state, "elsewhere.md"), "no frontmatter");
			writeFileSync(join(vault, "concepts", "notes.txt"), "x");
			const command = `*** Begin Patch\n*** Update File: ${join(state, "elsewhere.md")}\n*** Add File: concepts/notes.txt\n+x\n*** End Patch\n`;
			assert.equal(applyPatch(command).stdout, "");
		});
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

describe("pre-compact", () => {
	test("backs the transcript up to thinking/session-logs, as obsidian-mind's does", () => {
		const transcript = join(state, "transcript.jsonl");
		writeFileSync(transcript, '{"type":"user"}\n');
		try {
			// The effects are the probe suite's; off here, the run skips loading them.
			const r = run("pre-compact", { hook_event_name: "PreCompact", trigger: "auto", transcript_path: transcript }, { VAULT_EXTENSIONS: "off" });
			assert.equal(r.code, 0, r.stderr);
			const backups = readdirSync(join(vault, "thinking", "session-logs"));
			assert.equal(backups.length, 1);
			assert.match(backups[0]!, /^session_auto_\d{8}_\d{6}\.jsonl$/);
			assert.equal(readFileSync(join(vault, "thinking", "session-logs", backups[0]!), "utf-8"), '{"type":"user"}\n');
		} finally {
			rmSync(join(vault, "thinking"), { recursive: true, force: true });
		}
	});

	test("a trigger that isn't a plain word names the backup `unknown`, inside the backup folder", () => {
		const transcript = join(state, "transcript.jsonl");
		writeFileSync(transcript, "{}\n");
		try {
			// Taken as given, this trigger would put the backup in the vault root.
			const r = run("pre-compact", { hook_event_name: "PreCompact", trigger: "a/../../../escape", transcript_path: transcript }, { VAULT_EXTENSIONS: "off" });
			assert.equal(r.code, 0, r.stderr);
			assert.deepEqual(readdirSync(vault).filter((f) => f.startsWith("escape")), [], "nothing written in the vault root");
			assert.match(readdirSync(join(vault, "thinking", "session-logs"))[0]!, /^session_unknown_\d{8}_\d{6}\.jsonl$/);
		} finally {
			rmSync(join(vault, "thinking"), { recursive: true, force: true });
		}
	});

	test("a missing transcript, or none named, exits 0 with no output", () => {
		try {
			for (const input of [{ hook_event_name: "PreCompact", trigger: "manual", transcript_path: join(state, "gone.jsonl") }, { hook_event_name: "PreCompact" }]) {
				const r = run("pre-compact", input, { VAULT_EXTENSIONS: "off" });
				assert.equal(r.code, 0, `${JSON.stringify(input)}: ${r.stderr}`);
				assert.equal(r.stdout, "", JSON.stringify(input));
			}
		} finally {
			rmSync(join(vault, "thinking"), { recursive: true, force: true });
		}
	});
});

describe("each entry point runs the effects declared on its event (#90)", () => {
	// A probe extension: an effect on every effect event, writing a marker named after the event.
	const EVENTS = ["session-start", "write", "pre-compact", "stop"];
	let markers = "";
	before(() => {
		markers = join(state, "markers");
		mkdirSync(markers);
		mkdirSync(join(vault, ".claude", "extensions", "probe"), { recursive: true });
		writeFileSync(
			join(vault, ".claude", "extensions", "probe", "index.ts"),
			// A write effect also logs its target's path, one per line, to `write-paths`.
			`import { appendFileSync, writeFileSync } from "node:fs";\nimport { join } from "node:path";\nconst dir = () => process.env["EFFECT_PROBE_DIR"] ?? ".";\nexport default { id: "probe", effects: [{ id: "probe.mark", on: ${JSON.stringify(EVENTS)}, run: (trigger: { event: string; target?: { relPath: string } }) => { writeFileSync(join(dir(), trigger.event), ""); if (trigger.target) appendFileSync(join(dir(), "write-paths"), trigger.target.relPath + "\\n"); } }] };\n`,
		);
		const declared = (JSON.parse(readFileSync(join(REPO, "vault-manifest.json"), "utf-8")) as { extensions: unknown[] }).extensions;
		manifest({}, [...declared, { id: "probe", module: ".claude/extensions/probe/index.ts", events: EVENTS }]);
	});
	after(() => manifest());

	// Inputs are functions: the vault's path is known only once the suite's `before` has run.
	for (const [script, event, stdin] of [
		["session-start", "session-start", () => ({ hook_event_name: "SessionStart", source: "startup", session_id: "e1" })],
		["validate-write", "write", () => ({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(vault, "concepts", "Lonely.md") } })],
		["stop-checklist", "stop", () => ({ hook_event_name: "Stop", session_id: "e3" })],
		["pre-compact", "pre-compact", () => ({ hook_event_name: "PreCompact", trigger: "manual", session_id: "e5" })],
	] as const) {
		test(`${script}.ts runs the ${event} effects`, () => {
			const r = run(script, stdin(), { EFFECT_PROBE_DIR: markers });
			assert.equal(r.code, 0, r.stderr);
			assert.ok(existsSync(join(markers, event)), `the ${event} effect ran`);
		});
	}

	test("pre-compact.ts runs no effect under VAULT_EXTENSIONS=off, the switch QMD's refresh obeys elsewhere (#104)", () => {
		rmSync(join(markers, "pre-compact"), { force: true });
		const r = run("pre-compact", { hook_event_name: "PreCompact", trigger: "manual" }, { EFFECT_PROBE_DIR: markers, VAULT_EXTENSIONS: "off" });
		assert.equal(r.code, 0, r.stderr);
		assert.equal(existsSync(join(markers, "pre-compact")), false);
	});

	test("pre-compact.ts runs no effect of an extension declared enabled: false (#104)", () => {
		rmSync(join(markers, "pre-compact"), { force: true });
		const declared = (JSON.parse(readFileSync(join(vault, "vault-manifest.json"), "utf-8")) as { extensions: { id: string }[] }).extensions;
		manifest({}, declared.map((d) => (d.id === "probe" ? { ...d, enabled: false } : d)));
		try {
			// HOOK_DEBUG shows any registry or effect failure: none, so it is enabled: false that skipped it.
			const r = run("pre-compact", { hook_event_name: "PreCompact", trigger: "manual" }, { EFFECT_PROBE_DIR: markers, HOOK_DEBUG: "1" });
			assert.equal(r.code, 0, r.stderr);
			assert.doesNotMatch(r.stderr, /pre-compact: (effects:|⚠️)/);
			assert.equal(existsSync(join(markers, "pre-compact")), false);
		} finally {
			manifest({}, declared);
		}
	});

	test("pre-compact.ts still runs the effects when the backup can't be written (#104)", () => {
		rmSync(join(markers, "pre-compact"), { force: true });
		// A file named `thinking` stops the backup folder from being made.
		writeFileSync(join(vault, "thinking"), "not a folder");
		const transcript = join(state, "transcript.jsonl");
		writeFileSync(transcript, "{}\n");
		try {
			const r = run("pre-compact", { hook_event_name: "PreCompact", trigger: "manual", transcript_path: transcript }, { EFFECT_PROBE_DIR: markers });
			assert.equal(r.code, 0, r.stderr);
			assert.ok(existsSync(join(markers, "pre-compact")), "the pre-compact effect ran");
		} finally {
			rmSync(join(vault, "thinking"), { force: true });
		}
	});

	test("validate-write.ts runs the write effects before the skip rules, for a file it does not validate", () => {
		mkdirSync(join(vault, "templates"), { recursive: true });
		writeFileSync(join(vault, "templates", "Concept.md"), "---\ndate:\n---\n");
		rmSync(join(markers, "write"), { force: true });
		try {
			const r = run("validate-write", { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(vault, "templates", "Concept.md") } }, { EFFECT_PROBE_DIR: markers });
			assert.equal(r.code, 0, r.stderr);
			assert.ok(existsSync(join(markers, "write")), "the write effect ran");
		} finally {
			rmSync(join(vault, "templates"), { recursive: true, force: true });
		}
	});

	test("validate-write.ts runs the write effects for each file an apply_patch writes, deletes or moves, once each, Markdown or not (#100)", () => {
		writeFileSync(join(vault, "concepts", "New.md"), fm(BASE) + "[[Paper]]\n");
		writeFileSync(join(vault, "concepts", "data.txt"), "x");
		rmSync(join(markers, "write-paths"), { force: true });
		// Brief.md is added and then moved away in the same patch: written, but gone.
		const command =
			"*** Begin Patch\n*** Delete File: concepts/Gone.md\n*** Update File: concepts/Old.md\n*** Move to: concepts/New.md\n*** Add File: concepts/data.txt\n+x\n" +
			"*** Add File: concepts/Brief.md\n+x\n*** Update File: concepts/Brief.md\n*** Move to: concepts/Brief2.md\n*** End Patch\n";
		writeFileSync(join(vault, "concepts", "Brief2.md"), fm(BASE) + "[[Paper]]\n");
		const r = applyPatch(command, { EFFECT_PROBE_DIR: markers });
		assert.equal(r.code, 0, r.stderr);
		const paths = readFileSync(join(markers, "write-paths"), "utf-8").split("\n").filter(Boolean).sort();
		assert.deepEqual(
			paths,
			["concepts/Brief.md", "concepts/Brief2.md", "concepts/Gone.md", "concepts/New.md", "concepts/Old.md", "concepts/data.txt"],
			"the index sees a deleted note, a moved note's old path, and a written file that is gone",
		);
	});

	test("stop-checklist.ts runs the stop effects before its checks, so a checklist item that throws keeps them", () => {
		mkdirSync(join(vault, ".claude", "extensions", "thrower"), { recursive: true });
		writeFileSync(
			join(vault, ".claude", "extensions", "thrower", "index.ts"),
			'export default { id: "thrower", checklist: [{ id: "thrower.bad", get full(): string { throw new Error("broken getter"); }, short: "s" }] };\n',
		);
		const declared = (JSON.parse(readFileSync(join(vault, "vault-manifest.json"), "utf-8")) as { extensions: unknown[] }).extensions;
		manifest({}, [...declared, { id: "thrower", module: ".claude/extensions/thrower/index.ts", events: ["stop"] }]);
		rmSync(join(markers, "stop"), { force: true });
		try {
			const r = run("stop-checklist", { hook_event_name: "Stop", session_id: "e4" }, { EFFECT_PROBE_DIR: markers });
			assert.equal(r.code, 0, r.stderr);
			assert.ok(existsSync(join(markers, "stop")), "the stop effect ran");
		} finally {
			manifest({}, declared);
		}
	});
});
