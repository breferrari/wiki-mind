---
description: "Write a syntheses/ note comparing two or more existing concepts or entities, citing the sources behind each claim; refuses when a side has no note yet."
argument-hint: "<X> vs <Y> [vs <Z>]"
---

# Write a synthesis

Compares the notes named in `$ARGUMENTS` in a `syntheses/` note (SPEC.md §2). A synthesis sits above concepts and entities: it says how they relate, and never replaces either.

## 1. Find the sides

Split the argument on "vs" (or "versus", or commas). For each side, find its note in `concepts/` or `entities/` (QMD first, see CLAUDE.md "Search").

**Refuse when a side has no note.** Name the missing side, and suggest the source to ingest first (`/wiki-ingest`), if the wiki or the user points at one. A synthesis compares what the wiki holds, never what you remember.

Also check whether a synthesis of the same sides exists. If it does, update it instead of writing a second one.

## 2. Read both sides and their sources

Read each side's note and the sources it cites. Every claim in the synthesis has to come from one of them.

## 3. Write it

From `templates/Synthesis.md`, in `syntheses/`, named `<X> vs <Y>`:
- **`sides`:** a link to each note compared, two or more;
- **`description`:** the comparison in one line;
- **The question:** what the comparison is for;
- **Where they agree** and **where they differ:** each point linked to the sources behind it. Use the table for side-by-side attributes;
- **Verdict:** when to prefer which. Say where the sources don't settle it, rather than deciding it yourself.

## 4. Link back

Add the synthesis to each side's **Related** section, and a one-line annotation under Syntheses in `Index.md`.

## 5. Report

Link the synthesis, and say what the sources leave open. Offer a question note (`/wiki-question`) for each gap.
