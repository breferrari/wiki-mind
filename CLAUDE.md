# wiki-mind

wiki-mind is a [ShardMind](https://github.com/breferrari/shardmind) shard: an Obsidian research vault on the LLM-wiki pattern. A user drops in sources; an agent reads them and maintains a linked wiki of concepts, entities and comparisons. Users install it with `shardmind install github:breferrari/wiki-mind`, and a plain `git clone` of this repo must open as the same vault.

## Status

Bootstrapping. The repo holds no vault content yet. Work goes in this order, and the maintainer reviews each step before the next starts:

1. Repo rules (this file), `LICENSE`, `README.md`.
2. `SPEC.md`: the shard surface (folders, templates, modules, values, static vs templated files, Claude-side machinery) against the ontology below.
3. CI: `shardmind validate` and the Invariant 1 contract test on ubuntu, macOS and Windows.
4. `ROADMAP.md` (phases mirror GitHub milestones, one issue per row, one PR per issue) and the `take-next` loop.

Do not write vault content before `SPEC.md` is ratified.

## Ontology (proposed; ratified in SPEC.md)

| Folder | Holds |
|--------|-------|
| `sources/` | One note per paper or article. |
| `concepts/` | Atomic ideas. |
| `entities/` | Named systems, tools, people. |
| `syntheses/` | "X vs Y" comparison notes that sit above concepts. |
| `open_questions/` | The intake queue. |
| `Index.md` | Annotated entry point to the wiki. |

Each folder gets one Obsidian template.

## Layout

Update this table in the same PR that adds or removes a top-level path.

| Path | What |
|------|------|
| `CLAUDE.md` | The vault's agent manual; ships in every install. |
| `CONTRIBUTING.md` | Rules for working on the repo; repo-only. |
| `SPEC.md` | The shard contract: what installs and why; repo-only. |
| `README.md` | GitHub landing page; also installs into the vault. |
| `LICENSE` | MIT. |
| `.gitattributes` | Pins LF line endings. |
| `.shardmindignore` | Repo-only files that `shardmind install` leaves out. |

## Developing this shard

This file is the vault's agent manual: it installs into every vault, and the vault manual will grow around this section. The rules for changing the shard itself live in [`CONTRIBUTING.md`](CONTRIBUTING.md), which `.shardmindignore` keeps out of installs. If you are working in the wiki-mind repo rather than in an installed vault, read `CONTRIBUTING.md` before changing anything.

Until the vault manual exists, the hard rules are repeated here.

### Hard rules

1. **No agent-session artifacts in anything that lands in the repo.** That covers files, commit messages, PR and issue bodies, and review comments. Never include claude.ai session URLs, `Claude-Session:` trailers, or local absolute paths (`C:\...`, `/Users/...`, `/home/...`). Use repo-relative paths or GitHub URLs. `Co-Authored-By:` trailers are fine.
2. **No commercial reasoning in the repo.** No competitor names, market positioning, naming rationale or launch plans. Design rationale is welcome: say why the design is what it is, not why the project is worth building.
3. **Branch and PR for every change.** Never push to `main`. PR titles use `type: short description` (`feat`, `fix`, `docs`, `chore`, `ci`, `test`, `refactor`).
4. **Windows, macOS and Linux are all supported.**
   - Build paths with path APIs, never by joining strings with `/` or `\`. Compare repo-relative paths in POSIX form.
   - Line endings are pinned to LF by `.gitattributes`. Invariant 1 compares bytes, so a CRLF conversion is a contract failure, not a cosmetic diff.
   - CI runs on ubuntu, macOS and Windows. A change is green only when all three are.
5. **Invariant 1: `shardmind install --defaults` equals a plain clone**, apart from ShardMind's own metadata (`.shardmind/` and `shard-values.yaml`). Every file you add is one of: installed byte-identical, a dotfolder `.njk` template, or listed in `.shardmindignore`. Vault-visible files stay static `.md`; personalization goes in hooks.
6. **Repo-only files go in `.shardmindignore`.** If a file is about the GitHub repo (contributor docs, CI helpers, tests of repo-only scripts, media), list it there with a comment saying why.
7. **Don't work around ShardMind.** If the engine can't do something the shard needs, stop and report the gap so it is filed on [breferrari/shardmind](https://github.com/breferrari/shardmind). Do not patch around it in the shard.

### References

- How a shard is built: ShardMind's [`docs/AUTHORING.md`](https://github.com/breferrari/shardmind/blob/main/docs/AUTHORING.md), [`docs/SHARD-LAYOUT.md`](https://github.com/breferrari/shardmind/blob/main/docs/SHARD-LAYOUT.md) (the binding invariants), [`docs/FORK-TO-SHARD.md`](https://github.com/breferrari/shardmind/blob/main/docs/FORK-TO-SHARD.md).
- Reference shard: [obsidian-mind](https://github.com/breferrari/obsidian-mind). Copy its shape (manifest, CI, contract test), not its content.
