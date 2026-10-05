/**
 * The four zones (CONTRIBUTING.md, "Developing this shard"), held by their
 * imports so the core can be lifted with a `git mv`:
 * - `lib/` is vendored and imports only `lib/`;
 * - `core/` imports only `core/` and `lib/`;
 * - `.claude/extensions/` imports only itself and `core/index.ts`, the
 *   core's one public entry point (SPEC.md §7.4);
 * - the entry points in `.claude/scripts/` import only `lib/` and `core/`.
 * Test files are exempt: they reach into whatever they test.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE = resolve(SCRIPTS, "..");

/** Relative import specifiers in a source file: static, re-exported and dynamic with a literal. */
export function relativeImports(source: string): string[] {
	const re = /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|import\s+['"](\.[^'"]+)['"]/g;
	return [...source.matchAll(re)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

function sources(dir: string, deep: boolean): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const abs = join(dir, name);
		if (statSync(abs).isDirectory()) {
			if (deep && name !== "node_modules") out.push(...sources(abs, deep));
		} else if (/\.(ts|mts)$/.test(name) && !/\.test\.ts$/.test(name) && !name.endsWith(".d.mts")) out.push(abs);
	}
	return out;
}

/** Each import of each file that resolves outside what `allowed` accepts, as "file -> target". */
function violations(files: readonly string[], allowed: (target: string) => boolean): string[] {
	const out: string[] = [];
	for (const file of files) {
		for (const spec of relativeImports(readFileSync(file, "utf-8"))) {
			const target = resolve(dirname(file), spec);
			if (!allowed(target)) out.push(`${relative(CLAUDE, file)} -> ${relative(CLAUDE, target)}`);
		}
	}
	return out;
}

const inside = (dir: string) => (target: string) => target === dir || target.startsWith(dir + sep);
const LIB = join(SCRIPTS, "lib");
const CORE = join(SCRIPTS, "core");
const EXTENSIONS = join(CLAUDE, "extensions");
const CORE_ENTRY = join(CORE, "index.ts");

describe("the four zones", () => {
	test("lib/ imports only lib/", () => {
		assert.deepEqual(violations(sources(LIB, true), inside(LIB)), []);
	});

	test("core/ imports only core/ and lib/", () => {
		assert.deepEqual(violations(sources(CORE, true), (t) => inside(CORE)(t) || inside(LIB)(t)), []);
	});

	test("extensions import only themselves and core/index.ts", () => {
		const files = sources(EXTENSIONS, true);
		assert.ok(files.length > 0, "the wiki extension is found");
		assert.deepEqual(violations(files, (t) => inside(EXTENSIONS)(t) || t === CORE_ENTRY), []);
	});

	test("entry points import only lib/ and core/", () => {
		const entries = sources(SCRIPTS, false);
		assert.ok(entries.some((f) => f.endsWith("session-start.ts")));
		assert.deepEqual(violations(entries, (t) => inside(LIB)(t) || inside(CORE)(t)), []);
	});

	test("the checker sees every import form, so a crossing cannot hide", () => {
		const src = [
			`import { a } from "../lib/x.ts";`,
			`import type { B } from "./types.ts";`,
			`export { c } from "../core/index.ts";`,
			`const m = await import("./dyn.ts");`,
			`import "./side.ts";`,
			`import { d } from "node:fs";`,
		].join("\n");
		assert.deepEqual(relativeImports(src), ["../lib/x.ts", "./types.ts", "../core/index.ts", "./dyn.ts", "./side.ts"]);
	});
});
