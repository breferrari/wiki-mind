/**
 * The retraction pass of SPEC.md §2.1 (.claude/extensions/wiki/retract.ts):
 * planRetraction sorts every line that links the source, and
 * applyRetraction writes each changed note whole, through the writer it is
 * given, stopping at the first failure. Each test builds its own temp vault.
 */
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTemp } from "./_helpers.ts";
import { applyRetraction, formatReport, planRetraction, RetractError, type Outcome, type RetractOptions } from "../../extensions/wiki/retract.ts";

const DATE = "2026-10-12";
const LATER = "2026-11-02";
const MARK = " (no longer current)";
const fm = (fields: Record<string, string>) =>
	`---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
const BASE = { date: "2026-10-01", description: "d", tags: "[t]" };
const SOURCE = { ...BASE, authors: "A", year: "2024", url: "https://a" };

let roots: string[] = [];
afterEach(() => {
	for (const r of roots) rmTemp(r);
	roots = [];
});

function vault(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "wiki-retract-"));
	roots.push(root);
	for (const [rel, content] of Object.entries(files)) {
		const abs = join(root, rel);
		mkdirSync(join(abs, ".."), { recursive: true });
		writeFileSync(abs, content);
	}
	return root;
}

const read = (root: string, rel: string) => readFileSync(join(root, rel), "utf-8");
const plainWrite = (abs: string, text: string) => writeFileSync(abs, text);

function run(root: string, opts: Partial<RetractOptions> & { source: string }) {
	const plan = planRetraction(root, { date: DATE, ...opts });
	const applied = applyRetraction(root, plan, plainWrite);
	return { plan, applied };
}

const kinds = (outcomes: readonly Outcome[]) => outcomes.map((o) => `${o.kind} ${o.relPath}${o.line === undefined ? "" : `:${o.line}`}`);

/** A small wiki around one source, Smith 2024, with every kind of citing line. */
function wiki(extra: Record<string, string> = {}) {
	return vault({
		"sources/Smith 2024.md": fm(SOURCE) + "# Smith 2024\n\n## What it says\n\nThings.\n",
		"sources/Lee 2025.md": fm(SOURCE) + "# Lee 2025\n",
		"concepts/RAG.md": fm(BASE) + "# RAG\n\n- Retrieval helps [[Smith 2024]] and [[Lee 2025]].\n- Only Smith says this [[Smith 2024]].\n",
		"Index.md": "# Index\n\n## Sources\n\n- [[Smith 2024]] the benchmark paper\n- [[Lee 2025]] the follow-up\n",
		...extra,
	});
}

describe("the source note (SPEC.md §2.1, Currency)", () => {
	test("status is set, a dated section goes directly under the H1, and the body stays", () => {
		const root = wiki();
		run(root, { source: "Smith 2024", notice: "https://notice", reason: "data fabricated" });
		const note = read(root, "sources/Smith 2024.md");
		assert.match(note, /^---\n[\s\S]*\nstatus: retracted\n---\n/);
		assert.ok(
			note.includes(`# Smith 2024\n\n## Retracted\n\n- ${DATE}: retracted. Notice: https://notice. Reason: data fabricated\n\n## What it says\n\nThings.\n`),
			note,
		);
	});

	test("a superseded source gets status, superseded_by and a Superseded section", () => {
		const root = wiki();
		run(root, { source: "Smith 2024", supersededBy: "Lee 2025" });
		const note = read(root, "sources/Smith 2024.md");
		assert.match(note, /\nstatus: superseded\nsuperseded_by: "\[\[Lee 2025\]\]"\n---\n/);
		assert.ok(note.includes(`## Superseded\n\n- ${DATE}: superseded by [[Lee 2025]].\n`), note);
	});

	test("the Index annotation gains its suffix", () => {
		const root = wiki();
		run(root, { source: "Smith 2024" });
		assert.ok(read(root, "Index.md").includes("- [[Smith 2024]] the benchmark paper (retracted)\n"));
		const sup = wiki();
		run(sup, { source: "Smith 2024", supersededBy: "Lee 2025" });
		assert.ok(read(sup, "Index.md").includes("- [[Smith 2024]] the benchmark paper (superseded by [[Lee 2025]])\n"));
	});

	test("a source with no note is an error, and nothing is written", () => {
		const root = wiki();
		assert.throws(() => planRetraction(root, { date: DATE, source: "Nobody 1999" }), (e: unknown) => e instanceof RetractError && e.code === "NO_SOURCE");
	});

	test("a newer source with no note stops the pass and names it to ingest first", () => {
		const root = wiki();
		assert.throws(
			() => planRetraction(root, { date: DATE, source: "Smith 2024", supersededBy: "Park 2026" }),
			(e: unknown) => e instanceof RetractError && e.code === "NO_NEWER_SOURCE" && /ingest Park 2026 first/.test(e.message),
		);
		assert.equal(read(root, "sources/Smith 2024.md").includes("status:"), false);
	});
});

