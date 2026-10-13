#!/usr/bin/env node
/**
 * PreCompact hook — back up the session transcript before the agent
 * compacts its context so lost history can be rehydrated from disk if
 * needed. Keeps the most recent 30 backups; older ones are pruned.
 *
 * Backups land in the vault root's `thinking/session-logs/` (the root found
 * by lib/project-dir.ts) named
 * `session_<trigger>_<YYYYMMDD_HHMMSS>.jsonl`.
 *
 * Copied from obsidian-mind's pre-compact.ts at 70317e2, with its backup
 * and exports unchanged. Its own QMD trigger is replaced by the declared
 * pre-compact effects (#104; SPEC.md §7.2).
 */

import {
	mkdirSync,
	copyFileSync,
	readdirSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { debug, readStdinJson } from "./lib/hook-io.ts";
import { isMainModule } from "./lib/main-guard.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";
import { openVault } from "./core/context.ts";
import { formatFailures, runEffects } from "./core/registry.ts";

type HookInput = {
	readonly transcript_path?: unknown;
	readonly trigger?: unknown;
};

const BACKUP_RETAIN = 30;

export function formatTimestamp(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
		`_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
	);
}

export function listBackups(dir: string): string[] {
	try {
		return readdirSync(dir)
			.filter((f) => f.startsWith("session_") && f.endsWith(".jsonl"))
			.map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
			.sort((a, b) => b.mtime - a.mtime)
			.map((e) => e.name);
	} catch {
		return [];
	}
}

export function pruneBackups(dir: string, retain: number): void {
	const ordered = listBackups(dir);
	for (const name of ordered.slice(retain)) {
		try {
			unlinkSync(join(dir, name));
		} catch {
			/* best effort — retention is soft */
		}
	}
}

/** Copy the transcript to `thinking/session-logs/` and prune; a failed copy is non-fatal, and the caller catches the rest. */
function backUp(vaultRoot: string, input: HookInput): void {
	const transcriptPath =
		typeof input.transcript_path === "string" ? input.transcript_path : "";
	// The trigger names the backup file, so only a plain word is taken: an
	// agent's own value can't escape the folder or break a Windows name.
	const trigger =
		typeof input.trigger === "string" && /^[A-Za-z]+$/.test(input.trigger) ? input.trigger : "unknown";

	if (!transcriptPath) {
		debug("pre-compact: no transcript_path in input");
		return;
	}

	const backupDir = join(vaultRoot, "thinking/session-logs");
	mkdirSync(backupDir, { recursive: true });

	const dest = join(
		backupDir,
		`session_${trigger}_${formatTimestamp(new Date())}.jsonl`,
	);

	try {
		copyFileSync(transcriptPath, dest);
		debug(`pre-compact: backed up ${transcriptPath} → ${dest}`);
	} catch (err) {
		// Both "transcript missing" (ENOENT) and any other fs error are non-fatal:
		// hook protocol requires exit 0. The debug line differentiates so a
		// missing-transcript scenario isn't logged as a "copy failed" anomaly.
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			debug(`pre-compact: transcript not found (path=${transcriptPath})`);
		} else {
			debug(`pre-compact: copy failed: ${(err as Error).message}`);
		}
		return;
	}

	pruneBackups(backupDir, BACKUP_RETAIN);
}

if (isMainModule(import.meta.url)) {
	const input = await readStdinJson<HookInput>();
	if (!input) process.exit(0);
	const vaultRoot = resolveProjectDir(process.cwd());

	// The backup first: it is a quick copy, and it survives a hook killed by
	// its time limit while an extension loads.
	try {
		backUp(vaultRoot, input);
	} catch (err) {
		// A backup folder that can't be made never costs the effects below.
		debug(`pre-compact: backup: ${err instanceof Error ? err.message : String(err)}`);
	}

	// Then the pre-compact effects, QMD's index refresh among them: writes
	// tend to cluster right before compaction, and catching them now means the
	// resume's SessionStart finds the index current.
	try {
		const { registry, ctx } = await openVault(vaultRoot, "pre-compact");
		const effects = await runEffects(registry, { event: "pre-compact" }, ctx);
		for (const line of formatFailures([...registry.failures, ...effects.failures])) debug(`pre-compact: ${line}`);
	} catch (err) {
		debug(`pre-compact: effects: ${err instanceof Error ? err.message : String(err)}`);
	}
	// Exit once the debug lines have flushed: an extension call that timed out
	// may have left a timer or a socket behind.
	process.stderr.write("", () => process.exit(0));
}
