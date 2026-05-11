// Rebuild the SQLite index and vector store from the markdown files in
// .domain-memory/knowledge/. The markdown is the source of truth; the
// index is derived and can be regenerated at any time. Used after
// manual edits, after a crash, or when bootstrapping a cold clone.

import { existsSync, rmSync } from 'node:fs';
import { relative } from 'node:path';
import {
  createServerContext,
  parseEntry,
  type Entry,
  type ServerContext,
} from '@domain-memory/server';
import { readFileSync } from 'node:fs';
import pc from 'picocolors';

export interface ReindexOptions {
  root: string;
  fresh?: boolean;
}

export async function runReindex(opts: ReindexOptions): Promise<void> {
  if (opts.fresh) {
    // Close nothing: we have not opened the DB yet. Just delete the files.
    const candidates = [
      `${opts.root}/.domain-memory/index.sqlite`,
      `${opts.root}/.domain-memory/index.sqlite-wal`,
      `${opts.root}/.domain-memory/index.sqlite-shm`,
    ];
    for (const f of candidates) {
      if (existsSync(f)) rmSync(f);
    }
    process.stdout.write(pc.dim('fresh: cleared index.sqlite\n'));
  }

  const ctx = createServerContext(opts.root);
  const files = ctx.entries.scanDisk();

  if (files.length === 0) {
    process.stdout.write(
      pc.yellow(`No knowledge files found under ${ctx.paths.knowledge}\n`),
    );
    return;
  }

  const features: Entry[] = [];
  const aspects: Entry[] = [];
  const failed: Array<{ file: string; reason: string }> = [];

  for (const abs of files) {
    try {
      const raw = readFileSync(abs, 'utf-8');
      const entry = parseEntry(raw, abs);
      if (entry.frontmatter.type === 'feature') features.push(entry);
      else aspects.push(entry);
    } catch (err) {
      failed.push({
        file: relative(opts.root, abs),
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  indexInOrder(ctx, features, aspects);

  process.stdout.write(pc.green(`Indexed ${features.length} features and ${aspects.length} aspects.\n`));

  if (failed.length > 0) {
    process.stdout.write(pc.red(`\n${failed.length} file(s) failed to parse:\n`));
    for (const f of failed) {
      process.stdout.write(`  ${pc.red('✗')} ${f.file}\n    ${pc.dim(f.reason)}\n`);
    }
  }

  process.stdout.write(pc.dim('\nComputing embeddings...\n'));
  const allEntries = [...features, ...aspects];
  const { ok, failed: embedFailed } = await ctx.indexer.indexMany(allEntries);
  process.stdout.write(
    pc.green(`Embeddings: ${ok} ok`) +
      (embedFailed > 0 ? pc.red(`, ${embedFailed} failed`) : '') +
      '\n',
  );

  ctx.db.close();
}

function indexInOrder(
  ctx: ServerContext,
  features: Entry[],
  aspects: Entry[],
): void {
  // Two-pass indexing to handle cross-referencing relations safely:
  //
  // 1. Index every feature without relations. This populates the entries
  //    table so every possible relation target exists.
  // 2. Index every feature again with its real relations. The upsert on
  //    entries means the row is rewritten in place, and entry_relations
  //    is cleared on each call so there are no duplicates.
  // 3. Index aspects (which never have relations of their own).

  for (const f of features) {
    const rel = relative(ctx.paths.root, ctx.entries.resolveFilePathFor(f));
    const stripped: Entry = {
      body: f.body,
      frontmatter: { ...f.frontmatter, relations: undefined },
    };
    ctx.entries.indexEntry(stripped, rel);
  }

  for (const f of features) {
    if (!f.frontmatter.relations) continue;
    const rel = relative(ctx.paths.root, ctx.entries.resolveFilePathFor(f));
    ctx.entries.indexEntry(f, rel);
  }

  for (const a of aspects) {
    const rel = relative(ctx.paths.root, ctx.entries.resolveFilePathFor(a));
    ctx.entries.indexEntry(a, rel);
  }
}
