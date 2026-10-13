/**
 * AGENTS.md as the vault's one instruction file (#25, SPEC.md §6.1), held
 * to the core's instruction-files rules (mindframe, from obsidian-mind #321):
 * - AGENTS.md ships, and stays under the core's byte cap;
 * - no retired instruction file (CLAUDE.md, GEMINI.md) ships;
 * - session-start warns when a retired one is left at the vault root after
 *   an update, since Claude Code would read a CLAUDE.md in place of AGENTS.md.
 *
 * Only the exact names are tested: the core's match will become
 * filesystem-case-aware (mindframe #91).
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS_MD_MAX_BYTES, INSTRUCTION_FILE, isRetiredInstructionFile } from "../core/index.ts";
import { collectSections, fromLoaded } from "../core/registry.ts";
import type { HookContext } from "../core/types.ts";
import { extension } from "../../extensions/wiki/index.ts";
import { rmTemp } from "./_helpers.ts";
import { installSet } from "./_shard.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("AGENTS.md ships, and is the only instruction file", () => {
	test("AGENTS.md is at the vault root, within the core's byte cap", () => {
		assert.equal(INSTRUCTION_FILE, "AGENTS.md");
		assert.ok(existsSync(join(REPO, INSTRUCTION_FILE)), "AGENTS.md ships");
		const bytes = Buffer.byteLength(readFileSync(join(REPO, INSTRUCTION_FILE), "utf-8"), "utf-8");
		assert.ok(bytes <= AGENTS_MD_MAX_BYTES, `AGENTS.md is ${bytes} B; the cap is ${AGENTS_MD_MAX_BYTES} B`);
	});

	test("no retired instruction file installs", () => {
		assert.deepEqual([...installSet(REPO)].filter((f) => !f.includes("/") && isRetiredInstructionFile(f)), []);
	});
});

describe("session-start warns about a retired instruction file left at the vault root", () => {
	let root = "";
	let ctx: HookContext;
	const registry = fromLoaded([{ declaration: { id: "wiki", module: ".claude/extensions/wiki/index.ts", events: ["session-start"] }, extension }]);
	before(() => {
		root = mkdtempSync(join(tmpdir(), "wiki-instruction-"));
		ctx = { vaultRoot: root, manifest: null, now: Date.now() };
		writeFileSync(join(root, "AGENTS.md"), "# Vault\n");
	});
	after(() => rmTemp(root));

	const warning = async () => (await collectSections(registry, ctx, "full")).result.find((s) => s.body.includes("retired"));

	test("no retired file: no warning", async () => {
		assert.equal(await warning(), undefined);
	});

	test("a GEMINI.md alone gets Gemini's reason, not Claude's", async () => {
		writeFileSync(join(root, "GEMINI.md"), "# old\n");
		const w = await warning();
		assert.ok(w, "a warning section");
		assert.match(w.body, /Gemini no longer reads `GEMINI\.md`/);
		assert.doesNotMatch(w.body, /Claude Code reads/);
	});

	test("a CLAUDE.md or GEMINI.md left behind is named, with what to do", async () => {
		writeFileSync(join(root, "CLAUDE.md"), "# my own notes\n");
		writeFileSync(join(root, "GEMINI.md"), "# old\n");
		const w = await warning();
		assert.ok(w, "a warning section");
		assert.match(w.body, /CLAUDE\.md/);
		assert.match(w.body, /GEMINI\.md/);
		assert.match(w.body, /AGENTS\.md/);
		assert.match(w.body, /Claude Code reads `CLAUDE\.md` in place of it/);
	});
});
