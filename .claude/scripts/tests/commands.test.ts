/**
 * The vault's slash commands (.claude/commands/, SPEC.md §6.2): every one is
 * a `wiki-` command with a description Claude Code lists, and an argument
 * hint whenever it takes arguments. Each one that names a template or a
 * folder names one that exists.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIR = join(REPO, ".claude", "commands");
const commands = readdirSync(DIR).filter((f) => f.endsWith(".md"));

describe("the slash commands", () => {
	test("there is at least one, and every one is a wiki- command", () => {
		assert.ok(commands.length > 0);
		for (const file of commands) assert.match(file, /^wiki-[a-z]+\.md$/);
	});

	for (const file of commands) {
		test(`${file}: a description, an argument hint if it takes arguments, and real paths`, () => {
			const text = readFileSync(join(DIR, file), "utf-8");
			const fm = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
			assert.match(fm, /^description: "[^"]{20,}"$/m, "a description Claude Code can list");
			if (text.includes("$ARGUMENTS")) assert.match(fm, /^argument-hint: "[^"]+"$/m);
			for (const m of text.matchAll(/`(templates\/[A-Za-z ]+\.md)`/g)) assert.ok(existsSync(join(REPO, m[1] ?? "")), `${m[1]} exists`);
			for (const m of text.matchAll(/`(sources|concepts|entities|syntheses|questions|inbox)\/`/g)) assert.ok(existsSync(join(REPO, m[1] ?? "")), `${m[1]}/ exists`);
		});
	}
});