describe("the claims that cite it", () => {
	test("MARKED keeps a claim with another current source; WITHDRAWN moves a sole-support claim to Withdrawn claims", () => {
		const root = wiki();
		const { plan } = run(root, { source: "Smith 2024" });
		assert.deepEqual(kinds(plan.outcomes).filter((k) => k.includes("concepts/")), ["MARKED concepts/RAG.md:8", "WITHDRAWN concepts/RAG.md:9"]);
		assert.equal(
			read(root, "concepts/RAG.md"),
			fm(BASE) + `# RAG\n\n- Retrieval helps [[Smith 2024]]${MARK} and [[Lee 2025]].\n\n## Withdrawn claims\n\n- Only Smith says this [[Smith 2024]]. (withdrawn ${DATE})\n`,
		);
	});

	test("every link form is a link: alias, heading, table escapes, embed, a path; one in code is not", () => {
		const root = wiki({
			"entities/Forms.md":
				fm({ ...BASE, kind: "tool" }) +
				[
					"- Alias [[Smith 2024|the paper]] and [[Lee 2025]].",
					"- Heading [[Smith 2024#Results]] and [[Lee 2025]].",
					"| row | [[Smith 2024\\|s]] | [[Lee 2025]] |",
					"| row | [[Smith 2024&#124;s]] | [[Lee 2025]] |",
					"- Embed ![[Smith 2024]] and [[Lee 2025]].",
					"- Path [[sources/Smith 2024]] and [[Lee 2025]].",
					"- Code `[[Smith 2024]]` stays.",
					"",
				].join("\n"),
		});
		const { plan } = run(root, { source: "Smith 2024" });
		// The link in code is no link, so its line is a bare mention: UNMATCHED, and left alone.
		assert.deepEqual(kinds(plan.outcomes).filter((k) => k.includes("entities/")), [
			...[7, 8, 9, 10, 11, 12].map((n) => `MARKED entities/Forms.md:${n}`),
			"UNMATCHED entities/Forms.md:13",
		]);
		const note = read(root, "entities/Forms.md");
		for (const link of ["[[Smith 2024|the paper]]", "[[Smith 2024#Results]]", "[[Smith 2024\\|s]]", "[[Smith 2024&#124;s]]", "![[Smith 2024]]", "[[sources/Smith 2024]]"]) {
			assert.ok(note.includes(link + MARK), link);
		}
		assert.ok(note.includes("- Code `[[Smith 2024]]` stays.\n"), "a link in code is left alone");
	});

	test("one line linking the source twice gets a marker after each link, once", () => {
		const root = wiki({ "concepts/Twice.md": fm(BASE) + "- [[Smith 2024]] then [[Smith 2024|again]], and [[Lee 2025]].\n" });
		run(root, { source: "Smith 2024" });
		assert.ok(read(root, "concepts/Twice.md").includes(`- [[Smith 2024]]${MARK} then [[Smith 2024|again]]${MARK}, and [[Lee 2025]].\n`));
	});

	test("an existing Withdrawn claims section is appended to, not duplicated", () => {
		const root = wiki({
			"concepts/Prior.md": fm(BASE) + "- Only [[Smith 2024]].\n\n## Withdrawn claims\n\n- Older [[Lee 2025]] (withdrawn 2026-01-01)\n",
		});
		run(root, { source: "Smith 2024" });
		assert.equal(
			read(root, "concepts/Prior.md"),
			fm(BASE) + `\n## Withdrawn claims\n\n- Older [[Lee 2025]] (withdrawn 2026-01-01)\n- Only [[Smith 2024]]. (withdrawn ${DATE})\n`,
		);
	});

	test("REOPENED: an answered question whose answer has no other current source", () => {
		const root = wiki({
			"questions/Does RAG help.md": fm({ ...BASE, status: "answered" }) + "Yes, per [[Smith 2024]].\n",
			"questions/Is it fast.md": fm({ ...BASE, status: "answered" }) + "Yes, per [[Smith 2024]] and [[Lee 2025]].\n",
		});
		const { plan } = run(root, { source: "Smith 2024" });
		assert.ok(kinds(plan.outcomes).includes("REOPENED questions/Does RAG help.md"));
		assert.ok(kinds(plan.outcomes).includes("MARKED questions/Is it fast.md:7"));
		const reopened = read(root, "questions/Does RAG help.md");
		assert.match(reopened, /\nstatus: open\n/);
		assert.ok(reopened.includes(`Yes, per [[Smith 2024]].\n\n- ${DATE}: reopened: the answer rested on [[Smith 2024]], retracted.\n`), reopened);
	});

	test("FLAGGED: a synthesis is never edited, for each of its three triggers", () => {
		const synths = {
			"concepts/Alone.md": fm(BASE) + "- Only [[Smith 2024]].\n",
			"concepts/Backed.md": fm(BASE) + "- [[Lee 2025]].\n",
			"syntheses/Side lost.md": fm({ ...BASE, sides: '["[[Alone]]", "[[Backed]]"]' }) + "Compares.\n",
			"syntheses/Named.md": fm({ ...BASE, sides: '["[[Smith 2024]]", "[[Backed]]"]' }) + "Compares.\n",
			"syntheses/Linked.md": fm({ ...BASE, sides: '["[[Backed]]", "[[RAG]]"]' }) + "Per [[Smith 2024]].\n",
			"syntheses/Untouched.md": fm({ ...BASE, sides: '["[[Backed]]", "[[RAG]]"]' }) + "Per [[Lee 2025]].\n",
		};
		const root = wiki(synths);
		const { plan } = run(root, { source: "Smith 2024" });
		const flagged = kinds(plan.outcomes).filter((k) => k.startsWith("FLAGGED"));
		assert.deepEqual(flagged.sort(), ["FLAGGED syntheses/Linked.md", "FLAGGED syntheses/Named.md", "FLAGGED syntheses/Side lost.md"]);
		for (const rel of Object.keys(synths).filter((r) => r.startsWith("syntheses/"))) assert.equal(read(root, rel), synths[rel as keyof typeof synths], rel);
	});

	test("KEPT: another source note, a frontmatter line and a heading are not claims", () => {
		const root = wiki({
			"sources/Review 2025.md": fm(SOURCE) + "# Review\n\n- Cites [[Smith 2024]].\n",
			"concepts/Heads.md": fm({ ...BASE, related: '"[[Smith 2024]]"' }) + "## About [[Smith 2024]]\n\n- [[Lee 2025]].\n",
		});
		const { plan } = run(root, { source: "Smith 2024" });
		const k = kinds(plan.outcomes);
		assert.ok(k.includes("KEPT sources/Review 2025.md:11"), k.join("\n"));
		assert.ok(k.includes("KEPT concepts/Heads.md:5"), k.join("\n"));
		assert.ok(k.includes("KEPT concepts/Heads.md:7"), k.join("\n"));
		assert.equal(read(root, "sources/Review 2025.md"), fm(SOURCE) + "# Review\n\n- Cites [[Smith 2024]].\n");
	});

	test("UNMATCHED: a mention of the source with no link is reported and left alone", () => {
		const root = wiki({ "concepts/Chunking.md": fm(BASE) + "- As Smith 2024 found, [[Lee 2025]] agrees.\n" });
		const { plan } = run(root, { source: "Smith 2024" });
		assert.ok(kinds(plan.outcomes).includes("UNMATCHED concepts/Chunking.md:6"));
		assert.equal(read(root, "concepts/Chunking.md"), fm(BASE) + "- As Smith 2024 found, [[Lee 2025]] agrees.\n");
	});

	test("a source linking itself is not a citation of itself", () => {
		const root = wiki({ "sources/Smith 2024.md": fm(SOURCE) + "# Smith 2024\n\nSee [[Smith 2024#Results]].\n" });
		const { plan } = run(root, { source: "Smith 2024" });
		assert.equal(plan.outcomes.some((o) => o.relPath === "sources/Smith 2024.md"), false);
	});

	test("a source nothing cites still changes, and the report says no note cites it", () => {
		const root = vault({ "sources/Solo 2020.md": fm(SOURCE) + "# Solo\n", "Index.md": "# Index\n- [[Solo 2020]] alone\n" });
		const { plan, applied } = run(root, { source: "Solo 2020" });
		assert.match(read(root, "sources/Solo 2020.md"), /status: retracted/);
		assert.match(formatReport(plan, applied), /No note cites \[\[Solo 2020\]\]\./);
	});

	test("a source name with spaces and parentheses", () => {
		const root = vault({
			"sources/Doe (2023) v2.md": fm(SOURCE) + "# Doe\n",
			"concepts/X.md": fm(BASE) + "- Only [[Doe (2023) v2]].\n",
			"Index.md": "# Index\n",
		});
		run(root, { source: "Doe (2023) v2" });
		assert.ok(read(root, "concepts/X.md").includes(`- Only [[Doe (2023) v2]]. (withdrawn ${DATE})\n`));
	});
});

