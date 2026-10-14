/**
 * The install hook runs the vault's one QMD bootstrap, the qmd extension's
 * (#112, SPEC.md §7.2 S11): the path its patch names must be the script
 * session start runs. The hook skips a missing script with a log line, so
 * a wrong path would otherwise ship with every test green.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BOOTSTRAP_PATH } from "../extensions/qmd/session.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("the install hook runs the qmd extension's bootstrap, which ships, and the docs give the same path", () => {
	const path = relative(REPO, BOOTSTRAP_PATH).replaceAll("\\", "/");
	const hook = readFileSync(join(REPO, ".shardmind", "hooks", "bootstrap.ts"), "utf-8");
	const named = /(?:const|let|var)\s+QMD_BOOTSTRAP_RELATIVE\s*(?::\s*string\s*)?=\s*(['"`])(.+?)\1/.exec(hook)?.[2];
	assert.ok(named !== undefined, "the hook names its bootstrap");
	assert.ok(existsSync(join(REPO, named)), `${named} ships`);
	assert.equal(named, path);
	// The manual command, where each agent looks for it, and the leftover-script warning (#115).
	for (const doc of ["AGENTS.md", ".claude/skills/qmd/SKILL.md", ".claude/extensions/wiki/index.ts"]) {
		assert.ok(readFileSync(join(REPO, doc), "utf-8").includes(path), `${doc} gives ${path}`);
	}
});
