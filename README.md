# wiki-mind

An Obsidian research vault on the LLM-wiki pattern: you bring sources, and an agent reads them and keeps a linked wiki of concepts, entities and comparisons up to date. You steer, read and correct. Every note is plain Markdown that Obsidian opens without the agent.

wiki-mind is a [ShardMind](https://github.com/breferrari/shardmind) shard, built for [Claude Code](https://claude.com/claude-code).

## What you get

| | |
|---|---|
| `sources/` | One note per paper or article: what it says, its key claims, each linked to what it informs. |
| `concepts/` | Atomic ideas, each citing its sources. |
| `entities/` | Named systems, tools and people, each citing its sources. |
| `syntheses/` | Comparisons: "X vs Y" notes over two or more concepts or entities. |
| `questions/` | The intake queue: questions and leads, each `open`, `answered` or `dropped`. |
| `inbox/` | Raw material before it is read: PDFs, saved pages, notes. |
| `Index.md` | The entry point: the agent's one-line annotations above a Bases view of each note type. |
| `templates/`, `bases/` | A template and a Bases view per note type. |
| `CLAUDE.md` | The agent's manual for the vault. |

Claude Code hooks keep the wiki honest as you work. The session starts with the wiki's state and open questions. Each write is checked against the note type's rules. Each answer ends with a short drift report: notes that cite no source, one-sided comparisons, orphans, notes `Index.md` doesn't annotate, stale questions.

## Commands

| Command | Does |
|---------|------|
| `/wiki-ingest <url or inbox path>` | Reads a source in full, writes its note, and updates the concepts and entities it informs, with every claim linked back to it. |
| `/wiki-synthesize <X> vs <Y>` | Compares notes the wiki already has, citing their sources. Refuses when a side has no note yet. |
| `/wiki-question <text>` | Files a question in the intake queue. |
| `/wiki-lint` | Checks the whole wiki for drift and fixes what it can. |

## Install

You need [Obsidian](https://obsidian.md) 1.12 or later, [Node.js](https://nodejs.org) 22.6 or later, and Claude Code.

```sh
mkdir my-wiki && cd my-wiki
npx shardmind install github:breferrari/wiki-mind
```

The installer asks three questions: your name, what the wiki is about, and whether to use QMD search. Then open the folder as a vault in Obsidian, and start Claude Code in it.

**Or clone it.** `git clone https://github.com/breferrari/wiki-mind my-wiki` gives the same vault with the defaults, but no updates.

**Updates.** In a vault installed with ShardMind, `npx shardmind update` brings in a new release and merges it with your edits. A file you changed is never overwritten without asking.

## Search (optional)

With [QMD](https://github.com/tobi/qmd) installed (`npm install -g @tobilu/qmd`), the agent searches the wiki semantically, and the hooks keep the index fresh as notes change. Each vault gets its own index. Without QMD, everything still works, and the agent searches with grep.

## Platforms

Windows, macOS and Linux. CI installs the vault and runs every hook on all three.

## License

[MIT](LICENSE)