describe("supersession", () => {
	test("RESTATE: a sole-support line is withdrawn and reported for the agent; the script writes no claim", () => {
		const root = wiki();
		const { plan } = run(root, { source: "Smith 2024", supersededBy: "Lee 2025" });
		const restate = plan.outcomes.find((o) => o.kind === "RESTATE");
		assert.deepEqual(restate && { relPath: restate.relPath, line: restate.line }, { relPath: "concepts/RAG.md", line: 9 });
		assert.match(restate?.detail ?? "", /\[\[Lee 2025\]\]/);
		const note = read(root, "concepts/RAG.md");
		assert.ok(note.includes(`- Only Smith says this [[Smith 2024]]. (withdrawn ${DATE})\n`));
		assert.equal(note.split("\n").filter((l) => l.includes("Lee 2025")).length, 1, "no restated claim was written by the script");
	});

	test("a chain: B's sole-support claims are withdrawn, and A, superseded by B, is named and not fallen back to", () => {
		const root = vault({
			"sources/A 2020.md": fm({ ...SOURCE, status: "superseded", superseded_by: '"[[B 2022]]"' }) + "# A\n",
			"sources/B 2022.md": fm(SOURCE) + "# B\n",
			"concepts/C.md": fm(BASE) + "- Restated from [[B 2022]].\n\n## Withdrawn claims\n\n- Once from [[A 2020]]. (withdrawn 2026-01-01)\n",
			"Index.md": "# Index\n",
		});
		const { plan } = run(root, { source: "B 2022" });
		assert.ok(kinds(plan.outcomes).includes("WITHDRAWN concepts/C.md:6"));
		const a = plan.outcomes.find((o) => o.relPath === "sources/A 2020.md");
		assert.equal(a?.kind, "KEPT");
		assert.match(a?.detail ?? "", /superseded by \[\[B 2022\]\]/);
	});
});

