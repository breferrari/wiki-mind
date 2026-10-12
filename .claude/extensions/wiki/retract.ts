/**
 * The retraction pass of SPEC.md §2.1: what `/wiki-retract` does to the
 * wiki when a source is retracted or superseded, or when that is undone.
 *
 * `planRetraction` reads the vault and decides everything: the source
 * note's status and dated section, its Index.md annotation, and an outcome
 * for each line that links the source. It writes nothing. `applyRetraction`
 * writes each changed note whole, through the writer it is given (the
 * vault's atomic write), and stops at the first note it cannot write. A
 * re-run finishes the job, because a line already marked or withdrawn is not
 * touched again.
 *
 * The script never writes a claim. For a superseded source's line with no
 * other current support, it withdraws the line and reports RESTATE; the
 * agent writes the newer source's claim there.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { field, listField, listNotes, NOTE_TYPES, type Note } from "./notes.ts";
import { currentSourceNames, joinLines, type LinkSpan, linkSpans, MARK, regions, splitLines, WITHDRAWN_HEADING } from "./claims.ts";

export type Kind = "MARKED" | "WITHDRAWN" | "RESTATE" | "REOPENED" | "FLAGGED" | "KEPT" | "UNMATCHED" | "RESTORED" | "UNMARKED";

/** One thing the pass did, or deliberately left alone. `line` is 1-based, in the note as it was read. */
export type Outcome = { readonly kind: Kind; readonly relPath: string; readonly line?: number; readonly detail: string };

export type RetractOptions = {
	/** The source note's name, as a wikilink names it. */
	readonly source: string;
	/** The newer source's name, for a supersession. */
	readonly supersededBy?: string;
	/** Make the source current again: its retraction or supersession was withdrawn. */
	readonly undo?: boolean;
	/** YYYY-MM-DD, written into every dated line and suffix. */
	readonly date: string;
	readonly notice?: string;
	readonly reason?: string;
};

export type NoteWrite = { readonly relPath: string; readonly content: string };

export type Plan = {
	/** The source note's name as it is in sources/. */
	readonly source: string;
	readonly options: RetractOptions;
	readonly outcomes: readonly Outcome[];
	/** In write order: the source note, the notes by type, then Index.md. */
	readonly writes: readonly NoteWrite[];
};

export type Writer = (absPath: string, text: string) => void;

export type Applied = {
	readonly written: readonly string[];
	readonly notWritten: readonly string[];
	readonly error?: { readonly relPath: string; readonly message: string };
};

export class RetractError extends Error {
	readonly code: "NO_SOURCE" | "NO_NEWER_SOURCE" | "CURRENT";
	constructor(code: RetractError["code"], message: string) {
		super(message);
		this.code = code;
	}
}

const DATED_HEADINGS = ["## Retracted", "## Superseded"] as const;
const INDEX_SUFFIX = / \((?:retracted|superseded by \[\[[^\]]+\]\])\)$/;
const WITHDRAWN_SUFFIX = / \(withdrawn \d{4}-\d{2}-\d{2}\)$/;

