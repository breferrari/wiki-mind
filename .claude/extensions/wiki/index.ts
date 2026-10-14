/**
 * wiki-mind's own hook behaviour, as one extension (SPEC.md §7.4):
 * - session-start sections: the wiki's counts, open questions, recent
 *   sources, and the head of Index.md;
 * - Stop: the wrap-up checklist, and detectors for concepts and entities
 *   that cite no source, one-sided syntheses, and notes Index.md doesn't
 *   annotate;
 * - prompt signals: a new source, a comparison, a question;
 * - write validators: the frontmatter and link rules of SPEC.md §2;
 * - a retracted or superseded source (SPEC.md §2.1): its `status` and
 *   `superseded_by` at write time, and at Stop, concepts and entities whose
 *   sources are all no longer current, and links to such a source with no
 *   marker after them.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_MD, INSTRUCTION_FILE, isRetiredInstructionFile, retiredInVault, sameOnDisk, stripFrontmatter, type Extension, type Finding, type HookContext, type WriteTarget } from "../../scripts/core/index.ts";
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
	statusOf,
	typeOf,
} from "./notes.ts";
import { currentSourceNames, linkSpans, noLongerCurrent, regions, splitLines, unmarkedLinks } from "./claims.ts";

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
	// Optional (SPEC.md §2.1): absent means current, and an absent field passes.
	source: { field: "status", values: ["retracted", "superseded"] },
};

const OPEN_QUESTIONS_SHOWN = 15;
const RECENT_SOURCES_SHOWN = 8;
const INDEX_LINES_SHOWN = 40;
/** An open question nobody has touched for this long is reported as stale. */
const STALE_QUESTION_DAYS = 30;

/** obsidian-mind's QMD bootstrap files, retired (#112), and the qmd extension's bootstrap, which replaced them. tests/bootstrap-path.test.ts holds the second against the extension's own path. */
const RETIRED_BOOTSTRAP_FILES = [".scripts/qmd-bootstrap.ts", ".scripts/package.json"] as const;
const BOOTSTRAP = ".claude/scripts/extensions/qmd/qmd-bootstrap.ts";

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

function sourceNames(ctx: HookContext): Set<string> {
	return new Set(listNotes(ctx.vaultRoot, "source").map((n) => n.name.toLowerCase()));
}

/** True when a concept or entity note fails the source-link rule. */
function unsourced(note: Note, sources: ReadonlySet<string>): boolean {
	return (note.type === "concept" || note.type === "entity") && !citesSource(note.content, sources);
}

/** Problems with a source's `superseded_by` (SPEC.md §2.1). */
function supersededByWarnings(content: string, sources: ReadonlySet<string>): string[] {
	const superseded = statusOf(content) === "superseded";
	if (!hasField(content, "superseded_by")) return superseded ? ["A superseded source names its newer source in `superseded_by`"] : [];
	if (!superseded) return ["`superseded_by` comes only with `status: superseded`"];
	const spans = linkSpans(field(content, "superseded_by") ?? "");
	if (spans.length === 0) return ['`superseded_by` names no note: write it as "[[Source]]"'];
	return spans
		.filter((span) => !sources.has(span.name))
		.map((span) => `\`superseded_by\` links [[${span.target}]], which is not a note in sources/`);
}

/** Each unmarked link in a note to a source that is no longer current, outside Withdrawn claims, as "[[Name]] on line N". */
function staleLinks(note: Note, stale: ReadonlyMap<string, string>): string[] {
	// Most notes name no stale source: skip them before reading line by line.
	const lower = note.content.toLowerCase();
	// A question reopened on a source (§2.1) cites it on purpose until it is re-answered.
	const names = new Set([...stale.keys()].filter((name) => lower.includes(name) && !lower.includes(`reopened: the answer rested on [[${name}]]`)));
	if (names.size === 0) return [];
	const { lines } = splitLines(note.content);
	const kinds = regions(lines);
	return lines.flatMap((line, i) =>
		kinds[i] === "body" ? unmarkedLinks(line, linkSpans(line), names).map((span) => `[[${stale.get(span.name)}]] on line ${i + 1}`) : [],
	);
}

function isOpen(note: Note): boolean {
	return statusOf(note.content) === "open";
}