describe("re-runs and status changes", () => {
	test("a second run changes nothing", () => {
		const root = wiki({ "questions/Q.md": fm({ ...BASE, status: "answered" }) + "Per [[Smith 2024]].\n" });
		run(root, { source: "Smith 2024" });
		const before = ["sources/Smith 2024.md", "concepts/RAG.md", "questions/Q.md", "Index.md"].map((r) => read(root, r));
		const { plan, applied } = run(root, { source: "Smith 2024", date: LATER });
		assert.deepEqual(applied.written, []);
		assert.deepEqual(plan.outcomes.filter((o) => o.kind !== "KEPT"), []);
		assert.deepEqual(["sources/Smith 2024.md", "concepts/RAG.md", "questions/Q.md", "Index.md"].map((r) => read(root, r)), before);
	});

	test("superseded then retracted: the status changes, superseded_by goes, and the dated section gains a line", () => {
		const root = wiki();
		run(root, { source: "Smith 2024", supersededBy: "Lee 2025" });
		run(root, { source: "Smith 2024", date: LATER });
		const note = read(root, "sources/Smith 2024.md");
		assert.match(note, /\nstatus: retracted\n---\n/);
		assert.equal(note.includes("superseded_by"), false);
		assert.ok(note.includes(`## Superseded\n\n- ${DATE}: superseded by [[Lee 2025]].\n- ${LATER}: retracted.\n`), note);
		assert.ok(read(root, "Index.md").includes("- [[Smith 2024]] the benchmark paper (retracted)\n"));
	});
});

