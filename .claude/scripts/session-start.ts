#!/usr/bin/env node
/**
 * SessionStart: the session context, assembled from the vault's extensions
 * (SPEC.md §7.4).
 *
 * The protocol is obsidian-mind's (its session-start.ts at c65062d); the
 * sections are the vault's:
 * - stdin is optional, read with a deadline;
 * - `VAULT_PATH` is exported to `CLAUDE_ENV_FILE` before anything else;
 * - under the mod (`om_mod`), `standdown` exits with no output, and
 *   `deliver` writes the full layer under the instruction budget;
 * - otherwise a resume or compact re-entry gets pointers, and any other
 *   start gets the full layer, under the hook output cap.
 *
 * The core sections (the heading, the date, extension failures) come first
 * and never degrade; the extensions' sections follow in priority order and
 * are given up from the highest priority number when over budget.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { HOOK_OUTPUT_LIMIT, fitWithMeter, readStdinJson, type OutputLimit } from "./lib/hook-io.ts";
import { readOmMod } from "./lib/om-mod.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";
import {
	DEFAULT_INSTRUCTION_BUDGET_BYTES,
	METER_HEADROOM,
	applyInjectionBudget,
	effectiveInjectionBudget,
	formatDateHeader,
	formatEnvExport,
	formatInjectionSize,
	injectionMode,
	parseInjectionBudget,
	parseInstructionBudget,
	type BudgetSection,
	type InjectionBudget,
} from "./lib/session-start.ts";
import { collectSections, formatFailures, loadRegistry, parseManifest, undispatched } from "./core/registry.ts";

type HookInput = { readonly source?: unknown };

/** stdin is optional here: a TTY skips it, and a pipe that never closes is abandoned after 2 s. */
async function readHookInput(): Promise<HookInput | null> {
	if (process.stdin.isTTY) return null;
	let timer: NodeJS.Timeout | undefined;
	const result = await Promise.race([
		readStdinJson<HookInput>(),
		new Promise<null>((resolveRace) => {
			timer = setTimeout(() => resolveRace(null), 2_000);
			timer.unref();
		}),
	]);
	if (timer !== undefined) clearTimeout(timer);
	if (result === null) process.stdin.destroy();
	return result;
}

const hookInput = await readHookInput();
const vaultRoot = resolveProjectDir(process.cwd());

// Only a hook process gets CLAUDE_ENV_FILE, so this runs before the
// standdown exit: the mod's own run never sees it.
const envFile = process.env["CLAUDE_ENV_FILE"];
if (envFile) {
	try {
		appendFileSync(envFile, formatEnvExport("VAULT_PATH", vaultRoot));
	} catch {
		/* best-effort: the session continues without it */
	}
}

const omMod = readOmMod(hookInput);
if (omMod === "standdown") process.exit(0);
const delivering = omMod === "deliver";
const mode = delivering ? "full" : injectionMode(hookInput?.source);

process.chdir(vaultRoot);
let manifestJson: string | null = null;
try {
	manifestJson = readFileSync("vault-manifest.json", "utf-8");
} catch {
	/* no manifest: no extensions, default budgets */
}
const manifest = parseManifest(manifestJson);
const registry = await loadRegistry(vaultRoot, manifest);
const ctx = { vaultRoot, manifest, now: Date.now() };
const { result: extensionSections, failures } = await collectSections(registry, ctx, mode);

const sections: BudgetSection[] = [
	{ header: "", body: "## Session Context", priority: 0 },
	{ header: "### Date", body: formatDateHeader(new Date(ctx.now)), priority: 0 },
];
const notes = [
	...formatFailures([...registry.failures, ...failures]),
	...undispatched(registry).map((slot) => `ℹ️  ${slot}: declared, not dispatched yet`),
	...(registry.off ? ["ℹ️  extensions are off (VAULT_EXTENSIONS=off)"] : []),
];
if (notes.length > 0) sections.push({ header: "### Extensions", body: notes.join("\n"), priority: 0 });
sections.push(...extensionSections);

const budget: InjectionBudget = delivering
	? { bytes: parseInstructionBudget(manifestJson) ?? DEFAULT_INSTRUCTION_BUDGET_BYTES }
	: effectiveInjectionBudget(parseInjectionBudget(manifestJson));
const budgeted = applyInjectionBudget(sections, budget.bytes);
const limit: OutputLimit = delivering
	? { max: budget.bytes + METER_HEADROOM, unit: "bytes", name: "the instruction budget" }
	: HOOK_OUTPUT_LIMIT;

process.stdout.write(
	fitWithMeter(
		budgeted.text + "\n",
		(cut, bodyBytes) =>
			formatInjectionSize(bodyBytes, {
				budgetBytes: budget.bytes,
				collapsed: budgeted.collapsed,
				clampedFrom: budget.clampedFrom,
				cut,
				cutTo: limit.name,
			}),
		limit,
	),
);
