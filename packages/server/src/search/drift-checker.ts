// Per-candidate drift detection. For each entry returned by the searcher
// we read its stored `content_hashes` (populated at save time) and compare
// them against a fresh SHA-256 of the current file on disk. The goal is
// to let the agent skip redundant verification when the memory is still
// aligned — and focus re-verification only on the specific files that
// actually changed.
//
// Design notes:
// - Runs only on the top-N ranked candidates, not on every matcher hit.
//   Hashing is cheap but we still avoid doing it for dropped candidates.
// - Directory entries (`is_dir=1`) are skipped: there is nothing to hash,
//   and a directory "hash" would collapse into a rescan of every file under
//   it — out of scope here. Entries whose paths are all directories end up
//   as `unknown`.
// - Missing `content_hash` rows also count as unknown for that path:
//   nothing to compare against, so we cannot claim drift or freshness.
// - We memoize per-file hashes within a single `check()` call because
//   popular files (e.g. a shared service) often appear in several
//   candidates. Across calls we intentionally do not cache: a stat+hash
//   on small PHP/TS files is in the microsecond range on local disk.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from '../storage/database.js';
import type { CandidateDrift } from '../storage/types.js';

interface StoredPath {
  path: string;
  is_dir: number;
  content_hash: string | null;
}

export interface DriftCheckerLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export class DriftChecker {
  constructor(
    private readonly db: Db,
    private readonly projectRoot: string,
    private readonly logger: DriftCheckerLogger = { warn: () => {} },
  ) {}

  check(entryIds: string[]): Map<string, CandidateDrift> {
    const out = new Map<string, CandidateDrift>();
    if (entryIds.length === 0) return out;

    const rowsByEntry = this.loadStoredPaths(entryIds);
    const hashCache = new Map<string, string | null>();

    for (const id of entryIds) {
      const paths = rowsByEntry.get(id) ?? [];
      out.set(id, this.classify(paths, hashCache));
    }

    return out;
  }

  private loadStoredPaths(entryIds: string[]): Map<string, StoredPath[]> {
    const placeholders = entryIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT entry_id, path, is_dir, content_hash
         FROM entry_paths
         WHERE entry_id IN (${placeholders})`,
      )
      .all(...entryIds) as Array<{
      entry_id: string;
      path: string;
      is_dir: number;
      content_hash: string | null;
    }>;

    const byEntry = new Map<string, StoredPath[]>();
    for (const row of rows) {
      let list = byEntry.get(row.entry_id);
      if (!list) {
        list = [];
        byEntry.set(row.entry_id, list);
      }
      list.push({
        path: row.path,
        is_dir: row.is_dir,
        content_hash: row.content_hash,
      });
    }
    return byEntry;
  }

  private classify(
    paths: StoredPath[],
    hashCache: Map<string, string | null>,
  ): CandidateDrift {
    const drifted: string[] = [];
    const missing: string[] = [];
    let checked = 0;

    for (const p of paths) {
      if (p.is_dir) continue;
      if (!p.content_hash) continue;
      checked += 1;
      const current = this.hashFile(p.path, hashCache);
      if (current === null) {
        missing.push(p.path);
      } else if (current !== p.content_hash) {
        drifted.push(p.path);
      }
    }

    if (checked === 0) {
      return { status: 'unknown', drifted_files: [], missing_files: [] };
    }
    if (drifted.length === 0 && missing.length === 0) {
      return { status: 'fresh', drifted_files: [], missing_files: [] };
    }
    return { status: 'drifted', drifted_files: drifted, missing_files: missing };
  }

  private hashFile(
    relPath: string,
    cache: Map<string, string | null>,
  ): string | null {
    const cached = cache.get(relPath);
    if (cached !== undefined) return cached;

    const full = resolve(this.projectRoot, relPath);
    try {
      const buf = readFileSync(full);
      const hex = createHash('sha256').update(buf).digest('hex');
      const tagged = `sha256:${hex}`;
      cache.set(relPath, tagged);
      return tagged;
    } catch (err) {
      cache.set(relPath, null);
      this.logger.warn('drift_hash_failed', {
        path: relPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
