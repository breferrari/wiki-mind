# Contributing

This file holds the rules for working on the wiki-mind repo. `.shardmindignore` keeps it out of installed vaults: it is about the repo, not the vault. The root `CLAUDE.md` is the vault's agent manual and ships in every install; its "Developing this shard" section points here.

## Workflow

- Branch and PR for every change. Never push to `main`.
- PR titles use `type: short description`. Types: `feat`, `fix`, `docs`, `chore`, `ci`, `test`, `refactor`.
- One issue per PR. The issue's roadmap row is updated in the same PR.

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

## References

- How a shard is built: ShardMind's [`docs/AUTHORING.md`](https://github.com/breferrari/shardmind/blob/main/docs/AUTHORING.md), [`docs/SHARD-LAYOUT.md`](https://github.com/breferrari/shardmind/blob/main/docs/SHARD-LAYOUT.md) (the binding invariants), [`docs/FORK-TO-SHARD.md`](https://github.com/breferrari/shardmind/blob/main/docs/FORK-TO-SHARD.md).
- Reference shard: [obsidian-mind](https://github.com/breferrari/obsidian-mind). Copy its shape (manifest, CI, contract test), not its content.
