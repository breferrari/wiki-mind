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

interface Steps {
	/** The install command line, as written. */
	install: string | undefined;
	/** The folder the install names, when it names one. */
	folder: string | undefined;
	/** The folder each `cd` line enters. */
	cds: string[];
	mkdir: boolean;
}

/** The README's install steps: the first ```sh block under `## Install`. */
export function readmeSteps(readme: string): Steps {
	const lines = readme.split(/\r?\n/);
	const section = lines.slice(lines.indexOf("## Install") + 1);
	const open = section.findIndex((l) => l === "```sh");
	const close = section.findIndex((l, i) => i > open && l === "```");
	return steps(open === -1 ? [] : section.slice(open + 1, close));
}

function steps(lines: string[]): Steps {
	const install = lines.find((l) => l.startsWith("npx shardmind install "));
	const words = install?.split(/\s+/) ?? [];
	return {
		install,
		folder: words[4],
		cds: lines.flatMap((l) => l.match(/(?:^|&&\s*)cd\s+(\S+)/)?.[1] ?? []),
		mkdir: lines.some((l) => /(^|&&\s*)mkdir\b/.test(l)),
	};
}

/** The body of CHANGELOG.md's Unreleased section. */
function unreleased(changelog: string): string {
	const body = changelog.split(/^## \[Unreleased\]\r?\n/m)[1] ?? "";
	return body.split(/^## /m)[0] ?? "";
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

	test("the github: fallback installs into the same folder", () => {
		assert.match(readme, new RegExp(`\`npx shardmind install github:breferrari/wiki-mind ${folder}\``));
	});

	test("the next release's notes carry the same install command", () => {
		const notes = unreleased(read("CHANGELOG.md"));
		assert.ok(install !== undefined && notes.includes(install), `CHANGELOG's Unreleased section gives \`${install}\``);
		assert.ok(notes.includes(`cd ${folder}`), `CHANGELOG's Unreleased section enters ${folder}`);
	});

	test("the reader sees the pre-1.0 form, so the first test can fail", () => {
		const old = readmeSteps("## Install\n\n```sh\r\nmkdir my-wiki && cd my-wiki\r\nnpx shardmind install breferrari/wiki-mind\r\n```\r\n");
		assert.deepEqual(old, { install: "npx shardmind install breferrari/wiki-mind", folder: undefined, cds: ["my-wiki"], mkdir: true });
	});
});
