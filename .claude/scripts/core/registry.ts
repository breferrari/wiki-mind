/**
 * The extension registry: loads a vault's declared extensions, orders what
 * they contribute, holds every call to a time limit, and isolates failures
 * (SPEC.md §7.4).
 *
 * The contract, rule by rule:
 * 1. One dispatcher per hook event runs every extension in-process. Claude
 *    Code runs matching hooks in parallel with no order, so order exists
 *    only inside these dispatchers.
 * 2. Vendored paths and vault paths are disjoint: this folder and ../lib are
 *    written only by a vendor update, `.claude/extensions/` only by the vault.
 * 3. Extensions are declared in vault-manifest.json before anything runs:
 *    id, module, events, priority, enabled. An extension runs only for the
 *    events its declaration lists.
 * 4. Order is a numeric priority, lower first. Unset falls back to the
 *    declaration's priority, then runs last. Ties break by item id, then by
 *    extension id. Core sections (the entry point's own) come before vault
 *    extensions.
 * 5. Each call runs in its own try with its own time limit, and fails open:
 *    a throw or a timeout is recorded, the item is skipped, and the hook
 *    carries on and reports it. `VAULT_EXTENSIONS=off` turns every extension
 *    off, for debugging.
 * 6. The core owns the output budget. Extensions return sections; the entry
 *    point assembles them and applyInjectionBudget gives up the highest
 *    priority number first.
 * 7. Guards are not dispatched yet. When they are, an extension adds a block
 *    and cannot remove one.
 * 8. Overrides are by id: `enabled: false` on a declaration, or an item id
 *    in its `disable` list. No extension replaces a core file.
 *
 * A time limit bounds an extension that waits (I/O, a promise that never
 * settles). It cannot interrupt synchronous code that never returns: that
 * would need a worker per call, and Claude Code's own hook timeout is the
 * backstop for it.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BudgetSection } from "../lib/session-start.ts";
import type {
	ChecklistItem,
	Declaration,
	Detector,
	Extension,
	Failure,
	Finding,
	HookContext,
	HookEvent,
	Point,
	Section,
	Signal,
	Validator,
	WriteTarget,
} from "./types.ts";
import { HOOK_EVENTS } from "./types.ts";

/** The manifest key that declares a vault's extensions. */
export const EXTENSIONS_KEY = "extensions";

/** The environment variable that turns every extension off. */
export const KILL_SWITCH = "VAULT_EXTENSIONS";

/** The per-call time limit when a declaration sets none. */
export const DEFAULT_TIMEOUT_MS = 1_000;

type Loaded = { readonly declaration: Declaration; readonly extension: Extension };

export type Registry = {
	readonly loaded: readonly Loaded[];
	readonly failures: readonly Failure[];
	/** True when the kill switch turned every extension off. */
	readonly off: boolean;
};

export type Dispatch<R> = { readonly result: R; readonly failures: readonly Failure[] };

function message(err: unknown): string {
	if (err instanceof Error) return err.message || err.name;
	return String(err);
}

function isModulePath(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value !== "" &&
		!value.startsWith("/") &&
		!/^[A-Za-z]:/.test(value) &&
		!value.includes("\\") &&
		!value.split("/").includes("..") &&
		/\.(ts|mts|js|mjs)$/.test(value)
	);
}

function isFinitePositive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * The declarations in vault-manifest.json, and a failure for each one that
 * is malformed or repeats an id. A module path must be vault-relative: an
 * extension runs inside every hook, so it must live in the vault it serves.
 */
export function parseDeclarations(
	manifest: Readonly<Record<string, unknown>> | null,
): Dispatch<Declaration[]> {
	const declared = manifest?.[EXTENSIONS_KEY];
	if (declared === undefined) return { result: [], failures: [] };
	if (!Array.isArray(declared)) {
		return { result: [], failures: [{ extension: EXTENSIONS_KEY, point: "load", message: "`extensions` in vault-manifest.json is not a list" }] };
	}
	const result: Declaration[] = [];
	const failures: Failure[] = [];
	const ids = new Set<string>();
	for (const entry of declared) {
		const record = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null;
		const id = typeof record?.["id"] === "string" && record["id"] !== "" ? record["id"] : null;
		const name = id ?? JSON.stringify(entry);
		const fail = (why: string) => failures.push({ extension: name, point: "load", message: why });
		if (record === null || id === null) { fail("a declaration needs a string `id`"); continue; }
		if (ids.has(id)) { fail("another declaration already has this id"); continue; }
		const events = record["events"];
		const disable = record["disable"];
		if (!isModulePath(record["module"])) fail("`module` is not a vault-relative .ts or .js path");
		else if (!Array.isArray(events) || events.length === 0 || !events.every((e) => HOOK_EVENTS.includes(e as HookEvent))) fail(`\`events\` must list at least one of ${HOOK_EVENTS.join(", ")}`);
		else if (record["priority"] !== undefined && !(typeof record["priority"] === "number" && Number.isFinite(record["priority"]))) fail("`priority` is not a finite number");
		else if (record["enabled"] !== undefined && typeof record["enabled"] !== "boolean") fail("`enabled` is not true or false");
		else if (disable !== undefined && !(Array.isArray(disable) && disable.every((d) => typeof d === "string"))) fail("`disable` is not a list of item ids");
		else if (record["timeoutMs"] !== undefined && !isFinitePositive(record["timeoutMs"])) fail("`timeoutMs` is not a positive number");
		else {
			ids.add(id);
			result.push(record as unknown as Declaration);
		}
	}
	return { result, failures };
}

