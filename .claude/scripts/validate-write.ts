#!/usr/bin/env node
/**
 * PostToolUse on Write or Edit (AfterTool on Gemini): the vault's write
 * validators, run over the file just written (SPEC.md §7.4).
 *
 * The protocol is obsidian-mind's (its validate-write.ts at c65062d):
 * - no `tool_input.file_path`, no output;
 * - the debounced QMD refresh runs before any skip, so every Markdown
 *   write refreshes the index;
 * - a file outside the vault root is not validated (the boundary is
 *   segment-safe: /vault does not match /vaulting);
 * - the file is read once, and every validator sees the same snapshot;
 * - warnings go to the agent in the event's envelope, which echoes the
 *   event name.
 *
 * obsidian-mind's memory-location guard is not ported: it sends durable
 * knowledge to `brain/`, which wiki-mind does not have (SPEC.md §7.2, P5).
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { debug, readStdinJson, writeHookOutput } from "./lib/hook-io.ts";
import { shouldSkipFile } from "./lib/frontmatter.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";
import { shouldRefreshForPath, triggerDebouncedRefresh } from "./lib/qmd-refresh.ts";
import { formatFailures, loadRegistry, parseManifest, runValidators } from "./core/registry.ts";

type HookInput = {
	readonly tool_input?: unknown;
	readonly hook_event_name?: unknown;
};

const input = await readStdinJson<HookInput>();
const toolInput = input?.tool_input;
const filePath = typeof toolInput === "object" && toolInput !== null ? (toolInput as Record<string, unknown>)["file_path"] : undefined;
if (typeof filePath !== "string" || filePath === "") {
	debug("validate: no file_path");
	process.exit(0);
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// QMD_REFRESH_SENTINEL routes the sentinel to a tmp path for tests.
const SENTINEL_PATH = process.env["QMD_REFRESH_SENTINEL"] ?? join(SCRIPT_DIR, ".qmd-refresh-sentinel");
if (shouldRefreshForPath(filePath)) {
	triggerDebouncedRefresh({
		sentinelPath: SENTINEL_PATH,
		workerPath: resolvePath(SCRIPT_DIR, "qmd-refresh-run.ts"),
		debounceMs: 30_000,
		logPrefix: "validate-write",
	});
}

const vaultRoot = resolveProjectDir(process.cwd());
const rootFwd = vaultRoot.replaceAll("\\", "/").replace(/\/+$/, "");
const fileFwd = filePath.replaceAll("\\", "/");
if (!fileFwd.startsWith(`${rootFwd}/`)) {
	debug(`validate: outside the vault root, skipped: ${filePath}`);
	process.exit(0);
}
if (shouldSkipFile(filePath)) {
	debug(`validate: skipped ${filePath}`);
	process.exit(0);
}

let content: string;
try {
	content = readFileSync(filePath, "utf-8");
} catch {
	debug(`validate: could not read ${filePath}`);
	process.exit(0);
}

let manifestJson: string | null = null;
try {
	manifestJson = readFileSync(join(vaultRoot, "vault-manifest.json"), "utf-8");
} catch {
	/* no manifest: no extensions */
}
const manifest = parseManifest(manifestJson);
const registry = await loadRegistry(vaultRoot, manifest);
const relPath = fileFwd.slice(rootFwd.length + 1);
const validated = await runValidators(registry, { relPath, content }, { vaultRoot, manifest, now: Date.now() });
const failureLines = formatFailures([...registry.failures, ...validated.failures]);

const blocks: string[] = [];
if (validated.result.length > 0) blocks.push(`⚠️  ${relPath}:\n${validated.result.map((w) => `- ${w}`).join("\n")}`);
if (failureLines.length > 0) blocks.push(`Extensions:\n${failureLines.join("\n")}`);
if (blocks.length > 0) {
	const eventName = typeof input?.hook_event_name === "string" ? input.hook_event_name : "PostToolUse";
	writeHookOutput(eventName, blocks.join("\n\n"));
}
process.exit(0);
