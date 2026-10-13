#!/usr/bin/env node
/**
 * PostToolUse on a write (AfterTool on Gemini): the vault's write
 * validators, run over each file just written (SPEC.md §7.4).
 *
 * The protocol is obsidian-mind's (its validate-write.ts):
 * - the files written are `writeTargets`: Claude Code's and Gemini's
 *   `tool_input.file_path`, or each file a Codex `apply_patch` adds, updates
 *   or moves to (a deleted file is not validated); none, no output;
 * - a file outside the vault root is not validated (the boundary is
 *   segment-safe: /vault does not match /vaulting);
 * - the write effects (QMD's index refresh among them) run for each file
 *   before the skip rules, so every Markdown write refreshes the index;
 * - each file is read once, and every validator sees the same snapshot;
 * - warnings go to the agent in one envelope for the call, which echoes the
 *   event name.
 *
 * obsidian-mind's memory-location guard is not ported: it sends durable
 * knowledge to `brain/`, which wiki-mind does not have (SPEC.md §7.2, P5).
 */

import { readFileSync } from "node:fs";
import { debug, readStdinJson, writeHookOutput } from "./lib/hook-io.ts";
import { shouldSkipFile } from "./lib/frontmatter.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";
import { writeTargets } from "./lib/write-targets.ts";
import { openVault } from "./core/context.ts";
import { formatFailures, runEffects, runValidators } from "./core/registry.ts";
import type { Failure } from "./core/types.ts";

type HookInput = {
	readonly hook_event_name?: unknown;
};

const input = await readStdinJson<HookInput>();
const vaultRoot = resolveProjectDir(process.cwd());
const filePaths = writeTargets(input, vaultRoot);
if (filePaths.length === 0) {
	debug("validate: no file written");
	process.exit(0);
}

const rootFwd = vaultRoot.replaceAll("\\", "/").replace(/\/+$/, "");
// Windows paths compare without case: `C:/Vault` and `c:/vault/x.md` are
// the same folder, and a case mismatch must not read as outside the vault.
const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/** Each written file inside the vault that could be read, with its vault-relative path. */
const targets = filePaths.flatMap((filePath) => {
	const fileFwd = filePath.replaceAll("\\", "/");
	if (!fold(fileFwd).startsWith(`${fold(rootFwd)}/`)) {
		debug(`validate: outside the vault root, skipped: ${filePath}`);
		return [];
	}
	try {
		return [{ relPath: fileFwd.slice(rootFwd.length + 1), content: readFileSync(filePath, "utf-8") }];
	} catch {
		debug(`validate: could not read ${filePath}`);
		return [];
	}
});
if (targets.length === 0) process.exit(0);

const blocks: string[] = [];
try {
	const { registry, ctx } = await openVault(vaultRoot, "write");
	const failures: Failure[] = [...registry.failures];
	for (const target of targets) {
		// Every write's effects run before the skip below (QMD's index refresh,
		// say): an effect decides for itself which paths it acts on.
		const effects = await runEffects(registry, { event: "write", target }, ctx);
		// The skip rules match path segments, so they get the vault-relative
		// path: a vault that itself sits under a `.claude/` or `templates/`
		// folder (a Claude Code worktree, say) would otherwise skip every file.
		const skipped = shouldSkipFile(target.relPath);
		if (skipped) debug(`validate: skipped ${target.relPath}`);
		const validated = skipped ? { result: [], failures: [] } : await runValidators(registry, target, ctx);
		failures.push(...effects.failures, ...validated.failures);
		if (validated.result.length > 0) blocks.push(`⚠️  ${target.relPath}:\n${validated.result.map((w) => `- ${w}`).join("\n")}`);
	}
	const failureLines = formatFailures(failures);
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
