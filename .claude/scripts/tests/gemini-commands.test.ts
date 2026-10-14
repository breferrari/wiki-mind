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

/**
 * A command's description as Claude Code reads it. commands.test.ts holds
 * each to one double-quoted YAML line with no inner quote; the core's
 * reader gives what is inside the quotes, and its YAML escapes (`\\`, `\t`)
 * are JSON's, so JSON undoes them once.
 */
export function description(markdown: string): string {
	return JSON.parse(`"${extractFrontmatterField(markdown, "description") ?? ""}"`) as string;
}

/** The wrapper's prompt, up to the typed arguments; classify-message.ts reads only what follows it (#118). */
const PREAMBLE = "Run the vault command below. It is written for Claude Code: where it says $ARGUMENTS, use these arguments: ";

/** The Gemini TOML wrapper for the command `name`, given its markdown. */
function wrapper(name: string, markdown: string): string {
	return [
		`# Generated in the wiki-mind repo from .claude/commands/${name}.md. In a vault, change the description here too when you change it there.`,
		`description = ${JSON.stringify(description(markdown))}`,
		'prompt = """',
		`${PREAMBLE}{{args}}`,
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

test("each description is TOML-safe, and each wrapper on disk reads its command live with Gemini's arguments", () => {
	for (const file of readdirSync(COMMANDS).filter((f) => COMMAND.test(f))) {
		const text = description(readFileSync(join(COMMANDS, file), "utf-8"));
		// A TOML string takes no raw control character (DEL included), and no lone surrogate even escaped.
		assert.ok(!/[\u0000-\u001f\u007f]/.test(text) && !/\p{Cs}/u.test(text),`${file}'s description is TOML-safe`);
	}
	for (const file of present()) {
		const name = file.replace(/\.toml$/, "");
		const text = readFileSync(join(WRAPPERS, file), "utf-8");
		assert.ok(text.includes(`@{.claude/commands/${name}.md}`), `${file} injects its command`);
		assert.ok(text.includes("{{args}}"), `${file} passes the arguments`);
	}
});

test("a description's escapes are undone once", () => {
	assert.equal(description('---\ndescription: "Use C:\\\\path and \u2014 dashes"\n---\n'), "Use C:\\path and \u2014 dashes");
});

test("classify-message.ts declares the same preamble as the wrappers, so it reads only the typed arguments (#118)", () => {
	// Read from source: an entry point runs on import, and lib/ is vendored, so there is no module to share it from.
	const source = readFileSync(join(REPO, ".claude", "scripts", "classify-message.ts"), "utf-8");
	// The whole declaration, from line start to its semicolon, so nothing can be appended to the literal.
	const declared = /^const GEMINI_PREAMBLE = "((?:[^"\\]|\\.)*)";$/m.exec(source)?.[1];
	assert.ok(declared !== undefined, "classify-message.ts declares GEMINI_PREAMBLE");
	assert.equal(JSON.parse(`"${declared}"`), PREAMBLE, "the same preamble as the generator's");
});

test("every command opens with frontmatter, where classify-message finds the end of a Gemini command's arguments (#118)", () => {
	for (const file of readdirSync(COMMANDS).filter((f) => COMMAND.test(f))) {
		assert.match(readFileSync(join(COMMANDS, file), "utf-8"), /^---\r?\n/, `${file} opens with ---`);
	}
});
