/**
 * The install steps the README and the next release's notes give, held to
 * the engine shard.yaml requires. From ShardMind 1.0, `install` makes a new
 * folder named after the shard unless it is given one, so `mkdir x && cd x`
 * before a folder-less install leaves the vault one level down, in
 * `x/wiki-mind/`. The steps name the folder in the install and then enter it.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf-8");

/** The README's install steps: the first ```sh block under `## Install`. */
function readmeSteps(readme: string) {
	const lines = readme.split(/\r?\n/);
	const section = lines.slice(lines.indexOf("## Install") + 1);
	const open = section.findIndex((l) => l === "```sh");
	const close = section.findIndex((l, i) => i > open && l === "```");
	const block = open === -1 ? [] : section.slice(open + 1, close);
	const install = block.find((l) => l.startsWith("npx shardmind install "));
	// After `install`, flags aside: the shard reference, then the folder.
	const args = install?.split(/\s+/).slice(3).filter((w) => !w.startsWith("-")) ?? [];
	const folder = args[1];
	return {
		install,
		folder,
		cds: block.flatMap((l) => l.match(/(?:^|&&\s*)cd\s+(\S+)/)?.[1] ?? []),
		mkdir: block.some((l) => /(^|&&\s*)mkdir\b/.test(l)),
	};
}

/** The newest release notes: Unreleased while it has any, else the latest version's. */
function newestNotes(changelog: string): string {
	return (
		changelog
			.split(/^## /m)
			.slice(1)
			.map((s) => s.slice(s.indexOf("\n") + 1))
			.find((body) => body.trim() !== "") ?? ""
	);
}

describe("the install steps", () => {
	const readme = read("README.md");
	const { install, folder, cds, mkdir } = readmeSteps(readme);

	test("the README installs into a folder it names, then enters it", () => {
		assert.ok(install, "the README's install block has an `npx shardmind install` line");
		assert.ok(folder, `the install names its folder: ${install}`);
		assert.ok(!mkdir, "no mkdir: the engine makes the folder");
		assert.deepEqual(cds, [folder], "the block enters the folder the install made, and only it");
	});

	const fallback = `npx shardmind install github:breferrari/wiki-mind ${folder}`;

	test("the github: fallback installs into the same folder", () => {
		assert.ok(readme.includes(`\`${fallback}\``), `the README gives \`${fallback}\``);
	});

	test("the newest release notes carry the same install command", () => {
		const notes = newestNotes(read("CHANGELOG.md"));
		assert.ok(install !== undefined && notes.includes(install), `CHANGELOG's newest notes give \`${install}\``);
		assert.ok(notes.includes(`cd ${folder}`), `CHANGELOG's newest notes enter ${folder}`);
		assert.ok(notes.includes(fallback), `CHANGELOG's newest notes give the fallback \`${fallback}\``);
	});

	test("the reader sees the pre-1.0 form, so the first test can fail", () => {
		const old = readmeSteps("## Install\n\n```sh\r\nmkdir my-wiki && cd my-wiki\r\nnpx shardmind install breferrari/wiki-mind\r\n```\r\n");
		assert.deepEqual(old, { install: "npx shardmind install breferrari/wiki-mind", folder: undefined, cds: ["my-wiki"], mkdir: true });
		const flagged = readmeSteps("## Install\n\n```sh\nnpx shardmind install --yes breferrari/wiki-mind my-wiki\n```\n");
		assert.equal(flagged.folder, "my-wiki", "a flag before the shard reference doesn't shift the folder");
		const crlf = "# Changelog\r\n\r\n## [Unreleased]\r\n\r\n## [0.2.0] - 2026-11-01\r\n\r\n- x\r\n";
		assert.equal(newestNotes(crlf).trim(), "- x", "an empty Unreleased falls through to the latest release, CRLF or not");
	});
});
