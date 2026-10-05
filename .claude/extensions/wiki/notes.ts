/**
 * Reading the wiki's notes: the five note folders of SPEC.md §2, their
 * frontmatter, and their links. Shared by the sections, detectors and
 * validators in index.ts.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractFrontmatterField, extractWikilinkTargets } from "../../scripts/core/index.ts";

/** Each note type's folder (SPEC.md §2). */
export const FOLDERS = {
	source: "sources",
	concept: "concepts",
	entity: "entities",
	synthesis: "syntheses",
	question: "questions",
} as const;

export type NoteType = keyof typeof FOLDERS;

export const NOTE_TYPES = Object.keys(FOLDERS) as NoteType[];

export type Note = {
	readonly type: NoteType;
	/** Vault-relative, forward slashes. */
	readonly relPath: string;
	/** The file name without `.md`, as a wikilink names it. */
	readonly name: string;
	readonly content: string;
	readonly mtimeMs: number;
};

/** The note type a vault-relative path holds: a `.md` file directly in a note folder, not its README. */
export function typeOf(relPath: string): NoteType | null {
	const parts = relPath.split("/");
	if (parts.length !== 2) return null;
	const [folder, file] = parts as [string, string];
	if (!file.endsWith(".md") || file === "README.md") return null;
	return NOTE_TYPES.find((t) => FOLDERS[t] === folder) ?? null;
}

/** The notes of one type, sorted by name. A missing folder has none. */
export function listNotes(vaultRoot: string, type: NoteType): Note[] {
	const folder = FOLDERS[type];
	let names: string[];
	try {
		names = readdirSync(join(vaultRoot, folder));
	} catch {
		return [];
	}
	const notes: Note[] = [];
	for (const file of names.sort()) {
		const relPath = `${folder}/${file}`;
		if (typeOf(relPath) === null) continue;
		try {
			const abs = join(vaultRoot, folder, file);
			const stat = statSync(abs);
			if (!stat.isFile()) continue;
			notes.push({ type, relPath, name: file.slice(0, -3), content: readFileSync(abs, "utf-8"), mtimeMs: stat.mtimeMs });
		} catch {
			/* a note that vanished or cannot be read is not counted */
		}
	}
	return notes;
}

/** The content without a leading byte-order mark, which some editors write. */
function unbom(content: string): string {
	return content.startsWith("﻿") ? content.slice(1) : content;
}

/** The frontmatter block, without its fences, or null when there is none. An empty block is "". */
export function frontmatter(content: string): string | null {
	const m = unbom(content).match(/^---\r?\n(?:([\s\S]*?)\r?\n)?---(\r?\n|$)/);
	return m ? (m[1] ?? "") : null;
}

/**
 * True when the frontmatter declares `name`, whatever its value. The key is
 * matched as `name:`, the rule `field` reads values by, so the two never
 * disagree about whether a field is there.
 */
export function hasField(content: string, name: string): boolean {
	const fm = frontmatter(content);
	return fm !== null && new RegExp(`^${name}:`, "m").test(fm);
}

/** A one-line field's value, or null (lib/session-start's small parser). */
export function field(content: string, name: string): string | null {
	return extractFrontmatterField(unbom(content), name);
}

/**
 * A list field's items, written inline (`sides: [A, B]`) or as a block
 * (`sides:` then `- A` lines). Quotes and wikilink brackets are stripped.
 */
export function listField(content: string, name: string): string[] {
	const fm = frontmatter(content);
	if (fm === null) return [];
	const lines = fm.split(/\r?\n/);
	const start = lines.findIndex((l) => new RegExp(`^${name}:`).test(l));
	if (start === -1) return [];
	const clean = (s: string) => s.trim().replace(/^["']|["']$/g, "").replace(/^\[\[|\]\]$/g, "").trim();
	// A trailing YAML comment is not part of the value; " #" cannot occur in a wikilink.
	const inline = (lines[start] ?? "").replace(new RegExp(`^${name}:`), "").replace(/\s+#.*$/, "").trim();
	if (inline !== "") {
		const body = isFlowList(inline) ? inline.slice(1, -1) : inline;
		return splitItems(body).map(clean).filter((s) => s !== "");
	}
	const items: string[] = [];
	for (const line of lines.slice(start + 1)) {
		const m = line.match(/^\s*-\s+(.*)$/);
		if (m === null) break;
		items.push(clean(m[1] ?? ""));
	}
	return items.filter((s) => s !== "");
}

/**
 * True when the value is a YAML flow list: its first `[` closes at its last
 * character. `[[[A]], [[B]]]` is one; `[[A]], [[B]]` (two bare wikilinks) is not.
 */
function isFlowList(value: string): boolean {
	if (!value.startsWith("[") || !value.endsWith("]")) return false;
	let depth = 0;
	for (let i = 0; i < value.length; i++) {
		if (value[i] === "[") depth++;
		else if (value[i] === "]") depth--;
		if (depth === 0) return i === value.length - 1;
	}
	return false;
}

/** Split on commas that are not inside a wikilink. */
function splitItems(text: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let current = "";
	for (let i = 0; i < text.length; i++) {
		const two = text.slice(i, i + 2);
		if (two === "[[") { depth++; current += two; i++; continue; }
		if (two === "]]") { depth = Math.max(0, depth - 1); current += two; i++; continue; }
		const ch = text[i] ?? "";
		if (ch === "," && depth === 0) { out.push(current); current = ""; continue; }
		current += ch;
	}
	out.push(current);
	return out;
}

/** The note names a note links to, lowercased: the last path segment, without `.md`. */
export function linkedNames(content: string): Set<string> {
	const names = new Set<string>();
	for (const target of extractWikilinkTargets(content)) {
		const last = target.split("/").pop() ?? target;
		names.add(last.replace(/\.md$/i, "").toLowerCase());
	}
	return names;
}

/** True when the note links at least one note that exists in sources/. */
export function citesSource(content: string, sourceNames: ReadonlySet<string>): boolean {
	for (const name of linkedNames(content)) if (sourceNames.has(name)) return true;
	return false;
}
