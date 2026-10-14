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

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const COMMANDS = join(REPO, ".claude", "commands");
const WRAPPERS = join(REPO, ".gemini", "commands");
const COMMAND = /^wiki-.+\.md$/;
const WRAPPER = /^wiki-.+\.toml$/;

/**
 * A command's frontmatter `description`, its YAML quoting undone once: a
 * double-quoted value's escapes (`\"`, `\\`) read as JSON's, which they
 * share, and a single-quoted one's `''` as one quote.
 */
export function commandDescription(markdown: string): string {
	const value = /^---\r?\n[\s\S]*?^description:[ \t]*(.*?)[ \t]*\r?$/m.exec(markdown)?.[1] ?? "";
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return JSON.parse(value) as string;
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
	return value;
}

/** The Gemini TOML wrapper for the command `name`, given its markdown. */
export function wrapper(name: string, markdown: string): string {
	return [
		`# Generated in the wiki-mind repo from .claude/commands/${name}.md. Do not edit: it is rewritten from the command.`,
		`description = ${JSON.stringify(commandDescription(markdown))}`,
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

const present = () => (existsSync(WRAPPERS) ? readdirSync(WRAPPERS).filter((f) => WRAPPER.test(f)) : []);

if (process.env["GEMINI_COMMANDS_WRITE"] === "1") {
	const want = expected();
	mkdirSync(WRAPPERS, { recursive: true });
	for (const [file, text] of want) writeFileSync(join(WRAPPERS, file), text);
	for (const file of present()) if (!want.has(file)) unlinkSync(join(WRAPPERS, file));
}

test("every vault command has its Gemini wrapper, as generated", () => {
	const want = expected();
	assert.ok(want.size > 0, "the vault has commands");
	for (const [file, text] of want) {
		const path = join(WRAPPERS, file);
		assert.ok(existsSync(path), `${file} is missing: run this test with GEMINI_COMMANDS_WRITE=1`);
		// Bytes, not lines: .gitattributes pins LF, and a CRLF wrapper is a regression.
		assert.equal(readFileSync(path, "utf-8"), text, `${file} is stale: run this test with GEMINI_COMMANDS_WRITE=1`);
	}
});

test("no wrapper is left for a command that is gone", () => {
	const want = expected();
	assert.deepEqual(present().filter((f) => !want.has(f)), [], "orphaned wrappers: run this test with GEMINI_COMMANDS_WRITE=1");
});

test("a description's YAML quoting is undone once, and written as a TOML string", () => {
	const md = (value: string) => `---\ndescription: ${value}\n---\n# Body\n`;
	assert.equal(commandDescription(md('"Say \\"hi\\" — now."')), 'Say "hi" — now.');
	assert.equal(commandDescription(md("'It''s here'")), "It's here");
	assert.equal(commandDescription(md("plain words")), "plain words");
	const toml = wrapper("wiki-x", md('"Say \\"hi\\" now"'));
	assert.match(toml, /^description = "Say \\"hi\\" now"$/m);
	assert.ok(toml.includes("@{.claude/commands/wiki-x.md}"), "injects its command");
	assert.ok(toml.includes("{{args}}"), "passes the arguments");
});
