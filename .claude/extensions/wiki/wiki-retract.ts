#!/usr/bin/env node
/**
 * `/wiki-retract`'s script (SPEC.md §2.1): plans the retraction pass and
 * prints it (--dry-run), or applies it and prints what it did.
 *
 *   node --experimental-strip-types .claude/extensions/wiki/wiki-retract.ts "<source>"
 *        [--superseded-by "<newer>"] [--notice <url>] [--reason "<text>"] [--undo] [--dry-run] [--date YYYY-MM-DD]
 *
 * Each note is written with the core's atomic write. Exit 0 when the pass
 * ran (or would run) in full, 1 when a write failed midway (the report says
 * what was and wasn't written; run it again to finish), and 2 when nothing
 * was written because the call can't run: no such source, no note for the
 * newer source, a newer source that can't supersede, a note behind a BOM,
 * bad arguments, or any other failure while planning.
 *
 * The exit code is set, not forced, so stdout and stderr drain before the
 * process ends: an agent reads the whole report through a pipe.
 */

import { parseArgs } from "node:util";
import { resolveProjectDir, writeFileAtomic } from "../../scripts/core/index.ts";
import { applyRetraction, formatReport, planRetraction, RetractError } from "./retract.ts";

const USAGE = 'usage: wiki-retract.ts "<source>" [--superseded-by "<newer>"] [--notice <url>] [--reason "<text>"] [--undo] [--dry-run] [--date YYYY-MM-DD]';

/** Nothing was written: the reason goes to stderr, and the exit code is 2. */
function refuse(message: string): number {
	process.stderr.write(`${message}\n`);
	return 2;
}

const today = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A real calendar date as YYYY-MM-DD: it is written into every dated line, and --undo matches it. */
function isDate(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function main(): number {
	let parsed;
	try {
		parsed = parseArgs({
			allowPositionals: true,
			options: {
				"superseded-by": { type: "string" },
				notice: { type: "string" },
				reason: { type: "string" },
				undo: { type: "boolean", default: false },
				"dry-run": { type: "boolean", default: false },
				date: { type: "string" },
			},
		});
	} catch (err) {
		return refuse(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
	}
	const { values, positionals } = parsed;
	const source = positionals[0];
	if (positionals.length !== 1 || source === undefined || source.trim() === "") return refuse(USAGE);
	if (values.undo && values["superseded-by"] !== undefined) return refuse("--undo takes no --superseded-by: it makes the source current again.");
	const date = values.date ?? today();
	if (!isDate(date)) return refuse(`--date takes a real date as YYYY-MM-DD, got ${date}`);

	// The vault the agent runs in, found as the hooks find it: the agent's project
	// directory (or here), walked up to the folder holding vault-manifest.json.
	const vaultRoot = resolveProjectDir(process.cwd());

	let plan;
	try {
		plan = planRetraction(vaultRoot, {
			source,
			date,
			undo: values.undo,
			...(values["superseded-by"] === undefined ? {} : { supersededBy: values["superseded-by"] }),
			...(values.notice === undefined ? {} : { notice: values.notice }),
			...(values.reason === undefined ? {} : { reason: values.reason }),
		});
	} catch (err) {
		// Planning writes nothing, so any failure here is exit 2: there is nothing to finish.
		return refuse(err instanceof RetractError ? err.message : `Couldn't plan the pass: ${err instanceof Error ? err.message : String(err)}. Nothing was written.`);
	}

	if (values["dry-run"]) {
		process.stdout.write(`${formatReport(plan)}\n`);
		return 0;
	}
	const applied = applyRetraction(vaultRoot, plan, writeFileAtomic);
	process.stdout.write(`${formatReport(plan, applied)}\n`);
	return applied.error === undefined ? 0 : 1;
}

process.exitCode = main();
