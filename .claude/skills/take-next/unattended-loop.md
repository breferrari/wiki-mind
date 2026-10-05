# take-next: unattended-loop

The reader invoked `/take-next unattended-loop`. That invocation approves the plan of every pass the loop takes. Run `SKILL.md` pass after pass until the queue is dry. **Where this file and `SKILL.md` differ, this file wins.**

## What changes in a pass

- **Step 3 does not wait, and skips plan mode.** Write the plan as usual and post it on the issue, headed "Plan (pre-approved by the reader for this run)". Then build.
- **The four stops stop the item, not the loop.** These are a contradiction with `SPEC.md`, a task that is two tasks, a destructive action outside the branch, or a decline or narrowing of what was asked. Don't build past one. Leave the draft PR open with the question at the top of its body, record the question for the final report, and take the next item. A new dependency or a contract change in `SPEC.md` belongs to the reader, and goes to the report the same way.
- **A wait does not block.** After `gh pr ready`, start the next pass in a new worktree while CI runs. Check the earlier PR's checks a few minutes apart, never in a watch loop.
- **Nothing is released.** Tagging stays with the reader.

## Merging

- **Merge only if the invocation said so.** The loop merges only when the reader's invocation delegates merging for this run. Otherwise it marks each PR ready and reports it.
- **When delegated:** merge a PR when its `CI` run on the **head** is green on all three operating systems. Remove its worktree and local branch in the same step.
- **A red run stops merging.** Fix it before the next pass starts.
- **When `main` moves under an open PR, rebase it.** On a `ROADMAP.md` conflict, keep both sides' rows.

## The queue

1. Take from `next.sh`, in its order.
2. Read the queue again when a pass ends and before calling it dry, because issues get filed while the loop runs.
3. When nothing is eligible, stop and tell the reader.

## Done when

`next.sh` is dry, and every PR of the loop is merged, ready or reported red. Report once, per `SKILL.md` step 9, with the counts: PRs opened, merged, ready and red; items skipped; and the questions waiting on the reader.