const LIST_FIELDS = ["sections", "detectors", "checklist", "signals", "validators", "preToolGuards", "mcpTools"] as const;

function asExtension(value: unknown): Extension | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	if (typeof record["id"] !== "string" || record["id"] === "") return null;
	for (const field of LIST_FIELDS) {
		if (record[field] !== undefined && !Array.isArray(record[field])) return null;
	}
	return value as Extension;
}

/** A registry over extensions already in hand: what the loader builds, and the seam tests use. */
export function fromLoaded(loaded: readonly Loaded[], failures: readonly Failure[] = []): Registry {
	return { loaded, failures, off: false };
}

/**
 * Load every enabled extension vault-manifest.json declares. A module that
 * cannot be imported, that exports no extension (as `default` or as
 * `extension`), or whose id differs from its declaration's is recorded and
 * skipped.
 */
export async function loadRegistry(
	vaultRoot: string,
	manifest: Readonly<Record<string, unknown>> | null,
	env: NodeJS.ProcessEnv = process.env,
): Promise<Registry> {
	if (env[KILL_SWITCH] === "off") return { loaded: [], failures: [], off: true };
	const { result: declarations, failures: parseFailures } = parseDeclarations(manifest);
	const failures: Failure[] = [...parseFailures];
	const loaded: Loaded[] = [];
	for (const declaration of declarations) {
		if (declaration.enabled === false) continue;
		try {
			const mod = (await import(pathToFileURL(resolve(vaultRoot, declaration.module)).href)) as Record<string, unknown>;
			const extension = asExtension(mod["default"]) ?? asExtension(mod["extension"]);
			if (extension === null) failures.push({ extension: declaration.id, point: "load", message: "the module exports no extension (an object with an `id`)" });
			else if (extension.id !== declaration.id) failures.push({ extension: declaration.id, point: "load", message: `the module's extension id is "${extension.id}"` });
			else loaded.push({ declaration, extension });
		} catch (err) {
			failures.push({ extension: declaration.id, point: "load", message: message(err) });
		}
	}
	return { loaded, failures, off: false };
}

type Entry<T> = {
	readonly ext: string;
	readonly item: T;
	readonly priority: number;
	readonly timeoutMs: number;
};

/**
 * Every item the extensions serving `event` hold at one point, in run order
 * (rule 4), without the ones turned off by id (rule 8). An item without a
 * string id, or with a priority that is not a finite number, is a failure.
 */
function ordered<T extends { readonly id: string; readonly priority?: number }>(
	registry: Registry,
	event: HookEvent,
	point: Point,
	pick: (ext: Extension) => readonly T[] | undefined,
	failures: Failure[],
): Entry<T>[] {
	const entries: Entry<T>[] = [];
	for (const { declaration, extension } of registry.loaded) {
		if (!declaration.events.includes(event)) continue;
		const off = new Set(declaration.disable ?? []);
		for (const item of pick(extension) ?? []) {
			const valid =
				typeof item === "object" &&
				item !== null &&
				typeof item.id === "string" &&
				(item.priority === undefined || (typeof item.priority === "number" && Number.isFinite(item.priority)));
			if (!valid) {
				failures.push({ extension: extension.id, point, message: "an item without a string `id`, or with a priority that is not a finite number" });
				continue;
			}
			if (off.has(item.id)) continue;
			entries.push({
				ext: extension.id,
				item,
				priority: item.priority ?? declaration.priority ?? Number.POSITIVE_INFINITY,
				timeoutMs: declaration.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			});
		}
	}
	const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
	return entries.sort(
		(a, b) =>
			(a.priority === b.priority ? 0 : a.priority < b.priority ? -1 : 1) ||
			byText(a.item.id, b.item.id) ||
			byText(a.ext, b.ext),
	);
}

