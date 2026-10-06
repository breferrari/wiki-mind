/**
 * What `shardmind install` would put in a vault, computed from the repo the
 * way the engine does: the tracked files, minus ShardMind's Tier 1 paths,
 * minus .shardmindignore. Two promises are held over that set:
 * - no test file installs: tests run in the repo, never in a vault;
 * - no installed module imports a file that does not install, so leaving
 *   tests out cannot break a hook;
 * - no vendor record or patch installs, and the vendor guard that does
 *   install allows an edit to a vendored path (SPEC.md §7.1, Q11).
 *
 * Repo-only itself (it lives in tests/, which .shardmindignore excludes).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmTemp } from "./_helpers.ts";
import { RELATIVE_IMPORT, installSet as installSetOf, matcher } from "./_shard.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const installSet = () => installSetOf(REPO);

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

	test("no vendor record or patch installs: provenance is repo-only", () => {
		const leaked = [...installed].filter((f) => f.endsWith("VENDOR.json") || f.includes("vendor-patches/"));
		assert.deepEqual(leaked, []);
	});

	test("the installed vendor guard allows an edit to a vendored path, and prints nothing", () => {
		assert.ok(installed.has(".claude/scripts/vendor-guard.ts"), "the guard installs, wired in settings.json");
		const vault = mkdtempSync(join(tmpdir(), "wiki-install-guard-"));
		try {
			for (const file of installed) {
				if (!file.startsWith(".claude/") && file !== "vault-manifest.json") continue;
				mkdirSync(dirname(join(vault, file)), { recursive: true });
				cpSync(join(REPO, file), join(vault, file));
			}
			const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", join(vault, ".claude", "scripts", "vendor-guard.ts")], {
				input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: join(vault, ".claude", "settings.json") } }),
				cwd: vault,
				encoding: "utf8",
				env: { ...process.env, CLAUDE_PROJECT_DIR: vault },
			});
			assert.equal(r.status, 0, r.stderr);
			assert.equal(r.stdout, "", "no deny in an installed vault");
		} finally {
			rmTemp(vault);
		}
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
