/**
 * vault-manifest.json, held to SPEC.md §7.2 (Config) and §7.4 (Declaration):
 * every key the vendored code reads is present and parses as valid; the
 * declared extensions parse with no failure; and the keys of obsidian-mind's
 * unvendored code are absent.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	parseInfraRootFilenames,
	parseInjectionBudget,
	parseInstructionBudget,
	parseListingCollapseThreshold,
	parseQmdIndex,
	parseQmdMinVersion,
} from "../lib/session-start.ts";
import { parseDeclarations, parseManifest } from "../core/registry.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const raw = readFileSync(join(REPO, "vault-manifest.json"), "utf-8");
const manifest = parseManifest(raw);

describe("vault-manifest.json", () => {
	test("is a JSON object", () => {
		assert.notEqual(manifest, null);
	});

	test("the session-context budgets parse", () => {
		assert.equal(parseInjectionBudget(raw), 9100);
		assert.equal(parseInstructionBudget(raw), 20000);
		assert.equal(parseListingCollapseThreshold(raw), 12);
	});

	test("QMD: the index is derived from the vault folder, the minimum version parses, the context is set", () => {
		assert.equal(manifest?.["qmd_index"], "", "empty, so two vaults on one machine never share a store");
		assert.equal(parseQmdIndex(raw), null);
		assert.equal(parseQmdMinVersion(raw), "2.0.0");
		assert.match(String(manifest?.["qmd_context"]), /wiki-mind/);
	});

	test("the vault's identity and its root infrastructure", () => {
		assert.equal(manifest?.["template"], "wiki-mind");
		for (const file of ["CLAUDE.md", "README.md", "LICENSE", "Index.md", "vault-manifest.json"]) {
			assert.ok(parseInfraRootFilenames(raw).includes(file), file);
		}
	});

	test("the declared extensions parse with no failure", () => {
		const { result, failures } = parseDeclarations(manifest);
		assert.deepEqual(failures, []);
		assert.deepEqual(result.map((d) => d.id), ["wiki"]);
	});

	test("obsidian-mind's keys for code wiki-mind does not vendor are absent", () => {
		for (const key of ["open_loop_dirs", "open_loop_sections", "memory_root", "mcp_exposed_roots", "mcp_never_expose", "mcp_inbox", "user_content_roots", "scaffold"]) {
			assert.ok(!(key in (manifest ?? {})), key);
		}
	});
});
