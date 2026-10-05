# Contributing

This file holds the rules for working on the wiki-mind repo. `.shardmindignore` keeps it out of installed vaults: it is about the repo, not the vault. The root `CLAUDE.md` is the vault's agent manual and ships in every install; its "Developing this shard" section points here.

## Workflow

- Branch and PR for every change. Never push to `main`.
- PR titles use `type: short description`. Types: `feat`, `fix`, `docs`, `chore`, `ci`, `test`, `refactor`.
- One issue per PR, based on `main`. No stacked PRs. The issue's roadmap row is updated in the same PR.
- `ROADMAP.md` is the build order. The `take-next` skill (`.claude/skills/take-next/`) takes the next task from it; run its `selftest.sh` after editing the skill's scripts.

## Hard rules

1. **No agent-session artifacts in anything that lands in the repo.** That covers files, commit messages, PR and issue bodies, and review comments. Never include claude.ai session URLs, `Claude-Session:` trailers, or local absolute paths (`C:\...`, `/Users/...`, `/home/...`). Use repo-relative paths or GitHub URLs. `Co-Authored-By:` trailers are fine.
2. **No commercial reasoning in the repo.** No competitor names, market positioning, naming rationale or launch plans. Design rationale is welcome: say why the design is what it is, not why the project is worth building.
3. **Windows, macOS and Linux are all supported.**
   - Build paths with path APIs, never by joining strings with `/` or `\`. Compare repo-relative paths in POSIX form.
   - Line endings are pinned to LF by `.gitattributes`. Invariant 1 compares bytes, so a CRLF conversion is a contract failure, not a cosmetic diff.
   - CI runs on ubuntu, macOS and Windows. A change is green only when all three are.
4. **Invariant 1: `shardmind install --defaults` equals a plain clone**, apart from ShardMind's own metadata (`.shardmind/` and `shard-values.yaml`). Every file you add is one of: installed byte-identical, a dotfolder `.njk` template, or listed in `.shardmindignore`. Vault-visible files stay static `.md`; personalization goes in hooks.
5. **Repo-only files go in `.shardmindignore`.** If a file is about the GitHub repo (contributor docs, CI helpers, tests of repo-only scripts, media), list it there with a comment saying why.
6. **Don't work around ShardMind.** If the engine can't do something the shard needs, stop and report the gap so it is filed on [breferrari/shardmind](https://github.com/breferrari/shardmind). Do not patch around it in the shard.

## Repo layout

Update this table in the same PR that adds or removes a top-level path.

| Path | What |
|------|------|
| `CLAUDE.md` | The vault's agent manual; ships in every install. |
| `Index.md`, `sources/`, `concepts/`, `entities/`, `syntheses/`, `questions/`, `inbox/`, `templates/`, `bases/` | The vault content (CLAUDE.md, "Vault layout"). |
| `.obsidian/` | Vault config: core plugins, the templates folder, attachments to `inbox/`. |
| `CONTRIBUTING.md` | Rules for working on the repo; repo-only. |
| `SPEC.md` | The shard contract: what installs and why; repo-only. |
| `ROADMAP.md` | Build order: phases mirror GitHub milestones, one issue per row; repo-only. |
| `.claude/skills/take-next/` | The loop that takes the next roadmap task; repo-only. |
| `README.md` | GitHub landing page; also installs into the vault. |
| `LICENSE` | MIT. |
| `.gitattributes` | Pins LF line endings. |
| `.shardmindignore` | Repo-only files that `shardmind install` leaves out. |
| `.shardmind/` | The ShardMind manifest and values schema; never installed. |
| `.gitignore` | Obsidian and hook runtime state. |
| `vault-manifest.json` | Vault metadata the hooks read, including the declared extensions; the hooks' vault-root marker. |
| `.claude/scripts/` | Hook entry points, the extension registry (`core/`) and the vendored obsidian-mind libraries (`lib/`, see `.claude/VENDOR.json`). |
| `.claude/extensions/` | wiki-mind's own hook extensions. |
| `.claude/settings.json` | Wires the hooks. |
| `.claude/skills/` | Obsidian and QMD skills, and the Claude Code mod in `wiki-mind/` (vendored). |
| `.scripts/` | QMD index bootstrap. |
| `.mcp.json` | Registers the QMD MCP server. |

## Zones: keeping the core liftable

The hook layer is built to move into a shared core repo. The move should be three steps: `git mv .claude/scripts/core/`, then swapping `.claude/VENDOR.json`'s source, then deleting the duplicated Stop flow. These rules keep it that way.

1. **Four zones, never mixed.** `tests/zones.test.ts` holds the imports.

   | Zone | Holds | May import |
   |------|-------|------------|
   | `.claude/scripts/lib/` | obsidian-mind's vendored libraries, untouched except for recorded, parameterized modifications | `lib/` only |
   | `.claude/scripts/core/` | the extension registry and its API; lift-ready | `core/` and `lib/` |
   | `.claude/extensions/` | wiki-mind's behaviour | itself and `core/index.ts`, the core's one public entry point |
   | `.claude/scripts/*.ts` | the entry points: thin dispatchers | `lib/` and `core/` |

2. **Every divergence from obsidian-mind is a parameter, never a fork of logic.**
   - Make a vendored string or behaviour configurable, as `modPreface(modName)` does. Don't copy and edit it.
   - Each one gets a change line in `.claude/VENDOR.json` and a seam row in SPEC.md §7.2.
3. **No general-purpose code in an entry point or an extension.**
   - If it would serve another vault, it goes in `core/`, with a comment flagging it as a lift candidate.
   - If an extension needs a helper, the core exports it from `core/index.ts`.
4. **Keep SPEC.md §7.2's API-gap table current.** Update it in the same PR that finds a gap.

## Releasing

Tagging is the maintainer's step. The release workflow (`.github/workflows/release.yml`) refuses a tag that doesn't match the repo, so a bad tag fails loudly instead of publishing.

1. In a PR:
   - rename `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD`, and open a new empty `## [Unreleased]` above it;
   - set `version: X.Y.Z` in `.shardmind/shard.yaml`;
   - set `"version": "X.Y.Z"` in `.claude/skills/wiki-mind/.claude-plugin/plugin.json`.
2. Merge it.
3. Tag the merge commit `vX.Y.Z` on `main`, and push the tag.

The workflow checks that the tag, `shard.yaml` and `plugin.json` agree, and that `CHANGELOG.md` has the version's section. Then it publishes the GitHub release with that section as its notes. `shardmind update` offers the release to installed vaults from then on.

## References


- How a shard is built: ShardMind's [`docs/AUTHORING.md`](https://github.com/breferrari/shardmind/blob/main/docs/AUTHORING.md), [`docs/SHARD-LAYOUT.md`](https://github.com/breferrari/shardmind/blob/main/docs/SHARD-LAYOUT.md) (the binding invariants), [`docs/FORK-TO-SHARD.md`](https://github.com/breferrari/shardmind/blob/main/docs/FORK-TO-SHARD.md).
- Reference shard: [obsidian-mind](https://github.com/breferrari/obsidian-mind). Copy its shape (manifest, CI, contract test), not its content.
