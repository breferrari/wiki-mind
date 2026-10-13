---
description: "Mark a source retracted or superseded, and update every note that cites it: claims with another current source are marked, claims without one move to Withdrawn claims, syntheses are flagged, answered questions reopen. --undo when a retraction is itself withdrawn."
argument-hint: "<source> [--superseded-by <newer source>] [--notice <url>] [--reason <text>] | <source> --undo"
---

# Retract or supersede a source

Marks the source named in `$ARGUMENTS` retracted or superseded, and updates every note that cites it (AGENTS.md, "Retract or supersede a source"). The user reports a retraction: never infer one.

A source note is the record of what the source said. Its body is never rewritten, and no note is deleted.

## 1. Check the request

- The source has a note in `sources/`. Find it by name (QMD first, see AGENTS.md "Search").
- For a supersession, the newer source has a note too. If it doesn't, stop and say which source to ingest first: the user can run `/wiki-ingest` for it.
- Ask for the notice's URL and a one-line reason if the user didn't give them. Both are optional.

## 2. Preview the pass

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types .claude/extensions/wiki/wiki-retract.ts "<source>" [--superseded-by "<newer>"] [--notice <url>] [--reason "<text>"] [--undo] --dry-run
```

It prints one line per outcome and the notes it would write. Show the user the plan, and go on once they agree.

| Outcome | What the script does |
|---------|----------------------|
| MARKED | Another current source backs the claim. ` (no longer current)` goes after the link. |
| WITHDRAWN | Nothing else backs the claim. The line moves under `## Withdrawn claims`, dated. |
| RESTATE | A superseded source's claim with no other backing. The line is withdrawn, and you restate it (step 4). |
| REOPENED | An answered question rested on the source alone. It goes back to `open`, with a dated line. |
| FLAGGED | A synthesis that rests on the source. It is not edited: its verdict needs review. |
| KEPT | A line that isn't a claim (frontmatter, a heading, another source note), or a case left as it is. |
| UNMATCHED | A mention of the source with no link. Left alone. |
| RESTORED, UNMARKED | `--undo`: a withdrawn claim back in the text, a marker removed. |

## 3. Apply it

Run the same command without `--dry-run`. Each note is written whole, atomically. If a note can't be written (read-only, or locked by another program), the script stops and names what it wrote and what it didn't. Say so, and once the user has freed the note, run the command again: it finishes the job and touches nothing twice.

## 4. Restate, for a supersession

For each RESTATE line, read the newer source and write its claim at that place in the note, as one line linked to the newer source. Work through a note's RESTATE lines from the bottom up: each line number holds only while nothing above it has been inserted. If the newer source doesn't make the claim, leave the line withdrawn. Never write a claim the newer source doesn't support.

## 5. Report

Run `/wiki-lint`. Then report the script's lines, with RESTATE lines reported as RESTATED or left withdrawn, as links. For each FLAGGED synthesis and REOPENED question, say what needs the user's judgement.
