#!/usr/bin/env node
/**
 * Stop (SessionEnd on Gemini): the wrap-up checklist and the vault's
 * hygiene findings, assembled from its extensions (SPEC.md §7.4).
 *
 * The protocol is obsidian-mind's (its stop-checklist.ts at v9.1.0):
 * - always exactly one JSON object on stdout, `{}` when silent;
 * - under the mod, `standdown` writes `{}` and nothing else, and `report`
 *   writes the report as data (`{"report": {key, claims, agentText}}`);
 * - a re-entry (`stop_hook_active`) says nothing and starts no refresh;
 * - a Stop reports when the findings changed since the last report this
 *   session: a one-line summary now, and the full report handed to the
 *   agent with the next prompt (lib/stop-handoff.ts), or as Stop feedback
 *   when it cannot be saved;
 * - SessionEnd, or an input with no session, reports in full;
 * - Stop's effects (QMD's debounced index refresh among them) run once the
 *   registry has loaded, before the checks.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	debug,
	readStdinJson,
	writeSilentHookOutput,
	writeStopFeedback,
	writeStopReportData,
	writeSystemMessage,
} from "./lib/hook-io.ts";
import { claimChanged } from "./lib/hint-state.ts";
import { readOmMod } from "./lib/om-mod.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";
import { reportKey } from "./lib/report-key.ts";
import { HANDOFF_DIR, pruneHandoffs, writeHandoff } from "./lib/stop-handoff.ts";
import { AGENT_PREFACE, FEEDBACK_PREFACE, FEEDBACK_TRAILER, modPreface, stopSummary } from "./lib/stop-report.ts";
import { openVault } from "./core/context.ts";
import { collectChecklist, formatFailures, runDetectors, runEffects } from "./core/registry.ts";

/**
 * The vault's Claude Code mod, as its plugin.json names it. The mod's report
 * tells the agent which plugin a notice comes from; a test holds this equal
 * to .claude/skills/wiki-mind/.claude-plugin/plugin.json.
 */
const MOD_NAME = "wiki-mind";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// The env override routes state to a tmp path for tests; production never sets it.
const STATE_PATH = process.env["STOP_CHECKLIST_STATE"] ?? join(SCRIPT_DIR, ".checklist-state.json");

type HookInput = {
	readonly hook_event_name?: unknown;
	readonly session_id?: unknown;
	readonly stop_hook_active?: unknown;
};

const input = await readStdinJson<HookInput>();
const omMod = readOmMod(input);
if (omMod === "standdown") {
	writeSilentHookOutput();
	process.exit(0);
}
// A Stop some hook forced, or a secondary agent's: say nothing, so a forced
// turn cannot loop. The mod's own `report` run is not a re-entry.
if (input?.stop_hook_active === true && omMod !== "report") {
	writeSilentHookOutput();
	process.exit(0);
}

async function report(): Promise<void> {
	const vaultRoot = resolveProjectDir(process.cwd());
	const { registry, ctx } = await openVault(vaultRoot, "stop");
	// Stop's effects (QMD's index refresh among them) first: a checklist or a
	// detector that throws must not cost the refresh.
	const effects = await runEffects(registry, { event: "stop" }, ctx);
	const checklist = collectChecklist(registry);
	const detected = await runDetectors(registry, ctx);
	const failures = [...registry.failures, ...checklist.failures, ...detected.failures, ...effects.failures];

	const items = checklist.result;
	const checklistText = items.length > 0 ? ["Wrap-up checklist:", ...items.map((i) => `- ${i.full}`)].join("\n") : "";
	const checklistSummary = items.length > 0 ? `Wrap-up checklist: ${items.map((i) => i.short).join(" · ")}` : "Wrap-up";
	const findingLines = detected.result.flatMap((f) => [`⚠️  ${f.claim}:`, ...f.lines]);
	const failureLines = formatFailures(failures);

	// No trailing newline: a message rendered by the agent's UI, not a stream.
	const message = [
		checklistText,
		findingLines.length > 0 ? `Vault hygiene (drift detected):\n${findingLines.join("\n")}` : "",
		failureLines.length > 0 ? `Extensions:\n${failureLines.join("\n")}` : "",
	]
		.filter((part) => part !== "")
		.join("\n\n");
	const claims = [...detected.result.map((f) => f.claim), ...(failures.length > 0 ? [`${failures.length} extension failure(s)`] : [])];

	const sessionId = input?.session_id;
	const isStop = input?.hook_event_name === "Stop";
	const hasSession = typeof sessionId === "string" && sessionId !== "";
	// The report's identity: what it says, not the order findings arrived in.
	const key = reportKey({ checklist: checklistText, findings: detected.result, failures: failureLines }, new Set<string>());

	// The mod's run always gets the report as data (its parser requires one),
	// even an empty one; everything else stays silent when there is nothing to say.
	if (omMod === "report") writeStopReportData({ key, claims, agentText: message === "" ? "" : `${modPreface(MOD_NAME)}\n\n${message}` });
	else if (message === "") writeSilentHookOutput();
	else if (isStop && hasSession && !claimChanged(STATE_PATH, sessionId, key)) writeSilentHookOutput();
	else if (isStop && hasSession) {
		try {
			pruneHandoffs(HANDOFF_DIR, Date.now());
			writeHandoff(HANDOFF_DIR, sessionId, `${AGENT_PREFACE}\n\n${message}`);
			writeSystemMessage(stopSummary(checklistSummary, claims));
		} catch {
			writeStopFeedback(`${FEEDBACK_PREFACE}\n\n${message}`, stopSummary(checklistSummary, claims, FEEDBACK_TRAILER));
		}
	} else writeSystemMessage(message);
}

// The output contract holds even if something above throws unexpectedly:
// one JSON object, and for the mod's run a report it can parse.
try {
	await report();
} catch (err) {
	debug(`stop-checklist: ${err instanceof Error ? err.message : String(err)}`);
	if (omMod === "report") writeStopReportData({ key: "unavailable", claims: [], agentText: "" });
	else writeSilentHookOutput();
}

// Exit once stdout has flushed: an extension call that timed out may have
// left a timer or a socket behind, and Stop's hook timeout is 5 s.
process.stdout.write("", () => process.exit(0));
