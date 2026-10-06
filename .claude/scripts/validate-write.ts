#!/usr/bin/env node
/**
 * PostToolUse on Write or Edit (AfterTool on Gemini): the vault's write
 * validators, run over the file just written (SPEC.md §7.4).
 *
 * The protocol is obsidian-mind's (its validate-write.ts at v9.1.0):
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
import { openVault } from "./core/context.ts";
import { formatFailures, runValidators } from "./core/registry.ts";

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
// Windows paths compare without case: `C:/Vault` and `c:/vault/x.md` are
// the same folder, and a case mismatch must not read as outside the vault.
const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
if (!fold(fileFwd).startsWith(`${fold(rootFwd)}/`)) {
	debug(`validate: outside the vault root, skipped: ${filePath}`);
	process.exit(0);
}
const relPath = fileFwd.slice(rootFwd.length + 1);
// The skip rules match path segments, so they get the vault-relative path:
// a vault that itself sits under a `.claude/` or `templates/` folder (a
// Claude Code worktree, say) would otherwise skip every file.
if (shouldSkipFile(relPath)) {
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

const blocks: string[] = [];
try {
	const { registry, ctx } = await openVault(vaultRoot, "write");
	const validated = await runValidators(registry, { relPath, content }, ctx);
	const failureLines = formatFailures([...registry.failures, ...validated.failures]);
	if (validated.result.length > 0) blocks.push(`⚠️  ${relPath}:\n${validated.result.map((w) => `- ${w}`).join("\n")}`);
	if (failureLines.length > 0) blocks.push(`Extensions:\n${failureLines.join("\n")}`);
} catch (err) {
	// Fail open: a write is never held up by its validation.
	debug(`validate: ${err instanceof Error ? err.message : String(err)}`);
}
if (blocks.length > 0) {
	const eventName = typeof input?.hook_event_name === "string" ? input.hook_event_name : "PostToolUse";
	writeHookOutput(eventName, blocks.join("\n\n"));
}
// Exit once stdout has flushed: an extension call that timed out may have
// left a timer or a socket behind.
process.stdout.write("", () => process.exit(0));
