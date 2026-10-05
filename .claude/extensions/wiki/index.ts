/**
 * wiki-mind's own hook behaviour, as one extension (SPEC.md §7.4):
 * - session-start sections: the wiki's counts, open questions, recent
 *   sources, and the head of Index.md;
 * - Stop: the wrap-up checklist, and detectors for concepts and entities
 *   that cite no source, one-sided syntheses, and notes Index.md doesn't
 *   annotate;
 * - prompt signals: a new source, a comparison, a question;
 * - write validators: the frontmatter and link rules of SPEC.md §2.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripFrontmatter, type Extension, type Finding, type HookContext, type WriteTarget } from "../../scripts/core/index.ts";
import {
	FOLDERS,
	NOTE_TYPES,
	type Note,
	type NoteType,
	citesSource,
	field,
	frontmatter,
	hasField,
	linkedNames,
	listField,
	listNotes,
	typeOf,
} from "./notes.ts";

/** Every note's frontmatter (SPEC.md §2). */
const GLOBAL_FIELDS = ["date", "description", "tags"] as const;

/** Each type's own frontmatter (SPEC.md §2). */
const TYPE_FIELDS: Readonly<Record<NoteType, readonly string[]>> = {
	source: ["authors", "year", "url"],
	concept: [],
	entity: ["kind"],
	synthesis: ["sides"],
	question: ["status"],
};

/** Fields whose value is one of a fixed set (SPEC.md §2). */
const ENUM_FIELDS: Readonly<Partial<Record<NoteType, { field: string; values: readonly string[] }>>> = {
	entity: { field: "kind", values: ["system", "tool", "person"] },
	question: { field: "status", values: ["open", "answered", "dropped"] },
};

const OPEN_QUESTIONS_SHOWN = 15;
const RECENT_SOURCES_SHOWN = 8;
const INDEX_LINES_SHOWN = 40;

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

function sourceNames(ctx: HookContext): Set<string> {
	return new Set(listNotes(ctx.vaultRoot, "source").map((n) => n.name.toLowerCase()));
}

/** True when a concept or entity note fails the source-link rule. */
function unsourced(note: Note, sources: ReadonlySet<string>): boolean {
	return (note.type === "concept" || note.type === "entity") && !citesSource(note.content, sources);
}

function isOpen(note: Note): boolean {
	return (field(note.content, "status") ?? "").toLowerCase() === "open";
}

function frontmatterWarnings(type: NoteType, content: string): string[] {
	if (frontmatter(content) === null) return ["Missing YAML frontmatter (SPEC.md §2)"];
	const warnings: string[] = [];
	for (const name of [...GLOBAL_FIELDS, ...TYPE_FIELDS[type]]) {
		if (!hasField(content, name)) warnings.push(`Missing \`${name}\` in frontmatter (required for ${article(type)} note, SPEC.md §2)`);
	}
	const rule = ENUM_FIELDS[type];
	if (rule !== undefined && hasField(content, rule.field)) {
		const value = (field(content, rule.field) ?? "").toLowerCase();
		if (!rule.values.includes(value)) warnings.push(`\`${rule.field}\` is "${value}"; ${article(type)} note's ${rule.field} is one of ${rule.values.join(", ")}`);
	}
	return warnings;
}

function findingOf(claim: string, notes: readonly Note[], why?: (n: Note) => string): Finding[] {
	if (notes.length === 0) return [];
	return [{ claim, lines: notes.map((n) => `- ${n.relPath}${why === undefined ? "" : ` (${why(n)})`}`) }];
}

