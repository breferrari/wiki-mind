/**
 * What `shardmind install` places in a vault, computed from the repo the
 * way the engine does: the tracked files, minus ShardMind's Tier 1 paths,
 * minus .shardmindignore. Shared by install-set.test.ts and the Invariant 1
 * contract test, so both read the same rule. shardmind#320 adopts the same
 * rule for `validate`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** ShardMind's engine-enforced exclusions (SHARD-LAYOUT.md, Tier 1) that a repo can hold. */
export const TIER_1: readonly RegExp[] = [/^\.git\//, /^\.github\//, /^\.shardmind\//];

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

/** The repo's .shardmindignore as one path test. */
export function ignored(repo: string): (path: string) => boolean {
	const patterns = readFileSync(join(repo, ".shardmindignore"), "utf-8")
		.split(/\r?\n/)
		.filter((l) => l.trim() !== "" && !l.startsWith("#"));
	if (patterns.some((p) => p.startsWith("!"))) throw new Error("negation: extend matcher() before using it");
	const tests = patterns.map(matcher);
	return (path) => tests.some((t) => t(path));
}

/** The repo-relative paths a defaults install places, forward slashes. */
export function installSet(repo: string): Set<string> {
	const tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf-8" }).split("\n").filter((l) => l !== "");
	const skip = ignored(repo);
	return new Set(tracked.filter((f) => !TIER_1.some((re) => re.test(f)) && !skip(f)));
}

/** Relative import specifiers: static, re-exported, dynamic with a literal, and side-effect. */
export const RELATIVE_IMPORT = /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|import\s+['"](\.[^'"]+)['"]/g;
