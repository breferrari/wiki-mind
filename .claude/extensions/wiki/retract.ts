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
import { field, linkedNames, listField, listNotes, linkName, NOTE_TYPES, type Note, statusOf } from "./notes.ts";
import {
	currentSourceNames,
	findHeading,
	joinLines,
	lastContentLine,
	type LinkSpan,
	linkSpans,
	MARK,
	noLongerCurrent,
	type Region,
	regions,
	splitLines,
	trimTrailingBlanks,
	unmarkedLinks,
	WITHDRAWN_HEADING,
} from "./claims.ts";

/** What a source is once the pass has run: retracted or superseded. */
export type Status = "retracted" | "superseded";

export type Kind = "MARKED" | "WITHDRAWN" | "RESTATE" | "REOPENED" | "FLAGGED" | "KEPT" | "UNMATCHED" | "RESTORED" | "UNMARKED";

/**
 * One thing the pass did, or deliberately left alone. `line` is 1-based, in
 * the note as it was read, except for RESTATE: there it is where the
 * restated claim goes in the note as written.
 */
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
	/**
	 * In write order: the notes by type, Index.md, then the source note. The
	 * source note goes last, so a pass that stops midway leaves its status as
	 * it was, and a re-run (retract or --undo) plans the rest.
	 */
	readonly writes: readonly NoteWrite[];
};

export type Writer = (absPath: string, text: string) => void;

export type Applied = {
	readonly written: readonly string[];
	readonly notWritten: readonly string[];
	readonly error?: { readonly relPath: string; readonly message: string };
};

export class RetractError extends Error {
	readonly code: "NO_SOURCE" | "NO_NEWER_SOURCE" | "BAD_NEWER";
	constructor(code: RetractError["code"], message: string) {
		super(message);
		this.code = code;
	}
}

const DATED_HEADINGS: readonly string[] = ["## Retracted", "## Superseded"];
const INDEX_SUFFIX = / \((?:retracted|superseded by \[\[[^\]]+\]\])\)$/;
const WITHDRAWN_SUFFIX = / \(withdrawn \d{4}-\d{2}-\d{2}\)$/;
/** A Markdown list item's marker: `-`, `*`, `+`, or `1.` / `1)`, with any indent. */
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

type Pass = {
	readonly target: Note;
	/** The target's name, lowercased as links name it. */
	readonly key: string;
	/** The current sources once this pass has run. */
	readonly current: ReadonlySet<string>;
	readonly options: RetractOptions;
	readonly undo: boolean;
	/** The status the pass sets; null when it makes the source current again. */
	readonly newStatus: Status | null;
	readonly oldStatus: Status | null;
	readonly newer: Note | undefined;
	/** The source has been superseded at some point, so its withdrawn lines may have been restated and --undo leaves them. */
	readonly everSuperseded: boolean;
	/** The sources that are not current once this pass has run, other than the target. */
	readonly stale: ReadonlySet<string>;
	/** The link names of each concept and entity, by its lowercased name, for the synthesis check. */
	readonly sideLinks: ReadonlyMap<string, { readonly name: string; readonly links: ReadonlySet<string> }>;
	readonly outcomes: Outcome[];
};

