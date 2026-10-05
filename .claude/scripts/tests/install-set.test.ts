/**
 * What `shardmind install` would put in a vault, computed from the repo the
 * way the engine does: the tracked files, minus ShardMind's Tier 1 paths,
 * minus .shardmindignore. Two promises are held over that set:
 * - no test file installs: tests run in the repo, never in a vault;
 * - no installed module imports a file that does not install, so leaving
 *   tests out cannot break a hook.
 *
 * Repo-only itself (it lives in tests/, which .shardmindignore excludes).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** ShardMind's engine-enforced exclusions (SHARD-LAYOUT.md, Tier 1) that a repo can hold. */
const TIER_1 = [/^\.git\//, /^\.github\//, /^\.shardmind\//];

/**
 * A .shardmindignore pattern as a path test, for the gitignore forms this
 * repo uses: a trailing `/` is a folder, `**` crosses folders, `*` does
 * not, and a pattern with no `/` before its end matches at any depth.
 */
export function matcher(pattern: string): (path: string) => boolean {
	let p = pattern.trim();
	const folder = p.endsWith("/");
	if (folder) p = p.slice(0, -1);
	const anchored = p.startsWith("/") || p.includes("/");
	p = p.replace(/^\//, "");
	const body = p
		.split("**/")
		.map((part) => part.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
		.join("(?:.*/)?");
	const re = new RegExp(`${anchored ? "^" : "(?:^|/)"}${body}${folder ? "/" : "$"}`);
	return (path: string) => re.test(path);
}

function ignored(): (path: string) => boolean {
	const patterns = readFileSync(join(REPO, ".shardmindignore"), "utf-8")
		.split(/\r?\n/)
		.filter((l) => l.trim() !== "" && !l.startsWith("#"));
	if (patterns.some((p) => p.startsWith("!"))) throw new Error("negation: extend matcher() before using it");
	const tests = patterns.map(matcher);
	return (path) => tests.some((t) => t(path));
}

function installSet(): Set<string> {
	const tracked = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf-8" }).split("\n").filter((l) => l !== "");
	const skip = ignored();
	return new Set(tracked.filter((f) => !TIER_1.some((re) => re.test(f)) && !skip(f)));
}

const RELATIVE_IMPORT = /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|import\s+['"](\.[^'"]+)['"]/g;

describe("what a vault gets", () => {
	const installed = installSet();

	test("the set is not empty, and holds the hooks", () => {
		assert.ok(installed.has(".claude/scripts/session-start.ts"));
		assert.ok(installed.has(".claude/skills/wiki-mind/hooks/register.ts"));
	});

	test("no test file and no test support installs", () => {
		const leaked = [...installed].filter((f) => /\.test\.ts$/.test(f) || f.startsWith(".claude/scripts/tests/") || f.endsWith("/world.ts"));
		assert.deepEqual(leaked, []);
	});

	test("no installed module imports a file that does not install", () => {
		const broken: string[] = [];
		for (const file of installed) {
			if (!/\.(ts|mts|mjs|js)$/.test(file)) continue;
			const source = readFileSync(join(REPO, file), "utf-8");
			for (const m of source.matchAll(RELATIVE_IMPORT)) {
				const spec = m[1] ?? m[2] ?? m[3] ?? "";
				const target = posix.normalize(posix.join(posix.dirname(file), spec));
				if (!installed.has(target)) broken.push(`${file} -> ${target}`);
			}
		}
		assert.deepEqual(broken, []);
	});
});

describe("the ignore matcher", () => {
	test("reads the forms this repo uses", () => {
		assert.ok(matcher(".claude/scripts/tests/")(".claude/scripts/tests/_helpers.ts"));
		assert.ok(matcher(".claude/scripts/**/*.test.ts")(".claude/scripts/core/registry.test.ts"));
		assert.ok(matcher(".claude/scripts/**/*.test.ts")(".claude/scripts/a.test.ts"));
		assert.ok(!matcher(".claude/scripts/**/*.test.ts")(".claude/scripts/core/registry.ts"));
		assert.ok(matcher(".claude/skills/wiki-mind/hooks/*.test.ts")(".claude/skills/wiki-mind/hooks/stop.test.ts"));
		assert.ok(!matcher(".claude/skills/wiki-mind/hooks/*.test.ts")(".claude/skills/wiki-mind/hooks/deep/stop.test.ts"));
		assert.ok(matcher("node_modules/")("a/node_modules/x.js"));
		assert.ok(matcher("SPEC.md")("SPEC.md"));
		assert.ok(!matcher("SPEC.md")("SPEC.md.bak"));
	});
});
