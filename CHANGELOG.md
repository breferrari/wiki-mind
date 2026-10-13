# Changelog

What changed in each release. A vault installed with ShardMind shows this after `shardmind update`.

## [Unreleased]

### Added

- **Codex and Gemini.** The vault ships hook configs for both, in `.codex/` and `.gemini/`. Each is a module you can leave out at install. Codex and Gemini read `AGENTS.md` and run the same hooks as Claude Code. Under Codex, run a command by typing its name without the slash, as `wiki-ingest`.
- **Diagrams in syntheses.** When a comparison has a shape a picture shows, `/wiki-synthesize` offers a mermaid diagram, drawn with the bundled `mermaid-visualizer` skill. A diagram adds no claim: everything in it is already in the note's text, with its source.
- **Retract or supersede a source with `/wiki-retract`.** The source note stays as the record of what it said. Each claim that cites it is marked when another source still backs it, or moved to the note's Withdrawn claims when nothing does. For a newer source, the agent restates the claim from it. Syntheses that rest on it are flagged for review, and answered questions that rested on it alone reopen. `--undo` reverses it when a retraction is itself withdrawn. `/wiki-lint` reports a link to such a source that nothing has marked.

### Changed

- **The vault's manual is `AGENTS.md`, not `CLAUDE.md`.** One instruction file every agent reads; what only Claude Code needs is in `.claude/rules/`. On `shardmind update`, an unmodified `CLAUDE.md` is removed. One you edited is kept, and session-start warns you about it: Claude Code would read it in place of `AGENTS.md`, so move anything of your own into `AGENTS.md` and delete it.
- **Install names its folder, and needs ShardMind 1.0 or later.** ShardMind 1.0 makes the vault's folder itself, so these steps replace 0.1.0's `mkdir` first:
  1. `npx shardmind install breferrari/wiki-mind my-wiki`
  2. `cd my-wiki`

  If your ShardMind can't find the shard by name, use the full GitHub reference: `npx shardmind install github:breferrari/wiki-mind my-wiki`. An older ShardMind stops with a version error: run `npx shardmind@latest`, or upgrade a global install with `npm i -g shardmind@latest`.
- **QMD search runs as an extension.** `vault-manifest.json` declares it under `extensions`, as `qmd`. It keeps the search index fresh at session start, after each write, before a compaction and at Stop, as before. If the entry is missing or wrong, session start says how to fix it.

### Fixed

- **Codex and Gemini run the hooks they missed.** Under Gemini, the session context now arrives on every start, resume and `/clear`, and each note you write is checked. Under Codex, the context also comes back after `/clear` and a compaction, and a note written with `apply_patch` is checked: each one, when a patch writes several.
- **Gemini and Codex get the session context.** Session start now sends it in the JSON shape their hooks read, so the counts, open questions, newest sources and the head of `Index.md` reach them as they reach Claude Code. The JSON takes room of its own, so the budget's ceiling is now 9.0kB (9,024 bytes), and the default budget is 9.0kB, down from 9.1kB. The budget counts text as the JSON does, so a quote, a backslash, a tab or a line break counts twice. If you set `eager_layer_budget_bytes` above the ceiling in `vault-manifest.json`, the context is held to the ceiling, and the meter's last line says so: lower it to 9000 to clear the note.
- **`/wiki-retract` handles a note saved with a byte-order mark.** Some Windows editors start a file with one. The note's frontmatter is read as frontmatter, and the mark stays the file's first character.
- **`/wiki-retract` finds the vault when the session started in a subfolder.** Before, it looked for `sources/` inside that subfolder and found nothing.
- **Your name and research focus head `Index.md`** when you give them at install. Before, ShardMind recorded them but never ran the step that writes them.

## [0.1.0] - 2026-10-06

The first release. You bring sources; the agent reads them and keeps a linked wiki of concepts, entities and comparisons over them. Every note is plain Markdown that Obsidian opens without the agent.

### Get started

- **Install it into an empty folder:**
  1. `mkdir my-wiki && cd my-wiki`
  2. `npx shardmind install github:breferrari/wiki-mind`
  3. Answer three questions: your name, what the wiki is about, and whether to use QMD search.
  4. Open the folder as a vault in Obsidian, and start Claude Code in it.
- **Have these first:** Obsidian 1.12 or later, Node.js 22.6 or later, ShardMind 0.2.1 or later, and Claude Code.
- **Or clone the repo.** A clone is the same vault with the defaults. Run `shardmind adopt github:breferrari/wiki-mind` in it to receive future releases with `shardmind update`.

### Work with the wiki

- **Ingest a source with `/wiki-ingest <url or inbox path>`.** The agent reads it in full and writes its note. Then it updates each concept and entity the source informs, with every claim linked back to it.
- **Compare with `/wiki-synthesize <X> vs <Y>`.** It works only from notes the wiki already has. When a side is missing, it says which source to ingest first.
- **File a question with `/wiki-question <text>`.** A question is `open`, `answered` or `dropped`, and is never deleted.
- **Check for drift with `/wiki-lint`.** It finds orphans, unsourced notes, one-sided comparisons, frontmatter problems, stale questions and notes `Index.md` doesn't annotate.
- **Start from `Index.md`.** It holds a one-line annotation per note, above a Bases view of each note type.

### Let the hooks keep it honest

- **Start each session with the wiki's state:** its counts, open questions, newest sources and the head of `Index.md`. When the context budget is tight, only the sections that don't fit become pointers, and the size line names them.
- **Fix write warnings in the same turn.** Each note write is checked against its type's rules.
- **Read the drift report after each answer.** On Claude Code 2.1.287 or later, the vault's mod shows it as one line under the answer. The agent gets the full report with your next message.
- **Add QMD search if you want it** (`npm install -g @tobilu/qmd`). Each vault gets its own index, refreshed as notes change. Without QMD, the agent searches with grep.

### Platforms

- **Use it on Windows, macOS or Linux.** CI installs the vault and runs every hook on all three.
