/**
 * The ShardMind manifest (.shardmind/shard.yaml), held to SPEC.md §8:
 * - Invariant 3: post-update hooks are additive. wiki-mind declares none, so
 *   the invariant holds trivially; this test changes when one is added.
 * - Invariant 4: bootstrap re-runs only on fingerprint change. The engine
 *   enforces it; the shard has to declare a fingerprint for it to apply.
 * - Every hook script under .shardmind/hooks/ is declared, since the engine
 *   runs only the hooks the manifest names.
 * - The engine floor the manifest declares is the version CI validates with,
 *   so a manifest can't claim an engine CI never ran.
 *
 * Repo-only (.shardmindignore): .shardmind/ and .github/ never install.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const manifest = readFileSync(join(REPO, ".shardmind", "shard.yaml"), "utf-8");
const ci = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf-8");
/** The engine floor: X.Y.Z from requires.shardmind's `">=X.Y.Z"`. */
const floor = manifest.match(/^ {2}shardmind:\s*">=([0-9.]+)"/m)?.[1];

/** The keys of a top-level YAML block, by indentation: `hooks:` then its two-space children. */
function blockKeys(yaml: string, block: string): string[] {
	const lines = yaml.split(/\r?\n/);
	const start = lines.findIndex((l) => l === `${block}:`);
	if (start === -1) return [];
	const keys: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^\S/.test(line)) break;
		const m = line.match(/^ {2}([A-Za-z_-]+):/);
		if (m?.[1] !== undefined) keys.push(m[1]);
	}
	return keys;
}

describe("the ShardMind manifest", () => {
	test("Invariant 3: no post-update hook (nor the legacy post-install), so post-update is additive trivially", () => {
		const hooks = blockKeys(manifest, "hooks");
		assert.ok(!hooks.includes("post-update"), "a post-update hook needs a test that holds it to ctx.newFiles");
		assert.ok(!hooks.includes("post-install"), "post-install is the deprecated combined slot");
	});

	test("Invariant 4: bootstrap is declared with a fingerprint, so it re-runs on update only when that changes", () => {
		assert.ok(blockKeys(manifest, "hooks").includes("bootstrap"));
		const block = manifest.slice(manifest.indexOf("  bootstrap:"));
		assert.match(block, /^ {4}script: \.shardmind\/hooks\/bootstrap\.ts$/m);
		assert.match(block, /^ {4}fingerprint: "[^"]+"$/m, "a bootstrap without a fingerprint never re-runs on update");
		assert.ok(existsSync(join(REPO, ".shardmind", "hooks", "bootstrap.ts")));
	});

	test("every hook script under .shardmind/hooks/ is declared, so the engine runs it", () => {
		const scripts = readdirSync(join(REPO, ".shardmind", "hooks")).filter((f) => f.endsWith(".ts"));
		assert.ok(scripts.length > 0);
		// A declaration is a value line under any slot; a comment naming the path doesn't count.
		const values = manifest
			.split(/\r?\n/)
			.filter((l) => !/^\s*#/.test(l))
			.map((l) => l.trimEnd());
		for (const script of scripts) {
			const declared = values.some((l) => l.endsWith(`: .shardmind/hooks/${script}`));
			assert.ok(declared, `.shardmind/hooks/${script} exists, but shard.yaml never declares it`);
		}
	});

	test("personalize is declared as a string, the form the engine's schema takes", () => {
		assert.match(manifest, /^ {2}personalize: \.shardmind\/hooks\/personalize\.ts$/m);
	});

	test("requires.shardmind's floor is the version CI validates with", () => {
		const pinned = ci.match(/SHARDMIND_VERSION:\s*([0-9.]+)/)?.[1];
		assert.ok(floor !== undefined, "requires.shardmind is a >= range");
		assert.equal(floor, pinned);
	});

	test("requires.shardmind's floor is 1.0.0 or later, the first engine whose install takes a folder", () => {
		assert.ok(floor !== undefined, "requires.shardmind is a >= range");
		assert.ok(Number(floor.split(".")[0]) >= 1, `the README's install steps name a folder, which ShardMind before 1.0 rejects; the floor is >=${floor}`);
	});

	test("the block reader sees a declared hook, so the first test can fail", () => {
		assert.deepEqual(blockKeys("hooks:\n  bootstrap: x\n  post-update: y\nother: 1\n", "hooks"), ["bootstrap", "post-update"]);
	});
});
