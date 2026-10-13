#!/usr/bin/env node
/**
 * PostToolUse on a write (AfterTool on Gemini): the vault's write
 * validators, run over each file just written (SPEC.md §7.4).
 *
 * The protocol is obsidian-mind's (its validate-write.ts at 70317e2):
 * - the files changed are `refreshTargets`: Claude Code's and Gemini's
 *   `tool_input.file_path`, or each file a Codex `apply_patch` adds,
 *   updates, deletes or moves (both paths); none, no output;
 * - a file outside the vault root is left alone (the boundary is
 *   segment-safe: /vault does not match /vaulting);
 * - the write effects (QMD's index refresh among them) run for each changed
 *   file before the skip rules, so the index sees every Markdown change; a
 *   removed file's target has empty content;
 * - the files written (`writeTargets`: not a deleted file or a moved
 *   note's old path) are validated;
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
import { refreshTargets, writeTargets } from "./lib/write-targets.ts";
import { openVault } from "./core/context.ts";
import { formatFailures, runEffects, runValidators } from "./core/registry.ts";
import type { Failure } from "./core/types.ts";

type HookInput = {
	readonly hook_event_name?: unknown;
};

const input = await readStdinJson<HookInput>();
const vaultRoot = resolveProjectDir(process.cwd());
const changed = refreshTargets(input, vaultRoot);
if (changed.length === 0) {
	debug("validate: no file written");
	process.exit(0);
}
const written = new Set(writeTargets(input, vaultRoot));

const rootFwd = vaultRoot.replaceAll("\\", "/").replace(/\/+$/, "");
// Windows paths compare without case: `C:/Vault` and `c:/vault/x.md` are
// the same folder, and a case mismatch must not read as outside the vault.
const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/**
 * Each changed file inside the vault, with its vault-relative path, read
 * once. A written file that can't be read is left out; a removed one has
 * empty content and is not validated.
 */
const targets = changed.flatMap((filePath) => {
	const fileFwd = filePath.replaceAll("\\", "/");
	if (!fold(fileFwd).startsWith(`${fold(rootFwd)}/`)) {
		debug(`validate: outside the vault root, skipped: ${filePath}`);
		return [];
	}
	const relPath = fileFwd.slice(rootFwd.length + 1);
	if (!written.has(filePath)) return [{ relPath, content: "", validate: false }];
	try {
		return [{ relPath, content: readFileSync(filePath, "utf-8"), validate: true }];
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
	for (const { relPath, content, validate } of targets) {
		const target = { relPath, content };
		// Every change's effects run before the skip below (QMD's index
		// refresh, say): an effect decides for itself which paths it acts on.
		const effects = await runEffects(registry, { event: "write", target }, ctx);
		failures.push(...effects.failures);
		if (!validate) continue;
		// The skip rules match path segments, so they get the vault-relative
		// path: a vault that itself sits under a `.claude/` or `templates/`
		// folder (a Claude Code worktree, say) would otherwise skip every file.
		if (shouldSkipFile(relPath)) {
			debug(`validate: skipped ${relPath}`);
			continue;
		}
		const validated = await runValidators(registry, target, ctx);
		failures.push(...validated.failures);
		if (validated.result.length > 0) blocks.push(`⚠️  ${relPath}:\n${validated.result.map((w) => `- ${w}`).join("\n")}`);
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
