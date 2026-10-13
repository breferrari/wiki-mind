/**
 * Claims, line by line (SPEC.md §2.1): where each wikilink sits on a line,
 * what part of a note each line is in, and which sources are current. The
 * retraction pass and the stale-citation check read notes the same way.
 *
 * The core reads the lines (`lineRegions`) and the links on each
 * (`wikilinkSpans`), by the rules `extractWikilinkTargets` follows. This
 * module adds the wiki's own layer: the Withdrawn claims region, and each
 * link's note name.
 */

import { lineRegions, wikilinkSpans } from "../../scripts/core/index.ts";
import { linkName, listNotes, type Note, statusOf } from "./notes.ts";

/** Written right after a link to a source that is no longer current. Exact: lint and --undo match it. */
export const MARK = " (no longer current)";
export const WITHDRAWN_HEADING = "## Withdrawn claims";

/** A note's lines and the line ending it uses, so a rewrite keeps CRLF as CRLF. */
/**
 * A note's lines, the line ending it uses, and whether it starts with a
 * byte-order mark. A rewrite joins them back as they came: CRLF stays CRLF,
 * and the mark stays the file's first character (SPEC.md §2.1), whatever
 * happens to the first line.
 */
export type Lines = { lines: string[]; eol: "\n" | "\r\n"; bom: boolean };

export function splitLines(content: string): Lines {
	const bom = content.startsWith("\uFEFF");
	const text = bom ? content.slice(1) : content;
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	return { lines: text.split(/\r?\n/), eol, bom };
}

export const joinLines = ({ lines, eol, bom }: Lines): string => (bom ? "\uFEFF" : "") + lines.join(eol);

/** Which part of a note a line is in: the core's regions, plus the wiki's Withdrawn claims. */
export type Region = "frontmatter" | "fence" | "heading" | "withdrawn" | "body";

/** Each line's region: a body line under `## Withdrawn claims` is "withdrawn". */
export function regions(lines: readonly string[]): Region[] {
	let withdrawn = false;
	return lineRegions(lines).map((region, i): Region => {
		if (region === "heading") withdrawn = (lines[i] ?? "").trim() === WITHDRAWN_HEADING;
		return region === "body" && withdrawn ? "withdrawn" : region;
	});
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

/** The links on a line, left to right, each with the note name it targets. */
export function linkSpans(line: string): LinkSpan[] {
	return wikilinkSpans(line).map((span) => ({ ...span, name: linkName(span.target) }));
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
