---
description: "Check the wiki for drift: orphans, unsourced concepts and entities, one-sided syntheses, frontmatter problems, stale open questions, notes Index.md doesn't annotate. Fix what you can, ask about the rest."
---

# Check the wiki

Runs every drift check the vault declares and works through what it finds (CLAUDE.md, "Check the wiki").

## 1. Run the checks

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types .claude/scripts/lint.ts
```

It prints each finding with the notes it names, or `No drift found.` The same checks run at every Stop. This shows them now, whether or not they changed.

## 2. Work through the findings

| Finding | Fix |
|---------|-----|
| Concept or entity cites no source | Find the source it came from and link it. If none in the wiki supports it, say so: the note may need a source ingested (`/wiki-ingest`) or may not belong. |
| Synthesis with fewer than two sides | Add the missing side to `sides`, or, if there is only one, ask whether it belongs in a concept instead. |
| Notes Index.md doesn't annotate | Add a one-line annotation for each to its section of `Index.md`. |
| Frontmatter problems | Fill the field the line names, from the note's template. |
| Orphan notes | Link each from the notes it relates to, and annotate it in `Index.md`. |
| Open questions untouched for 30 days | Ask the user whether each is still open: answer it, drop it (`status: dropped`), or leave it. |

Fix what has one clear fix. Ask about anything that needs the user's judgement: whether a note belongs, which source a claim came from, whether a question still matters.

## 3. Report

Say what you fixed and what is waiting on the user, as links. Run the checks once more to confirm.

Never move, rename or delete a note without asking.
