/**
 * What the release workflow (.github/workflows/release.yml) checks at tag
 * time, held on every PR so a release never fails for a reason a PR could
 * have caught: the shard's version and the mod's agree, and CHANGELOG.md
 * keeps an Unreleased section and well-formed version headings.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf-8");

describe("release readiness", () => {
	test("shard.yaml and the mod's plugin.json carry the same version", () => {
		const shard = read(".shardmind/shard.yaml").match(/^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m)?.[1];
		const mod = (JSON.parse(read(".claude/skills/wiki-mind/.claude-plugin/plugin.json")) as { version: string }).version;
		assert.ok(shard, "shard.yaml has a version");
		assert.equal(mod, shard);
	});

	test("CHANGELOG.md opens with an Unreleased section, and every version heading is [X.Y.Z] - YYYY-MM-DD", () => {
		const headings = read("CHANGELOG.md").split("\n").filter((l) => l.startsWith("## "));
		assert.equal(headings[0], "## [Unreleased]");
		for (const h of headings.slice(1)) assert.match(h, /^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/);
	});
});
