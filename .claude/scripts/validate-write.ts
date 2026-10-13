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
 *   removed file, or a written one already gone, has empty content;
 * - the files written (`writeTargets`: not a deleted file or a moved
 *   note's old path) are validated, and one that can't be read is reported;
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
import { foldOnDisk } from "./lib/instruction-files.ts";
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
const written = new Set(writeTargets(input, vaultRoot));
// refreshTargets is written plus removed (a deleted file, a moved note's old path).
const removed = refreshTargets(input, vaultRoot).filter((p) => !written.has(p));
if (written.size === 0 && removed.length === 0) {
	debug("validate: no file written");
	process.exit(0);
}

const rootFwd = vaultRoot.replaceAll("\\", "/").replace(/\/+$/, "");
// Where the filesystem ignores case (Windows, macOS), `C:/Vault` and
// `c:/vault/x.md` are the same folder, and a case mismatch must not read as
// outside the vault: the core's rule (mindframe #91), the one shouldSkipFile
// uses too. It goes by platform, so a case-sensitive volume on macOS is folded
// as well (the core's gap, mindframe #112).
const fold = foldOnDisk;
const rootKey = `${fold(rootFwd)}/`;

/**
 * Each changed file inside the vault, once, keyed so that where the
 * filesystem ignores case one file named in two cases is one file; a written spelling wins over a
 * removed one, so a case-only rename is validated under its new name.
 */
const byFile = new Map<string, { filePath: string; relPath: string; written: boolean }>();
const listed: { filePath: string; isWritten: boolean }[] = [
	...[...written].map((filePath) => ({ filePath, isWritten: true })),
	...removed.map((filePath) => ({ filePath, isWritten: false })),
];
for (const { filePath, isWritten } of listed) {
	const fileFwd = filePath.replaceAll("\\", "/");
	const key = fold(fileFwd);
	if (!key.startsWith(rootKey)) {
		debug(`validate: outside the vault root, skipped: ${filePath}`);
		continue;
	}
	if (!byFile.has(key)) byFile.set(key, { filePath, relPath: fileFwd.slice(rootFwd.length + 1), written: isWritten });
}

/**
 * Each target, read once if written. A removed file, or a written one that
 * is gone (a patch that adds a note and then moves it away), has empty
 * content and is not validated: its effects still run, so the index hears
 * it changed. A written file that exists but can't be read is reported.
 */
const unread: string[] = [];
const targets = [...byFile.values()].map(({ filePath, relPath, written: isWritten }) => {
	if (!isWritten) return { relPath, content: "", validate: false };
	try {
		return { relPath, content: readFileSync(filePath, "utf-8"), validate: true };
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") unread.push(`⚠️  ${relPath}: not checked, it could not be read (${code ?? String(err)})`);
		debug(`validate: could not read ${filePath}`);
		return { relPath, content: "", validate: false };
	}
});
if (targets.length === 0) process.exit(0);

const blocks: string[] = [...unread];
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
		// The root lets a root `claude.md` match the retired CLAUDE.md where
		// the filesystem ignores case (mindframe #91).
		if (shouldSkipFile(relPath, { vaultRoot })) {
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
