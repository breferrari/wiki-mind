/**
 * Claims, line by line (SPEC.md §2.1): where each wikilink sits on a line,
 * what part of a note each line is in, and which sources are current. The
 * retraction pass and the stale-citation check read notes the same way.
 *
 * A link is whatever `extractWikilinkTargets` reads as one; this module only
 * adds where it is, because a claim is the whole line that holds the link.
 */

import { extractWikilinkTargets } from "../../scripts/core/index.ts";
import { field, listNotes } from "./notes.ts";

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

export function regions(lines: readonly string[]): Region[] {
	const out: Region[] = [];
	let inFrontmatter = lines[0]?.replace(/^﻿/, "") === "---";
	let fence: string | null = null;
	let withdrawn = false;
	lines.forEach((line, i) => {
		if (inFrontmatter) {
			out.push("frontmatter");
			if (i > 0 && line === "---") inFrontmatter = false;
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

/** A wikilink on a line: its target as written, the note name it targets (lowercased last path segment), and where it sits. */
export type LinkSpan = { readonly target: string; readonly name: string; readonly start: number; readonly end: number };

export function linkSpans(line: string): LinkSpan[] {
	// Inline code is not a link: blank it out, keeping every offset.
	const masked = line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
	const spans: LinkSpan[] = [];
	for (const m of masked.matchAll(/!?\[\[([^\[\]\n]+?)\]\]/g)) {
		const target = extractWikilinkTargets(m[0])[0];
		if (target === undefined) continue;
		const name = (target.split("/").pop() ?? target).replace(/\.md$/i, "").toLowerCase();
		spans.push({ target, name, start: m.index, end: m.index + m[0].length });
	}
	return spans;
}

/** True when a source note's `status` marks it retracted or superseded (§2.1). */
export function noLongerCurrent(content: string): boolean {
	const status = (field(content, "status") ?? "").toLowerCase();
	return status === "retracted" || status === "superseded";
}

/** The names of the source notes that are current, lowercased as links name them. */
export function currentSourceNames(vaultRoot: string): Set<string> {
	return new Set(listNotes(vaultRoot, "source").filter((n) => !noLongerCurrent(n.content)).map((n) => n.name.toLowerCase()));
}
