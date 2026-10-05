/**
 * A defaults QMD bootstrap in a wiki-mind vault (SPEC.md §7.2, Config):
 * the collection is registered under the index derived from the vault's
 * folder name, and gets wiki-mind's `qmd_context`, never the vendored
 * bootstrap's generic fallback text.
 *
 * QMD itself is faked: a stand-in `@tobilu/qmd` package, resolved the way
 * lib/qmd.ts resolves the real one, logs each call and answers `--version`.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rmTemp } from "./_helpers.ts";
import { deriveQmdIndex } from "../lib/session-start.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let parent = "";
let vault = "";
let log = "";

before(() => {
	parent = mkdtempSync(join(tmpdir(), "wiki-boot-"));
	vault = join(parent, "My Research Wiki");
	mkdirSync(join(vault, ".claude"), { recursive: true });
	cpSync(join(REPO, ".scripts"), join(vault, ".scripts"), { recursive: true });
	cpSync(join(REPO, ".claude", "scripts", "lib"), join(vault, ".claude", "scripts", "lib"), { recursive: true });
	cpSync(join(REPO, ".claude", "scripts", "package.json"), join(vault, ".claude", "scripts", "package.json"));
	cpSync(join(REPO, "vault-manifest.json"), join(vault, "vault-manifest.json"));
	const fake = join(vault, ".claude", "scripts", "node_modules", "@tobilu", "qmd");
	mkdirSync(join(fake, "dist", "cli"), { recursive: true });
	writeFileSync(join(fake, "package.json"), JSON.stringify({ name: "@tobilu/qmd", version: "2.1.0" }));
	writeFileSync(
		join(fake, "dist", "cli", "qmd.js"),
		"const fs = require('fs');\n" +
			"fs.appendFileSync(process.env.FAKE_QMD_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n" +
			"if (process.argv.includes('--version')) console.log('qmd 2.1.0');\n",
	);
	log = join(parent, "qmd-calls.jsonl");
});
after(() => rmTemp(parent));

describe("QMD bootstrap in a wiki-mind vault", () => {
	test("registers the collection under the derived index, with wiki-mind's context", () => {
		const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", join(".scripts", "qmd-bootstrap.ts")], {
			cwd: vault,
			encoding: "utf-8",
			env: { ...process.env, FAKE_QMD_LOG: log },
			timeout: 30_000,
		});
		assert.equal(run.status, 0, run.stderr);
		const index = deriveQmdIndex(vault);
		assert.notEqual(index, null);
		const calls = readFileSync(log, "utf-8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
		const add = calls.find((c) => c.includes("collection") && c.includes("add"));
		assert.ok(add, JSON.stringify(calls));
		assert.equal(add[add.indexOf("--index") + 1], index);
		assert.equal(add[add.indexOf("--name") + 1], index);
		const context = calls.find((c) => c.includes("context") && c.includes("add"));
		assert.ok(context, JSON.stringify(calls));
		const manifest = JSON.parse(readFileSync(join(REPO, "vault-manifest.json"), "utf-8")) as { qmd_context: string };
		assert.ok(context.includes(manifest.qmd_context), JSON.stringify(context));
		assert.ok(!JSON.stringify(calls).includes("Obsidian vault template"), "never the generic fallback context");
		assert.match(run.stdout, new RegExp(`Bootstrapping QMD index '${index}'`));
	});
});
