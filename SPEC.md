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
| `.claude/scripts/` | Hook scripts and the QMD MCP server, vendored (§7). |
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

The `.claude/settings.json` hooks from obsidian-mind, retargeted at the wiki:

| Event | Script | Change for wiki-mind |
|-------|--------|----------------------|
| SessionStart | `session-start.ts` | Context lists the wiki folders, open questions and recent sources instead of active work and North Star. |
| UserPromptSubmit | `classify-message.ts` | Wiki signals instead of work signals (§7.2, X2 and P2). |
| PostToolUse (Write/Edit) | `validate-write.ts` | Frontmatter and link rules per §2. |
| PreCompact | `pre-compact.ts` | Unchanged. |
| Stop | `stop-checklist.ts` | Wiki hygiene findings (the `wiki-lint` checks). |

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

## 7. Vendored machinery from obsidian-mind

**Decided:** the scripts, hooks and mod come from obsidian-mind as a vendored copy, not a rewrite. The machinery is expected to move into a reusable repo of its own later; vendoring now means that extraction swaps the source of the copy instead of merging two forks. ShardMind declined composition, so shards vendor what they share.

### 7.1 The record

A `VENDOR.json` records the obsidian-mind commit the copy came from, following ShardMind's `source/ui-kit/VENDOR.json`:

- `repository`, `commit`, `version` (the obsidian-mind release), `license`;
- `files`: each vendored path mapped to its upstream path, with `modified: true|false` and, when modified, a one-line `change` saying what and why.

The `files` map is the extraction input: unmodified files are the shared core as it stands, and each `change` line is a place the shared core needs a seam. **Decided (2026-10-05, maintainer may overrule):** the record is `.claude/VENDOR.json`, and it installs (Q11). A vault should know where its machinery came from: a later vendor update in an installed vault reads it.

Vendored scope, from the initial copy: `.claude/scripts/` (with `lib/` and the tests of what is kept), `.claude/skills/` (the mod and the Obsidian and QMD skills), `.scripts/qmd-bootstrap.ts`, `.shardmind/hooks/bootstrap.ts`. obsidian-mind's commands, agents, templates, Bases and content are not vendored: they are its domain, not machinery.

**Decided, the maintainer may overrule:** the cross-repo memory MCP server (`om-mcp`, `lib/mcp-*`, `lib/memory-*`) stays in obsidian-mind and is not vendored. It is about half of the machinery, it is a product of its own, and the wiki workflow does not depend on it. If wiki-mind wants it later, it arrives through the extraction or a vendor update, not through a second fork now.

