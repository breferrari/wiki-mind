/**
 * wiki-mind's extension (.claude/extensions/wiki/): the sections, detectors,
 * signals and validators of SPEC.md §2 and §7.4, run through the registry
 * against a temp vault.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTemp } from "./_helpers.ts";
import { collectChecklist, collectSections, fromLoaded, matchSignals, runDetectors, runValidators } from "../core/registry.ts";
import type { HookContext } from "../core/types.ts";
import { extension } from "../../extensions/wiki/index.ts";
import { listField } from "../../extensions/wiki/notes.ts";

const fm = (fields: Record<string, string>) =>
	`---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
const BASE = { date: "2026-10-05", description: "d", tags: "[t]" };

let root = "";
let ctx: HookContext;
const registry = fromLoaded([
	{ declaration: { id: "wiki", module: ".claude/extensions/wiki/index.ts", events: ["session-start", "stop", "prompt", "write"] }, extension },
]);

function write(rel: string, content: string, mtime?: number): void {
	const abs = join(root, rel);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content);
	if (mtime !== undefined) utimesSync(abs, mtime, mtime);
}

before(() => {
	root = mkdtempSync(join(tmpdir(), "wiki-ext-"));
	ctx = { vaultRoot: root, manifest: null, now: Date.now() };
	write("sources/Old Paper.md", fm({ ...BASE, authors: "A", year: "2020", url: "https://a" }) + "# Old\n", 1_600_000_000);
	write("sources/New Paper.md", fm({ ...BASE, authors: "B", year: "2024", url: "https://b" }) + "# New\n", 1_700_000_000);
	write("sources/README.md", "# not a note\n");
	write("concepts/RAG.md", fm(BASE) + "Grounded in [[New Paper]].\n");
	write("concepts/Lonely.md", fm(BASE) + "No citation.\n");
	write("entities/FAISS.md", fm({ ...BASE, kind: "tool" }) + "From [[sources/Old Paper|the old paper]].\n");
	write("syntheses/RAG vs Finetuning.md", fm({ ...BASE, sides: "[[[RAG]], [[Finetuning]]]" }) + "# vs\n");
	write("syntheses/Half.md", `---\ndate: 2026-10-05\ndescription: d\ntags: [t]\nsides:\n  - "[[RAG]]"\n---\n`);
	write("questions/Open One.md", fm({ ...BASE, description: "why slow", status: "open" }));
	write("questions/Done.md", fm({ ...BASE, status: "answered" }));
	write("Index.md", "# Index\n- [[RAG]] the idea\n- [[New Paper]]\n- [[Old Paper]]\n- [[FAISS]]\n- [[RAG vs Finetuning]]\n- [[Open One]]\n");
});
after(() => rmTemp(root));

describe("sections", () => {
	test("counts, open questions, recent sources newest first, and the Index head, in that order", async () => {
		const { result, failures } = await collectSections(registry, ctx, "full");
		assert.deepEqual(failures, []);
		assert.deepEqual(result.map((s) => s.header), ["### Wiki", "### Open questions", "### Recent sources", "### Index"]);
		assert.equal(result[0]?.body, "sources: 2 · concepts: 2 · entities: 1 · syntheses: 2 · questions: 2 (1 open)");
		assert.equal(result[1]?.body, "- [[Open One]] — why slow");
		assert.match(result[2]?.body ?? "", /^- \[\[New Paper\]\].*\n- \[\[Old Paper\]\]/);
		assert.match(result[3]?.body ?? "", /^# Index/);
		assert.equal(result[0]?.fallback, undefined, "the counts are load-bearing");
	});
});

describe("Stop", () => {
	test("detectors find the unsourced concept, the one-sided synthesis, and the unindexed notes", async () => {
		const { result, failures } = await runDetectors(registry, ctx);
		assert.deepEqual(failures, []);
		assert.deepEqual(result.map((f) => f.claim), [
			"1 concept or entity note cites no source",
			"1 synthesis with fewer than two sides",
			"3 notes Index.md doesn't annotate",
		]);
		assert.deepEqual(result[0]?.lines, ["- concepts/Lonely.md"]);
		assert.deepEqual(result[2]?.lines, ["- concepts/Lonely.md", "- syntheses/Half.md", "- questions/Done.md"]);
	});

	test("the checklist names Index.md, source links and /wiki-lint", () => {
		const shorts = collectChecklist(registry).result.map((i) => i.short);
		assert.deepEqual(shorts, ["update Index.md", "link new notes", "ask the agent to run /wiki-lint for drift"]);
	});
});

describe("signals", () => {
	test("a URL and a comparison match; a plain prompt matches nothing", async () => {
		const hit = await matchSignals(registry, "read https://arxiv.org/abs/1 then compare RAG vs finetuning");
		assert.equal(hit.result.length, 2);
		assert.match(hit.result[0] ?? "", /^NEW SOURCE/);
		assert.match(hit.result[1] ?? "", /^COMPARISON/);
		assert.deepEqual((await matchSignals(registry, "tidy the index")).result, []);
		assert.match((await matchSignals(registry, "I wonder if chunk size matters")).result[0] ?? "", /^QUESTION/);
	});
});

describe("validators", () => {
	const check = (relPath: string, content: string) => runValidators(registry, { relPath, content }, ctx);

	test("a complete note passes", async () => {
		assert.deepEqual((await check("concepts/RAG.md", fm(BASE) + "[[New Paper]]")).result, []);
		assert.deepEqual((await check("entities/X.md", fm({ ...BASE, kind: "person" }) + "[[Old Paper]]")).result, []);
	});

	test("missing frontmatter, missing fields and an out-of-set value are each reported", async () => {
		assert.deepEqual((await check("questions/Q.md", "# no frontmatter")).result, ["Missing YAML frontmatter"]);
		const source = (await check("sources/S.md", fm({ date: "x" }))).result;
		for (const f of ["description", "tags", "authors", "year", "url"]) assert.ok(source.some((w) => w.includes(`\`${f}\``)), f);
		const entity = (await check("entities/E.md", fm({ ...BASE, kind: "company" }) + "[[Old Paper]]")).result;
		assert.deepEqual(entity, ['`kind` is "company"; an entity note\'s kind is one of system, tool, person']);
	});

	test("a concept or entity must cite a note that exists in sources/", async () => {
		assert.deepEqual((await check("concepts/C.md", fm(BASE) + "[[Ghost Paper]]")).result, ["Cites no source: link at least one note in sources/"]);
	});

	test("a synthesis needs two sides", async () => {
		assert.deepEqual((await check("syntheses/S.md", fm({ ...BASE, sides: "[[[A]]]" }))).result, ["A synthesis compares two or more notes: `sides` lists 1"]);
	});

	test("files outside the note folders, and READMEs, are not validated", async () => {
		assert.deepEqual((await check("Index.md", "no frontmatter")).result, []);
		assert.deepEqual((await check("sources/README.md", "no frontmatter")).result, []);
		assert.deepEqual((await check("sources/deep/Nested.md", "no frontmatter")).result, []);
	});
});

describe("listField", () => {
	test("reads inline lists, block lists, quotes and wikilinks", () => {
		assert.deepEqual(listField(fm({ sides: "[[[A]], [[B, with comma]]]" }), "sides"), ["A", "B, with comma"]);
		assert.deepEqual(listField(fm({ sides: '["[[A]]", "[[B]]"]' }), "sides"), ["A", "B"]);
		assert.deepEqual(listField("---\nsides:\n  - [[A]]\n  - B\nnext: 1\n---\n", "sides"), ["A", "B"]);
		assert.deepEqual(listField(fm({ other: "x" }), "sides"), []);
		assert.deepEqual(listField(fm({ sides: "[[[A]], [[B]]] # the two compared" }), "sides"), ["A", "B"]);
	});

	test("an empty frontmatter block is frontmatter with missing fields; a byte-order mark is ignored", async () => {
		const empty = await runValidators(registry, { relPath: "concepts/E.md", content: "---\n---\n[[New Paper]]" }, ctx);
		assert.ok(!empty.result.includes("Missing YAML frontmatter"));
		assert.ok(empty.result.some((w) => w.includes("`date`")));
		const bom = await runValidators(registry, { relPath: "entities/B.md", content: "﻿" + fm({ ...BASE, kind: "tool" }) + "[[New Paper]]" }, ctx);
		assert.deepEqual(bom.result, []);
	});
});
