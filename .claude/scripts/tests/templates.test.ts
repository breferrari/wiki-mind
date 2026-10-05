/**
 * The note templates (SPEC.md §2, #14): one per note type, each declaring
 * every frontmatter field the wiki extension's write validators require for
 * that type. A note created from a template is never "Missing" a field; the
 * only warnings left are for values the user still has to fill in (an
 * entity's `kind`, a source link, a synthesis's sides).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromLoaded, runValidators } from "../core/registry.ts";
import { extension } from "../../extensions/wiki/index.ts";
import { FOLDERS, NOTE_TYPES } from "../../extensions/wiki/notes.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TEMPLATE: Record<string, string> = { source: "Source", concept: "Concept", entity: "Entity", synthesis: "Synthesis", question: "Question" };
const registry = fromLoaded([{ declaration: { id: "wiki", module: "x.ts", events: ["write"] }, extension }]);
const ctx = { vaultRoot: REPO, manifest: null, now: 0 };

/** The template as Obsidian's Templates plugin inserts it. */
function instantiate(text: string): string {
	return text.replaceAll("{{date}}", "2026-10-05").replaceAll("{{title}}", "A note");
}

describe("the note templates", () => {
	test("one template per note type, in the folder Obsidian's Templates plugin uses", () => {
		const config = JSON.parse(readFileSync(join(REPO, ".obsidian", "templates.json"), "utf-8")) as { folder: string };
		assert.equal(config.folder, "templates");
		for (const type of NOTE_TYPES) assert.ok(existsSync(join(REPO, "templates", `${TEMPLATE[type]}.md`)), type);
	});

	for (const type of NOTE_TYPES) {
		test(`${TEMPLATE[type]}.md declares every field a ${type} note needs`, async () => {
			const content = instantiate(readFileSync(join(REPO, "templates", `${TEMPLATE[type]}.md`), "utf-8"));
			const { result, failures } = await runValidators(registry, { relPath: `${FOLDERS[type]}/A note.md`, content }, ctx);
			assert.deepEqual(failures, []);
			assert.deepEqual(result.filter((w) => w.startsWith("Missing")), [], "no field is missing");
			if (type === "question") assert.deepEqual(result, [], "a new question is valid as it stands: status open");
		});
	}
});