export function planRetraction(vaultRoot: string, options: RetractOptions): Plan {
	const sources = listNotes(vaultRoot, "source");
	const byName = (name: string) => sources.find((n) => n.name.toLowerCase() === name.trim().toLowerCase());
	const target = byName(options.source);
	if (target === undefined) throw new RetractError("NO_SOURCE", `No note in sources/ is named ${options.source}.`);
	const undo = options.undo === true;
	// An --undo on a current source still runs: a retraction that stopped midway
	// wrote markers and withdrawals before it reached the source note.
	const oldStatus = noLongerCurrent(target.content) ? (statusOf(target.content) as Status) : null;
	let newer: Note | undefined;
	if (options.supersededBy !== undefined && !undo) {
		newer = byName(options.supersededBy);
		if (newer === undefined) {
			throw new RetractError("NO_NEWER_SOURCE", `No note in sources/ is named ${options.supersededBy}: ingest ${options.supersededBy} first, then supersede [[${target.name}]] by it.`);
		}
		if (newer === target) throw new RetractError("BAD_NEWER", `[[${target.name}]] can't supersede itself.`);
		if (noLongerCurrent(newer.content)) throw new RetractError("BAD_NEWER", `[[${newer.name}]] is no longer current itself: it can't supersede [[${target.name}]].`);
	}

	const key = target.name.toLowerCase();
	const current = currentSourceNames(sources);
	if (undo) current.add(key);
	else current.delete(key);
	const notes = new Map(NOTE_TYPES.map((t) => [t, t === "source" ? sources : listNotes(vaultRoot, t)] as const));
	const sides = [...(notes.get("concept") ?? []), ...(notes.get("entity") ?? [])];

	const pass: Pass = {
		target,
		key,
		current,
		options,
		undo,
		newStatus: undo ? null : newer !== undefined ? "superseded" : "retracted",
		oldStatus,
		newer,
		everSuperseded: /^- \d{4}-\d{2}-\d{2}: superseded by \[\[/m.test(target.content),
		stale: new Set(sources.map((n) => n.name.toLowerCase()).filter((n) => n !== key && !current.has(n))),
		sideLinks: new Map(sides.map((n) => [n.name.toLowerCase(), { name: n.name, links: linkedNames(n.content) }])),
		outcomes: [],
	};

	const writes: NoteWrite[] = [];
	const needle = target.name.toLowerCase();
	for (const type of NOTE_TYPES) {
		for (const note of notes.get(type) ?? []) {
			if (note.relPath === target.relPath) continue;
			// Most notes never name the source: skip them before reading line by line. Not a
			// synthesis, which a side's lost source flags without the synthesis naming it.
			if (type !== "synthesis" && !note.content.toLowerCase().includes(needle)) continue;
			const edited = editNote(pass, note);
			if (edited !== note.content) writes.push({ relPath: note.relPath, content: edited });
		}
	}
	const indexPath = join(vaultRoot, "Index.md");
	if (existsSync(indexPath)) {
		const index = readFileSync(indexPath, "utf-8");
		const edited = editIndex(pass, index);
		if (edited !== index) writes.push({ relPath: "Index.md", content: edited });
	}
	const sourceNote = editSourceNote(pass);
	if (sourceNote !== target.content) writes.push({ relPath: target.relPath, content: sourceNote });
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
		lines.push("", applied.written.length === 0 ? "  Written: nothing." : `  Written: ${applied.written.join(", ")}`);
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

const emit = (pass: Pass, kind: Kind, relPath: string, line: number | undefined, detail: string) =>
	pass.outcomes.push(line === undefined ? { kind, relPath, detail } : { kind, relPath, line, detail });

// The source note: status, superseded_by, and the dated section.

function editSourceNote(pass: Pass): string {
	const { target, options } = pass;
	const supersededBy = pass.newer === undefined ? null : `"[[${pass.newer.name}]]"`;
	const sameNewer = linkSpans(field(target.content, "superseded_by") ?? "")[0]?.name === pass.newer?.name.toLowerCase();
	const unchanged = pass.newStatus === pass.oldStatus && (pass.newStatus !== "superseded" || sameNewer);
	if (unchanged) return target.content; // the same status again, or an --undo of a source never marked

	const doc = splitLines(target.content);
	setField(doc.lines, "status", pass.newStatus);
	setField(doc.lines, "superseded_by", pass.newStatus === "superseded" ? supersededBy : null);

	let dated: string;
	if (pass.newStatus === null) {
		dated = `- ${options.date}: no longer ${pass.oldStatus}: the ${pass.oldStatus === "superseded" ? "supersession" : "retraction"} was withdrawn.`;
	} else {
		dated = `- ${options.date}: ${pass.newStatus === "superseded" ? `superseded by [[${pass.newer?.name}]]` : "retracted"}.`;
		if (options.notice) dated += ` Notice: ${options.notice}.`;
		if (options.reason) dated += ` Reason: ${options.reason}`;
	}
	const kinds = regions(doc.lines);
	const existing = findHeading(doc.lines, kinds, (h) => DATED_HEADINGS.includes(h));
	if (existing !== -1) {
		doc.lines.splice(lastContentLine(doc.lines, kinds, existing) + 1, 0, dated);
	} else {
		const heading = pass.newStatus === "superseded" ? "## Superseded" : "## Retracted";
		const h1 = findHeading(doc.lines, kinds, (h) => /^#\s/.test(h));
		if (h1 !== -1) doc.lines.splice(h1 + 1, 0, "", heading, "", dated);
		else doc.lines.splice(kinds.lastIndexOf("frontmatter") + 1, 0, heading, "", dated, "");
	}
	return joinLines(doc);
}

/** Set a one-line frontmatter field, or remove it when value is null. A new field goes last. */
function setField(lines: string[], name: string, value: string | null): void {
	const kinds = regions(lines);
	const at = lines.findIndex((l, i) => kinds[i] === "frontmatter" && l.startsWith(`${name}:`));
	const close = kinds.lastIndexOf("frontmatter");
	if (value === null) {
		if (at !== -1) lines.splice(at, 1);
	} else if (at !== -1) {
		lines[at] = `${name}: ${value}`;
	} else if (close === -1) {
		lines.unshift("---", `${name}: ${value}`, "---");
	} else {
		lines.splice(close, 0, `${name}: ${value}`);
	}
}

// Index.md: the annotation's suffix.

function editIndex(pass: Pass, content: string): string {
	const doc = splitLines(content);
	const suffix = pass.newStatus === null ? "" : pass.newStatus === "superseded" ? ` (superseded by [[${pass.newer?.name}]])` : " (retracted)";
	// The source's own annotation: the line whose first link is the source.
	doc.lines = doc.lines.map((line) => (linkSpans(line)[0]?.name === pass.key ? line.replace(INDEX_SUFFIX, "") + suffix : line));
	return joinLines(doc);
}

// Every other note, by type.

/** A note read line by line: its lines, their regions, and each line's links (none in a fence). */
type Read = { readonly doc: ReturnType<typeof splitLines>; readonly kinds: readonly Region[]; readonly spans: readonly (readonly LinkSpan[])[] };

function readNote(note: Note): Read {
	const doc = splitLines(note.content);
	const kinds = regions(doc.lines);
	return { doc, kinds, spans: doc.lines.map((line, i) => (kinds[i] === "fence" ? [] : linkSpans(line))) };
}

const citesOn = (pass: Pass, spans: readonly LinkSpan[]) => spans.some((s) => s.name === pass.key);

function editNote(pass: Pass, note: Note): string {
	const read = readNote(note);
	switch (note.type) {
		case "source":
			if (!pass.undo) keepSourceRecord(pass, note, read);
			return note.content;
		case "synthesis":
			if (!pass.undo) flagSynthesis(pass, note, read);
			return note.content;
		case "question":
			if (!pass.undo && reopenQuestion(pass, note, read)) return joinLines(read.doc);
			return editClaims(pass, note, read, false);
		default:
			return editClaims(pass, note, read, true);
	}
}

/** Another source note is a record of what it said (§2.1): reported, never edited. */
function keepSourceRecord(pass: Pass, note: Note, { doc, kinds, spans }: Read): void {
	spans.forEach((s, i) => {
		if (!citesOn(pass, s)) return;
		const chain = kinds[i] === "frontmatter" && /^superseded_by:/.test(doc.lines[i] ?? "");
		emit(pass, "KEPT", note.relPath, i + 1, chain ? `superseded by [[${pass.target.name}]]; its claims don't fall back to it` : "another source note: a record");
	});
}

/** A synthesis is never edited (§2.1): flagged when a side loses its only current source, names the source in `sides`, or links it. */
function flagSynthesis(pass: Pass, note: Note, { spans }: Read): void {
	const sides = listField(note.content, "sides").map((item) => linkName(item.split(/[|#]/)[0] ?? ""));
	const why: string[] = [];
	if (sides.includes(pass.key)) why.push("names the source in sides");
	for (const side of sides) {
		const s = pass.sideLinks.get(side);
		if (s !== undefined && s.links.has(pass.key) && ![...s.links].some((n) => pass.current.has(n))) why.push(`[[${s.name}]] lost its only current source`);
	}
	if (!sides.includes(pass.key) && spans.some((s) => citesOn(pass, s))) why.push("links the source");
	if (why.length > 0) emit(pass, "FLAGGED", note.relPath, undefined, `review the verdict: ${why.join("; ")}`);
}

/** An answered question whose answer has no other current source goes back to open, with a dated line (§2.1). True when the question is settled for this pass. */
function reopenQuestion(pass: Pass, note: Note, { doc, kinds, spans }: Read): boolean {
	if (doc.lines.some((l) => l.includes(`reopened: the answer rested on [[${pass.target.name}]]`))) return true; // reopened on an earlier run
	const body = spans.filter((_, i) => kinds[i] === "body").flat();
	if (statusOf(note.content) !== "answered" || !citesOn(pass, body) || body.some((s) => s.name !== pass.key && pass.current.has(s.name))) return false;
	setField(doc.lines, "status", "open");
	trimTrailingBlanks(doc.lines);
	doc.lines.push("", `- ${pass.options.date}: reopened: the answer rested on [[${pass.target.name}]], ${pass.newStatus}.`, "");
	emit(pass, "REOPENED", note.relPath, undefined, `answer rested on [[${pass.target.name}]]`);
	return true;
}

/**
 * Concepts and entities (`withdraw`), and questions that stay as they are:
 * each line that links the source is marked, withdrawn, restated or kept;
 * under --undo, markers come off and withdrawn lines come back.
 */
function editClaims(pass: Pass, note: Note, { doc, kinds, spans }: Read, withdraw: boolean): string {
	const target = new Set([pass.key]);
	const remove = new Set<number>();
	const withdrawn: string[] = [];
	const restored: string[] = [];
	doc.lines.forEach((line, i) => {
		const own = (spans[i] ?? []).filter((s) => s.name === pass.key);
		switch (kinds[i]) {
			case "fence":
				return;
			case "withdrawn":
				if (pass.undo && own.length > 0 && WITHDRAWN_SUFFIX.test(line)) {
					if (pass.everSuperseded) {
						emit(pass, "KEPT", note.relPath, i + 1, "the source was superseded, so this line may have been restated: not restored. Restore it by hand if it wasn't");
					} else {
						const claim = line.replace(WITHDRAWN_SUFFIX, "");
						const back = unmark(claim, linkSpans(claim).filter((s) => s.name === pass.key));
						// Its other links to sources that are no longer current get their marker now.
						restored.push(mark(back, unmarkedLinks(back, linkSpans(back), pass.stale)));
						doc.lines[i] = `${line} restored ${pass.options.date}`;
						emit(pass, "RESTORED", note.relPath, i + 1, "back in the note's text");
					}
				}
				return;
			case "frontmatter":
			case "heading":
				if (own.length > 0 && !pass.undo) emit(pass, "KEPT", note.relPath, i + 1, `a ${kinds[i]} line, not a claim`);
				return;
		}
		if (own.length === 0) {
			if (!pass.undo && mentions(line, spans[i] ?? [], pass.target.name)) emit(pass, "UNMATCHED", note.relPath, i + 1, `names "${pass.target.name}" with no link: left alone`);
			return;
		}
		if (pass.undo) {
			const unmarked = unmark(line, own);
			if (unmarked !== line) {
				doc.lines[i] = unmarked;
				emit(pass, "UNMARKED", note.relPath, i + 1, "marker removed");
			}
			return;
		}
		const open = unmarkedLinks(line, own, target);
		if (open.length === 0) return; // marked on an earlier run
		const other = (spans[i] ?? []).find((s) => s.name !== pass.key && pass.current.has(s.name));
		if (other !== undefined || !withdraw) {
			doc.lines[i] = mark(line, open);
			emit(pass, "MARKED", note.relPath, i + 1, other === undefined ? "a question's line: marked, not moved" : `also backed by [[${other.target}]]`);
			return;
		}
		remove.add(i);
		withdrawn.push(`- ${line.replace(LIST_MARKER, "").trim()} (withdrawn ${pass.options.date})`);
		// Where the restated claim goes once the withdrawn lines are gone: this line's place.
		if (pass.newStatus === "superseded") emit(pass, "RESTATE", note.relPath, i + 2 - remove.size, `withdrawn: write [[${pass.newer?.name}]]'s claim at this line, or leave it withdrawn`);
		else emit(pass, "WITHDRAWN", note.relPath, i + 1, "moved to Withdrawn claims");
	});
	if (remove.size > 0) doc.lines = doc.lines.filter((_, i) => !remove.has(i));
	if (restored.length > 0) insertBeforeWithdrawn(doc.lines, restored);
	if (withdrawn.length > 0) appendWithdrawn(doc.lines, withdrawn);
	return joinLines(doc);
}

/** Insert MARK after each span, right to left so earlier offsets hold. */
const mark = (line: string, spans: readonly LinkSpan[]) => spans.toReversed().reduce((l, s) => l.slice(0, s.end) + MARK + l.slice(s.end), line);

const unmark = (line: string, spans: readonly LinkSpan[]) =>
	spans.toReversed().reduce((l, s) => (l.startsWith(MARK, s.end) ? l.slice(0, s.end) + l.slice(s.end + MARK.length) : l), line);

/** True when a line names the source in plain text, outside its links. */
function mentions(line: string, spans: readonly LinkSpan[], name: string): boolean {
	const rest = spans.toReversed().reduce((l, s) => l.slice(0, s.start) + l.slice(s.end), line);
	return rest.toLowerCase().includes(name.toLowerCase());
}

/** Restored claims go back at the end of the note's text, before Withdrawn claims. */
function insertBeforeWithdrawn(lines: string[], claims: readonly string[]): void {
	const section = findHeading(lines, regions(lines), (h) => h === WITHDRAWN_HEADING);
	let at = section === -1 ? lines.length : section;
	while (at > 0 && (lines[at - 1] ?? "").trim() === "") at--;
	lines.splice(at, 0, ...claims);
}

function appendWithdrawn(lines: string[], entries: readonly string[]): void {
	const kinds = regions(lines);
	const section = findHeading(lines, kinds, (h) => h === WITHDRAWN_HEADING);
	if (section !== -1) {
		lines.splice(lastContentLine(lines, kinds, section) + 1, 0, ...entries);
		return;
	}
	trimTrailingBlanks(lines);
	lines.push("", WITHDRAWN_HEADING, "", ...entries, "");
}
