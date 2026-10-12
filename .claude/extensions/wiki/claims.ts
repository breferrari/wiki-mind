/**
 * Claims, line by line (SPEC.md §2.1): where each wikilink sits on a line,
 * what part of a note each line is in, and which sources are current. The
 * retraction pass and the stale-citation check read notes the same way.
 *
 * A link is whatever `extractWikilinkTargets` reads as one; this module only
 * adds where it is, because a claim is the whole line that holds the link.
 */

import { extractWikilinkTargets } from "../../scripts/core/index.ts";
import { linkName, listNotes, type Note, statusOf } from "./notes.ts";

/** Written right after a link to a source that is no longer current. Exact: lint and --undo match it. */
export const MARK = " (no longer current)";
export const WITHDRAWN_HEADING = "## Withdrawn claims";

/** A note's lines and the line ending it uses, so a rewrite keeps CRLF as CRLF. */
export type Lines = { lines: string[]; eol: "\n" | "\r\n" };

export function splitLines(content: string): Lines {
	const eol = content.includes("\r\n") ? "\r\n" : "\n";
	return { lines: content.split(/\r?\n/), eol };
}

export const joinLines = ({ lines, eol }: Lines): string => lines.join(eol);

/** Which part of a note a line is in. */
export type Region = "frontmatter" | "fence" | "heading" | "withdrawn" | "body";

/**
 * Each line's region. The core's code stripper (lib/wikilinks.ts) removes
 * fenced lines rather than naming them, and isn't exported to extensions,
 * so this reads fences itself: a fence closes on the same character, at
 * least as long, as Markdown has it.
 */
export function regions(lines: readonly string[]): Region[] {
	const out: Region[] = [];
	let inFrontmatter = lines[0]?.replace(/^﻿/, "").trimEnd() === "---";
	let fence: string | null = null;
	let withdrawn = false;
	lines.forEach((line, i) => {
		if (inFrontmatter) {
			out.push("frontmatter");
			if (i > 0 && line.trimEnd() === "---") inFrontmatter = false;
			return;
		}
		const open = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
		if (fence !== null) {
			out.push("fence");
			if (open !== undefined && open[0] === fence[0] && open.length >= fence.length) fence = null;
			return;
		}
		if (open !== undefined) {
			fence = open;
			out.push("fence");
			return;
		}
		if (/^#{1,6}\s/.test(line)) {
			withdrawn = line.trim() === WITHDRAWN_HEADING;
			out.push("heading");
			return;
		}
		out.push(withdrawn ? "withdrawn" : "body");
	});
	return out;
}

/** The first heading line that `match` accepts, or -1. */
export function findHeading(lines: readonly string[], kinds: readonly Region[], match: (heading: string) => boolean): number {
	return lines.findIndex((l, i) => kinds[i] === "heading" && match(l.trim()));
}

/** The last non-blank line of the section that starts at `heading`. */
export function lastContentLine(lines: readonly string[], kinds: readonly Region[], heading: number): number {
	let last = heading;
	for (let i = heading + 1; i < lines.length && kinds[i] !== "heading"; i++) if ((lines[i] ?? "").trim() !== "") last = i;
	return last;
}

/** Drop blank lines at the end. */
export function trimTrailingBlanks(lines: string[]): void {
	while (lines.length > 0 && (lines.at(-1) ?? "").trim() === "") lines.pop();
}

/** A wikilink on a line: its target as written, the note name it targets (lowercased last path segment), and where it sits. */
export type LinkSpan = { readonly target: string; readonly name: string; readonly start: number; readonly end: number };

/** The links on a line, left to right. */
export function linkSpans(line: string): LinkSpan[] {
	// Inline code is not a link: blank it out, keeping every offset.
	const masked = line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
	const spans: LinkSpan[] = [];
	for (const m of masked.matchAll(/!?\[\[([^\[\]\n]+?)\]\]/g)) {
		const target = extractWikilinkTargets(m[0])[0];
		if (target !== undefined) spans.push({ target, name: linkName(target), start: m.index, end: m.index + m[0].length });
	}
	return spans;
}

/** The links among `spans` to a note in `names` with no marker after them: what lint reports and the pass marks or withdraws. */
export function unmarkedLinks(line: string, spans: readonly LinkSpan[], names: ReadonlySet<string>): LinkSpan[] {
	return spans.filter((s) => names.has(s.name) && !line.startsWith(MARK, s.end));
}

/** True when a source note's `status` marks it retracted or superseded (§2.1). */
export function noLongerCurrent(content: string): boolean {
	const status = statusOf(content);
	return status === "retracted" || status === "superseded";
}

/** The names of the current source notes, lowercased as links name them. */
export function currentSourceNames(sources: readonly Note[]): Set<string>;
export function currentSourceNames(vaultRoot: string): Set<string>;
export function currentSourceNames(from: string | readonly Note[]): Set<string> {
	const sources = typeof from === "string" ? listNotes(from, "source") : from;
	return new Set(sources.filter((n) => !noLongerCurrent(n.content)).map((n) => n.name.toLowerCase()));
}
