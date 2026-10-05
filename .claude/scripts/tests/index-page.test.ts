/**
 * Index.md, the annotated entry point (SPEC.md §2, #16): a section per note
 * type that embeds its Bases view, and one marker line the personalize hook
 * (#17) writes the owner and research focus into.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromLoaded, runDetectors } from "../core/registry.ts";
import { extension } from "../../extensions/wiki/index.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const index = readFileSync(join(REPO, "Index.md"), "utf-8");
const SECTIONS: readonly [string, string][] = [
	["Sources", "Sources.base"],
	["Concepts", "Concepts.base"],
	["Entities", "Entities.base"],
	["Syntheses", "Syntheses.base"],
	["Questions", "Questions.base"],
];

describe("Index.md", () => {
	test("a section per note type, in order, each embedding its Bases view", () => {
		let from = 0;
		for (const [heading, base] of SECTIONS) {
			const at = index.indexOf(`\n## ${heading}\n`, from);
			assert.ok(at >= from, `## ${heading} in order`);
			const next = index.indexOf("\n## ", at + 1);
			const body = index.slice(at, next === -1 ? undefined : next);
			assert.match(body, new RegExp(`!\\[\\[${base.replace(".", "\\.")}(#[^\\]]+)?\\]\\]`), `${heading} embeds ${base}`);
			assert.ok(existsSync(join(REPO, "bases", base)), `${base} exists`);
			from = at + 1;
		}
	});

	test("one personalize marker, which Obsidian hides as a comment", () => {
		assert.equal(index.split("%% wiki-mind:about %%").length - 1, 1);
	});

	test("a fresh vault has nothing Index.md fails to annotate", async () => {
		const registry = fromLoaded([{ declaration: { id: "wiki", module: "x.ts", events: ["stop"] }, extension }]);
		const { result } = await runDetectors(registry, { vaultRoot: REPO, manifest: null, now: 0 });
		assert.deepEqual(result, [], "the shipped folders hold only READMEs");
	});
});