describe("--undo (a retraction that is itself withdrawn)", () => {
	test("status clears, markers go, sole-support lines come back marked restored, and the annotation returns", () => {
		const root = wiki({ "questions/Q.md": fm({ ...BASE, status: "answered" }) + "Per [[Smith 2024]].\n" });
		run(root, { source: "Smith 2024" });
		const { plan } = run(root, { source: "Smith 2024", undo: true, date: LATER });
		const source = read(root, "sources/Smith 2024.md");
		assert.equal(/\nstatus:/.test(source), false);
		assert.ok(source.includes(`## Retracted\n\n- ${DATE}: retracted.\n- ${LATER}: no longer retracted: the retraction was withdrawn.\n`), source);
		assert.equal(
			read(root, "concepts/RAG.md"),
			fm(BASE) +
				`# RAG\n\n- Retrieval helps [[Smith 2024]] and [[Lee 2025]].\n- Only Smith says this [[Smith 2024]].\n\n## Withdrawn claims\n\n- Only Smith says this [[Smith 2024]]. (withdrawn ${DATE}) restored ${LATER}\n`,
		);
		assert.ok(read(root, "Index.md").includes("- [[Smith 2024]] the benchmark paper\n"));
		assert.match(read(root, "questions/Q.md"), /\nstatus: open\n/, "a reopened question stays open");
		assert.ok(kinds(plan.outcomes).some((k) => k.startsWith("RESTORED concepts/RAG.md")));
	});

	test("after a supersession, withdrawn lines are not restored: the restatement stands, and they are reported", () => {
		const root = wiki();
		run(root, { source: "Smith 2024", supersededBy: "Lee 2025" });
		const { plan } = run(root, { source: "Smith 2024", undo: true, date: LATER });
		const note = read(root, "concepts/RAG.md");
		assert.ok(note.includes(`- Only Smith says this [[Smith 2024]]. (withdrawn ${DATE})\n`));
		assert.equal(note.includes("restored"), false);
		assert.ok(kinds(plan.outcomes).some((k) => k.startsWith("KEPT concepts/RAG.md")));
	});

	test("undo on a current source is an error", () => {
		const root = wiki();
		assert.throws(() => planRetraction(root, { date: DATE, source: "Smith 2024", undo: true }), (e: unknown) => e instanceof RetractError && e.code === "CURRENT");
	});
});

describe("writes (SPEC.md §2.1, Writes)", () => {
	test("CRLF notes keep CRLF", () => {
		const crlf = (s: string) => s.replaceAll("\n", "\r\n");
		const root = wiki({
			"sources/Smith 2024.md": crlf(fm(SOURCE) + "# Smith 2024\n\nThings.\n"),
			"concepts/RAG.md": crlf(fm(BASE) + "- Both [[Smith 2024]] and [[Lee 2025]].\n- Only [[Smith 2024]].\n"),
		});
		run(root, { source: "Smith 2024" });
		for (const rel of ["sources/Smith 2024.md", "concepts/RAG.md"]) {
			const text = read(root, rel);
			assert.equal(/[^\r]\n/.test(text), false, `${rel} has a bare LF`);
		}
		assert.ok(read(root, "concepts/RAG.md").includes(`\r\n## Withdrawn claims\r\n\r\n- Only [[Smith 2024]]. (withdrawn ${DATE})\r\n`));
	});

	test("a failed write stops the pass, the result says what was and wasn't written, and a re-run finishes", () => {
		const root = wiki({ "entities/Locked.md": fm({ ...BASE, kind: "tool" }) + "- Only [[Smith 2024]].\n" });
		const plan = planRetraction(root, { date: DATE, source: "Smith 2024" });
		const order = plan.writes.map((w) => w.relPath);
		const failAt = order.indexOf("entities/Locked.md");
		assert.ok(failAt > 0, `the locked note is written after others: ${order.join(", ")}`);
		const applied = applyRetraction(root, plan, (abs, text) => {
			if (abs.endsWith(join("entities", "Locked.md"))) throw new Error("EPERM: operation not permitted");
			plainWrite(abs, text);
		});
		assert.deepEqual(applied.written, order.slice(0, failAt));
		assert.deepEqual(applied.notWritten, order.slice(failAt));
		assert.match(applied.error?.message ?? "", /EPERM/);
		assert.equal(applied.error?.relPath, "entities/Locked.md");
		assert.equal(read(root, "entities/Locked.md"), fm({ ...BASE, kind: "tool" }) + "- Only [[Smith 2024]].\n", "the failed note is untouched");
		assert.match(formatReport(plan, applied), /Not written: entities\/Locked\.md/);
		const rerun = run(root, { source: "Smith 2024" });
		assert.ok(rerun.applied.written.includes("entities/Locked.md"));
		assert.ok(read(root, "entities/Locked.md").includes(`(withdrawn ${DATE})`));
		assert.equal(rerun.applied.error, undefined);
	});
});
