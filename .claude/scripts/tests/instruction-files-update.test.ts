/**
 * An existing vault updating to the AGENTS.md model (#25), proved through
 * ShardMind's real update engine rather than assumed from its spec.
 *
 * Each case installs wiki-mind 0.1.0 into a scratch folder, then updates it
 * to the commit under test. 0.1.0 is installed by ref (`#v0.1.0`), and its
 * recorded ref is then pointed at the commit under test: `shardmind update`
 * re-resolves a ref-installed vault's ref, so this stands in for a release
 * bump without publishing one. Then:
 * - an unmodified CLAUDE.md, which the new version no longer ships, is
 *   removed, and AGENTS.md arrives;
 * - a CLAUDE.md the user edited is kept (ShardMind never drops a user's
 *   change), and AGENTS.md arrives beside it.
 *
 * Like the contract test, it needs the network and a pushed commit, so it
 * runs only with WIKI_CONTRACT_REF set (CI sets it to the commit it checked
 * out). WIKI_CONTRACT_CLI may point at a local shardmind cli.js; otherwise
 * `npx shardmind@<the version CI pins>` runs it.
 */
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmTemp } from "./_helpers.ts";
import { shardmind } from "./_shard.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REF = process.env["WIKI_CONTRACT_REF"] ?? "";
const BASE_REF = "v0.1.0";
const SHARD = "github:breferrari/wiki-mind";

const folders: string[] = [];
after(() => {
	for (const f of folders) rmTemp(f);
});

/** Install wiki-mind 0.1.0 into a new scratch folder, and point its recorded ref at the commit under test. */
function installBase(): string {
	const vault = mkdtempSync(join(tmpdir(), "wiki-update-"));
	folders.push(vault);
	const run = shardmind(REPO, vault, "install", "--defaults", `${SHARD}#${BASE_REF}`, ".");
	assert.equal(run.status, 0, `install of ${BASE_REF} failed:\n${run.stdout}\n${run.stderr}`);
	assert.ok(existsSync(join(vault, "CLAUDE.md")), "0.1.0 ships CLAUDE.md");
	const statePath = join(vault, ".shardmind", "state.json");
	const state = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
	assert.equal(state["ref"], BASE_REF, "a ref install records its ref");
	writeFileSync(statePath, `${JSON.stringify({ ...state, ref: REF }, null, 2)}\n`);
	return vault;
}

function update(vault: string) {
	const run = shardmind(REPO, vault, "update", "--yes");
	assert.equal(run.status, 0, `update to ${REF} failed:\n${run.stdout}\n${run.stderr}`);
	return run;
}

describe("updating a 0.1.0 vault to the AGENTS.md model", { skip: REF === "" ? "WIKI_CONTRACT_REF is unset (CI sets it to the commit it checked out)" : false }, () => {
	test("an unmodified CLAUDE.md is removed, and AGENTS.md arrives", () => {
		const vault = installBase();
		update(vault);
		assert.equal(existsSync(join(vault, "CLAUDE.md")), false, "the unmodified CLAUDE.md is removed");
		assert.ok(existsSync(join(vault, "AGENTS.md")), "AGENTS.md arrives");
	});

	test("a CLAUDE.md the user edited is kept, and AGENTS.md arrives beside it", () => {
		const vault = installBase();
		const mine = "\n## My own notes\n\nKeep this.\n";
		appendFileSync(join(vault, "CLAUDE.md"), mine);
		update(vault);
		assert.ok(existsSync(join(vault, "CLAUDE.md")), "the edited CLAUDE.md is kept");
		assert.ok(readFileSync(join(vault, "CLAUDE.md"), "utf-8").endsWith(mine), "with the user's edit");
		assert.ok(existsSync(join(vault, "AGENTS.md")), "AGENTS.md arrives");
	});
});
