# wiki-mind Roadmap

> Living document. The phases below are the build order. Each row links its issue, and the tracker holds each issue's state. A fresh session takes the next task with the `take-next` skill, which needs no context from earlier conversations.
>
> Contract: [`SPEC.md`](SPEC.md) | Rules: [`CONTRIBUTING.md`](CONTRIBUTING.md) | Loop: [`.claude/skills/take-next/SKILL.md`](.claude/skills/take-next/SKILL.md)

## How work is taken

- **Order is the phase number at the start of a milestone title.** `sh .claude/skills/take-next/next.sh` names the milestone to take from, and the topmost ⬜ row of its section here is the task.
- **Each phase has a section whose heading matches its milestone title exactly,** and a table whose marks follow the tracker: ✅ closed, ⬜ open, 🔨 in progress.
- **`sh .claude/skills/take-next/preflight.sh` checks the record against itself.** Every invariant in `SPEC.md` is held by a test, or tracked by an open issue that names it. Every roadmap mark agrees with its issue. Every open issue has a milestone. Every issue is mentioned here.
- **An issue filed mid-pass gets a milestone and a row in the same pass.** Out-of-scope work gets a row in the phase it belongs to, or in a new phase after the last one.
- **One issue, one PR,** based on `main`. No stacked PRs.

---

## Phase 1 — machinery in place

