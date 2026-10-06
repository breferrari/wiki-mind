# Changelog

What changed in each release. A vault installed with ShardMind shows this after `shardmind update`.

## [Unreleased]

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
