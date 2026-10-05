---
description: "File a question or lead in questions/ with status open, linked to whatever raised it."
argument-hint: "<the question>"
---

# File a question

Files `$ARGUMENTS` as a note in `questions/`: the wiki's intake queue (SPEC.md §2).

## Steps

1. **Check it isn't already filed.** Search `questions/` (QMD first, see CLAUDE.md "Search") for a question that asks the same thing. If one exists, say so and link it instead. If it was `dropped` and the user still wants it, set it back to `open`.
2. **Name it** as the question itself, short enough for a file name, with no date prefix: `questions/Why does retrieval degrade on long documents.md`.
3. **Write it** from `templates/Question.md`:
   - `status: open`;
   - `description`: the question in one line;
   - **Why it matters:** what answering it would change;
   - **Raised by:** link the note, source or conversation that raised it, when anything did;
   - **Leads:** sources to ingest or notes to read that might answer it, if you know any.
4. **Annotate it in `Index.md`** under Questions, one line.
5. **Say what you filed**, with its link.

Don't answer the question here. If the wiki already answers it, say so and link the notes instead of filing it.
