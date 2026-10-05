# take-next: unattended-loop

The reader invoked `/take-next unattended-loop`. That invocation approves the plan of every pass the loop takes. Run `SKILL.md` pass after pass until the queue is dry. **Where this file and `SKILL.md` differ, this file wins.**

## What changes in a pass

- **Step 3 does not wait, and skips plan mode.** Write the plan as usual and post it on the issue, headed "Plan (pre-approved by the reader for this run)". Then build.
- **The four stops stop the item, not the loop.** These are a contradiction with `SPEC.md`, a task that is two tasks, a destructive action outside the branch, or a decline or narrowing of what was asked. Don't build past one. Leave the draft PR open with the question at the top of its body, record the question for the final report, and take the next item. A new dependency or a contract change in `SPEC.md` belongs to the reader, and goes to the report the same way.
- **A wait does not block.** After `gh pr ready`, start the next pass in a new worktree while CI runs. Check the earlier PR's checks a few minutes apart, never in a watch loop.
- **Nothing is released.** Tagging stays with the reader.

## Merging

Recorded 2026-10-05. The maintainer delegated merges to a reviewer, and the reviewer delegated this much to the loop. It applies only to a `/take-next unattended-loop` invocation. An attended pass marks its PR ready and leaves the merge to the reviewer (`SKILL.md` step 7).

- **The loop merges its own PRs** in Phases 1, 2 and 4, and in Phase 3 except for the issues listed below. Once a PR is ready, run `gh pr ready <n>`, then `gh pr merge <n> --auto --squash`. Branch protection holds the merge until the required checks pass on the PR's head commit: `check (ubuntu-latest)`, `check (macos-latest)` and `check (windows-latest)`. The repo deletes merged branches. To check on a merge, look at `gh pr view <n>` a few minutes apart. Never use `gh run watch` or a polling loop. After the merge, remove the worktree and the local branch.
- **These PRs go to the reviewer first:**
  - any PR that changes `SPEC.md`;
  - #6 (vendoring), because the `VENDOR.json` change lines are the extraction input;
  - #18 (the vault `CLAUDE.md`, the product's voice);
  - #20 (`/wiki-ingest`, the core workflow).

  Mark these ready, but don't enable auto-merge. Tell the reviewer, then take the next item meanwhile.
- **A four-stops question goes to the reviewer,** not the maintainer. Leave the draft PR with the question at the top of its body, tell the reviewer, and continue.
- **The matrix job in `ci.yml` stays named `check`.** Protection requires it by that name, so ask the reviewer before renaming it.
- **A red run stops merging.** Fix it before the next pass starts.
- **When `main` moves under an open PR, rebase it.** On a `ROADMAP.md` conflict, keep both sides' rows.

## The queue

1. Take from `next.sh`, in its order.
2. Read the queue again when a pass ends and before calling it dry, because issues get filed while the loop runs.
3. When nothing is eligible, stop and tell the reader.

## Done when

`next.sh` is dry, and every PR of the loop is merged, ready or reported red. Report once, per `SKILL.md` step 9, with the counts: PRs opened, merged, ready and red; items skipped; and the questions waiting on the reader.
