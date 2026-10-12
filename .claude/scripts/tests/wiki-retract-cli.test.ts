/**
 * `/wiki-retract`'s script (.claude/extensions/wiki/wiki-retract.ts), run
 * as the command runs it: its exit codes, --dry-run, and a full pass written
 * with the core's atomic write, in a temp vault.
 */
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmTemp } from "./_helpers.ts";

const RUNNER = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "extensions", "wiki", "wiki-retract.ts");
const fm = (fields: Record<string, string>) =>
	`---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
const BASE = { date: "2026-10-01", description: "d", tags: "[t]" };
const SOURCE = { ...BASE, authors: "A", year: "2024", url: "https://a" };

let roots: string[] = [];
afterEach(() => {
	for (const r of roots) rmTemp(r);
	roots = [];
});

function vault(): string {
	const root = mkdtempSync(join(tmpdir(), "wiki-retract-cli-"));
	roots.push(root);
	const files: Record<string, string> = {
		"sources/Smith 2024.md": fm(SOURCE) + "# Smith 2024\n",
		"sources/Lee 2025.md": fm(SOURCE) + "# Lee 2025\n",
		"concepts/RAG.md": fm(BASE) + "- Only [[Smith 2024]].\n",
		"Index.md": "# Index\n- [[Smith 2024]] the paper\n",
	};
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(join(root, rel, ".."), { recursive: true });
		writeFileSync(join(root, rel), content);
	}
	return root;
}

/** Run the script from `projectDir`, with CLAUDE_PROJECT_DIR naming it. */
function run(projectDir: string, ...args: string[]) {
	const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
	delete env["CODEX_PROJECT_DIR"];
	delete env["GEMINI_PROJECT_DIR"];
	const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", RUNNER, ...args], { cwd: projectDir, env, encoding: "utf-8" });
	return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const read = (root: string, rel: string) => readFileSync(join(root, rel), "utf-8");

describe("wiki-retract.ts", () => {
	// Its vault has no vault-manifest.json, so this also covers a folder outside any vault: used as given.
	test("--dry-run prints the plan and writes nothing", () => {
		const root = vault();
		const r = run(root, "Smith 2024", "--dry-run", "--date", "2026-10-12");
		assert.equal(r.code, 0, r.stderr);
		assert.match(r.stdout, /WITHDRAWN\s+concepts\/RAG\.md:6/);
		assert.match(r.stdout, /Would write: concepts\/RAG\.md, Index\.md, sources\/Smith 2024\.md/);
		assert.equal(read(root, "concepts/RAG.md"), fm(BASE) + "- Only [[Smith 2024]].\n");
	});

	test("a full run writes every note and exits 0", () => {
		const root = vault();
		const r = run(root, "Smith 2024", "--date", "2026-10-12", "--notice", "https://notice", "--reason", "fabricated");
		assert.equal(r.code, 0, r.stderr);
		assert.match(r.stdout, /Written: concepts\/RAG\.md, Index\.md, sources\/Smith 2024\.md/);
		assert.match(read(root, "sources/Smith 2024.md"), /- 2026-10-12: retracted\. Notice: https:\/\/notice\. Reason: fabricated/);
		assert.ok(read(root, "concepts/RAG.md").includes("(withdrawn 2026-10-12)"));
	});

	test("finds the vault from a subfolder: a session started in concepts/ still finds sources/ (#89)", () => {
		const root = vault();
		writeFileSync(join(root, "vault-manifest.json"), "{}\n");
		const r = run(join(root, "concepts"), "Smith 2024", "--date", "2026-10-12");
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.ok(read(root, "concepts/RAG.md").includes("(withdrawn 2026-10-12)"));
	});

	test("exit 2, with the reason, for a call the pass can't run", () => {
		const root = vault();
		const cases: [string[], RegExp][] = [
			[["Nobody 1999"], /No note in sources\/ is named Nobody 1999/],
			[["Smith 2024", "--superseded-by", "Park 2026"], /ingest Park 2026 first/],
			[["Smith 2024", "--superseded-by", "Smith 2024"], /can't supersede itself/],
			[["Smith 2024", "--undo", "--superseded-by", "Lee 2025"], /--undo takes no --superseded-by/],
			[["Smith 2024", "--date", "12/10/2026"], /--date takes a real date as YYYY-MM-DD/],
			[["Smith 2024", "--date", "2026-13-45"], /--date takes a real date as YYYY-MM-DD/],
			[["Smith 2024", "--date", "2026-02-30"], /--date takes a real date as YYYY-MM-DD/],
			[[], /usage: wiki-retract\.ts/],
			[["Smith 2024", "--bogus"], /usage: wiki-retract\.ts/],
		];
		for (const [args, message] of cases) {
			const r = run(root, ...args);
			assert.equal(r.code, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
			assert.match(r.stderr, message, args.join(" "));
		}
		assert.equal(read(root, "concepts/RAG.md"), fm(BASE) + "- Only [[Smith 2024]].\n", "nothing was written");
	});

	test("a planning failure that isn't the pass's own is exit 2 too: nothing was written", () => {
		const root = vault();
		rmSync(join(root, "Index.md"));
		mkdirSync(join(root, "Index.md"));
		const r = run(root, "Smith 2024");
		assert.equal(r.code, 2, r.stdout + r.stderr);
		assert.match(r.stderr, /Nothing was written/);
		assert.equal(read(root, "concepts/RAG.md"), fm(BASE) + "- Only [[Smith 2024]].\n");
	});
});
