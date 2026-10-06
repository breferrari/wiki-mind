#!/usr/bin/env node
/**
 * UserPromptSubmit (BeforeAgent on Gemini): the routing hints of the vault's
 * prompt signals, and the previous turn's Stop report when one is waiting
 * (SPEC.md §7.4).
 *
 * The protocol is obsidian-mind's (its classify-message.ts at v9.1.0):
 * - the waiting Stop report is taken first, whatever the prompt holds;
 * - each hint fires once per session (lib/hint-state.ts), failing open
 *   without a session id;
 * - the envelope echoes the event name, and nothing is written when there
 *   is neither a hint nor a report.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { debug, readStdinJson, writeHookOutput } from "./lib/hook-io.ts";
import { claimUnseen } from "./lib/hint-state.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";
import { HANDOFF_DIR, takeHandoff } from "./lib/stop-handoff.ts";
import { formatFailures, loadRegistry, matchSignals, parseManifest } from "./core/registry.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// CLASSIFY_HINT_STATE routes the state file to a tmp path for tests.
const STATE_PATH = process.env["CLASSIFY_HINT_STATE"] ?? join(SCRIPT_DIR, ".hint-state.json");

type HookInput = {
	readonly prompt?: unknown;
	readonly hook_event_name?: unknown;
	readonly session_id?: unknown;
};

const input = await readStdinJson<HookInput>();
if (!input) {
	debug("classify: null input (bad/empty stdin)");
	process.exit(0);
}

const sessionId = input.session_id;
const hasSession = typeof sessionId === "string" && sessionId !== "";
const stopReport = hasSession ? takeHandoff(HANDOFF_DIR, sessionId) : null;

const prompt = input.prompt;
let hints: string[] = [];
let failureLines: string[] = [];
if (typeof prompt === "string" && prompt !== "") {
	const vaultRoot = resolveProjectDir(process.cwd());
	let manifestJson: string | null = null;
	try {
		manifestJson = readFileSync(join(vaultRoot, "vault-manifest.json"), "utf-8");
	} catch {
		/* no manifest: no extensions */
	}
	try {
		const registry = await loadRegistry(vaultRoot, parseManifest(manifestJson), "prompt");
		const matched = await matchSignals(registry, prompt);
		hints = hasSession && matched.result.length > 0 ? claimUnseen(STATE_PATH, sessionId, matched.result) : matched.result;
		failureLines = formatFailures([...registry.failures, ...matched.failures]);
	} catch (err) {
		// Fail open: the waiting Stop report still rides with this prompt.
		debug(`classify: ${err instanceof Error ? err.message : String(err)}`);
	}
}

const parts: string[] = [];
if (hints.length > 0) {
	parts.push(
		"Wiki routing hints (act on these if the user's message contains relevant info):\n" +
			hints.map((h) => `- ${h}`).join("\n") +
			"\n\nRemember: use the templates, link every claim to its source, follow CLAUDE.md.",
	);
}
if (failureLines.length > 0) parts.push(`Extensions:\n${failureLines.join("\n")}`);
if (stopReport !== null) parts.push(stopReport);

if (parts.length > 0) {
	const eventName = typeof input.hook_event_name === "string" ? input.hook_event_name : "UserPromptSubmit";
	writeHookOutput(eventName, parts.join("\n\n"));
}
// Exit once stdout has flushed: an extension call that timed out may have
// left a timer or a socket behind.
process.stdout.write("", () => process.exit(0));
