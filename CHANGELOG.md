# Changelog

What changed in each release. A vault installed with ShardMind shows this after `shardmind update`.

## [Unreleased]

The first release.

### Added

- **The wiki:**
  - `sources/`, `concepts/`, `entities/`, `syntheses/` and `questions/`, with a template and a Bases view each;
  - `inbox/` for raw material;
  - `Index.md`, the annotated entry point that embeds the Bases views.
- **Commands:**
  - `/wiki-ingest` reads a source and updates the concepts and entities it informs, with every claim linked back to it;
  - `/wiki-synthesize` compares notes the wiki already has;
  - `/wiki-question` files a question;
  - `/wiki-lint` checks the wiki for drift.
- **Claude Code hooks:**
  - each session starts with the wiki's counts, open questions, newest sources and the head of `Index.md`. Over the context budget, only the sections that don't fit become pointers, and the meter says which;
  - each note write is checked against its type's rules;
  - each answer ends with a drift report for notes that cite no source, one-sided comparisons, orphans, notes `Index.md` doesn't annotate, and stale questions;
  - routing hints suggest the command a message calls for.
- **A Claude Code mod** that delivers the session context as an instruction file and shows the drift report as one line under the answer, on Claude Code 2.1.287 or later.
- **QMD semantic search, optional:**
  - each vault gets its own index, built at install;
  - the index refreshes as notes change;
  - a broken native module is repaired at session start.
- **Install-time personalization:** your name and the wiki's focus head `Index.md`.
- **Requires** ShardMind 0.2.1 or later.
