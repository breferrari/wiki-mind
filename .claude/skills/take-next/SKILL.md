---
name: take-next
description: Take the next task from ROADMAP.md and ship it end to end. Use when starting work with no specific task named, or when the user says "take next", "next task", "what's next and do it", or "keep going". Enforces one task per pass, a failing test per behavior, and a recorded trail.
---

# take-next

Take **one** task from `ROADMAP.md` and carry it to a PR that is ready to merge. Never take part of a task, several tasks, or a survey of possible work.

This skill runs the rules in [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) as one pass, against the contract in [`SPEC.md`](../../../SPEC.md). Where this file disagrees with either of them, this file is wrong. Fix it in the pass that finds the disagreement.

It was ported from ShardMind's `take-next` on 2026-10-05, which was ported from vigia's. The mechanism (milestone order, pre-flight, the stops) is theirs. The contract, the checks and the merge rule belong to wiki-mind.

**`unattended-loop`** in the arguments: read [`unattended-loop.md`](unattended-loop.md) first.

> [!IMPORTANT]
> **Run this to the end. Plan approval in step 3 is the one routine stop.**
>
> Step 3 settles **what** gets built, and a question costs nothing there. Everything after step 3 is execution, and this file answers execution questions:
>
> - **The tools are pre-authorized.** Running this skill authorizes `/simplify`, `/two-axis-review`, `/code-review` and the agents they start.
> - **Apply review findings without asking.** Fix each finding that is worth fixing, and list each skipped finding in the PR body with a one-line reason. A finding that would decline or narrow what was asked is stop 4. Do not apply it as a fix.
> - **A documented choice wins.** `SPEC.md` marks its decisions with a date. Take the decision and name it in the report.
> - **An open choice goes to the branch that delivers what was asked.** Finish the pass and put the question in the report.
>
> Four things stop the pass. All four are about *what*:
>
> 1. A finding contradicts `SPEC.md` (step 4).
> 2. The task is really two tasks (step 3).
> 3. An action is destructive outside this branch. A release is one: this skill never tags.
> 4. You conclude that something asked for must be declined or narrowed. Ask in its own message, and wait.
>
> **An unattended session may add. It may not subtract.**
>
> Step 3 is a real stop. Present the plan and wait. If nobody answers, that is not approval.

## 1. Find the task

```sh
sh .claude/skills/take-next/next.sh            # the milestone to take from, then its open issues
sh .claude/skills/take-next/next.sh --ranked   # every eligible milestone in take order
sh .claude/skills/take-next/preflight.sh       # does the record still agree with the tracker
```

`next.sh` picks the earliest eligible milestone:

- **Order is the phase number at the start of the title.** A title without `Phase <n>` sorts last. It does not disappear. A phase inserted before Phase N gets a fractional number (`Phase 1.5 — …`), and its `## Phase 1.5 — …` section must match the milestone title exactly.
- **A milestone with no open issues is skipped.** An empty answer means the work is finished or nothing is filed. Find out which before you act.
- A milestone whose description starts with `Shelf:` is never selected. This repo has no shelf. The rule stays so `next.sh` matches its upstream.

After you edit `next.sh`, `preflight.sh` or these rules, run `sh .claude/skills/take-next/selftest.sh`. When you finish the last issue in a milestone, close the milestone.

Take the **topmost ⬜ row** in that phase's section of `ROADMAP.md`. If a later task blocks it, say so and take the blocker. Then run `preflight.sh <n>`: another session may hold the row.

### Pre-flight

`preflight.sh` reads `SPEC.md`, `ROADMAP.md` and the test files from `origin/main`, never from the working tree. It exits non-zero on any finding. Fix each finding in this pass. First it checks that the whole board arrived. Then it runs these comparisons:

1. Every invariant `SPEC.md` declares (`### Invariant <n>`) is named by a test (a `*.test.*` file), or by the title of an open issue that will add one. A `track` line shows an invariant held only by an issue. That is expected until Phase 2 lands.
2. No issue title names an invariant the spec no longer declares.
3. Each roadmap row's mark agrees with its issue's state, and the issue exists.
4. Each open issue has a milestone. Without one, `next.sh` never sees it.
5. `next.sh`'s answer agrees with the roadmap's section order, and each open milestone with work has a section.
6. Each issue, open or closed, is mentioned in the roadmap.
7. Given an issue number: no worktree, branch or plan comment already names it.

A false positive means the check is wrong. Fix the check; never skip it.

## 2. Load the context

Read, in this order:

1. The issue.
2. The `SPEC.md` sections it cites. For anything about install, update or hooks, also the ShardMind contract `SPEC.md` builds on.
3. The commits that last changed those sections.
4. For vendored code, the upstream file at the commit `.claude/VENDOR.json` records.

If the maintainer's knowledge vault is connected over MCP, search it for:

- the decision you are about to change;
- lessons from obsidian-mind and ShardMind that apply, such as a Windows rename trap;
- context the repo doesn't hold.

Never move strategic context from the vault into the repo (`CONTRIBUTING.md` hard rule 2).

