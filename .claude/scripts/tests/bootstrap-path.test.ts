/**
 * The install hook runs the vault's one QMD bootstrap, the qmd extension's
 * (#112, SPEC.md §7.2 S11): the path its patch names must be the script
 * session start runs. The hook skips a missing script with a log line, so
 * a wrong path would otherwise ship with every test green.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BOOTSTRAP_PATH } from "../extensions/qmd/session.ts";
import { collectSections, fromLoaded } from "../core/registry.ts";
import type { HookContext } from "../core/types.ts";
import { extension } from "../../extensions/wiki/index.ts";
import { rmTemp } from "./_helpers.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("the install hook runs the qmd extension's bootstrap, which ships, and the docs give the same path", () => {
	const path = relative(REPO, BOOTSTRAP_PATH).replaceAll("\\", "/");
	const hook = readFileSync(join(REPO, ".shardmind", "hooks", "bootstrap.ts"), "utf-8");
	const named = /(?:const|let|var)\s+QMD_BOOTSTRAP_RELATIVE\s*(?::\s*string\s*)?=\s*(['"`])(.+?)\1/.exec(hook)?.[2];
	assert.ok(named !== undefined, "the hook names its bootstrap");
	assert.ok(existsSync(join(REPO, named)), `${named} ships`);
	assert.equal(named, path);
	// The manual command, where each agent looks for it.
	for (const doc of ["AGENTS.md", ".claude/skills/qmd/SKILL.md"]) {
		assert.ok(readFileSync(join(REPO, doc), "utf-8").includes(path), `${doc} gives ${path}`);
	}
});

describe("session start names files left from the old bootstrap (#115)", () => {
	// update keeps an edited .scripts/qmd-bootstrap.ts or .scripts/package.json,
	// and the old script no longer runs.
	let root = "";
	let ctx: HookContext;
	const registry = fromLoaded([{ declaration: { id: "wiki", module: ".claude/extensions/wiki/index.ts", events: ["session-start"] }, extension }]);
	const warning = async () => (await collectSections(registry, ctx, "full")).result.find((s) => s.header === "### QMD bootstrap");
	before(() => {
		root = mkdtempSync(join(tmpdir(), "wiki-bootstrap-"));
		ctx = { vaultRoot: root, manifest: null, now: Date.now() };
	});
	after(() => rmTemp(root));

	test("none left: no warning", async () => {
		assert.equal(await warning(), undefined);
	});

	const left = async (files: string[], mode: "full" | "pointer" = "full") => {
		mkdirSync(join(root, ".scripts"), { recursive: true });
		for (const f of files) writeFileSync(join(root, ".scripts", f), "// mine\n");
		try {
			return (await collectSections(registry, ctx, mode)).result.find((s) => s.header === "### QMD bootstrap")?.body ?? "";
		} finally {
			rmSync(join(root, ".scripts"), { recursive: true, force: true });
		}
	};
	const bootstrapPath = () => relative(REPO, BOOTSTRAP_PATH).replaceAll("\\", "/");

	test("the old script alone: named, the bootstrap that replaced it given, and the user asked first", async () => {
		const body = await left(["qmd-bootstrap.ts"]);
		assert.match(body, /`\.scripts\/qmd-bootstrap\.ts` is left from the old QMD bootstrap, which no longer runs/);
		assert.ok(body.includes(`\`${bootstrapPath()}\``), "gives the extension's real bootstrap path");
		assert.match(body, /Ask the user before removing anything: move anything of their own out first, then delete it,/);
	});

	test("the old script and its package.json: both named", async () => {
		const body = await left(["qmd-bootstrap.ts", "package.json"]);
		assert.match(body, /`\.scripts\/qmd-bootstrap\.ts` and `\.scripts\/package\.json` are left/);
		assert.match(body, /then delete them,/);
	});

	test("package.json alone in .scripts/: named", async () => {
		assert.match(await left(["package.json"]), /`\.scripts\/package\.json` is left/);
	});

	test("package.json beside the user's own scripts: kept quiet, since they may need it", async () => {
		assert.equal(await left(["package.json", "my-tool.ts"]), "");
	});

	test("on a resume, the section shows only when something is left: it has no pointer", async () => {
		assert.equal((await collectSections(registry, ctx, "pointer")).result.find((s) => s.header === "### QMD bootstrap"), undefined);
		assert.match(await left(["qmd-bootstrap.ts"], "pointer"), /is left from the old QMD bootstrap/);
	});
});
