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

	for (const files of [["qmd-bootstrap.ts"], ["package.json"], ["qmd-bootstrap.ts", "package.json"]]) {
		test(`${files.join(" and ")} left: named, with the bootstrap that replaced it, and the user asked first`, async () => {
			mkdirSync(join(root, ".scripts"), { recursive: true });
			for (const f of files) writeFileSync(join(root, ".scripts", f), "// mine\n");
			try {
				const body = (await warning())?.body ?? "";
				for (const f of files) assert.ok(body.includes(`\`.scripts/${f}\``), `names .scripts/${f}`);
				assert.match(body, /no longer runs/);
				assert.ok(body.includes(`\`${relative(REPO, BOOTSTRAP_PATH).replaceAll("\\", "/")}\``), "gives the extension's real bootstrap path");
				assert.match(body, /Ask the user before removing anything/);
				assert.match(body, /move anything of their own out first/);
			} finally {
				rmSync(join(root, ".scripts"), { recursive: true, force: true });
			}
		});
	}
});
