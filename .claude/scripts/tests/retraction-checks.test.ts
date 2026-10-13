/**
 * The checks SPEC.md §2.1 adds to wiki-mind's extension: a source's
 * `status` and `superseded_by` at write time, `wiki.unsourced` counting
 * only current sources, and `wiki.stale-citation` for a link to a source
 * that is no longer current with no marker after it. The write-time
 * source-link rule keeps counting every source, so the command's own
 * writes never warn.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTemp } from "./_helpers.ts";
import { fromLoaded, runDetectors, runValidators } from "../core/registry.ts";
import type { HookContext } from "../core/types.ts";
import { extension } from "../../extensions/wiki/index.ts";
import { MARK } from "../../extensions/wiki/claims.ts";

const fm = (fields: Record<string, string>) =>
	`---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
const BASE = { date: "2026-10-12", description: "d", tags: "[t]" };
const SOURCE = { ...BASE, authors: "A", year: "2024", url: "https://a" };

let root = "";
let ctx: HookContext;
const registry = fromLoaded([
	{ declaration: { id: "wiki", module: ".claude/extensions/wiki/index.ts", events: ["stop", "write"] }, extension },
]);

function write(rel: string, content: string): void {
	const abs = join(root, rel);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content);
}

before(() => {
	root = mkdtempSync(join(tmpdir(), "wiki-retraction-checks-"));
	ctx = { vaultRoot: root, manifest: null, now: Date.now() };
	write("sources/Live.md", fm(SOURCE) + "# Live\n");
	write("sources/Gone (2024).md", fm({ ...SOURCE, status: "retracted" }) + "# Gone\n");
	write("sources/Old.md", fm({ ...SOURCE, status: "superseded", superseded_by: '"[[Live]]"' }) + "# Old\n");
	// Only a retracted source: unsourced at Stop, but no write-time warning.
	write("concepts/Fallen.md", fm(BASE) + `- A claim [[Gone (2024)]]${MARK}.\n`);
	// A current source as well: sourced.
	write("concepts/Held.md", fm(BASE) + `- A claim [[Live]] and [[Gone (2024)|the paper]]${MARK}.\n`);
	// Unmarked links to sources that are no longer current, in each form.
	write("entities/Stale.md", fm({ ...BASE, kind: "tool" }) + "- From [[Live]] and [[Gone (2024)]].\n| a | [[Old\\|old]] |\n");
	// A marked link, a withdrawn claim and a link in code: none is stale.
	write(
		"concepts/Clean.md",
		fm(BASE) + `- Still [[Live]], once [[Old#Results]]${MARK}.\n\`[[Gone (2024)]]\`\n\n## Withdrawn claims\n\n- A claim [[Gone (2024)]] (withdrawn 2026-10-12)\n`,
	);
	// A note behind a byte-order mark: its frontmatter is read as frontmatter (mindframe #82),
	// so its frontmatter link is no claim, and its unmarked body link is stale (#101).
	write("concepts/Bom.md", "\uFEFF" + fm({ ...BASE, sources: '"[[Gone (2024)]]"' }) + "- [[Live]] and [[Gone (2024)]].\n");
	// A wikilink inside a mermaid diagram is in a fence: no claim, so never stale (SPEC.md §6.2).
	write("syntheses/Drawn.md", fm({ ...BASE, sides: '["[[Held]]", "[[Clean]]"]' }) + "Per [[Live]].\n\n## Diagram\n\n```mermaid\ngraph LR\n  A[\"[[Gone (2024)]]\"] --> B\n```\n");
	// A heading behind a byte-order mark is a heading, not a claim: never stale.
	write("concepts/BomHead.md", "\uFEFF# About [[Gone (2024)]]\n\n- [[Live]].\n");
	// A question reopened on a retracted source: its answer's link is expected, not stale.
	write("questions/Reopened.md", fm({ ...BASE, status: "open" }) + "Per [[Gone (2024)]].\n\n- 2026-10-12: reopened: the answer rested on [[Gone (2024)]], retracted.\n");
	write("Index.md", "# Index\n- [[Gone (2024)]] (retracted)\n");
});
after(() => rmTemp(root));

describe("validate-write: a source's status and superseded_by (SPEC.md §2.1)", () => {
	const check = (relPath: string, content: string) => runValidators(registry, { relPath, content }, ctx);

	test("an absent status passes, and so do retracted and superseded", async () => {
		assert.deepEqual((await check("sources/S.md", fm(SOURCE))).result, []);
		assert.deepEqual((await check("sources/S.md", fm({ ...SOURCE, status: "retracted" }))).result, []);
		assert.deepEqual((await check("sources/S.md", fm({ ...SOURCE, status: "superseded", superseded_by: '"[[Live]]"' }))).result, []);
	});

	test("any other status is reported", async () => {
		assert.deepEqual((await check("sources/S.md", fm({ ...SOURCE, status: "withdrawn" }))).result, [
			'`status` is "withdrawn"; a source note\'s status is one of retracted, superseded',
		]);
	});

	test("superseded_by comes only with status: superseded, and a superseded source names one", async () => {
		assert.deepEqual((await check("sources/S.md", fm({ ...SOURCE, superseded_by: '"[[Live]]"' }))).result, [
			"`superseded_by` comes only with `status: superseded`",
		]);
		assert.deepEqual((await check("sources/S.md", fm({ ...SOURCE, status: "retracted", superseded_by: '"[[Live]]"' }))).result, [
			"`superseded_by` comes only with `status: superseded`",
		]);
		assert.deepEqual((await check("sources/S.md", fm({ ...SOURCE, status: "superseded" }))).result, [
			"A superseded source names its newer source in `superseded_by`",
		]);
	});

	test("superseded_by links a source note that exists", async () => {
		assert.deepEqual((await check("sources/S.md", fm({ ...SOURCE, status: "superseded", superseded_by: '"[[Ghost]]"' }))).result, [
			"`superseded_by` links [[Ghost]], which is not a note in sources/",
		]);
		assert.deepEqual((await check("sources/S.md", fm({ ...SOURCE, status: "superseded", superseded_by: "Live" }))).result, [
			'`superseded_by` names no note: write it as "[[Source]]"',
		]);
	});

	test("CRLF frontmatter reads the same", async () => {
		const crlf = (s: string) => s.replaceAll("\n", "\r\n");
		assert.deepEqual((await check("sources/S.md", crlf(fm({ ...SOURCE, status: "superseded", superseded_by: '"[[Live]]"' })))).result, []);
		assert.deepEqual((await check("sources/S.md", crlf(fm({ ...SOURCE, status: "withdrawn" })))).result, [
			'`status` is "withdrawn"; a source note\'s status is one of retracted, superseded',
		]);
	});

	test("a concept whose only source is no longer current gets no write-time warning", async () => {
		assert.deepEqual((await check("concepts/Fallen.md", fm(BASE) + `- A claim [[Gone (2024)]]${MARK}.\n`)).result, []);
	});
});

describe("wiki-lint (SPEC.md §2.1)", () => {
	test("wiki.unsourced counts only current sources", async () => {
		const { result, failures } = await runDetectors(registry, ctx);
		assert.deepEqual(failures, []);
		const unsourced = result.find((f) => f.claim.endsWith("no source"));
		assert.ok(unsourced, "an unsourced finding");
		assert.deepEqual(unsourced.lines, ["- concepts/Fallen.md"]);
	});

	test("wiki.stale-citation names each note with an unmarked link to a source that is no longer current", async () => {
		const { result } = await runDetectors(registry, ctx);
		const stale = result.find((f) => f.claim.includes("no longer current"));
		assert.ok(stale, "a stale-citation finding");
		assert.equal(stale.claim, "2 notes link a source that is no longer current with no marker");
		assert.deepEqual(stale.lines, [
			// The BOM note's body link, on line 7, and not its frontmatter link on line 5.
			"- concepts/Bom.md ([[Gone (2024)]] on line 7)",
			"- entities/Stale.md ([[Gone (2024)]] on line 7, [[Old]] on line 8)",
		]);
	});
});
