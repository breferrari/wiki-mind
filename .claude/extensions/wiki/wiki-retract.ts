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
 * what was and wasn't written; run it again to finish), and 2 for a call
 * the pass can't run: no such source, no note for the newer source, a newer
 * source that can't supersede, or bad arguments.
 */

import { parseArgs } from "node:util";
import { writeFileAtomic } from "../../scripts/core/index.ts";
import { applyRetraction, formatReport, planRetraction, RetractError } from "./retract.ts";

const USAGE = 'usage: wiki-retract.ts "<source>" [--superseded-by "<newer>"] [--notice <url>] [--reason "<text>"] [--undo] [--dry-run] [--date YYYY-MM-DD]';

function fail(message: string, code: number): never {
	process.stderr.write(`${message}\n`);
	process.exit(code);
}

let args: ReturnType<typeof parse>;
function parse() {
	return parseArgs({
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
}
try {
	args = parse();
} catch (err) {
	fail(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`, 2);
}

const { values, positionals } = args;
const source = positionals[0];
if (positionals.length !== 1 || source === undefined || source.trim() === "") fail(USAGE, 2);
if (values.undo && values["superseded-by"] !== undefined) fail("--undo takes no --superseded-by: it makes the source current again.", 2);
const local = new Date();
const date = values.date ?? `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date takes YYYY-MM-DD, got ${date}`, 2);

// The vault the agent runs in: its project directory, as the hooks find it, or here.
const vaultRoot = [process.env["CLAUDE_PROJECT_DIR"], process.env["CODEX_PROJECT_DIR"], process.env["GEMINI_PROJECT_DIR"]].find((d) => d !== undefined && d !== "") ?? process.cwd();

let plan: ReturnType<typeof planRetraction>;
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
	if (err instanceof RetractError) fail(err.message, 2);
	throw err;
}

if (values["dry-run"]) {
	process.stdout.write(`${formatReport(plan)}\n`);
	process.exit(0);
}
const applied = applyRetraction(vaultRoot, plan, writeFileAtomic);
process.stdout.write(`${formatReport(plan, applied)}\n`, () => process.exit(applied.error === undefined ? 0 : 1));
