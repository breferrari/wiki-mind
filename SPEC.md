# wiki-mind shard specification

> **Status:** decided 2026-10-05. Every question the draft raised is answered; [Decisions](#decisions) lists the answers and where each one landed. The maintainer may overrule any of them. This file is the contract the roadmap builds against. A change to it lands in its own PR before the code that needs it.

This spec covers the shard surface: what a user gets from `shardmind install github:breferrari/wiki-mind`, and how the repo is laid out to produce it. The ShardMind contract it builds on is [`docs/SHARD-LAYOUT.md`](https://github.com/breferrari/shardmind/blob/main/docs/SHARD-LAYOUT.md); this file does not restate it.

## 1. What the vault does

wiki-mind is a research vault on the LLM-wiki pattern. The user brings material, and an agent keeps a linked wiki over it:

1. A question or a lead lands in `questions/`.
2. Raw material (a PDF, a saved page, notes) is dropped in `inbox/`.
3. A paper or article is ingested as one note in `sources/`, from a URL or from a file in `inbox/`. The original stays where it is.
4. Ingesting a source creates or updates the `concepts/` and `entities/` notes it bears on, and each claim links back to the source it came from.
5. When two or more concepts compete or overlap, a `syntheses/` note compares them.
6. `Index.md` is the annotated entry point over all of it.

The agent does the writing; the user steers, reads and corrects. Every note is plain Markdown that Obsidian opens without the agent.

## 2. Ontology

Five note types, each with one folder and one Obsidian template, plus `Index.md`.

| Type | Folder | One note per | Template | Must link to |
|------|--------|--------------|----------|--------------|
| Source | `sources/` | paper or article | `templates/Source.md` | the concepts and entities it informs |
| Concept | `concepts/` | atomic idea | `templates/Concept.md` | at least one source |
| Entity | `entities/` | named system, tool or person | `templates/Entity.md` | at least one source |
| Synthesis | `syntheses/` | "X vs Y" comparison | `templates/Synthesis.md` | the concepts or entities it compares, two or more |
| Question | `questions/` | question or lead to pursue | `templates/Question.md` | whatever raised it, when anything did |

A synthesis sits above concepts: it never replaces one, and a concept never holds a comparison. That separation is what keeps concepts atomic.

**Decided (2026-10-05, maintainer may overrule):** the folder is `questions/`, not `open_questions/`, because a question note has a status and answered questions stay in the folder. The type is Question throughout (Q1).

`Index.md` sits at the vault root. **Decided (2026-10-05, maintainer may overrule):** it is both of these (Q4):

- the agent-curated, annotated entry point, with a one-line annotation per note, since annotations need judgement;
- the page that embeds the `bases/` views for complete listings.

`wiki-lint` reports a note that a Bases view shows but `Index.md` doesn't annotate.

**Decided (2026-10-05, maintainer may overrule):** frontmatter (Q3). Every note has `date`, `description` and `tags`. Per type:

| Type | Adds |
|------|------|
| Source | `authors`, `year`, `url` |
| Concept | nothing |
| Entity | `kind`: `system`, `tool` or `person` |
| Synthesis | `sides`: the notes it compares |
| Question | `status`: `open`, `answered` or `dropped` |

## 3. Shipped files

### 3.1 Vault content (installed, static)

| Path | What |
|------|------|
| `Index.md` | Annotated entry point. |
| `sources/`, `concepts/`, `entities/`, `syntheses/`, `questions/` | Empty at install, each with a `README.md` that says what goes there, so the folder exists in a clone. |
| `inbox/` | Raw drops before ingest: the pattern's raw layer. Empty at install, with a `README.md`. `wiki-ingest` reads from it and leaves the original in place. |
| `bases/` | Bases views over the five note types, embedded in `Index.md`. |
| `templates/` | The five templates above. |
| `.obsidian/` | Vault config: core plugins, templates folder, attachment folder. No user state (ShardMind's Tier 1 excludes it anyway). |
| `README.md`, `LICENSE` | As today. |

**Decided (2026-10-05, maintainer may overrule):** `inbox/` and `bases/` ship. `brain/` and `thinking/` don't in v0.1: the wiki is the memory, and `CLAUDE.md` is the manual (Q2).

### 3.2 Agent layer (installed)

| Path | What |
|------|------|
| `CLAUDE.md` | The vault's agent manual. |
| `.claude/commands/` | Slash commands (§6.2). |
| `.claude/scripts/` | The vendored libraries and QMD MCP server, wiki-mind's entry points, and the extension registry in `core/` (§7). |
| `.claude/extensions/` | wiki-mind's own sections, detectors, signals and validators (§7.4). |
| `.claude/skills/` | Obsidian and QMD skills, and the Claude Code mod at `.claude/skills/wiki-mind/` (§6.4), vendored. |
| `.claude/settings.json` | The hook wiring, vendored unmodified: wiki-mind's entry points keep obsidian-mind's script names and walk-up (§7.3). |
| `.mcp.json` | Registers the QMD MCP server. |
| `vault-manifest.json` | Vault metadata the scripts read (QMD index name, budgets). Also the marker the hook commands walk up to when finding the vault root. |
| `.scripts/qmd-bootstrap.ts` | Builds the QMD index on a fresh clone. |
| `.claude/VENDOR.json` | Where the vendored machinery came from (§7.1). |
| `AGENTS.md` + `.codex/`, `GEMINI.md` + `.gemini/` | Not in the first release: a later roadmap phase (§5). |

### 3.3 Repo-only (in `.shardmindignore`)

`CONTRIBUTING.md`, `SPEC.md`, `ROADMAP.md`, tests of repo-only scripts, and any media. `.github/` and `.shardmind/` are excluded by the engine itself.

### 3.4 Static vs templated

**Decided:** every file ships static. No `.njk` at first: obsidian-mind ships none, and every value in §4 is consumed by a hook or at runtime, not by rendering. Personalization goes through the `personalize` hook (managed files, non-default installs only), so Invariant 1 holds with no render delta. A `.njk` is added only for dotfolder config, and only when a value has to reach a file that no hook can edit.

## 4. Values

Every value has a default (ShardMind rejects one without). The defaults are what a clone gets.

| Value | Type | Default | Used by |
|-------|------|---------|---------|
| `user_name` | string | `""` | `personalize`: names the owner in `Index.md`. |
| `research_focus` | string | `""` | `personalize`: one line in `Index.md`; the QMD context string. |
| `qmd_enabled` | boolean | `true` | `bootstrap` (build the index or not); the `when:` of the QMD `external_tools` entry. |

**Decided (2026-10-05, maintainer may overrule):** these three values (Q5). obsidian-mind's `org_name` and `vault_purpose` don't carry over: wiki-mind has one purpose.

## 5. Modules

| Module | Paths | Removable | Why |
|--------|-------|-----------|-----|
| `wiki` | the five note folders, `inbox/`, `bases/`, `Index.md`, `templates/` | no | The product. |
| `claude` | `CLAUDE.md`, `.claude/` except `scripts/`, `.claude-plugin/` if shipped | no | As in obsidian-mind: other agents' hook configs resolve into `.claude/scripts/`, so removing Claude would orphan them. `.claude/scripts/` is claimed by no module and so always installs. |
| `codex`, `gemini` | their manual and dotfolder | yes | **Later roadmap phase**, not the first release. Planned, as in obsidian-mind, not dropped. |

**Decided (2026-10-05, maintainer may overrule):** the first release is Claude only (Q6).

**Decided (2026-10-05, maintainer may overrule):** QMD search is a value (`qmd_enabled`), not a module, as in obsidian-mind (Q7). Its files are small scripts that do nothing when QMD is absent, and keeping them installed means turning it on later needs no reinstall. The vendored `bootstrap` already works this way.

Default wizard state is every module selected (ShardMind rule), so a defaults install ships all of the above.

## 6. Claude-side machinery

### 6.1 The vault `CLAUDE.md`

**Decided:** the root `CLAUDE.md` is the vault's agent manual and ships in every install. It covers the ontology, the ingest and synthesis workflows, linking rules, and search order (QMD MCP, then QMD CLI, then grep). It keeps a "Developing this shard" section that points at `CONTRIBUTING.md`; contributor rules live there, kept out of installs by `.shardmindignore`. Until the vault manual is written, that section repeats the hard rules.

### 6.2 Commands

**Decided (2026-10-05, maintainer may overrule):** the prefix is `wiki-` (Q8). It reads naturally and doesn't collide with obsidian-mind's `om-` commands.

| Command | Does |
|---------|------|
| `/wiki-ingest <url or inbox path>` | Fetch the source (`defuddle` for web pages) or read it from `inbox/`, leaving the original in place; write the `sources/` note, create or update the concepts and entities it informs, link both ways, update `Index.md`, mark any question it answers. |
| `/wiki-synthesize <X> vs <Y>` | Write a `syntheses/` note comparing two or more existing concepts or entities, citing their sources. Refuses when a side has no note yet and says which to ingest first. |
| `/wiki-question <text>` | File a `questions/` note with `status: open`. |
| `/wiki-lint` | Report orphans, claims with no source link, syntheses with fewer than two sides, frontmatter missing per §2, and notes a Bases view shows that `Index.md` doesn't annotate. |

**Decided (2026-10-05, maintainer may overrule):** v0.1 ships only these four commands (Q9). `wiki-lint` covers what `vault-audit` would. `wrap-up` and `tidy` can come later through the extraction.

### 6.3 Hooks

The same events obsidian-mind hooks, wired the same way in `.claude/settings.json`. The scripts are wiki-mind's own, written as dispatchers over the extension registry (§7.4); only `pre-compact.ts` is vendored:

| Event | Script | Change for wiki-mind |
|-------|--------|----------------------|
| SessionStart | `session-start.ts` | Context sections: `Index.md` summary, open questions, recent sources. |
| UserPromptSubmit | `classify-message.ts` | Wiki prompt signals: a new source, a claim, a comparison, a question. |
| PostToolUse (Write/Edit) | `validate-write.ts` | Write validators: frontmatter and link rules per §2. |
| PreCompact | `pre-compact.ts` | Vendored unmodified. |
| Stop | `stop-checklist.ts` | Stop detectors: the `wiki-lint` checks. |

### 6.4 The Claude Code mod

**Decided:** wiki-mind ships the Claude Code mod as well as the hooks, with the same two paths obsidian-mind has.

- On Claude Code 2.1.287 and later, the mod under `.claude/skills/<mod>/` delivers the session context as an instruction file and shows the Stop report as one line under the answer. For each event it handles, it passes the settings hook a stand-down flag and the hook exits.
- On older Claude Code, and on Codex and Gemini, the mod does not load and the settings hooks run unchanged.

Both paths run the same scripts, so they cannot disagree on content.

**Decided:** the mod's identity is per vault, and its flag protocol is shared. The mod is named `wiki-mind` (folder `.claude/skills/wiki-mind/`, plugin name `wiki-mind`), so a user who runs both vaults gets no collision. The flag stays byte-identical to obsidian-mind's: the field is `om_mod` and its values are `deliver`, `standdown` and `report`. That flag is the contract between the settings hooks and the mod, so renaming it in one shard would fork the protocol (§7.3).

### 6.5 ShardMind lifecycle hooks

| Slot | Does |
|------|------|
| `bootstrap` | Build the QMD index when `qmd_enabled`. Fingerprinted, so an index-schema change re-runs it on update. |
| `personalize` | Write `user_name` and `research_focus` into `Index.md`. Never runs on a defaults install (engine-enforced). |
| `post-update` | None at first. |

## 7. Claude-side machinery: vendored libraries, own entry points

**Decided (2026-10-05, maintainer may overrule):** wiki-mind vendors obsidian-mind's *generic libraries*, unmodified. It writes its own entry points over them. obsidian-mind's hook scripts are not vendored, except `pre-compact.ts`, which is generic as a whole.

Most of obsidian-mind's entry points are its domain: the North Star, work and brain sections, the work-folder hygiene scan, its prompt signals, and its stop checklist. In a wiki vault they would print nothing or misfire. Vendoring them would ship dead weight and needed patches to quiet it.

wiki-mind is also the test bed for the extensible layer. Its entry points are thin dispatchers over a small extension registry (§7.4). That registry is a prototype of the core the machinery is expected to become. The machinery is expected to move into a reusable repo of its own later. Vendoring the libraries unmodified now means that extraction swaps the source of the copy instead of merging two forks. ShardMind declined composition, so shards vendor what they share.

### 7.1 The record and the vendored set

`.claude/VENDOR.json` records the obsidian-mind commit the copy came from, in the shape of ShardMind's `source/ui-kit/VENDOR.json`:

- `repository`, `commit`, `version`, `tag`, `license`;
- `files`: each vendored path mapped to its upstream path, with `modified`. When `modified` is true, a one-line `change` says what changed and why.

`modified` is computed from the bytes against upstream at the recorded commit, never typed by hand. **Decided (2026-10-05, maintainer may overrule):** the record installs, at `.claude/VENDOR.json` (Q11). A vault should know where its machinery came from: a later vendor update in an installed vault reads it.

**The vendored set: 76 files from obsidian-mind v9.0.1.** #6 vendored 66 generic files unmodified. #35 added `.claude/settings.json` unmodified. #7 added the mod's 9 files, 7 of them changed by P1, and patched `lib/stop-report.ts` for S6. `.claude/VENDOR.json` lists each one.

| Group | Files |
|-------|-------|
| Generic libraries (`.claude/scripts/lib/`) | `hook-io`, `main-guard`, `project-dir`, `om-mod`, `frontmatter`, `wikilinks`, `regex`, `read-field`, `read-head`, `charcount`, `atomic-write`, `report-key`, `hint-state`, `stop-handoff`, `stop-report`, `qmd`, `qmd-bootstrap`, `qmd-refresh`, `qmd-ignore`, `qmd-models`, `session-start` (21) |
| Generic scripts | `pre-compact.ts`, `qmd-mcp.mjs` (+ `.d.mts`), `qmd-refresh-run.ts`, `.scripts/qmd-bootstrap.ts`, `.shardmind/hooks/bootstrap.ts` |
| Config | `.claude/scripts/package.json` and `tsconfig.json`, `.scripts/package.json`, `.shardmind/hooks/package.json`, `.mcp.json` |
| Skills | `obsidian-markdown`, `obsidian-bases`, `obsidian-cli`, `json-canvas`, `defuddle`, `qmd` |
| Tests | the 22 obsidian-mind tests whose subject is a vendored file, plus `tests/_helpers.ts` |

How the set was chosen:

- Each library was checked against its static imports. A library that imports obsidian-mind domain code is out. `matcher` imports obsidian-mind's signal set, so it is out (seam S3).
- Each test was checked the same way, and then by running it. `qmd-refresh.integration.test.ts` imports only vendored code, but it spawns obsidian-mind's `validate-write.ts`. Its subject is an entry point wiki-mind doesn't vendor, so it is out. A wiki-mind version comes back with the entry points.

**What the first attempt vendored, for the record.** The first attempt took the import closure of obsidian-mind's entry points: 98 files, three of them patched. This set is 66 files, none patched.

Not vendored:

- the hook entry points `session-start.ts`, `classify-message.ts`, `validate-write.ts` and `stop-checklist.ts`, and the libraries only they use (`active-hygiene`, `signals`, `matcher`, `memory-promoted`, `mcp-exposure`, `mcp-qmd-client`);
- the memory MCP server and its libraries;
- `tidy-fix`, the correction sweep, `update-skills.ts`, the root `.claude-plugin/`, and the `excalidraw-diagram` and `mermaid-visualizer` skills;
- obsidian-mind's commands, agents, templates, Bases and content.

The mod is vendored at `.claude/skills/wiki-mind/` (upstream `.claude/skills/obsidian-mind/`). P1, its identity change, renames its plugin, state keys and context block to `wiki-mind`, and leaves the `om_mod` protocol and the script paths it runs unchanged (§7.3). It doesn't need obsidian-mind's root `.claude-plugin/`. `claude plugin validate --strict` and `claude plugin test` check it in CI on all three operating systems (`.github/workflows/mod.yml`).

**Decided, the maintainer may overrule:** the memory MCP server, and the libraries only it uses, stay in obsidian-mind. The server is a product of its own, it is about half of the machinery, and the wiki workflow doesn't depend on it. If wiki-mind wants it later, it arrives through the extraction or a vendor update.

**Decided (2026-10-05, maintainer may overrule):** the correction sweep is not in v0.1 (Q12). obsidian-mind's sweep is built around its single-source status rule. A wiki's correction case is different: a source is retracted or superseded. That case gets its own spec in a later phase (see [Later](#later)).

**Tests stay in the repo (#40).** `.shardmindignore` leaves out:
- every test file;
- the test helpers under `.claude/scripts/tests/`;
- the mod's test engine stand-in, `hooks/world.ts`.

Nothing installed imports them, and `tests/install-set.test.ts` holds that. `.claude/VENDOR.json` still records the vendored tests, because the record describes the vendored source, not the install. A vendor update in an installed vault skips the files that vault doesn't have.

Two things a vendor update has to keep in step:

- `.gitignore` carries the hook runtime-state entries;
- CI typechecks and tests the vendored scripts on all three operating systems.

### 7.2 What the extraction learns from this split

#### Config

The vendored code reads these `vault-manifest.json` keys. Each one falls back to a default when absent. #10 writes wiki-mind's values.

| Key | Read by |
|-----|---------|
| `template`, `qmd_index`, `qmd_min_version`, `qmd_context` | the QMD libraries, `qmd-mcp.mjs`, `.scripts/qmd-bootstrap.ts` |
| `eager_layer_budget_bytes`, `eager_layer_instruction_budget_bytes`, `listing_collapse_threshold` | `lib/session-start.ts` (the session-context budget) |
| `infrastructure` | `lib/session-start.ts` (which root files are infrastructure) |

The keys of obsidian-mind's unvendored code are not carried over: `open_loop_dirs`, `open_loop_sections`, `memory_root`, the `mcp_*` keys, `user_content_roots` and `scaffold`.

#### Seams found by vendoring

| ID | Seam | What the extraction does with it |
|----|------|----------------------------------|
| S1 | obsidian-mind's hygiene scan (`active-hygiene`) imports the memory layer (`memory-promoted` → `mcp-exposure` → `mcp-qmd-client`) to check captures already promoted into `brain/`. | That check becomes a Stop detector obsidian-mind registers. The core's hygiene path imports no memory code. |
| S2 | `lib/session-start.ts` is mostly generic: the injection budget, listing collapse, QMD index resolution and frontmatter helpers. It also holds three obsidian-mind formatters (`formatActiveWork`, `hasBrainContent`, `formatBrainIndex`). The QMD libraries import their index helpers from it. | Split it. The budget, listing and QMD helpers move to the core; the formatters become obsidian-mind's session-start extensions. |
| S3 | `lib/matcher.ts` classifies prompts against obsidian-mind's fixed signal set (`lib/signals.ts`). | The matcher takes its signals from the registry (prompt signals, §7.4), with no built-in set. |
| S4 | The QMD refresh trigger lives inside obsidian-mind's `validate-write.ts` entry point. | It becomes a core write hook that runs whatever validators are registered. |

#### Per entry point

Each wiki-mind entry point (#35) is a dispatcher over the registry (§7.4). It keeps obsidian-mind's generic protocol and drops its domain. This table lists, for each one, the vendored libraries it uses and what it needed that no library gave. That list is the extraction's API gap: each line it copies from obsidian-mind's entry point is a function the core should own.

| Entry point | Vendored libraries used | Needed and not given |
|-------------|-------------------------|----------------------|
| `session-start.ts` | `hook-io` (stdin, `fitWithMeter`, the output cap), `om-mod`, `project-dir`, `lib/session-start` (budget, meter, env export, date header, `injectionMode`) | The optional-stdin read with a 2 s deadline, copied from obsidian-mind's entry point. QMD's session-start work also lived only in that entry point (S5). It is now core code, `core/qmd-session.ts` (#42), composed from the vendored QMD libraries. |
| `stop-checklist.ts` | `hook-io` (the Stop writers), `hint-state` (`claimChanged`), `om-mod`, `project-dir`, `qmd-refresh`, `report-key`, `stop-handoff`, `stop-report` | The Stop flow itself: standdown, then the re-entry guard, the mod's report, the per-session dedupe, the handoff and its feedback fallback. It is about 40 lines copied from obsidian-mind's entry point, and should be one core function. `stop-report`'s mod preface names "the obsidian-mind plugin" (seam S6). |
| `classify-message.ts` | `hook-io`, `hint-state` (`claimUnseen`), `project-dir`, `stop-handoff` | Nothing beyond the signal matcher (S3), which the registry now provides. The order (the handoff taken first, whatever the prompt holds) is copied. |
| `validate-write.ts` | `hook-io`, `frontmatter` (`shouldSkipFile`), `project-dir`, `qmd-refresh` | The vault-root boundary check and the refresh-before-skip order (S4), both copied. obsidian-mind's memory-location guard is not ported: it sends knowledge to `brain/`, which wiki-mind does not have. |
| `pre-compact.ts` | vendored whole | — |

Every entry point also reads and parses `vault-manifest.json` itself; the core should hand the parsed manifest in.

| ID | Seam (continued) | What the extraction does with it |
|----|------------------|----------------------------------|
| S5 | QMD's session-start work lived in obsidian-mind's `session-start.ts`, not in a library. *Resolved in #42:* `core/qmd-session.ts` runs it for any vault's session-start. It covers the background index update (or the idempotent bootstrap when the store is missing or near-empty), the native-ABI self-heal, and the minimum-version note, and its side effects are injectable. `VAULT_QMD=off` turns it off, so tests never touch the user's QMD store. | A core session-start step, run before the sections. It lifts with `core/` as it is. |
| S6 | `lib/stop-report.ts`'s `MOD_PREFACE` told the agent a notice may come "from the obsidian-mind plugin". *Patched in #7:* `modPreface(modName)` builds it for any vault's mod, and `MOD_PREFACE` keeps obsidian-mind's value. wiki-mind's `stop-checklist.ts` passes `wiki-mind`, and a test holds that equal to the mod's `plugin.json`. | The mod's name comes from the mod's declaration, so no entry point names it. |

#### Live run (#36)

The real-session test bed ran wiki-mind on Windows with Claude Code 2.1.289, on both delivery paths: the settings hooks and the mod. It ran two scenarios, `wiki` and `compact`, for four sessions in all. The extraction can rely on these results:

- **Both paths work.** The `wiki` scenario passed every check on both arms. The session context reached the model, the routing hints fired on a URL, the write validator ran after a Write, and the Stop report was handed over with the next message.
- **The mod's line is confirmed.** Under the mod, the Stop line shows live as `wiki-mind: vault check: …`. Claude Code prefixes it with the name from the mod's declaration, which confirms S6's choice: no entry point names the mod.
- **Under the mod, the hooks print almost nothing.** The settings hooks' output bytes move into the mod's `classic.*` events: SessionStart prints 0 B and Stop prints 2 B, and the context and the report still arrive. The slowest mod events took about 2 s: `classic.SessionStart`, `classic.Stop` and `prompt.submit`. That is the QMD refresh and the detectors over a small vault. Each extension's time limit (§7.4) bounds this cost; nothing else does.
- **Compaction.** `SessionStart:compact` fires and re-injects the context; the model-layer check passed. PreCompact runs, and appears in Claude Code's debug log as `PreCompact:manual`. The checks that failed attributed these events to the wrong turn: that is a fault in the test bed's parser, not in the hooks.
- **Not yet covered:** macOS and Linux (#70).

### 7.3 Contracts that must not change

These are shared between obsidian-mind and wiki-mind, and stay shared through the extraction.

| Contract | What it fixes | Why it is fixed |
|----------|---------------|-----------------|
| `vault-manifest.json` as the vault-root marker | The hook commands in `.claude/settings.json` walk up from the project directory to the first folder holding `vault-manifest.json`. | Every hook command depends on it, and a session started in a vault subfolder relies on the walk. The keys inside may differ per vault (§7.2); the file's name and role do not. |
| The `om_mod` flag protocol | The field name `om_mod`, and the values `deliver`, `standdown` and `report` that the mod passes to the settings hooks. | It is how the hooks know the mod handled an event. The extraction exposes it as the shared layer's API. |
| The entry-point file names the mod runs | The mod's `register.ts` runs `.claude/scripts/session-start.ts` with `om_mod: "deliver"` and `.claude/scripts/stop-checklist.ts` with `om_mod: "report"`, by path. | wiki-mind's own entry points keep those two names, so the mod's identity change (P1) stays identity-only. |

### 7.4 The extension registry (prototype for the extracted core)

**Decided (2026-10-05, maintainer may overrule):** wiki-mind's entry points are thin dispatchers over an extension registry. wiki-mind is the test bed for the extensible layer: once this registry and the real-session test bed (#36) pass, it moves to the shared core unchanged, and `.claude/VENDOR.json` then points there.

#### Where things live

| Path | Holds | Written by |
|------|-------|------------|
| `.claude/scripts/core/` | `types.ts` (the API), `registry.ts` (loading and dispatch), and their tests. Imports only `../lib`, so a `git mv` lifts it out. | a vendor update, once extracted |
| `.claude/scripts/lib/` | the vendored libraries (§7.1) | a vendor update only |
| `.claude/scripts/*.ts` | the entry points `.claude/settings.json` runs | wiki-mind now; the core once extracted |
| `.claude/extensions/` | the vault's own extensions | the vault only |

The vendored paths and the vault paths are disjoint. So a vendor update's three-way merge is a safety net that almost never conflicts.

An extension imports from `../../scripts/core/index.ts` only (#44). That file re-exports the API types, and the helpers the core chooses to export: `extractFrontmatterField` and `stripFrontmatter` from `lib/session-start.ts`, and `extractWikilinkTargets` from `lib/wikilinks.ts`. `tests/zones.test.ts` holds this rule, and the other zone rules in CONTRIBUTING.md.

**The lift's import rule (decided 2026-10-05, maintainer may overrule):** an extension imports only from the core's one public entry point, never a library file directly. The extraction can then rename or split library internals, as seams S2 and S5 need, without breaking any vault's extensions. The rule already holds in wiki-mind, so the lift changes only the entry point's path.

#### Declaration

An extension runs only if `vault-manifest.json` declares it, and only for the events it lists:

```json
"extensions": [
  {
    "id": "wiki",
    "module": ".claude/extensions/wiki/index.ts",
    "events": ["session-start", "stop", "prompt", "write"],
    "priority": 100,
    "enabled": true,
    "disable": ["wiki.unindexed"],
    "timeoutMs": 1000
  }
]
```

| Field | Rule |
|-------|------|
| `id` | Required, unique, and equal to the `id` the module exports. |
| `module` | Required. A vault-relative `.ts`, `.mts`, `.js` or `.mjs` path with forward slashes. Not absolute, and no `..`. |
| `events` | Required, at least one of `session-start`, `stop`, `prompt`, `write`, `pre-tool` and `mcp`. The last two are slots, recorded and not dispatched. |
| `priority` | Optional. The default for this extension's items that set none. |
| `enabled` | Optional. `false` turns the extension off; its module is never imported. |
| `disable` | Optional. Item ids to turn off, leaving the rest of the extension on. |
| `timeoutMs` | Optional, default 1000. The time limit for each call. |

A malformed declaration is a failure, reported and skipped, and the others still load.

#### The extension

A module exports an `Extension` (`.claude/scripts/core/types.ts`) as `default` or as `extension`: an `id`, plus any of these lists. Every item has an `id` and an optional `priority`. Every function may be async and receives a `HookContext`: the vault root, the parsed manifest, and a fixed `now`.

| Point | Event | Item | Returns |
|-------|-------|------|---------|
| Sections | `session-start` | `header`, `render(ctx)`, optional `pointer` | The body, or null to leave the section out. A section with a pointer can be given up for it; one without is load-bearing. |
| Detectors | `stop` | `detect(ctx)` | Findings: a one-line `claim` for the user's summary, and the `lines` the agent reads. |
| Checklist | `stop` | `full`, `short` | The wrap-up line as the agent reads it and as the summary shows it. |
| Signals | `prompt` | `match(prompt)`, `hint` | True when the prompt matches; the hint is routed once per session. |
| Validators | `write` | `appliesTo(relPath)`, `validate(target, ctx)` | Warnings for the file just written. |
| Slots | `pre-tool`, `mcp` | `preToolGuards`, `mcpTools` | Not dispatched yet. Session-start lists them as declared. |

#### The contract

1. **One dispatcher per event runs every extension in-process.** Claude Code runs matching hooks in parallel with no order, so order exists only inside these dispatchers.
2. **Disjoint paths:** see "Where things live".
3. **Declared, not discovered:** an extension runs only through its declaration, and only for its listed events. A hook imports only the extensions declared for its own event, so an extension's top-level code never runs in a hook it doesn't serve, and its load failures are reported only there (#46).
4. **Order:**
   - The order is a numeric priority, lower first.
   - An unset priority falls back to the declaration's, and otherwise runs last.
   - Ties break by item id, then extension id, so declaration order never matters.
   - The core's own sections (the heading, the date, extension notices) come before every extension's.
5. **Isolation:**
   - Every call runs in its own try, with its own time limit, and calls for one event run concurrently.
   - A throw, a rejected promise or a timeout is recorded, the item is skipped, and the hook carries on and reports the failure in its own output.
   - `VAULT_EXTENSIONS=off` turns every extension off, for debugging.
   - The limit bounds a call that waits. It cannot interrupt synchronous code that never returns; Claude Code's own hook timeout is the backstop for that.
6. **The core owns the output:**
   - Extensions return values and never write to stdout.
   - Sections become the budget's sections, so the highest priority number is given up first, and a section without a pointer never is.
   - `fitWithMeter` caps the whole output, and the meter names what was given up.
7. **No extension weakens a core guard.** When guards are dispatched, an extension can add a block, never remove one.
8. **Overrides are by id:** `enabled: false`, or an id in `disable`. No extension replaces a core file.

Each rule that can be tested has a test in `core/registry.test.ts`: declaration, event gating, order, the budget, a throw, a timeout, disable by id, the kill switch and slots. Rule 1's effect on real hooks is tested in `tests/wiki-entry-points.test.ts`. Isolation covers more than throws: a value of the wrong shape, a getter that throws, and an import that never settles are each a reported failure, and every entry point still writes its protocol's output. Each guarantee was mutated away once and its test watched fail; PR #37 lists them.

#### wiki-mind's extension

`.claude/extensions/wiki/` holds one extension, `wiki`:

- **Sections:**
  - the counts per note folder (load-bearing);
  - open questions (`status: open`);
  - the newest sources;
  - the head of `Index.md`.
- **Checklist:** `Index.md` annotations, source links, `/wiki-lint`.
- **Detectors:**
  - concepts and entities that cite no source;
  - syntheses with fewer than two `sides`;
  - notes `Index.md` doesn't link.
- **Signals:** a new source (a URL, arXiv, DOI or PDF), a comparison, a question.
- **Validators:** the §2 frontmatter (global fields, type fields, the `kind` and `status` value sets), the source-link rule, and two `sides` for a synthesis.

## 8. Invariants

ShardMind's four invariants apply as written. Each is held by a test whose name cites it. Until that test exists, an open issue names it. The `take-next` pre-flight checks this (`ROADMAP.md`).

### Invariant 1 — `install --defaults` equals a clone

Enforced in CI on ubuntu, macOS and Windows by `tests/contract.test.ts` (#11). It installs the commit CI checked out (for a pull request, the merge commit with main) from GitHub with `shardmind install --defaults`, and compares the result with what the repo says a vault gets: the tracked files, minus Tier 1, minus `.shardmindignore`. The paths must match and every file must be byte-identical; the install adds only `.shardmind/` and `shard-values.yaml`. With no `.njk` (§3.4), there is no render delta. The same test asserts that no test file installs (#40).

### Invariant 2 — a defaults install touches no managed file

Holds by the engine gate. The `personalize` hook adds no defaults check of its own. The Invariant 1 contract test also holds this one: a hook edit on a defaults install would break byte equality.

### Invariant 3 — `post-update` is additive

Holds trivially while it is unused. A test asserts that the manifest declares no `post-update` hook. That test changes when one is added.

### Invariant 4 — `bootstrap` re-runs only on fingerprint change

The fingerprint is bumped in the PR that changes the QMD index schema.

Line endings are LF everywhere (`.gitattributes`), because Invariant 1 compares bytes.

## Decisions

The draft's open questions, all answered 2026-10-05. The maintainer may overrule any of them.

| Q | Question | Answer | Lands in |
|---|----------|--------|----------|
| Q1 | Ontology as proposed? | Yes, with `questions/` in place of `open_questions/`; the type is Question. | §1, §2 |
| Q2 | More content folders? | `inbox/` and `bases/`. No `brain/` or `thinking/` in v0.1. | §3.1 |
| Q3 | Frontmatter | As proposed. | §2 |
| Q4 | `Index.md` shape | Agent-curated annotations plus embedded Bases views. | §2, §6.2 |
| Q5 | Values | `user_name`, `research_focus`, `qmd_enabled`. | §4 |
| Q6 | Codex and Gemini | Claude only in the first release; Codex and Gemini in a later phase. | §3.2, §5 |
| Q7 | QMD as value or module | A value. | §5 |
| Q8 | Command prefix | `wiki-`. | §6.2 |
| Q9 | Generic obsidian-mind commands | Not in v0.1. | §6.2 |
| Q10 | Mod name and flag | Mod `wiki-mind`; `om_mod` protocol unchanged. | §6.4, §7.3 |
| Q11 | Where `VENDOR.json` lives | `.claude/VENDOR.json`, installed. | §3.2, §7.1 |
| Q12 | Correction sweep | Not in v0.1; specified separately later. | §7.1 |

## Later

Planned for phases after the first release, so they are scheduled rather than dropped:

- **Codex and Gemini** as removable modules, as in obsidian-mind (§5).
- **Corrections for a retracted or superseded source:** how the wiki updates the concepts, entities and syntheses that cite it. This needs its own spec, not obsidian-mind's sweep (§7.1).
- **`wrap-up` and `tidy`**, through the extraction rather than as wiki-mind copies (§6.2).
- **A diagram skill for syntheses** (mermaid). A comparison note is a natural place for a diagram (§7.1).
