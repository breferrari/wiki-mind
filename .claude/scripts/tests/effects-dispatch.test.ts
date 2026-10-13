/**
 * The entry points run the effects extensions declare (#102, #90), and the
 * vault declares mindframe's qmd extension for its session-start notes and
 * its index refresh (SPEC.md §6.3).
 *
 * A probe extension in a temp vault declares an effect on every effect
 * event and writes a marker file when one runs. Each entry point, run as
 * its hook would be, must leave its event's marker.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationNotes } from "../core/context.ts";
import { rmTemp, runScript } from "./_helpers.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUNTIME_STATE = new Set(["node_modules", ".stop-handoff", ".hint-state.json", ".checklist-state.json", ".qmd-refresh-sentinel", "session-context.md"]);
const manifest = (): Record<string, unknown> => JSON.parse(readFileSync(join(REPO, "vault-manifest.json"), "utf-8")) as Record<string, unknown>;

describe("the vault declares the qmd extension (SPEC.md §6.3)", () => {
	test("vault-manifest.json declares qmd on session-start, write, pre-compact and stop", () => {
		const declared = (manifest()["extensions"] as { id: string; module: string; events: string[] }[] | undefined) ?? [];
		const qmd = declared.find((d) => d.id === "qmd");
		assert.ok(qmd, "a qmd declaration");
		assert.equal(qmd.module, ".claude/scripts/extensions/qmd/index.ts");
		assert.deepEqual([...qmd.events].sort(), ["pre-compact", "session-start", "stop", "write"]);
	});

	test("with it declared, the core leaves no migration note for the meter", () => {
		assert.deepEqual(migrationNotes(manifest()), []);
	});
});

describe("each entry point runs the effects declared on its event (#90)", () => {
	let vault = "";
	let state = "";
	let markers = "";
	before(() => {
		vault = mkdtempSync(join(tmpdir(), "wiki-effects-"));
		state = mkdtempSync(join(tmpdir(), "wiki-effects-state-"));
		markers = join(state, "markers");
		mkdirSync(markers);
		cpSync(join(REPO, ".claude"), join(vault, ".claude"), { recursive: true, filter: (src) => !RUNTIME_STATE.has(basename(src)) });
		for (const folder of ["sources", "concepts", "entities", "syntheses", "questions"]) mkdirSync(join(vault, folder));
		writeFileSync(join(vault, "Index.md"), "# Index\n");
		writeFileSync(join(vault, "concepts", "C.md"), "---\ndate: 2026-10-13\ndescription: d\ntags: [t]\n---\nNo source.\n");
		// The probe: an effect on every effect event, writing a marker named after the event.
		mkdirSync(join(vault, ".claude", "extensions", "probe"), { recursive: true });
		writeFileSync(
			join(vault, ".claude", "extensions", "probe", "index.ts"),
			[
				'import { writeFileSync } from "node:fs";',
				'import { join } from "node:path";',
				"export default {",
				'\tid: "probe",',
				"\teffects: [{",
				'\t\tid: "probe.mark",',
				'\t\ton: ["session-start", "write", "pre-compact", "stop"],',
				'\t\trun: (trigger: { event: string }) => writeFileSync(join(process.env["EFFECT_PROBE_DIR"] ?? ".", trigger.event), ""),',
				"\t}],",
				"};",
				"",
			].join("\n"),
		);
		const m = manifest();
		const extensions = [...((m["extensions"] as unknown[] | undefined) ?? []), { id: "probe", module: ".claude/extensions/probe/index.ts", events: ["session-start", "write", "pre-compact", "stop"] }];
		writeFileSync(join(vault, "vault-manifest.json"), JSON.stringify({ ...m, extensions }));
	});
	after(() => {
		rmTemp(vault);
		rmTemp(state);
	});

	const run = (script: string, stdin: object) =>
		runScript(join(vault, ".claude", "scripts", `${script}.ts`), stdin, {
			CLAUDE_PROJECT_DIR: vault,
			EFFECT_PROBE_DIR: markers,
			STOP_CHECKLIST_STATE: join(state, "checklist.json"),
			CLASSIFY_HINT_STATE: join(state, "hints.json"),
			STOP_HANDOFF_DIR: join(state, "handoff"),
			VAULT_QMD: "off",
		});

	test("session-start.ts runs the session-start effects", () => {
		const r = run("session-start", { hook_event_name: "SessionStart", source: "startup", session_id: "e1" });
		assert.equal(r.code, 0, r.stderr);
		assert.ok(existsSync(join(markers, "session-start")), "the session-start effect ran");
	});

	test("validate-write.ts runs the write effects", () => {
		const r = run("validate-write", { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(vault, "concepts", "C.md") }, session_id: "e2" });
		assert.equal(r.code, 0, r.stderr);
		assert.ok(existsSync(join(markers, "write")), "the write effect ran");
	});

	test("stop-checklist.ts runs the stop effects", () => {
		const r = run("stop-checklist", { hook_event_name: "Stop", session_id: "e3" });
		assert.equal(r.code, 0, r.stderr);
		assert.ok(existsSync(join(markers, "stop")), "the stop effect ran");
	});
});
