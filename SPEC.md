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
| `.claude/skills/` | Obsidian and QMD skills, and the Claude Code mod (§6.4), vendored. |
| `.claude/settings.json` | The hook wiring. |
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

**The vendored set (#6): 66 files from obsidian-mind v9.0.1, all unmodified.**

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

The mod is vendored by #7, together with its identity change (P1). `.claude/settings.json` arrives with wiki-mind's entry points, because obsidian-mind's version points at scripts this set doesn't have.

**Decided, the maintainer may overrule:** the memory MCP server, and the libraries only it uses, stay in obsidian-mind. The server is a product of its own, it is about half of the machinery, and the wiki workflow doesn't depend on it. If wiki-mind wants it later, it arrives through the extraction or a vendor update.

**Decided (2026-10-05, maintainer may overrule):** the correction sweep is not in v0.1 (Q12). obsidian-mind's sweep is built around its single-source status rule. A wiki's correction case is different: a source is retracted or superseded. That case gets its own spec in a later phase (see [Later](#later)).

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

For each wiki-mind entry point, the issue that builds it fills in this table: the vendored libraries it uses, and what it needed that no library gave. That list is the extraction's API gap.

| Entry point | Vendored libraries used | Needed and not given |
|-------------|-------------------------|----------------------|
| `session-start.ts` | (entry-points issue) | |
| `stop-checklist.ts` | (entry-points issue) | |
| `validate-write.ts` | (entry-points issue) | |
| `classify-message.ts` | (entry-points issue) | |
| `pre-compact.ts` | vendored whole | — |

### 7.3 Contracts that must not change

These are shared between obsidian-mind and wiki-mind, and stay shared through the extraction.

| Contract | What it fixes | Why it is fixed |
|----------|---------------|-----------------|
| `vault-manifest.json` as the vault-root marker | The hook commands in `.claude/settings.json` walk up from the project directory to the first folder holding `vault-manifest.json`. | Every hook command depends on it, and a session started in a vault subfolder relies on the walk. The keys inside may differ per vault (§7.2); the file's name and role do not. |
| The `om_mod` flag protocol | The field name `om_mod`, and the values `deliver`, `standdown` and `report` that the mod passes to the settings hooks. | It is how the hooks know the mod handled an event. The extraction exposes it as the shared layer's API. |
| The entry-point file names the mod runs | The mod's `register.ts` runs `.claude/scripts/session-start.ts` with `om_mod: "deliver"` and `.claude/scripts/stop-checklist.ts` with `om_mod: "report"`, by path. | wiki-mind's own entry points keep those two names, so the mod's identity change (P1) stays identity-only. |

### 7.4 The extension registry (prototype for the extracted core)

**Decided (2026-10-05, maintainer may overrule):** wiki-mind's entry points are thin dispatchers over an extension registry. The registry lives in `.claude/scripts/core/`, so a `git mv` can lift it into the future core repo. It imports only the vendored libraries.

Extension points:

- session-start sections;
- Stop and hygiene detectors;
- prompt signals;
- write validators.

Pre-tool guards and MCP tools exist as slots only.

The registry owns three things:

- **ordering:** by priority;
- **the byte budget:** low-priority sections degrade first, through `hook-io`'s `fitWithMeter`;
- **failure isolation:** an extension that throws is named in the output and skipped, and it never blocks the hook.

wiki-mind's own behaviour is written as extensions under `.claude/extensions/`, declared in `vault-manifest.json`. That covers the `Index.md`, open-questions and recent-sources sections, the `wiki-lint` detectors, and the §2 validators.

The entry-points issue writes this section's API in full: the extension shape, the manifest declaration, and how each point dispatches. The extraction starts from that.

## 8. Invariants

ShardMind's four invariants apply as written. Each is held by a test whose name cites it. Until that test exists, an open issue names it. The `take-next` pre-flight checks this (`ROADMAP.md`).

### Invariant 1 — `install --defaults` equals a clone

Enforced in CI on ubuntu, macOS and Windows by a contract test shaped like obsidian-mind's `shard-contract.test.ts`. With no `.njk` (§3.4), every installed file is byte-identical to the clone.

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
