/**
 * AGENTS.md as the vault's one instruction file (#25, SPEC.md §6.1), held
 * to the core's instruction-files rules (mindframe, from obsidian-mind #321):
 * - AGENTS.md ships, and stays under the core's byte cap;
 * - no retired instruction file (CLAUDE.md, GEMINI.md) ships;
 * - session-start warns when a retired one is left at the vault root after
 *   an update: a CLAUDE.md, which Claude Code would read in place of
 *   AGENTS.md, and a GEMINI.md where the vault's Gemini settings point Gemini
 *   at AGENTS.md instead.
 *
 * Names match as the agent opens them (mindframe #91): in any case where the
 * filesystem ignores case (Windows, macOS), exactly on Linux.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS_MD_MAX_BYTES, INSTRUCTION_FILE, filesystemIgnoresCase, isRetiredInstructionFile } from "../core/index.ts";
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
		assert.deepEqual([...installSet(REPO)].filter((f) => !f.includes("/") && isRetiredInstructionFile(f, "win32")), [], "matched as Windows does, so no case variant ships either");
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

	test("without the gemini module, a GEMINI.md is Gemini's own manual: no warning", async () => {
		writeFileSync(join(root, "GEMINI.md"), "# mine\n");
		assert.equal(await warning(), undefined);
	});

	test("with Gemini settings that name no context file, or name GEMINI.md, no warning either", async () => {
		mkdirSync(join(root, ".gemini"), { recursive: true });
		for (const settings of ['{"model":"x"}', '{"context":{"fileName":["AGENTS.md","GEMINI.md"]}}', "not json"]) {
			writeFileSync(join(root, ".gemini", "settings.json"), settings);
			assert.equal(await warning(), undefined, settings);
		}
	});

	test("with the gemini module, a GEMINI.md alone gets Gemini's reason, not Claude's", async () => {
		mkdirSync(join(root, ".gemini"), { recursive: true });
		writeFileSync(join(root, ".gemini", "settings.json"), '{"context":{"fileName":["AGENTS.md"]}}\n');
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

	describe("Gemini's settings read as Gemini reads them (mindframe #104, #119)", () => {
		before(() => {
			rmSync(join(root, "CLAUDE.md"), { force: true });
			writeFileSync(join(root, "GEMINI.md"), "# old\n");
			mkdirSync(join(root, ".gemini"), { recursive: true });
		});
		after(() => {
			rmSync(join(root, ".gemini"), { recursive: true, force: true });
			rmSync(join(root, "GEMINI.md"), { force: true });
		});

		test("settings with comments still name AGENTS.md, so a GEMINI.md is retired", async () => {
			writeFileSync(join(root, ".gemini", "settings.json"), '// the vault\'s manual\n{"context":{"fileName":["AGENTS.md"]} /* one file */}\n');
			assert.match((await warning())?.body ?? "", /Gemini no longer reads `GEMINI\.md`/);
		});

		test("settings behind a byte-order mark name nothing, as Gemini refuses them: no warning", async () => {
			writeFileSync(join(root, ".gemini", "settings.json"), '\uFEFF{"context":{"fileName":["AGENTS.md"]}}\n');
			assert.equal(await warning(), undefined);
		});
	});

	test("a lowercase claude.md is named where the filesystem ignores case, and not on Linux (mindframe #91)", async () => {
		// Its own fixture: no GEMINI.md and no Gemini settings, so only claude.md can be named.
		rmSync(join(root, "GEMINI.md"), { force: true });
		rmSync(join(root, "CLAUDE.md"), { force: true });
		rmSync(join(root, ".gemini"), { recursive: true, force: true });
		writeFileSync(join(root, "claude.md"), "# mine\n");
		try {
			const w = (await warning())?.body ?? "";
			if (!filesystemIgnoresCase()) assert.equal(w, "");
			else assert.match(w, /Claude Code reads `claude\.md` in place of it/);
		} finally {
			rmSync(join(root, "claude.md"), { force: true });
		}
	});
});