function frontmatterWarnings(type: NoteType, content: string): string[] {
	if (frontmatter(content) === null) return ["Missing YAML frontmatter"];
	const warnings: string[] = [];
	for (const name of [...GLOBAL_FIELDS, ...TYPE_FIELDS[type]]) {
		if (!hasField(content, name)) warnings.push(`Missing \`${name}\` in frontmatter (required for ${article(type)} note)`);
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
			// A retired instruction file left at the vault root after an update
			// (SPEC.md §6.1): Claude Code reads a CLAUDE.md in place of AGENTS.md.
			id: "wiki.retired-instruction-files",
			priority: 0,
			header: "### Instruction files",
			render: (ctx) => {
				let names: string[];
				try {
					// CLAUDE.md always, and GEMINI.md only where the vault's Gemini
					// settings point Gemini at AGENTS.md, each name matched the way the
					// agent opens it (the core's retiredInVault, mindframe #91 and #104).
					// The settings are read only when a candidate is there.
					const candidates = readdirSync(ctx.vaultRoot).filter((n) => isRetiredInstructionFile(n));
					if (candidates.length === 0) return null;
					names = candidates.filter(retiredInVault(ctx.vaultRoot)).sort();
				} catch {
					return null;
				}
				if (names.length === 0) return null;
				const [is, it] = names.length === 1 ? ["is", "it"] : ["are", "them"];
				// Each retired file's own harm: Claude Code reads a CLAUDE.md in place of
				// AGENTS.md, and Gemini, pointed at AGENTS.md, no longer reads a GEMINI.md.
				const why = names
					.map((n) => (sameOnDisk(n, CLAUDE_MD) ? `Claude Code reads \`${n}\` in place of it` : `Gemini no longer reads \`${n}\``))
					.join("; ");
				return `⚠️ ${names.map((n) => `\`${n}\``).join(" and ")} ${is} retired: \`${INSTRUCTION_FILE}\` is this vault's one instruction file (${why}). Move anything of your own from ${it} into \`${INSTRUCTION_FILE}\` (or \`.claude/rules/\` for Claude-only notes), then delete ${it}.`;
			},
		},
		{
			// obsidian-mind's QMD bootstrap folder, which the vault no longer ships
			// (#112): update keeps a file the user edited, and the old script no
			// longer runs, since some of the libraries it imports are gone (#115).
			// Load-bearing: a pointer would show on every resume, leftover or not.
			id: "wiki.retired-bootstrap",
			priority: 0,
			header: "### QMD bootstrap",
			render: (ctx) => {
				const left = RETIRED_BOOTSTRAP_FILES.filter((f) => existsSync(join(ctx.vaultRoot, f)));
				if (left.length === 0) return null;
				return `⚠️ ${left.map((f) => `\`${f}\``).join(" and ")} ${left.length === 1 ? "is" : "are"} left from the old QMD bootstrap, which no longer runs: the vault's bootstrap is now \`${BOOTSTRAP}\`. Ask the user before removing anything: move anything of their own out first, then delete ${left.length === 1 ? "it" : "them"}, and \`.scripts/\` if nothing else is in it.`;
			},
		},
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
				// Only a current source counts (SPEC.md §2.1). The write-time rule
				// below counts every source, so a note the retraction pass has just
				// rewritten doesn't warn as it is written.
				const sources = currentSourceNames(ctx.vaultRoot);
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
		{
			id: "wiki.frontmatter",
			priority: 40,
			detect: (ctx) => {
				const broken = NOTE_TYPES.flatMap((t) => listNotes(ctx.vaultRoot, t).map((n) => ({ n, w: frontmatterWarnings(t, n.content) }))).filter((x) => x.w.length > 0);
				return findingOf(
					`${plural(broken.length, "note")} with frontmatter problems`,
					broken.map((x) => x.n),
					(n) => broken.find((x) => x.n === n)?.w[0] ?? "",
				);
			},
		},
		{
			id: "wiki.orphans",
			priority: 50,
			detect: (ctx) => {
				// An orphan links to no other note, and no note or Index.md links to it.
				const notes = NOTE_TYPES.flatMap((t) => listNotes(ctx.vaultRoot, t));
				const names = new Set(notes.map((n) => n.name.toLowerCase()));
				const inbound = new Set<string>();
				const outbound = new Map<Note, number>();
				for (const n of notes) {
					const links = [...linkedNames(n.content)].filter((l) => names.has(l) && l !== n.name.toLowerCase());
					outbound.set(n, links.length);
					for (const l of links) inbound.add(l);
				}
				const index = join(ctx.vaultRoot, "Index.md");
				if (existsSync(index)) for (const l of linkedNames(readFileSync(index, "utf-8"))) inbound.add(l);
				const orphans = notes.filter((n) => outbound.get(n) === 0 && !inbound.has(n.name.toLowerCase()));
				return findingOf(`${plural(orphans.length, "orphan note")}`, orphans);
			},
		},
		{
			id: "wiki.stale-citation",
			priority: 55,
			detect: (ctx) => {
				const stale = new Map(
					listNotes(ctx.vaultRoot, "source")
						.filter((n) => noLongerCurrent(n.content))
						.map((n) => [n.name.toLowerCase(), n.name] as const),
				);
				if (stale.size === 0) return [];
				const links = new Map(
					(["concept", "entity", "synthesis", "question"] as const)
						.flatMap((t) => listNotes(ctx.vaultRoot, t))
						.map((n) => [n, staleLinks(n, stale)] as const)
						.filter(([, l]) => l.length > 0),
				);
				return findingOf(
					`${plural(links.size, "note")} link${links.size === 1 ? "s" : ""} a source that is no longer current with no marker`,
					[...links.keys()],
					(n) => links.get(n)?.join(", ") ?? "",
				);
			},
		},
		{
			id: "wiki.stale-questions",
			priority: 60,
			detect: (ctx) => {
				// No day count in the lines: the Stop report's identity is its text,
				// and a count that grows daily would re-show an unchanged report.
				const stale = listNotes(ctx.vaultRoot, "question").filter((n) => isOpen(n) && ctx.now - n.mtimeMs > STALE_QUESTION_DAYS * 86_400_000);
				return findingOf(`${plural(stale.length, "open question")} untouched for ${STALE_QUESTION_DAYS} days`, stale);
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
					: ["Cites no source: link at least one note in sources/"],
		},
		{
			id: "wiki.superseded-by",
			priority: 25,
			appliesTo: (relPath) => typeOf(relPath) === "source",
			validate: (target, ctx) => supersededByWarnings(target.content, sourceNames(ctx)),
		},
		{
			id: "wiki.synthesis-sides",
			priority: 30,
			appliesTo: (relPath) => typeOf(relPath) === "synthesis",
			validate: (target) => {
				const sides = listField(target.content, "sides").length;
				return sides >= 2 ? [] : [`A synthesis compares two or more notes: \`sides\` lists ${sides}`];
			},
		},
	],
};

export default extension;
