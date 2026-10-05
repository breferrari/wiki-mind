/**
 * Installed text never sends a reader to a file the vault does not have.
 * SPEC.md, ROADMAP.md and CONTRIBUTING.md are repo-only (.shardmindignore),
 * so an installed Markdown file that names one points at nothing. The one
 * exception is CLAUDE.md's "Developing this shard" section: it names
 * CONTRIBUTING.md for someone working in the repo, and says installs leave
 * it out.
 *
 * Code comments that cite the spec are developer provenance, not reader
 * text, and are not checked. Runtime output is held by no-upstream-name.test.ts.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installSet } from "./_shard.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REPO_ONLY = /\b(SPEC|ROADMAP|CONTRIBUTING)\.md\b/;

describe("installed text names no repo-only file", () => {
	const markdown = [...installSet(REPO)].filter((f) => f.endsWith(".md"));

	test("the install holds the manual and the folder READMEs", () => {
		assert.ok(markdown.includes("CLAUDE.md"));
		assert.ok(markdown.includes("sources/README.md"));
	});

	for (const file of markdown) {
		test(file, () => {
			let text = readFileSync(join(REPO, file), "utf-8");
			if (file === "CLAUDE.md") {
				const at = text.indexOf("\n## Developing this shard\n");
				assert.ok(at > 0, "CLAUDE.md keeps its Developing this shard section");
				const devSection = text.slice(at);
				assert.doesNotMatch(devSection, /\b(SPEC|ROADMAP)\.md\b/, "the dev section names only CONTRIBUTING.md");
				text = text.slice(0, at);
			}
			const hit = text.split("\n").find((line) => REPO_ONLY.test(line));
			assert.equal(hit, undefined, `${file} names a repo-only file: ${hit}`);
		});
	}
});