/** Run one extension call under its time limit, recording a throw or a timeout as a Failure. */
async function isolated<R>(
	failures: Failure[],
	entry: Entry<{ readonly id: string }>,
	point: Point,
	fn: () => R | Promise<R>,
): Promise<{ ok: true; value: R } | { ok: false }> {
	let timer: NodeJS.Timeout | undefined;
	try {
		const value = await Promise.race([
			Promise.resolve().then(fn),
			new Promise<never>((_, reject) => {
				// Not unref'd: a call that never settles leaves nothing else to
				// keep the event loop alive, and the hook would exit with no
				// output before the limit fired. `finally` clears it.
				timer = setTimeout(() => reject(new Error(`timed out after ${entry.timeoutMs} ms`)), entry.timeoutMs);
			}),
		]);
		return { ok: true, value };
	} catch (err) {
		failures.push({ extension: entry.ext, point, item: entry.item.id, message: message(err) });
		return { ok: false };
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/** Run every entry concurrently, keeping the results in run order. */
async function each<T extends { readonly id: string }, R>(
	entries: readonly Entry<T>[],
	failures: Failure[],
	point: Point,
	fn: (item: T) => R | Promise<R>,
): Promise<{ entry: Entry<T>; value: R }[]> {
	const runs = await Promise.all(entries.map((entry) => isolated(failures, entry, point, () => fn(entry.item))));
	const out: { entry: Entry<T>; value: R }[] = [];
	runs.forEach((run, i) => {
		const entry = entries[i];
		if (run.ok && entry !== undefined) out.push({ entry, value: run.value });
	});
	return out;
}

/** applyInjectionBudget compares priorities by subtraction, so "last" is the largest finite number. */
function budgetPriority(priority: number): number {
	return Number.isFinite(priority) ? priority : Number.MAX_SAFE_INTEGER;
}

/**
 * The session-context sections, as BudgetSections for applyInjectionBudget.
 * In `pointer` mode (a resume or compact re-entry) a section with a pointer
 * renders as its pointer, and a load-bearing one renders in full.
 */
export async function collectSections(
	registry: Registry,
	ctx: HookContext,
	mode: "full" | "pointer",
): Promise<Dispatch<BudgetSection[]>> {
	const failures: Failure[] = [];
	const entries = ordered<Section>(registry, "session-start", "section", (e) => e.sections, failures);
	const pointers = entries.filter(({ item }) => mode === "pointer" && item.pointer !== undefined);
	const rendered = await each(
		entries.filter((e) => !pointers.includes(e)),
		failures,
		"section",
		(item) => item.render(ctx),
	);
	const bodies = new Map<Entry<Section>, string>();
	for (const { entry, value } of rendered) if (value !== null) bodies.set(entry, value);
	const sections: BudgetSection[] = [];
	for (const entry of entries) {
		const { item } = entry;
		const priority = budgetPriority(entry.priority);
		if (pointers.includes(entry)) sections.push({ header: item.header, body: item.pointer ?? "", priority });
		else {
			const body = bodies.get(entry);
			if (body !== undefined) sections.push({ header: item.header, body, priority, fallback: item.pointer });
		}
	}
	return { result: sections, failures };
}

/** Every detector's findings, in run order. */
export async function runDetectors(registry: Registry, ctx: HookContext): Promise<Dispatch<Finding[]>> {
	const failures: Failure[] = [];
	const entries = ordered<Detector>(registry, "stop", "detector", (e) => e.detectors, failures);
	const runs = await each(entries, failures, "detector", (item) => item.detect(ctx));
	return { result: runs.flatMap(({ value }) => [...value]), failures };
}

/** The wrap-up checklist, in run order. */
export function collectChecklist(registry: Registry): Dispatch<ChecklistItem[]> {
	const failures: Failure[] = [];
	const items = ordered<ChecklistItem>(registry, "stop", "checklist", (e) => e.checklist, failures).map(({ item }) => item);
	return { result: items, failures };
}

/** The hints of every signal the prompt matches, in run order, without duplicates. */
export async function matchSignals(registry: Registry, prompt: string): Promise<Dispatch<string[]>> {
	const failures: Failure[] = [];
	const entries = ordered<Signal>(registry, "prompt", "signal", (e) => e.signals, failures);
	const runs = await each(entries, failures, "signal", (item) => item.match(prompt));
	const hints: string[] = [];
	for (const { entry, value } of runs) if (value === true && !hints.includes(entry.item.hint)) hints.push(entry.item.hint);
	return { result: hints, failures };
}

/** The warnings of every validator that applies to the written file, in run order. */
export async function runValidators(registry: Registry, target: WriteTarget, ctx: HookContext): Promise<Dispatch<string[]>> {
	const failures: Failure[] = [];
	const entries = ordered<Validator>(registry, "write", "validator", (e) => e.validators, failures);
	const runs = await each(entries, failures, "validator", (item) => (item.appliesTo(target.relPath) ? item.validate(target, ctx) : []));
	return { result: runs.flatMap(({ value }) => [...value]), failures };
}

/** The slots an extension filled that the registry does not dispatch yet. */
export function undispatched(registry: Registry): string[] {
	const out: string[] = [];
	for (const { extension } of registry.loaded) {
		if ((extension.preToolGuards?.length ?? 0) > 0) out.push(`${extension.id}: pre-tool guards`);
		if ((extension.mcpTools?.length ?? 0) > 0) out.push(`${extension.id}: MCP tools`);
	}
	return out;
}

/** One line per failure, for whichever output the hook writes. */
export function formatFailures(failures: readonly Failure[]): string[] {
	return failures.map(
		(f) => `⚠️  extension ${f.extension}${f.item === undefined ? "" : `, ${f.point} ${f.item}`}: skipped (${f.message})`,
	);
}

/** The parsed manifest, or null when absent or malformed. */
export function parseManifest(manifestJson: string | null): Readonly<Record<string, unknown>> | null {
	if (manifestJson === null) return null;
	try {
		const parsed: unknown = JSON.parse(manifestJson);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}