## 3. Plan, and wait for approval

Enter plan mode. Do not write code before a person approves the plan.

The plan holds:

- **What it rests on.** The `SPEC.md` decisions it depends on, by section, and any fact that argues against the approach.
- **Premises.** For each one: what must be true, how it could be false, and the answer with its source (*measured*, *read in the source*, *checked against the world*, *recorded in SPEC.md*, or *assumed*). A premise the plan depends on must not stay *assumed*.
- **A bug is reproduced before it is planned.** Name the failing test, and watch it fail.
- **Adversarial cases.** Windows paths and CRLF always count for this repo. Each case gets a test.
- **Promises you can diff.** The files, the tests by name and what each asserts, every deviation from `SPEC.md` with its reason, and what is out of scope.

**One fresh context must hold the work.** If the work won't fit in one, split the issue into child issues. A split is stop 2: show it in the plan, and file the children after approval.

Before writing code, post the approved plan on the issue as a comment that starts with the word `Plan`. Write each deviation and its reason on the issue at the time you take it.

## 4. Build

- **One issue, one branch, one PR, based on `main`.** No stacked PRs. Work in a worktree, so the main checkout stays on `main`: `git worktree add ../wiki-mind.<n> -b issue-<n>-<slug> origin/main`. Remove it after the merge.
- **Spec first.** If `SPEC.md` is silent or wrong on a decision you need, change it in its own commit before the code.
- **Write the failing test first** for each behaviour and each adversarial case. Watch it fail, then make it pass.
- **Vendored code** changes only as a core patch that `SPEC.md` §7.2 lists. Record each one in `.claude/VENDOR.json` (`modified: true` and a `change` line).
- **Commit in steps.** Use conventional prefixes, and tag the issue in the first commit. Follow `CONTRIBUTING.md` hard rule 1 in every commit message and PR body.
- **Open a draft PR early** (`gh pr create --draft`), so CI runs on every push.
- **No new dependency that `SPEC.md` doesn't name.** Propose it in the spec first.
- **If reality contradicts the spec, stop (stop 1).** Say which one you think is wrong, and wait.
- **Every issue you file gets a milestone and a roadmap row** in the same pass. Fix in-scope findings in this PR.

## 5. Scope the checks

- **Docs-only diff:** CI only.
- **Skill diff:** also `sh .claude/skills/take-next/selftest.sh`.
- **Vendored scripts or hooks diff:** also their typecheck and test suite (`.claude/scripts/`).
- **Manifest or vault content diff:** also `shardmind validate` and the Invariant 1 contract test, once they exist.

Name the scope you chose in the PR body.

## 6. Review and prove

Before the review, diff the result against the plan. Mark each promise delivered or not, and fix any scope that quietly narrowed.

Run each review tool once, in this order, and apply what it finds:

1. `/simplify`.
2. `/two-axis-review` against `origin/main`. The Spec axis compares the diff with the issue, the plan comment and `SPEC.md`.
3. `/code-review high`, for code diffs.
4. **Mutation check**, for each new test that guards a fix. Commit first. Then remove the fix and watch the test fail. Then restore with `git checkout -- <file>` and confirm `git status` is clean.

A docs-only diff runs steps 1 and 2.

## 7. Mark ready

The PR body says:

- what is true now;
- the scope of the checks;
- one line per review tool;
- one line per skipped finding, with its reason;
- a link to the plan comment.

Mark the PR ready once the local checks are green and the plan diff is clean.

**Watch CI by polling, not by watching.** Never run `gh run watch` or a polling loop: the API rate limit is shared. Check `gh pr checks <n>` a few minutes apart, and confirm the run's `headSha` is the PR head. The matrix covers three operating systems, so a failure on Windows alone is still a failure.

**Merging is the maintainer's,** or belongs to whoever the maintainer has delegated it to. Merge yourself only when that delegation covers this run, which an unattended run's does (see `unattended-loop.md`, which also lists the PRs that still go to the reviewer). Then use `gh pr merge <n> --auto --squash`: branch protection holds the merge until the required checks pass, and the repo deletes merged branches. **This skill never tags a release.**

## 8. Close the loop

On the branch, before the PR is ready:

1. **`ROADMAP.md`:** change the row's mark, and add a row for each issue this pass filed.
2. **`SPEC.md`:** if the contract changed, change it in its own commit.

After the merge:

3. **The issue:** close it with the commit, and with test counts where there are tests.
4. **The milestone:** close it if this was its last issue.

## 9. Report

The first line says what a wiki-mind user can do now that they couldn't before, or "nothing yet" plus the issue that will change that. Then cover:

- the issue taken and what shipped;
- the next task, named but not started;
- review: what each tool found, and what you applied or skipped;
- plan diff: every promise delivered, or the deviations;
- decisions taken without asking: one line each, naming the branch taken and the branch not taken.

## Writing

PR bodies, issue comments, commits and the report use plain words. Put the fact first, one paragraph per line. Never put agent-session artifacts or commercial reasoning in any of them (`CONTRIBUTING.md` hard rules 1 and 2).
