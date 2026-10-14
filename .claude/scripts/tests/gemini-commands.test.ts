/**
 * Gemini runs the vault's commands from `.gemini/commands/*.toml` (#109, on
 * obsidian-mind #400's model): one wrapper per `.claude/commands/wiki-*.md`.
 * Each wrapper injects its command file with `@{…}`, which Gemini resolves
 * before it substitutes `{{args}}`, so the command text is read live and no
 * copy drifts. This test is the generator: it fails on a missing, stale or
 * orphaned wrapper, and with GEMINI_COMMANDS_WRITE=1 it writes them (a
 * developer's step: CI never sets it, or the suite would heal itself and pass).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFrontmatterField } from "../core/index.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const COMMANDS = join(REPO, ".claude", "commands");
const WRAPPERS = join(REPO, ".gemini", "commands");
const COMMAND = /^wiki-.+\.md$/;
const WRAPPER = /^wiki-.+\.toml$/;

/** The Gemini TOML wrapper for the command `name`, given its markdown. */
function wrapper(name: string, markdown: string): string {
	return [
		`# Generated in the wiki-mind repo from .claude/commands/${name}.md. In a vault, change the description here too when you change it there.`,
		// commands.test.ts holds every description to a double-quoted line with no
		// inner quote, so the core's reader (which stays inside the frontmatter)
		// gives it whole, and JSON's escapes are TOML's.
		`description = ${JSON.stringify(extractFrontmatterField(markdown, "description") ?? "")}`,
		'prompt = """',
		"Run the vault command below. It is written for Claude Code: where it says $ARGUMENTS, use these arguments: {{args}}",
		"",
		`@{.claude/commands/${name}.md}`,
		'"""',
		"",
	].join("\n");
}

/** Every wrapper there should be: file name to contents. */
function expected(): Map<string, string> {
	return new Map(
		readdirSync(COMMANDS)
			.filter((f) => COMMAND.test(f))
			.map((f) => {
				const name = f.replace(/\.md$/, "");
				return [`${name}.toml`, wrapper(name, readFileSync(join(COMMANDS, f), "utf-8"))] as const;
			}),
	);
}

const want = expected();
const present = () => (existsSync(WRAPPERS) ? readdirSync(WRAPPERS).filter((f) => WRAPPER.test(f)) : []);

if (process.env["GEMINI_COMMANDS_WRITE"] === "1") {
	mkdirSync(WRAPPERS, { recursive: true });
	for (const [file, text] of want) writeFileSync(join(WRAPPERS, file), text);
	for (const file of present()) if (!want.has(file)) unlinkSync(join(WRAPPERS, file));
}

test("every vault command has its Gemini wrapper, as generated", () => {
	assert.ok(want.size > 0, "the vault has commands");
	for (const [file, text] of want) {
		const path = join(WRAPPERS, file);
		assert.ok(existsSync(path), `${file} is missing: run this test with GEMINI_COMMANDS_WRITE=1`);
		// Bytes, not lines: .gitattributes pins LF, and a CRLF wrapper is a regression.
		assert.equal(readFileSync(path, "utf-8"), text, `${file} is stale: run this test with GEMINI_COMMANDS_WRITE=1`);
	}
});

test("no wrapper is left for a command that is gone", () => {
	assert.deepEqual(present().filter((f) => !want.has(f)), [], "orphaned wrappers: run this test with GEMINI_COMMANDS_WRITE=1");
});

test("each wrapper has a TOML-safe description, and reads its command live with Gemini's arguments", () => {
	for (const [file, text] of want) {
		const name = file.replace(/\.toml$/, "");
		// TOML basic strings take no raw control character (DEL included) and no lone surrogate.
		assert.match(text, /^description = "[^\u0000-\u001f\u007f\ud800-\udfff]{20,}"$/m, `${file} has a TOML-safe description`);
		assert.ok(text.includes(`@{.claude/commands/${name}.md}`), `${file} injects its command`);
		assert.ok(text.includes("{{args}}"), `${file} passes the arguments`);
	}
});
