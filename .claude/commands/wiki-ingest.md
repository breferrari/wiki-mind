---
description: "Ingest a source from a URL or inbox/: write its sources/ note, update the concepts and entities it informs with linked claims, mark questions it answers, annotate Index.md."
argument-hint: "<url, or a path in inbox/>"
---

# Ingest a source

Turns `$ARGUMENTS` (a URL, or a file in `inbox/`) into wiki notes (CLAUDE.md, "The wiki"). This is the core workflow: everything in the wiki traces back to a source ingested here.

## 1. Read the source in full

- **A URL:** fetch it with `defuddle parse <url> --md` (the defuddle skill). For a PDF link, download it to `inbox/` first, then read it as a file.
- **A path in `inbox/`:** read the file. Leave the original where it is: `inbox/` is the raw layer, never cleaned up by ingest.

Read all of it before writing anything. If it can't be read (paywalled, scanned without text, a dead link), say so and stop.

## 2. Check what the wiki already has

Search (QMD first, see CLAUDE.md "Search") for:
- the source itself, so it is not ingested twice. If it exists, update that note instead.
- the concepts and entities it is about, so each idea keeps one note.
- open questions it might answer.

## 3. Write the source note

From `templates/Source.md`, in `sources/`, named by the work's title:
- **Frontmatter:** `authors`, `year`, `url` (or the inbox path), and a one-line `description` of what it contributes.
- **What it says:** the source's argument in your words. Report what the source says, not what you think of the field.
- **Key claims:** one line each, each linked to the concept or entity it informs.
- **Concepts and entities**, and any **open questions it raises**, linked.

## 4. Update the concepts and entities it informs

For each idea or named thing the source bears on:
- **If its note exists:** add the new claim to it, with a link to this source. Don't rewrite what other sources said. Where this source disagrees with one, say so in both directions, and consider a synthesis.
- **If it doesn't exist:** create it from `templates/Concept.md` or `templates/Entity.md` (set `kind`). It cites this source, so it is never created without one.

Keep concepts atomic: one idea per note. A comparison belongs in `syntheses/` (`/wiki-synthesize`), never inside a concept.

## 5. Questions

- **A question this source answers:** set `status: answered`, write the answer with its sources, and link the question from the source note.
- **A question it raises:** file it (`/wiki-question`).

## 6. Index.md

Add a one-line annotation for each new note to its section of `Index.md`: what the note is for, not a summary of it.

## 7. Report

List what you created and what you updated, as links, plus any disagreement with existing notes and any question answered. Then stop: the user reads and corrects.

The hooks check every note as you write it (CLAUDE.md, "The wiki"). Fix any warning they raise in the same turn.