const nameOf = (item: string) => (item.split(/[|#]/)[0] ?? "").split("/").pop()?.replace(/\.md$/i, "").trim().toLowerCase() ?? "";

function findSource(notes: readonly Note[], name: string): Note | undefined {
	const key = name.trim().toLowerCase();
	return notes.find((n) => n.name.toLowerCase() === key);
}

export function planRetraction(vaultRoot: string, options: RetractOptions): Plan {
	const sources = listNotes(vaultRoot, "source");
	const target = findSource(sources, options.source);
	if (target === undefined) throw new RetractError("NO_SOURCE", `No note in sources/ is named ${options.source}.`);
	const status = (field(target.content, "status") ?? "").toLowerCase();
	const wasCurrent = status !== "retracted" && status !== "superseded";
	if (options.undo === true && wasCurrent) throw new RetractError("CURRENT", `[[${target.name}]] is current: there is nothing to undo.`);
	let newer: Note | undefined;
	if (options.supersededBy !== undefined && options.undo !== true) {
		newer = findSource(sources, options.supersededBy);
		if (newer === undefined) {
			throw new RetractError("NO_NEWER_SOURCE", `No note in sources/ is named ${options.supersededBy}: ingest ${options.supersededBy} first, then supersede [[${target.name}]] by it.`);
		}
	}

	const key = target.name.toLowerCase();
	const current = currentSourceNames(vaultRoot);
	if (options.undo === true) current.add(key);
	else current.delete(key);

	const pass: Pass = {
		target,
		key,
		current,
		options,
		newStatus: options.undo === true ? null : newer !== undefined ? "superseded" : "retracted",
		oldStatus: wasCurrent ? null : (status as "retracted" | "superseded"),
		newer,
		outcomes: [],
	};

	const writes: NoteWrite[] = [];
	const sourceNote = editSourceNote(pass);
	if (sourceNote !== target.content) writes.push({ relPath: target.relPath, content: sourceNote });
	for (const type of NOTE_TYPES) {
		for (const note of listNotes(vaultRoot, type)) {
			if (note.relPath === target.relPath) continue;
			const edited = editNote(pass, note, vaultRoot);
			if (edited !== note.content) writes.push({ relPath: note.relPath, content: edited });
		}
	}
	const indexPath = join(vaultRoot, "Index.md");
	if (existsSync(indexPath)) {
		const index = readFileSync(indexPath, "utf-8");
		const edited = editIndex(pass, index);
		if (edited !== index) writes.push({ relPath: "Index.md", content: edited });
	}
	return { source: target.name, options, outcomes: pass.outcomes, writes };
}

export function applyRetraction(vaultRoot: string, plan: Plan, write: Writer): Applied {
	const written: string[] = [];
	for (const [i, w] of plan.writes.entries()) {
		try {
			write(join(vaultRoot, w.relPath), w.content);
		} catch (err) {
			return {
				written,
				notWritten: plan.writes.slice(i).map((x) => x.relPath),
				error: { relPath: w.relPath, message: err instanceof Error ? err.message : String(err) },
			};
		}
		written.push(w.relPath);
	}
	return { written, notWritten: [] };
}

export function formatReport(plan: Plan, applied?: Applied): string {
	const { options } = plan;
	const flags = options.undo === true ? " --undo" : options.supersededBy !== undefined ? ` --superseded-by "${options.supersededBy}"` : "";
	const lines = [`/wiki-retract "${plan.source}"${flags}`, ""];
	if (plan.outcomes.length === 0) lines.push(`  No note cites [[${plan.source}]].`);
	const width = Math.max(0, ...plan.outcomes.map((o) => where(o).length));
	for (const o of plan.outcomes) lines.push(`  ${o.kind.padEnd(10)}  ${where(o).padEnd(width)}  ${o.detail}`);
	const counts = new Map<Kind, number>();
	for (const o of plan.outcomes) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
	if (counts.size > 0) lines.push("", `  ${[...counts].map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")}.`);
	if (applied !== undefined) {
		lines.push("");
		lines.push(applied.written.length === 0 ? "  Written: nothing." : `  Written: ${applied.written.join(", ")}`);
		if (applied.error !== undefined) {
			lines.push(`  Not written: ${applied.notWritten.join(", ")}`);
			lines.push(`  Stopped at ${applied.error.relPath}: ${applied.error.message}. Run the command again to finish.`);
		}
	} else if (plan.writes.length > 0) {
		lines.push("", `  Would write: ${plan.writes.map((w) => w.relPath).join(", ")}`);
	}
	return lines.join("\n");
}

const where = (o: Outcome) => (o.line === undefined ? o.relPath : `${o.relPath}:${o.line}`);

type Pass = {
	readonly target: Note;
	readonly key: string;
	readonly current: ReadonlySet<string>;
	readonly options: RetractOptions;
	/** null when the pass makes the source current again. */
	readonly newStatus: "retracted" | "superseded" | null;
	readonly oldStatus: "retracted" | "superseded" | null;
	readonly newer: Note | undefined;
	readonly outcomes: Outcome[];
};

const outcome = (pass: Pass, kind: Kind, relPath: string, line: number | undefined, detail: string) =>
	pass.outcomes.push(line === undefined ? { kind, relPath, detail } : { kind, relPath, line, detail });

/** The word for what happened to the source, for dated lines. */
const fate = (pass: Pass) => (pass.newStatus === "superseded" ? "superseded" : "retracted");

// ---------------------------------------------------------------------------
// The source note: status, superseded_by, and the dated section.
// ---------------------------------------------------------------------------

function editSourceNote(pass: Pass): string {
	const { target, options } = pass;
	const supersededBy = pass.newer === undefined ? null : `"[[${pass.newer.name}]]"`;
	const unchanged =
		pass.newStatus !== null &&
		pass.newStatus === pass.oldStatus &&
		(pass.newStatus === "retracted" || field(target.content, "superseded_by") === supersededBy);
	if (unchanged) return target.content;

	const doc = splitLines(target.content);
	setField(doc.lines, "status", pass.newStatus);
	setField(doc.lines, "superseded_by", pass.newStatus === "superseded" ? supersededBy : null);

	let dated: string;
	if (pass.newStatus === null) {
		const was = pass.oldStatus === "superseded" ? "supersession" : "retraction";
		dated = `- ${options.date}: no longer ${pass.oldStatus}: the ${was} was withdrawn.`;
	} else {
		dated = `- ${options.date}: ${pass.newStatus === "superseded" ? `superseded by [[${pass.newer?.name}]]` : "retracted"}.`;
		if (options.notice !== undefined && options.notice !== "") dated += ` Notice: ${options.notice}.`;
		if (options.reason !== undefined && options.reason !== "") dated += ` Reason: ${options.reason}`;
	}
	const kinds = regions(doc.lines);
	const existing = doc.lines.findIndex((l, i) => kinds[i] === "heading" && (DATED_HEADINGS as readonly string[]).includes(l.trim()));
	if (existing !== -1) {
		doc.lines.splice(lastContentLine(doc.lines, kinds, existing) + 1, 0, dated);
	} else {
		const heading = pass.newStatus === "superseded" ? "## Superseded" : "## Retracted";
		const h1 = doc.lines.findIndex((l, i) => kinds[i] === "heading" && /^#\s/.test(l));
		if (h1 !== -1) doc.lines.splice(h1 + 1, 0, "", heading, "", dated);
		else doc.lines.splice(frontmatterEnd(kinds) + 1, 0, heading, "", dated, "");
	}
	return joinLines(doc);
}

/** Set a one-line frontmatter field, or remove it when value is null. A new field goes last. */
function setField(lines: string[], name: string, value: string | null): void {
	const kinds = regions(lines);
	const at = lines.findIndex((l, i) => kinds[i] === "frontmatter" && l.startsWith(`${name}:`));
	if (value === null) {
		if (at !== -1) lines.splice(at, 1);
		return;
	}
	if (at !== -1) lines[at] = `${name}: ${value}`;
	else lines.splice(frontmatterEnd(kinds), 0, `${name}: ${value}`);
}

/** The index of the frontmatter's closing `---`, or -1 when there is no frontmatter. */
function frontmatterEnd(kinds: readonly string[]): number {
	let end = -1;
	kinds.forEach((k, i) => {
		if (k === "frontmatter") end = i;
	});
	return end;
}

/** The last non-blank line of the section that starts at `heading`. */
function lastContentLine(lines: readonly string[], kinds: readonly string[], heading: number): number {
	let last = heading;
	for (let i = heading + 1; i < lines.length && kinds[i] !== "heading"; i++) if ((lines[i] ?? "").trim() !== "") last = i;
	return last;
}

// ---------------------------------------------------------------------------
// Index.md: the annotation's suffix.
// ---------------------------------------------------------------------------

function editIndex(pass: Pass, content: string): string {
	const doc = splitLines(content);
	const suffix =
		pass.newStatus === null ? "" : pass.newStatus === "superseded" ? ` (superseded by [[${pass.newer?.name}]])` : " (retracted)";
	doc.lines = doc.lines.map((line) => {
		if (!linkSpans(line).some((s) => s.name === pass.key)) return line;
		return line.replace(INDEX_SUFFIX, "") + suffix;
	});
	return joinLines(doc);
}

// ---------------------------------------------------------------------------
// Every other note.
// ---------------------------------------------------------------------------

function editNote(pass: Pass, note: Note, vaultRoot: string): string {
	const doc = splitLines(note.content);
	const kinds = regions(doc.lines);
	const spans = doc.lines.map((line, i) => (kinds[i] === "fence" ? [] : linkSpans(line)));
	const cites = (i: number) => (spans[i] ?? []).some((s) => s.name === pass.key);
	const undo = pass.newStatus === null;

	if (note.type === "source") {
		if (!undo) {
			spans.forEach((_, i) => {
				if (!cites(i)) return;
				const chain = kinds[i] === "frontmatter" && /^superseded_by:/.test(doc.lines[i] ?? "");
				outcome(pass, "KEPT", note.relPath, i + 1, chain ? `superseded by [[${pass.target.name}]]; its claims don't fall back to it` : "another source note: a record");
			});
		}
		return note.content;
	}

	if (note.type === "synthesis") {
		if (!undo) flagSynthesis(pass, note, vaultRoot, spans.some((_, i) => cites(i)));
		return note.content;
	}

	if (note.type === "question" && !undo && reopenQuestion(pass, note, doc, kinds, spans)) return joinLines(doc);

	// Concepts, entities, and questions that stay as they are.
	const claims = note.type === "concept" || note.type === "entity";
	const remove = new Set<number>();
	const withdrawn: string[] = [];
	const restored: string[] = [];
	doc.lines.forEach((line, i) => {
		const kind = kinds[i];
		const own = (spans[i] ?? []).filter((s) => s.name === pass.key);
		if (kind === "withdrawn") {
			if (undo && own.length > 0 && WITHDRAWN_SUFFIX.test(line)) {
				if (wasEverSuperseded(pass)) {
					outcome(pass, "KEPT", note.relPath, i + 1, "restated from a newer source: not restored");
				} else {
					restored.push(line.replace(WITHDRAWN_SUFFIX, ""));
					doc.lines[i] = `${line} restored ${pass.options.date}`;
					outcome(pass, "RESTORED", note.relPath, i + 1, "back in the note's text");
				}
			}
			return;
		}
		if (kind === "fence") return;
		if (own.length === 0) {
			if (!undo && kind === "body" && mentions(line, spans[i] ?? [], pass.target.name)) {
				outcome(pass, "UNMATCHED", note.relPath, i + 1, `names "${pass.target.name}" with no link: left alone`);
			}
			return;
		}
		if (kind === "frontmatter" || kind === "heading") {
			if (!undo) outcome(pass, "KEPT", note.relPath, i + 1, `a ${kind} line, not a claim`);
			return;
		}
		if (undo) {
			const unmarked = unmark(line, own);
			if (unmarked !== line) {
				doc.lines[i] = unmarked;
				outcome(pass, "UNMARKED", note.relPath, i + 1, "marker removed");
			}
			return;
		}
		const open = own.filter((s) => !line.startsWith(MARK, s.end));
		if (open.length === 0) return; // marked on an earlier run
		const supported = (spans[i] ?? []).some((s) => s.name !== pass.key && pass.current.has(s.name));
		if (supported || !claims) {
			doc.lines[i] = mark(line, open);
			const other = (spans[i] ?? []).find((s) => s.name !== pass.key && pass.current.has(s.name));
			outcome(pass, "MARKED", note.relPath, i + 1, other === undefined ? "a question's line: marked, not moved" : `also backed by [[${other.target}]]`);
			return;
		}
		remove.add(i);
		withdrawn.push(`${line.startsWith("- ") ? line : `- ${line.trim()}`} (withdrawn ${pass.options.date})`);
		if (pass.newStatus === "superseded") {
			outcome(pass, "RESTATE", note.relPath, i + 1, `withdrawn: write [[${pass.newer?.name}]]'s claim here, or leave it withdrawn`);
		} else {
			outcome(pass, "WITHDRAWN", note.relPath, i + 1, "moved to Withdrawn claims");
		}
	});
	if (remove.size === 0 && withdrawn.length === 0 && restored.length === 0) return joinLines(doc);
	doc.lines = doc.lines.filter((_, i) => !remove.has(i));
	if (restored.length > 0) insertBeforeWithdrawn(doc.lines, restored);
	if (withdrawn.length > 0) appendWithdrawn(doc.lines, withdrawn);
	return joinLines(doc);
}

const mark = (line: string, spans: readonly LinkSpan[]) =>
	[...spans].sort((a, b) => b.end - a.end).reduce((l, s) => l.slice(0, s.end) + MARK + l.slice(s.end), line);

function unmark(line: string, spans: readonly LinkSpan[]): string {
	return [...spans].sort((a, b) => b.end - a.end).reduce((l, s) => (l.startsWith(MARK, s.end) ? l.slice(0, s.end) + l.slice(s.end + MARK.length) : l), line);
}

/** True when a line names the source in plain text, outside its links. */
function mentions(line: string, spans: readonly LinkSpan[], name: string): boolean {
	let rest = line;
	for (const s of [...spans].sort((a, b) => b.start - a.start)) rest = rest.slice(0, s.start) + rest.slice(s.end);
	return rest.toLowerCase().includes(name.toLowerCase());
}

/** A synthesis is never edited (§2.1): it is flagged when a side loses its only current source, names the source in `sides`, or links it. */
function flagSynthesis(pass: Pass, note: Note, vaultRoot: string, links: boolean): void {
	const sides = listField(note.content, "sides").map(nameOf);
	const why: string[] = [];
	if (sides.includes(pass.key)) why.push("names the source in sides");
	const notes = [...listNotes(vaultRoot, "concept"), ...listNotes(vaultRoot, "entity")];
	for (const side of sides) {
		const sideNote = notes.find((n) => n.name.toLowerCase() === side);
		if (sideNote === undefined) continue;
		const names = new Set(splitLines(sideNote.content).lines.flatMap((l) => linkSpans(l).map((s) => s.name)));
		if (names.has(pass.key) && ![...names].some((n) => pass.current.has(n))) why.push(`[[${sideNote.name}]] lost its only current source`);
	}
	if (links && !sides.includes(pass.key)) why.push("links the source");
	if (why.length > 0) outcome(pass, "FLAGGED", note.relPath, undefined, `review the verdict: ${why.join("; ")}`);
}

/** An answered question whose answer has no other current source goes back to open, with a dated line (§2.1). */
function reopenQuestion(pass: Pass, note: Note, doc: { lines: string[] }, kinds: readonly string[], spans: readonly (readonly LinkSpan[])[]): boolean {
	const status = (field(note.content, "status") ?? "").toLowerCase();
	const body = spans.filter((_, i) => kinds[i] === "body").flat();
	const reopenedBefore = doc.lines.some((l) => l.includes(`reopened: the answer rested on [[${pass.target.name}]]`));
	if (reopenedBefore) return true;
	if (status !== "answered" || !body.some((s) => s.name === pass.key) || body.some((s) => s.name !== pass.key && pass.current.has(s.name))) return false;
	setField(doc.lines, "status", "open");
	while (doc.lines.length > 0 && (doc.lines.at(-1) ?? "").trim() === "") doc.lines.pop();
	doc.lines.push("", `- ${pass.options.date}: reopened: the answer rested on [[${pass.target.name}]], ${fate(pass)}.`, "");
	outcome(pass, "REOPENED", note.relPath, undefined, `answer rested on [[${pass.target.name}]]`);
	return true;
}

/** True when the source has ever been superseded: its withdrawn lines were restated, so --undo leaves them. */
const wasEverSuperseded = (pass: Pass) => splitLines(pass.target.content).lines.some((l) => l.trim() === "## Superseded");

/** Restored claims go back at the end of the note's text, before Withdrawn claims. */
function insertBeforeWithdrawn(lines: string[], claims: readonly string[]): void {
	const kinds = regions(lines);
	const section = lines.findIndex((l, i) => kinds[i] === "heading" && l.trim() === WITHDRAWN_HEADING);
	let at = section === -1 ? lines.length : section;
	while (at > 0 && (lines[at - 1] ?? "").trim() === "") at--;
	lines.splice(at, 0, ...claims);
}

function appendWithdrawn(lines: string[], entries: readonly string[]): void {
	const kinds = regions(lines);
	const section = lines.findIndex((l, i) => kinds[i] === "heading" && l.trim() === WITHDRAWN_HEADING);
	if (section !== -1) {
		lines.splice(lastContentLine(lines, kinds, section) + 1, 0, ...entries);
		return;
	}
	while (lines.length > 0 && (lines.at(-1) ?? "").trim() === "") lines.pop();
	lines.push("", WITHDRAWN_HEADING, "", ...entries, "");
}
