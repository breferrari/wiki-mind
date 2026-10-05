/**
 * wiki-mind's personalize hook (.shardmind/hooks/personalize.ts, SPEC.md
 * §6.5, #17): the owner and research focus go into Index.md in place of the
 * marker line, once, and nothing else changes.
 */
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rmTemp } from "./_helpers.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const hook = (await import(pathToFileURL(join(REPO, ".shardmind", "hooks", "personalize.ts")).href)) as {
	default: (ctx: unknown) => Promise<void>;
	MARKER: string;
	aboutLine: (name: string, focus: string) => string | null;
};
const dirs: string[] = [];
after(() => dirs.forEach(rmTemp));

const INDEX = `# Index\n\n${hook.MARKER}\n\nThe wiki's entry point.\n`;

async function run(values: Record<string, unknown>, index: string | null = INDEX): Promise<string | null> {
	const dir = mkdtempSync(join(tmpdir(), "wiki-personalize-"));
	dirs.push(dir);
	if (index !== null) writeFileSync(join(dir, "Index.md"), index);
	const log = console.log;
	console.log = () => undefined;
	try {
		await hook.default({ slot: "personalize", vaultRoot: dir, values, modules: {}, shard: { name: "wiki-mind", version: "0.1.0" } });
	} finally {
		console.log = log;
	}
	try {
		return readFileSync(join(dir, "Index.md"), "utf-8");
	} catch {
		return null;
	}
}

describe("the personalize hook", () => {
	test("both values replace the marker line, and nothing else changes", async () => {
		const out = await run({ user_name: "Ada", research_focus: "Retrieval-augmented generation" });
		assert.equal(out, INDEX.replace(hook.MARKER, "> **Focus:** Retrieval-augmented generation · **Kept by** Ada"));
	});

	test("one value alone is written alone", async () => {
		assert.match((await run({ user_name: "", research_focus: "Memory" })) ?? "", /^> \*\*Focus:\*\* Memory$/m);
		assert.match((await run({ user_name: "Ada", research_focus: "  " })) ?? "", /^> \*\*Kept by\*\* Ada$/m);
	});

	test("both blank: Index.md is untouched", async () => {
		assert.equal(await run({ user_name: " ", research_focus: "", qmd_enabled: false }), INDEX);
	});

	test("without the marker (already edited), Index.md is untouched", async () => {
		const edited = "# Index\n\nMy own intro.\n";
		assert.equal(await run({ user_name: "Ada", research_focus: "X" }, edited), edited);
	});

	test("without Index.md, nothing is created", async () => {
		assert.equal(await run({ user_name: "Ada", research_focus: "X" }, null), null);
	});

	test("CRLF line endings are kept", async () => {
		const crlf = INDEX.replaceAll("\n", "\r\n");
		const out = (await run({ user_name: "Ada", research_focus: "" }, crlf)) ?? "";
		assert.ok(out.includes("> **Kept by** Ada\r\n"));
		assert.ok(!out.includes(hook.MARKER));
	});
});