Milestone: [Phase 1](https://github.com/breferrari/wiki-mind/milestone/1)

obsidian-mind's generic libraries arrive as a vendored copy with `.claude/VENDOR.json` (SPEC.md §7.1). wiki-mind then writes its own entry points over an extension registry (§7.4), and vendors the mod under its own name. The two CI fixes came first, because the session-artifact grep would have failed on vendored regex source.

| | Task | Issue |
|---|---|---|
| ✅ | ci: give the PR-title job its own name | [#4](https://github.com/breferrari/wiki-mind/issues/4) |
| ✅ | ci: tighten the session-artifact path pattern before vendored code lands | [#5](https://github.com/breferrari/wiki-mind/issues/5) |
| ✅ | Vendor obsidian-mind's generic libraries at c65062d with .claude/VENDOR.json | [#6](https://github.com/breferrari/wiki-mind/issues/6) |
| ✅ | Write wiki-mind's entry points over an extension registry | [#35](https://github.com/breferrari/wiki-mind/issues/35) |
| ✅ | Vendor the Claude Code mod as wiki-mind (P1) | [#7](https://github.com/breferrari/wiki-mind/issues/7) |
| ✅ | Empty obsidian-mind's prompt signal set (P2). Closed as not needed: the #6 rescope vendors no signal set | [#8](https://github.com/breferrari/wiki-mind/issues/8) |
| ⬜ | Remove the in-repo take-next once the global skill lands. Blocked: waits for the reviewer's word that the global skill has landed; skip it until then | [#31](https://github.com/breferrari/wiki-mind/issues/31) |

## Phase 2 — the shard installs

Milestone: [Phase 2](https://github.com/breferrari/wiki-mind/milestone/2)

`shardmind install github:breferrari/wiki-mind` works, and CI holds each invariant in SPEC.md §8 on ubuntu, macOS and Windows. The manifest lands first, so `shardmind validate` stops skipping.

| | Task | Issue |
|---|---|---|
| ✅ | Add the ShardMind manifest and values schema, with a test holding Invariant 3 | [#9](https://github.com/breferrari/wiki-mind/issues/9) |
| ✅ | Add vault-manifest.json with wiki-mind's config keys | [#10](https://github.com/breferrari/wiki-mind/issues/10) |
| ✅ | Organize for the core lift: four zones and core's public entry point | [#44](https://github.com/breferrari/wiki-mind/issues/44) |
| ✅ | Load only the extensions declared for the current hook event | [#46](https://github.com/breferrari/wiki-mind/issues/46) |
| ✅ | Keep test files out of installed vaults | [#40](https://github.com/breferrari/wiki-mind/issues/40) |
| ✅ | No obsidian-mind in anything user- or model-facing | [#41](https://github.com/breferrari/wiki-mind/issues/41) |
| ✅ | Contract test for Invariant 1 and Invariant 2: install --defaults equals a clone | [#11](https://github.com/breferrari/wiki-mind/issues/11) |
| ✅ | bootstrap hook builds the QMD index, with a test holding Invariant 4 | [#12](https://github.com/breferrari/wiki-mind/issues/12) |
| ✅ | QMD session-start work for wiki-mind sessions (S5) | [#42](https://github.com/breferrari/wiki-mind/issues/42) |
| ⬜ | Re-vendor lib/session-start.ts when obsidian-mind 9.1.0 fixes applyInjectionBudget. Blocked until 9.1.0 is released | [#53](https://github.com/breferrari/wiki-mind/issues/53) |

## Phase 3 — the wiki

Milestone: [Phase 3](https://github.com/breferrari/wiki-mind/milestone/3)

The ontology from SPEC.md §2 becomes a vault: folders, templates, Bases views, `Index.md`, the personalize hook, the vault manual, and the four `wiki-` commands. The commands come last, because they write against the templates and `Index.md`.

| | Task | Issue |
|---|---|---|
| ✅ | Add the wiki folders, inbox/ and Obsidian config | [#13](https://github.com/breferrari/wiki-mind/issues/13) |
| ⬜ | Add the five note templates with their frontmatter | [#14](https://github.com/breferrari/wiki-mind/issues/14) |
| ⬜ | Add Bases views over the five note types | [#15](https://github.com/breferrari/wiki-mind/issues/15) |
| ⬜ | Add Index.md, the annotated entry point | [#16](https://github.com/breferrari/wiki-mind/issues/16) |
| ⬜ | personalize hook writes user_name and research_focus into Index.md | [#17](https://github.com/breferrari/wiki-mind/issues/17) |
| ⬜ | Write the vault CLAUDE.md manual | [#18](https://github.com/breferrari/wiki-mind/issues/18) |
| ⬜ | Add /wiki-question | [#19](https://github.com/breferrari/wiki-mind/issues/19) |
| ⬜ | Add /wiki-ingest | [#20](https://github.com/breferrari/wiki-mind/issues/20) |
| ⬜ | Add /wiki-synthesize | [#21](https://github.com/breferrari/wiki-mind/issues/21) |
| ⬜ | Add /wiki-lint | [#22](https://github.com/breferrari/wiki-mind/issues/22) |
| ⬜ | Test bed: run every hook and the mod in real Claude Code sessions | [#36](https://github.com/breferrari/wiki-mind/issues/36) |

## Phase 4 — first release

Milestone: [Phase 4](https://github.com/breferrari/wiki-mind/milestone/4)

Everything a first tag needs except the tag itself, which is the maintainer's.

| | Task | Issue |
|---|---|---|
| ⬜ | Add the release workflow and CHANGELOG.md | [#23](https://github.com/breferrari/wiki-mind/issues/23) |
| ⬜ | Write the README's install, update and usage sections | [#24](https://github.com/breferrari/wiki-mind/issues/24) |
| ⬜ | Contract test on fork PRs: resolve or skip with a notice | [#51](https://github.com/breferrari/wiki-mind/issues/51) |

## Phase 5 — after the first release

Milestone: [Phase 5](https://github.com/breferrari/wiki-mind/milestone/5)

Work SPEC.md schedules for after v0.1 (its Later section), so it is planned, not dropped.

| | Task | Issue |
|---|---|---|
| ⬜ | Codex and Gemini as removable modules | [#25](https://github.com/breferrari/wiki-mind/issues/25) |
| ⬜ | Spec corrections for a retracted or superseded source | [#26](https://github.com/breferrari/wiki-mind/issues/26) |
| ⬜ | wrap-up and tidy through the extraction | [#27](https://github.com/breferrari/wiki-mind/issues/27) |
| ⬜ | Diagram skill for syntheses (mermaid) | [#33](https://github.com/breferrari/wiki-mind/issues/33) |
