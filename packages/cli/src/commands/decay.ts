// Persists the lazy confidence decay into the stored confidence value.
// Walks every indexed entry, computes its effective confidence, and if
// it has decayed writes the new value back to the markdown frontmatter
// and reindexes it. Without --write the command runs as a dry run and
// only prints what would change.
//
// This is a maintenance operation. The normal read path (Searcher,
// check_drift, web viewer) already surfaces the effective confidence
// at read time via effectiveConfidence(). decay --write is useful when
// you want the on-disk source of truth to reflect reality — for
// example before committing the knowledge to git.

import pc from 'picocolors';
import {
  createServerContext,
  effectiveConfidence,
  type Entry,
} from '@mashware/domain-memory-server';

export interface DecayOptions {
  root: string;
  write: boolean;
}

interface PendingChange {
  id: string;
  name: string;
  from: number;
  to: number;
  entry: Entry;
}

export async function runDecay(opts: DecayOptions): Promise<number> {
  const ctx = createServerContext(opts.root);
  const indexed = ctx.entries.listIndexed();

  const changes: PendingChange[] = [];
  for (const row of indexed) {
    let entry: Entry;
    try {
      entry = ctx.entries.loadById(row.id);
    } catch {
      continue;
    }
    const stored = entry.frontmatter.confidence;
    const effective = effectiveConfidence(stored, entry.frontmatter.last_verified);
    if (effective < stored) {
      changes.push({
        id: row.id,
        name: entry.frontmatter.name,
        from: stored,
        to: effective,
        entry,
      });
    }
  }

  if (changes.length === 0) {
    process.stdout.write(pc.dim('No entries need decay adjustments.\n'));
    ctx.db.close();
    return 0;
  }

  process.stdout.write(
    pc.bold(`${changes.length} entries with decayed confidence:\n\n`),
  );
  for (const c of changes) {
    process.stdout.write(
      `  ${pc.cyan(c.name)} ${pc.dim(`(${c.id})`)}  ${c.from} → ${c.to}\n`,
    );
  }

  if (!opts.write) {
    process.stdout.write(
      '\n' +
        pc.dim(
          'Dry run. Re-run with --write to persist these changes on disk.\n',
        ),
    );
    ctx.db.close();
    return 0;
  }

  const now = new Date().toISOString();
  let written = 0;
  for (const change of changes) {
    change.entry.frontmatter.confidence = change.to;
    change.entry.frontmatter.updated_at = now;
    try {
      ctx.entries.save(change.entry);
      written += 1;
    } catch (err) {
      process.stderr.write(
        pc.red(
          `  ✗ failed to write ${change.id}: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        ),
      );
    }
  }

  process.stdout.write('\n' + pc.green(`Persisted ${written}/${changes.length} decays.\n`));
  ctx.db.close();
  return written === changes.length ? 0 : 1;
}
