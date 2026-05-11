// CLI wrapper over the drift detection logic. Pass a list of file paths
// (or pipe a git diff) and the command prints the knowledge entries that
// reference any of those files. Intended for git hooks and CI jobs that
// want to surface stale knowledge alongside code review.

import { basename } from 'node:path';
import pc from 'picocolors';
import { createServerContext } from '@mashware/domain-memory-server';

export interface CheckDriftOptions {
  root: string;
  files: string[];
  json?: boolean;
}

interface AffectedEntry {
  id: string;
  name: string;
  feature_name: string | null;
  matched_paths: string[];
  last_verified: string;
  confidence: number;
  content_path: string;
}

export async function runCheckDrift(opts: CheckDriftOptions): Promise<number> {
  if (opts.files.length === 0) {
    process.stderr.write(pc.red('No files provided. Use --files or pipe via stdin.\n'));
    return 1;
  }

  const ctx = createServerContext(opts.root);

  const byEntry = new Map<string, Set<string>>();
  const exactStmt = ctx.db.prepare<[string]>(
    'SELECT entry_id FROM entry_paths WHERE path = ?',
  );
  const basenameStmt = ctx.db.prepare<[string]>(
    "SELECT entry_id FROM entry_paths WHERE path LIKE ? AND is_dir = 0",
  );
  const dirStmt = ctx.db.prepare<[string, string]>(
    'SELECT entry_id FROM entry_paths WHERE is_dir = 1 AND ? LIKE path || ?',
  );

  for (const p of opts.files) {
    for (const row of exactStmt.all(p) as Array<{ entry_id: string }>) {
      bump(byEntry, row.entry_id, p);
    }
    const name = basename(p);
    if (name) {
      for (const row of basenameStmt.all(`%/${name}`) as Array<{
        entry_id: string;
      }>) {
        bump(byEntry, row.entry_id, p);
      }
    }
    for (const row of dirStmt.all(p, '%') as Array<{ entry_id: string }>) {
      bump(byEntry, row.entry_id, p);
    }
  }

  if (byEntry.size === 0) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ affected_entries: [] }) + '\n');
    } else {
      process.stdout.write(pc.dim('No entries reference the given files.\n'));
    }
    ctx.db.close();
    return 0;
  }

  const ids = Array.from(byEntry.keys());
  const placeholders = ids.map(() => '?').join(',');
  const rows = ctx.db
    .prepare(
      `SELECT e.id, e.name, e.last_verified, e.confidence, e.file_path AS content_path,
              f.name AS feature_name
       FROM entries e
       LEFT JOIN entries f ON f.id = e.feature_id
       WHERE e.id IN (${placeholders}) AND e.status = 'active'`,
    )
    .all(...ids) as Array<{
    id: string;
    name: string;
    last_verified: string;
    confidence: number;
    content_path: string;
    feature_name: string | null;
  }>;

  const affected: AffectedEntry[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    feature_name: r.feature_name,
    matched_paths: Array.from(byEntry.get(r.id) ?? []),
    last_verified: r.last_verified,
    confidence: r.confidence,
    content_path: r.content_path,
  }));

  if (opts.json) {
    process.stdout.write(JSON.stringify({ affected_entries: affected }, null, 2) + '\n');
    ctx.db.close();
    return 0;
  }

  process.stdout.write(
    pc.yellow(`${affected.length} entries reference the given files:\n\n`),
  );
  for (const entry of affected) {
    const label = entry.feature_name
      ? `${entry.feature_name} / ${entry.name}`
      : entry.name;
    process.stdout.write(`  ${pc.cyan(label)} ${pc.dim(`(${entry.id})`)}\n`);
    process.stdout.write(
      `    ${pc.dim(`verified: ${entry.last_verified}   confidence: ${entry.confidence}`)}\n`,
    );
    for (const p of entry.matched_paths) {
      process.stdout.write(`    · ${p}\n`);
    }
    process.stdout.write(`    ${pc.dim(entry.content_path)}\n\n`);
  }

  process.stdout.write(
    pc.dim('Review each entry and update or archive it if this PR makes it stale.\n'),
  );

  ctx.db.close();
  return 0;
}

function bump(map: Map<string, Set<string>>, entryId: string, path: string): void {
  const existing = map.get(entryId);
  if (existing) {
    existing.add(path);
  } else {
    map.set(entryId, new Set([path]));
  }
}

export async function readStdinLines(): Promise<string[]> {
  if (process.stdin.isTTY) return [];
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}
