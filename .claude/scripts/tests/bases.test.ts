/**
 * The Bases views (SPEC.md §3.1, #15): one per note type, scoped to its
 * folder and leaving out the folder's README, which is not a note. Index.md
 * embeds them for the complete listings (SPEC.md §2).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FOLDERS, NOTE_TYPES } from "../../extensions/wiki/notes.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BASE: Record<string, string> = { source: "Sources", concept: "Concepts", entity: "Entities", synthesis: "Syntheses", question: "Questions" };

describe("the Bases views", () => {
	for (const type of NOTE_TYPES) {
		test(`${BASE[type]}.base lists ${FOLDERS[type]}/ and leaves its README out`, () => {
			const path = join(REPO, "bases", `${BASE[type]}.base`);
			assert.ok(existsSync(path));
			const text = readFileSync(path, "utf-8");
			assert.match(text, new RegExp(`^ {4}- file\\.inFolder\\("${FOLDERS[type]}"\\)$`, "m"));
			assert.match(text, /^ {4}- file\.name != "README"$/m);
			assert.match(text, /^views:$/m);
		});
	}

	test("Questions.base has an Open view, filtered on status", () => {
		const text = readFileSync(join(REPO, "bases", "Questions.base"), "utf-8");
		assert.match(text, /name: Open\n\s+filters:\n\s+and:\n\s+- status == "open"/);
	});
});