**Decided (2026-10-05, maintainer may overrule):** the correction sweep is not in v0.1 (Q12). obsidian-mind's sweep is built around its single-source status rule. A wiki's correction case is different: a source is retracted or superseded. That case gets its own spec in a later phase (see [Later](#later)).

### 7.2 What wiki-mind changes, and how deep

wiki-mind vendors obsidian-mind's machinery as it is. It does not build an extension mechanism of its own. Instead, it records what each change would need from the extracted layer. The extracted layer is meant to be a core with declared extension points per lifecycle event:

- session-start sections;
- Stop and hygiene detectors;
- prompt signals;
- write validators;
- pre-tool guards;
- MCP tools.

Under that design, a vault's own behaviour lives outside the vendored code (for example under `.claude/extensions/`) and is declared in `vault-manifest.json`. The core owns ordering, the byte budget and failure isolation. Vaults that patch obsidian-mind's core files today to add their own behaviour are the case it serves.

Every change below is in one of three tiers:

- **Config:** a `vault-manifest.json` key. No vendored code changes.
- **Extension:** new behaviour at a lifecycle point. It names the point it needs. Until the core has that point, the behaviour is written in wiki-mind's own files (the commands, `CLAUDE.md`), not in the vendored scripts.
- **Core patch:** an edited vendored file, recorded in `VENDOR.json`. Each one marks an extension point the core lacks, so each one is justified, and the list is kept as short as possible.

A row marked *verify* is a reading of obsidian-mind's code that the vendoring PR confirms or corrects.

#### Config

| ID | Change | Key |
|----|--------|-----|
| K1 | Vault identity and release. | `template`, `version`, `released` |
| K2 | QMD index, minimum version and the context string search sees. `bootstrap.ts` already reads them, so it stays unmodified. | `qmd_index`, `qmd_min_version`, `qmd_context` |
| K3 | Which folders hold unchecked open loops. *Verify*: obsidian-mind's open-loop detector counts unchecked checkboxes, and question notes carry `status:` frontmatter, not checkboxes, so pointing it at `questions/` may count nothing. If so, X4 owns stale open questions, and K3 only empties the work folders. | `open_loop_dirs`, `open_loop_sections` |
| K4 | Which paths are infrastructure and which hold user notes. | `infrastructure`, `user_content_roots`, `scaffold` |
| K5 | Session-context byte budgets. obsidian-mind's values are kept. | `eager_layer_budget_bytes`, `eager_layer_instruction_budget_bytes`, `listing_collapse_threshold` |
| K6 | Per-type required frontmatter (§2). obsidian-mind ships this key, but none of its hooks read it today (verified); see X3. | `frontmatter_required` |
| K7 | The memory-server keys are dropped, because the server is not vendored (§7.1). *Verify*: no vendored script outside the memory server reads them unconditionally; if one does, they stay. | `memory_root`, `mcp_exposed_roots`, `mcp_never_expose`, `mcp_inbox` |

#### Extension

| ID | Behaviour | Extension point it needs | Until the point exists |
|----|-----------|--------------------------|------------------------|
| X1 | Session context shows open questions (`status: open`), recent sources and the `Index.md` summary. | session-start sections | `CLAUDE.md` tells the agent to read `Index.md` and `questions/` at session start. |
| X2 | Prompt signals for wiki intake: a new source, a claim, a comparison, a question. Each routes to its folder. | prompt signals | `CLAUDE.md` carries the routing table. |
| X3 | Write validation per note type: required frontmatter (K6); concepts and entities link at least one source; a synthesis names two or more sides. | write validators, reading K6 | `wiki-lint` reports the same problems on demand. |
| X4 | Wiki hygiene at Stop: orphans, claims with no source, one-sided syntheses, `Index.md` drift. | Stop and hygiene detectors | The `wiki-lint` command. |
| X5 | No pre-tool guard at first. | pre-tool guards | None needed. |
| X6 | No MCP tool beyond QMD at first. | MCP tools | None needed. |

obsidian-mind's own sections, detectors and checks for its work folders (`work/active/`, `work/meetings/`, `brain/North Star.md`) stay in the vendored code untouched. In a wiki vault those folders don't exist, so they should produce nothing (*verify*: each one tolerates an absent folder). In the extracted design they become obsidian-mind's extensions, not core.

#### Core patch

| ID | File | Change | Why it can't wait for an extension point | Point the core lacks |
|----|------|--------|-------------------------------------------|----------------------|
| P1 | `.claude/skills/<mod>/` (`register.ts`, `context.ts`, `stop.ts`, `.claude-plugin/plugin.json`) and the folder name | The mod's name, state keys, context block and plugin identity become `wiki-mind`. The `om_mod` flag protocol is unchanged (§7.3). | With both vaults installed, two mods named `obsidian-mind` would collide. | Mod identity as configuration. |
| P2 | `lib/signals.ts` | obsidian-mind's signal set (DECISION, WIN, INCIDENT, ONE_ON_ONE, …) is emptied. | Those signals fire on wiki prompts and route to folders the vault doesn't have. That is wrong guidance, not just silence. | Prompt signals that a vault declares and can replace, with no fixed default set. |
| P3 | `stop-checklist.ts` | Drop the work-vault checklist lines ("Archive completed projects? work/active/ …"). *Verify*: only if they print regardless of whether the folders exist. | Same reason as P2: the lines would tell the agent to do things that can't apply. | Stop checklist items as detectors. |
| P4 | `validate-write.ts` | The topic-cluster hint suggests a folder under the wiki's own folders, not `work/active/<Topic>/`. *Verify*: only if the hint can fire in a wiki vault. | A hint that points at a nonexistent folder misleads. | Cluster target folder as config. |

P1 and P2 are certain. P3 and P4 land only if the vendoring PR confirms them. Every other file is vendored unmodified.

### 7.3 Contracts that must not change

These are shared between obsidian-mind and wiki-mind, and stay shared through the extraction. A vendored change that touches one is a bug, not a seam.

| Contract | What it fixes | Why it is fixed |
|----------|---------------|-----------------|
| `vault-manifest.json` as the vault-root marker | The hook commands in `.claude/settings.json` walk up from the project directory to the first folder holding `vault-manifest.json`. | Every hook command depends on it, and a session started in a vault subfolder relies on the walk. The keys inside the file may differ per vault (§7.2, Config); its name and role do not. |
| The `om_mod` flag protocol | The field name `om_mod` and the values `deliver`, `standdown` and `report` that the mod passes to the settings hooks. | It is how the hooks know the mod handled an event. Both sides of it are vendored, and the extraction exposes it as the shared layer's API. |

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
