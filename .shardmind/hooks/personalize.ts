/**
 * wiki-mind's personalize hook (SPEC.md §6.5).
 *
 * Runs on first install and adopt only, and only when the user gave
 * non-default values: the engine never calls it on an all-defaults install,
 * so a defaults install stays byte-identical to a clone (Invariant 2).
 *
 * It writes the owner and the research focus into Index.md, in place of the
 * `%% wiki-mind:about %%` marker line, once. A blank value is left out, and
 * with both blank nothing is written. Index.md without the marker (the user
 * already edited it) is left alone. Managed files only: the engine warns if
 * this hook creates anything.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MARKER = '%% wiki-mind:about %%';

interface PersonalizeContext {
  slot: 'personalize';
  vaultRoot: string;
  values: Record<string, unknown>;
  modules: Record<string, 'included' | 'excluded'>;
  shard: { name: string; version: string };
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The line that replaces the marker, or null when there is nothing to say. */
export function aboutLine(userName: string, researchFocus: string): string | null {
  const parts = [
    researchFocus === '' ? null : `**Focus:** ${researchFocus}`,
    userName === '' ? null : `**Kept by** ${userName}`,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : `> ${parts.join(' · ')}`;
}

export default async function personalize(ctx: PersonalizeContext): Promise<void> {
  const line = aboutLine(text(ctx.values['user_name']), text(ctx.values['research_focus']));
  if (line === null) return;
  const target = join(ctx.vaultRoot, 'Index.md');
  let original: string;
  try {
    original = await readFile(target, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('wiki-mind: Index.md not present, so nothing to personalize.');
      return;
    }
    throw err;
  }
  const lines = original.split('\n');
  const at = lines.findIndex((l) => l.replace(/\r$/, '') === MARKER);
  if (at === -1) return;
  lines[at] = lines[at]!.endsWith('\r') ? `${line}\r` : line;
  await writeFile(target, lines.join('\n'), 'utf-8');
  console.log('wiki-mind: personalized Index.md');
}
