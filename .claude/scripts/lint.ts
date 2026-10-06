#!/usr/bin/env node
/**
 * The vault's drift report on demand: every detector the vault declares for
 * Stop, run now, printed as plain text for the agent (`/wiki-lint`). The
 * Stop hook shows the same findings only when they change; this shows them
 * whenever it is asked.
 *
 * A thin dispatcher over the registry (SPEC.md §7.4), with nothing
 * wiki-specific, so it lifts with the core. Exit 0 always: the report is the
 * output, and a vault with drift is not an error.
 */

import { resolveProjectDir } from "./lib/project-dir.ts";
import { openVault } from "./core/context.ts";
import { formatFailures, runDetectors } from "./core/registry.ts";

const vaultRoot = resolveProjectDir(process.cwd());
const { registry, ctx } = await openVault(vaultRoot, "stop");
const detected = await runDetectors(registry, ctx);
const failures = formatFailures([...registry.failures, ...detected.failures]);

const lines: string[] = [];
if (detected.result.length === 0) lines.push("No drift found.");
for (const finding of detected.result) lines.push(`⚠️  ${finding.claim}:`, ...finding.lines, "");
if (failures.length > 0) lines.push("Extensions:", ...failures);
if (registry.off) lines.push("Extensions are off (VAULT_EXTENSIONS=off): nothing was checked.");
process.stdout.write(`${lines.join("\n").trimEnd()}\n`, () => process.exit(0));
