# wiki-mind shard specification

> **Status:** draft for ratification. Sections marked **Decided** are settled. Everything under [Open questions](#open-questions) waits for the maintainer's answer, and the text that depends on an answer says so. Once ratified, this file is the contract the roadmap builds against. A change to it lands in its own PR before the code that needs it.

This spec covers the shard surface: what a user gets from `shardmind install github:breferrari/wiki-mind`, and how the repo is laid out to produce it. The ShardMind contract it builds on is [`docs/SHARD-LAYOUT.md`](https://github.com/breferrari/shardmind/blob/main/docs/SHARD-LAYOUT.md); this file does not restate it.

## 1. What the vault does

wiki-mind is a research vault on the LLM-wiki pattern. The user brings material, and an agent keeps a linked wiki over it:

1. A question or a lead lands in `open_questions/`.
2. A paper or article is ingested as one note in `sources/`.
3. Ingesting a source creates or updates the `concepts/` and `entities/` notes it bears on, and each claim links back to the source it came from.
4. When two or more concepts compete or overlap, a `syntheses/` note compares them.
5. `Index.md` is the annotated entry point over all of it.

The agent does the writing; the user steers, reads and corrects. Every note is plain Markdown that Obsidian opens without the agent.

## 2. Ontology

Five note types, each with one folder and one Obsidian template, plus `Index.md`.

| Type | Folder | One note per | Template | Must link to |
|------|--------|--------------|----------|--------------|
| Source | `sources/` | paper or article | `templates/Source.md` | the concepts and entities it informs |
| Concept | `concepts/` | atomic idea | `templates/Concept.md` | at least one source |
| Entity | `entities/` | named system, tool or person | `templates/Entity.md` | at least one source |
| Synthesis | `syntheses/` | "X vs Y" comparison | `templates/Synthesis.md` | the concepts or entities it compares, two or more |
| Open question | `open_questions/` | question or lead to pursue | `templates/Open Question.md` | whatever raised it, when anything did |

A synthesis sits above concepts: it never replaces one, and a concept never holds a comparison. That separation is what keeps concepts atomic.

`Index.md` sits at the vault root and lists each note type's notes with a one-line annotation per note. Whether the agent maintains it by hand or it embeds Bases views is open (Q4).

Frontmatter per type (field names, required set) is fixed by the templates PR, against Q3.

## 3. Shipped files

### 3.1 Vault content (installed, static)

| Path | What |
|------|------|
| `Index.md` | Annotated entry point. |
| `sources/`, `concepts/`, `entities/`, `syntheses/`, `open_questions/` | Empty at install, each with a `README.md` that says what goes there, so the folder exists in a clone. |
| `templates/` | The five templates above. |
| `.obsidian/` | Vault config: core plugins, templates folder, attachment folder. No user state (ShardMind's Tier 1 excludes it anyway). |
| `README.md`, `LICENSE` | As today. |

Further content folders (a `brain/` for the agent's operational memory, `bases/`, a `thinking/` scratchpad, an `inbox/` for raw drops) are open (Q2).

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
| `AGENTS.md` + `.codex/`, `GEMINI.md` + `.gemini/` | Only if Q6 answers yes. |

### 3.3 Repo-only (in `.shardmindignore`)

`CONTRIBUTING.md`, `SPEC.md`, `ROADMAP.md`, the vendoring record (§7.1), tests of repo-only scripts, and any media. `.github/` and `.shardmind/` are excluded by the engine itself.

### 3.4 Static vs templated

**Decided:** every file ships static. No `.njk` at first: obsidian-mind ships none, and every value in §4 is consumed by a hook or at runtime, not by rendering. Personalization goes through the `personalize` hook (managed files, non-default installs only), so Invariant 1 holds with no render delta. A `.njk` is added only for dotfolder config, and only when a value has to reach a file that no hook can edit.

## 4. Values

Every value has a default (ShardMind rejects one without). The defaults are what a clone gets.

| Value | Type | Default | Used by |
|-------|------|---------|---------|
| `user_name` | string | `""` | `personalize`: names the owner in `Index.md`. |
| `research_focus` | string | `""` | `personalize`: one line in `Index.md`; the QMD context string. |
| `qmd_enabled` | boolean | `true` | `bootstrap` (build the index or not); the `when:` of the QMD `external_tools` entry. |

This set is a proposal (Q5). obsidian-mind's `org_name` and `vault_purpose` don't carry over: wiki-mind has one purpose.

## 5. Modules

| Module | Paths | Removable | Why |
|--------|-------|-----------|-----|
| `wiki` | the five folders, `Index.md`, `templates/` | no | The product. |
| `claude` | `CLAUDE.md`, `.claude/` except `scripts/`, `.claude-plugin/` if shipped | no | As in obsidian-mind: other agents' hook configs resolve into `.claude/scripts/`, so removing Claude would orphan them. `.claude/scripts/` is claimed by no module and so always installs. |
| `codex`, `gemini` | their manual and dotfolder | yes | Only if Q6 answers yes. |

QMD search is a value (`qmd_enabled`), not a module, as in obsidian-mind: its files are small scripts that do nothing when QMD is absent, and keeping them installed means turning it on later needs no reinstall. Whether to make it a module instead is Q7.

Default wizard state is every module selected (ShardMind rule), so a defaults install ships all of the above.

## 6. Claude-side machinery

### 6.1 The vault `CLAUDE.md`

**Decided:** the root `CLAUDE.md` is the vault's agent manual and ships in every install. It covers the ontology, the ingest and synthesis workflows, linking rules, and search order (QMD MCP, then QMD CLI, then grep). It keeps a "Developing this shard" section that points at `CONTRIBUTING.md`; contributor rules live there, kept out of installs by `.shardmindignore`. Until the vault manual is written, that section repeats the hard rules.

### 6.2 Commands

Proposed, prefix open (Q8):

| Command | Does |
|---------|------|
| `ingest <url or file>` | Fetch the source (`defuddle` for web pages), write the `sources/` note, create or update the concepts and entities it informs, link both ways, update `Index.md`, close or annotate any open question it answers. |
| `synthesize <X> vs <Y>` | Write a `syntheses/` note comparing two or more existing concepts or entities, citing their sources. Refuses when a side has no note yet and says which to ingest first. |
| `question <text>` | File an `open_questions/` note. |
| `lint` | Report orphans, claims with no source link, syntheses with fewer than two sides, and `Index.md` drift. |

Whether obsidian-mind's generic commands (`wrap-up`, `tidy`, `vault-audit`) carry over is Q9.

### 6.3 Hooks

The `.claude/settings.json` hooks from obsidian-mind, retargeted at the wiki:

| Event | Script | Change for wiki-mind |
|-------|--------|----------------------|
| SessionStart | `session-start.ts` | Context lists the wiki folders, open questions and recent sources instead of active work and North Star. |
| UserPromptSubmit | `classify-message.ts` | Wiki signals (§7.2) instead of work signals. |
| PostToolUse (Write/Edit) | `validate-write.ts` | Frontmatter and link rules per §2. |
| PreCompact | `pre-compact.ts` | Unchanged. |
| Stop | `stop-checklist.ts` | Wiki hygiene findings (the `lint` checks). |

### 6.4 The Claude Code mod

**Decided:** wiki-mind ships the Claude Code mod as well as the hooks, with the same two paths obsidian-mind has.

- On Claude Code 2.1.287 and later, the mod under `.claude/skills/<mod>/` delivers the session context as an instruction file and shows the Stop report as one line under the answer. For each event it handles, it passes the settings hook a stand-down flag and the hook exits.
- On older Claude Code, and on Codex and Gemini, the mod does not load and the settings hooks run unchanged.

Both paths run the same scripts, so they cannot disagree on content. The mod's name, folder and flag name are Q10.

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

The `files` map is the extraction input: unmodified files are the shared core as it stands, and each `change` line is a place the shared core needs a seam. Location of the record is Q11.

Vendored scope, from the initial copy: `.claude/scripts/` (with `lib/` and the tests of what is kept), `.claude/skills/` (the mod and the Obsidian and QMD skills), `.scripts/qmd-bootstrap.ts`, `.shardmind/hooks/bootstrap.ts`. obsidian-mind's commands, agents, templates, Bases and content are not vendored: they are its domain, not machinery. Which `lib/` subsystems come along is Q12.

### 7.2 What wiki-mind changes, and why

Known at spec time. The vendoring PR completes the list file by file in `VENDOR.json`.

| Area | Change | Why | Seam it implies |
|------|--------|-----|-----------------|
| Signals (`lib/signals.ts`) | Replace DECISION, WIN, INCIDENT, ONE_ON_ONE and the rest with wiki signals: new source, claim, comparison, question. | The routing targets are a different ontology. | Signals as data the shard supplies. |
| Session context (`lib/session-start.ts`) | Read wiki folders and open questions, not `work/active/` and `brain/North Star.md`. | Different folders carry the vault's state. | Context sections declared by the shard. |
| Write validation (`validate-write.ts`) | Frontmatter per §2 types; source-link rule for concepts and entities. | Different note types. | Note-type rules read from the shard. |
| Hygiene (`lib/active-hygiene.ts`, Stop report) | Wiki checks (`lint`) instead of active-work staleness. | Different notion of drift. | Pluggable hygiene checks. |
| Mod identity | Plugin name, mod folder, state keys, possibly the flag name. | Two mods named `obsidian-mind` would collide in a user who runs both vaults. | Name supplied by the shard. |
| `vault-manifest.json` keys | Drop obsidian-mind-only keys (`open_loop_dirs`, `open_loop_sections`); keep the shared ones. | The keys describe folders wiki-mind does not have. | A shared core key set plus shard keys. |
| `bootstrap.ts` | Index name and QMD context string from wiki-mind's values. | Different vault. | Already value-driven; likely unmodified. |

## 8. Invariants

ShardMind's four invariants apply as written. For this shard:

1. **`install --defaults` equals a clone.** Enforced in CI on ubuntu, macOS and Windows by a contract test shaped like obsidian-mind's `shard-contract.test.ts`. With no `.njk` (§3.4), every installed file is byte-identical to the clone.
2. **A defaults install touches no managed file.** Holds by the engine gate; the `personalize` hook adds no defaults check of its own.
3. **`post-update` is additive.** Holds trivially while it is unused.
4. **`bootstrap` re-runs only on fingerprint change.** The fingerprint is bumped in the PR that changes the QMD index schema.

Line endings are LF everywhere (`.gitattributes`), because Invariant 1 compares bytes.

## Open questions

Answer inline or on the PR. Each answer edits the section named.

- **Q1. Ontology as proposed?** Five types, folder names as written (`open_questions/` with an underscore, the others plural). (§2)
- **Q2. More content folders?** Any of: `brain/` (the agent's operational memory, as in obsidian-mind), `bases/` (Bases views over the five types), `thinking/` (scratchpad), `inbox/` (raw drops before ingest). (§3.1)
- **Q3. Frontmatter.** Minimum fields for every note (proposal: `date`, `description`, `tags`), plus per type: source (`authors`, `year`, `url`), entity (`kind`: system, tool or person), synthesis (`sides`), open question (`status`: open, answered, dropped)? (§2)
- **Q4. `Index.md`: agent-maintained list, Bases embeds, or both?** (§2)
- **Q5. Values.** `user_name`, `research_focus`, `qmd_enabled`: keep, add, drop? (§4)
- **Q6. Codex and Gemini.** Ship `AGENTS.md` and `GEMINI.md` with their hook configs as removable modules, as obsidian-mind does, or Claude only at first? (§3.2, §5)
- **Q7. QMD as a value or a module?** (§5)
- **Q8. Command prefix.** obsidian-mind uses `om-`. `wm-`, `wiki-`, or none? (§6.2)
- **Q9. Generic obsidian-mind commands.** Carry over `wrap-up`, `tidy`, `vault-audit` (adapted), or only the wiki commands? (§6.2)
- **Q10. Mod name and flag.** Mod folder and plugin name (`wiki-mind`?), and whether the stand-down flag keeps obsidian-mind's `om_mod` name (one flag across shards, easier extraction) or becomes `wm_mod`. (§6.4, §7.2)
- **Q11. Where `VENDOR.json` lives.** At the repo root (repo-only, in `.shardmindignore`), or next to the code it describes (`.claude/VENDOR.json`, installed, so a vault knows where its machinery came from)? (§7.1)
- **Q12. Which obsidian-mind subsystems come along.** The cross-repo memory MCP server (`om-mcp`, `lib/mcp-*`, `lib/memory-*`) and the correction sweep are large and work-vault shaped. Vendor them now, later, or never? (§7.1)
