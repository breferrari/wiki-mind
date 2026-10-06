# wiki-mind

This vault is a research wiki. The user brings sources; you read them and keep a linked wiki over them: what each source says, the ideas and named things it is about, and how those compare. The user steers, reads and corrects. Everything is plain Markdown that Obsidian opens without you.

## At session start

The SessionStart hook gives you:
- the wiki's counts per folder;
- the open questions;
- the newest sources;
- the head of `Index.md`.

Read `Index.md` itself before any substantial work: it is the annotated map of the wiki. On a resume or compact, the hook gives pointers instead, so re-read what you need.

## The wiki

Five note types, each with its own folder and template (`templates/`). These are the rules every note follows; the hooks check them as you write.

| Type | Folder | One note per | Frontmatter beyond `date`, `description`, `tags` | Must link to |
|------|--------|--------------|---------------------------------------------------|--------------|
| Source | `sources/` | paper or article | `authors`, `year`, `url` | every concept and entity it informs |
| Concept | `concepts/` | atomic idea | — | at least one source |
| Entity | `entities/` | named system, tool or person | `kind`: `system`, `tool` or `person` | at least one source |
| Synthesis | `syntheses/` | comparison of two or more notes | `sides`: the notes compared | each side, and the sources behind each claim |
| Question | `questions/` | question or lead to pursue | `status`: `open`, `answered` or `dropped` | whatever raised it, when anything did |

- **`inbox/`** holds raw material before it is ingested: PDFs, saved pages, notes. Originals stay there after ingest.
- **`Index.md`** is the entry point: one annotated line per note, in a section per type, above a Bases view that lists every note of the type.

**A concept is atomic.** It never holds a comparison: when two ideas compete or overlap, write a synthesis that links both. A synthesis sits above concepts and never replaces one.

## Workflows

### Ingest a source: `/wiki-ingest <url or inbox path>`

1. Read the source in full: `defuddle` for a web page, or the file in `inbox/` (leave the original in place).
2. Write the `sources/` note from `templates/Source.md`, with what the source says (not what you think of the field), its key claims, and its frontmatter.
3. For each idea and named thing the source informs, update the existing concept or entity note, or create one from its template. Add the claim with a link to the source, and link the source to it.
4. Mark any question the source answers: set `status: answered`, write the answer with its sources, and link it.
5. Add a one-line annotation for each new note to its section of `Index.md`.

Check what exists first: search before creating, so one idea never gets two notes.

### Compare: `/wiki-synthesize <X> vs <Y>`

Write a `syntheses/` note from `templates/Synthesis.md`, with the notes compared in `sides`. Say where they agree and where they differ, and give a verdict on when to prefer which, citing the sources behind each claim. If a side has no note yet, stop and say which source to ingest first.

### File a question: `/wiki-question <text>`

Write a `questions/` note with `status: open`, linked to whatever raised it. When a question stops mattering, set `status: dropped`. Never delete it.

### Check the wiki: `/wiki-lint`

It reports:
- orphans;
- concepts and entities with no source;
- syntheses with fewer than two sides;
- missing frontmatter;
- stale open questions;
- notes `Index.md` doesn't annotate.

Fix what you can, and ask about the rest.

### Answer from the wiki

When the user asks something the wiki covers, answer from the notes and cite them as `[[wikilinks]]`. Where the wiki is silent or thin, say so, and offer a question note or a source to ingest. Don't fill the gap from memory as if the wiki said it.

## Writing rules

- **Use the templates.** A note created from one has every field it needs, and the hooks warn about anything missing.
- **Wikilinks, not Markdown links**, between notes: `[[Note name]]`. Link every claim to the source it came from.
- **Name a note by its title**, with no date prefix: `concepts/Retrieval-augmented generation.md`.
- **One note per thing.** Split a note that grows to hold two ideas. Merge two notes that turn out to be one, keeping the links working.
- **Orphans are bugs.** Every note links to at least one other, and `Index.md` annotates it.
- **Never move, rename or delete notes without asking.** Don't edit `.claude/`, `.scripts/` or the manifests: they are the vault's machinery.

## Search

Use the most capable search available, and stop there:

1. **The QMD MCP tools** (`mcp__qmd__query`, `mcp__qmd__get`, `mcp__qmd__multi_get`, `mcp__qmd__status`). They are already scoped to this vault's index.
2. **The QMD CLI:** `qmd --index <name> query|search|get`. `<name>` is `qmd_index` in `vault-manifest.json` when it is set, and otherwise the vault folder's name as a slug.
3. **Grep and Glob**, only when QMD is not installed.

## Hook feedback

- **A Stop report** comes with the user's next message: a wrap-up checklist, and any drift found (unsourced notes, one-sided syntheses, unannotated notes). Deal with the user's message first. Then act on what bears on the current work, ask about what needs their call, and leave the rest.
- **A routing hint** (a new source, a comparison, a question) suggests the `wiki-` command that fits. Use it when the user's message calls for it.
- **A write warning** after you save a note names what its note type requires and the note lacks. Fix it in the same turn.

## Vault layout

| Path | What |
|------|------|
| `Index.md` | The annotated entry point. |
| `sources/`, `concepts/`, `entities/`, `syntheses/`, `questions/` | The notes, one folder per type. Each has a README. |
| `inbox/` | Raw material before ingest. |
| `templates/` | One template per note type. |
| `bases/` | Bases views over each note type, embedded in `Index.md`. |
| `CLAUDE.md` | This manual. |
| `vault-manifest.json` | Vault metadata the hooks read, including the declared extensions. |
| `.claude/` | The hooks, the extension registry and its wiki extension, the skills, and the Claude Code mod. |
| `.scripts/` | The QMD index bootstrap. |

## Developing this shard

This manual installs into every vault. The rules for changing the shard itself live in [`CONTRIBUTING.md`](CONTRIBUTING.md), which installs keep out. If you are working in the wiki-mind repo rather than in an installed vault, read it before changing anything.

### Zones

The hook layer keeps four zones. Its core is vendored from mindframe, and the other vendored libraries from upstream. The full rules are in [`CONTRIBUTING.md`](CONTRIBUTING.md#zones-keeping-the-core-liftable).

- **`lib/`** is vendored upstream code. `.claude/VENDOR.json` and `.claude/scripts/VENDOR.json` say where each file came from. It changes only by parameterized changes, each recorded as a patch in `vendor-patches/`. A guard stops a direct edit and names the routes.
- **`core/`** is vendored from mindframe and imports only `lib/`.
- **`.claude/extensions/`** imports only `core/index.ts`.
- **The entry points** are thin dispatchers.
- **Divergence:** every divergence from upstream is a parameter with a patch and a seam row in the shard's spec (see CONTRIBUTING.md).
- **General-purpose code** goes in the core, by a change to mindframe, never in an entry point or an extension.