export const extension: Extension = {
	id: "wiki",

	sections: [
		{
			id: "wiki.counts",
			priority: 0,
			header: "### Wiki",
			render: (ctx) => {
				const counts = NOTE_TYPES.map((t) => [t, listNotes(ctx.vaultRoot, t)] as const);
				const open = (counts.find(([t]) => t === "question")?.[1] ?? []).filter(isOpen).length;
				return counts
					.map(([t, notes]) => `${FOLDERS[t]}: ${notes.length}${t === "question" ? ` (${open} open)` : ""}`)
					.join(" · ");
			},
		},
		{
			id: "wiki.open-questions",
			priority: 10,
			header: "### Open questions",
			pointer: "(Over budget: list questions/ with `status: open` on demand.)",
			render: (ctx) => {
				const open = listNotes(ctx.vaultRoot, "question").filter(isOpen);
				if (open.length === 0) return null;
				const lines = open.slice(0, OPEN_QUESTIONS_SHOWN).map((n) => {
					const description = field(n.content, "description");
					return `- [[${n.name}]]${description === null ? "" : ` — ${description}`}`;
				});
				if (open.length > OPEN_QUESTIONS_SHOWN) lines.push(`… and ${open.length - OPEN_QUESTIONS_SHOWN} more`);
				return lines.join("\n");
			},
		},
		{
			id: "wiki.recent-sources",
			priority: 20,
			header: "### Recent sources",
			pointer: "(Over budget: list sources/ by modified time on demand.)",
			render: (ctx) => {
				const sources = listNotes(ctx.vaultRoot, "source").sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : 1));
				if (sources.length === 0) return null;
				return sources
					.slice(0, RECENT_SOURCES_SHOWN)
					.map((n) => `- [[${n.name}]] (${new Date(n.mtimeMs).toISOString().slice(0, 10)})`)
					.join("\n");
			},
		},
		{
			id: "wiki.index",
			priority: 30,
			header: "### Index",
			pointer: "(Over budget: read Index.md on demand.)",
			render: (ctx) => {
				const path = join(ctx.vaultRoot, "Index.md");
				if (!existsSync(path)) return null;
				const text = stripFrontmatter(readFileSync(path, "utf-8")).trim();
				if (text === "") return null;
				const lines = text.split(/\r?\n/);
				const shown = lines.slice(0, INDEX_LINES_SHOWN);
				if (lines.length > INDEX_LINES_SHOWN) shown.push(`… (${lines.length - INDEX_LINES_SHOWN} more lines in Index.md)`);
				return shown.join("\n");
			},
		},
	],

	checklist: [
		{ id: "wiki.checklist.index", priority: 10, full: "Update Index.md? (a one-line annotation per new note)", short: "update Index.md" },
		{ id: "wiki.checklist.links", priority: 20, full: "New notes linked? (concepts and entities cite a source; orphans are bugs)", short: "link new notes" },
		{ id: "wiki.checklist.lint", priority: 30, full: "To act on any drift, or after many new notes, ask the agent to run /wiki-lint", short: "ask the agent to run /wiki-lint for drift" },
	],

	detectors: [
		{
			id: "wiki.unsourced",
			priority: 10,
			detect: (ctx) => {
				const sources = sourceNames(ctx);
				const notes = [...listNotes(ctx.vaultRoot, "concept"), ...listNotes(ctx.vaultRoot, "entity")].filter((n) => unsourced(n, sources));
				return findingOf(`${plural(notes.length, "concept or entity note")} cite${notes.length === 1 ? "s" : ""} no source`, notes);
			},
		},
		{
			id: "wiki.one-sided",
			priority: 20,
			detect: (ctx) => {
				const notes = listNotes(ctx.vaultRoot, "synthesis").filter((n) => listField(n.content, "sides").length < 2);
				return findingOf(`${plural(notes.length, "synthesis", "syntheses")} with fewer than two sides`, notes, (n) => `sides: ${listField(n.content, "sides").length}`);
			},
		},
		{
			id: "wiki.unindexed",
			priority: 30,
			detect: (ctx) => {
				const path = join(ctx.vaultRoot, "Index.md");
				if (!existsSync(path)) return [];
				const indexed = linkedNames(readFileSync(path, "utf-8"));
				const notes = NOTE_TYPES.flatMap((t) => listNotes(ctx.vaultRoot, t)).filter((n) => !indexed.has(n.name.toLowerCase()));
				return findingOf(`${plural(notes.length, "note")} Index.md doesn't annotate`, notes);
			},
		},
	],

	signals: [
		{
			id: "wiki.signal.source",
			priority: 10,
			match: (prompt) => /https?:\/\/|\barxiv\b|\bdoi\.org\b|\.pdf\b/i.test(prompt),
			hint: "NEW SOURCE: consider /wiki-ingest, which writes the sources/ note and updates the concepts and entities it informs",
		},
		{
			id: "wiki.signal.comparison",
			priority: 20,
			match: (prompt) => /\b(vs\.?|versus|compared? (to|with)|difference between)\b/i.test(prompt),
			hint: "COMPARISON: consider /wiki-synthesize, which writes a syntheses/ note over the concept and entity notes it compares",
		},
		{
			id: "wiki.signal.question",
			priority: 30,
			match: (prompt) => /\b(open question|i wonder|unclear (whether|if)|not sure (whether|if))\b/i.test(prompt),
			hint: "QUESTION: consider /wiki-question, which files it in questions/ with `status: open`",
		},
	],

	validators: [
		{
			id: "wiki.frontmatter",
			priority: 10,
			appliesTo: (relPath) => typeOf(relPath) !== null,
			validate: (target: WriteTarget) => {
				const type = typeOf(target.relPath);
				return type === null ? [] : frontmatterWarnings(type, target.content);
			},
		},
		{
			id: "wiki.source-link",
			priority: 20,
			appliesTo: (relPath) => {
				const type = typeOf(relPath);
				return type === "concept" || type === "entity";
			},
			validate: (target, ctx) =>
				citesSource(target.content, sourceNames(ctx))
					? []
					: ["Cites no source: link at least one note in sources/ (SPEC.md §2)"],
		},
		{
			id: "wiki.synthesis-sides",
			priority: 30,
			appliesTo: (relPath) => typeOf(relPath) === "synthesis",
			validate: (target) => {
				const sides = listField(target.content, "sides").length;
				return sides >= 2 ? [] : [`A synthesis compares two or more notes: \`sides\` lists ${sides} (SPEC.md §2)`];
			},
		},
	],
};

export default extension;
