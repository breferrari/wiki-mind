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

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { debug, readStdinJson, writeHookOutput } from "./lib/hook-io.ts";
import { claimUnseen } from "./lib/hint-state.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";
import { HANDOFF_DIR, takeHandoff } from "./lib/stop-handoff.ts";
import { openVault } from "./core/context.ts";
import { formatFailures, matchSignals } from "./core/registry.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// CLASSIFY_HINT_STATE routes the state file to a tmp path for tests.
const STATE_PATH = process.env["CLASSIFY_HINT_STATE"] ?? join(SCRIPT_DIR, ".hint-state.json");

type HookInput = {
	readonly prompt?: unknown;
	readonly hook_event_name?: unknown;
	readonly session_id?: unknown;
};

/**
 * The preamble of a Gemini command wrapper (`.gemini/commands/*.toml`, #117),
 * up to where Gemini puts the typed arguments. tests/gemini-commands.test.ts
 * holds it equal to the generator's, and obsidian-mind's is the same.
 */
const GEMINI_PREAMBLE = "Run the vault command below. It is written for Claude Code: where it says $ARGUMENTS, use these arguments: ";

/**
 * What the user typed. Under Gemini, BeforeAgent gets a `/wiki-` command's
 * expanded prompt (obsidian-mind #408): the preamble, the typed arguments,
 * then the injected command file, whose words would set off hints of their
 * own. The arguments run from the preamble to the blank line before the
 * command file's frontmatter, so a multi-line argument is read whole; an
 * argument that itself holds a blank line then `---` is read up to there.
 * With no such boundary, only the preamble's own line is read.
 */
function typedPrompt(prompt: string): string {
	if (!prompt.startsWith(GEMINI_PREAMBLE)) return prompt;
	const rest = prompt.slice(GEMINI_PREAMBLE.length);
	const boundary = /\r?\n\r?\n---\r?\n/.exec(rest);
	return boundary === null ? (rest.split(/\r?\n/)[0] ?? "") : rest.slice(0, boundary.index);
}

const input = await readStdinJson<HookInput>();
if (!input) {
	debug("classify: null input (bad/empty stdin)");
	process.exit(0);
}

const sessionId = input.session_id;
const hasSession = typeof sessionId === "string" && sessionId !== "";
const stopReport = hasSession ? takeHandoff(HANDOFF_DIR, sessionId) : null;

const prompt = typeof input.prompt === "string" ? typedPrompt(input.prompt) : input.prompt;
let hints: string[] = [];
let failureLines: string[] = [];
if (typeof prompt === "string" && prompt !== "") {
	const vaultRoot = resolveProjectDir(process.cwd());
	try {
		const { registry } = await openVault(vaultRoot, "prompt");
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
			"\n\nRemember: use the templates, link every claim to its source, follow AGENTS.md.",
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
