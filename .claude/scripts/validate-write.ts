#!/usr/bin/env node
/**
 * PostToolUse on Write or Edit (AfterTool on Gemini): the vault's write
 * validators, run over the file just written (SPEC.md §7.4).
 *
 * The protocol is obsidian-mind's (its validate-write.ts at v9.1.0):
 * - no `tool_input.file_path`, no output;
 * - a file outside the vault root is not validated (the boundary is
 *   segment-safe: /vault does not match /vaulting);
 * - the write effects (QMD's index refresh among them) run before the skip
 *   rules, so every Markdown write refreshes the index;
 * - the file is read once, and every validator sees the same snapshot;
 * - warnings go to the agent in the event's envelope, which echoes the
 *   event name.
 *
 * obsidian-mind's memory-location guard is not ported: it sends durable
 * knowledge to `brain/`, which wiki-mind does not have (SPEC.md §7.2, P5).
 */

import { readFileSync } from "node:fs";
import { debug, readStdinJson, writeHookOutput } from "./lib/hook-io.ts";
import { shouldSkipFile } from "./lib/frontmatter.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";
import { openVault } from "./core/context.ts";
import { formatFailures, runEffects, runValidators } from "./core/registry.ts";

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
	// Every write's effects run before the skip below (QMD's index refresh,
	// say): an effect decides for itself which paths it acts on.
	const target = { relPath, content };
	const effects = await runEffects(registry, { event: "write", target }, ctx);
	// The skip rules match path segments, so they get the vault-relative path:
	// a vault that itself sits under a `.claude/` or `templates/` folder (a
	// Claude Code worktree, say) would otherwise skip every file.
	const skipped = shouldSkipFile(relPath);
	if (skipped) debug(`validate: skipped ${filePath}`);
	const validated = skipped ? { result: [], failures: [] } : await runValidators(registry, target, ctx);
	const failureLines = formatFailures([...registry.failures, ...effects.failures, ...validated.failures]);
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
