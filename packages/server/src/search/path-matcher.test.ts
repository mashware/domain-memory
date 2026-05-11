import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../storage/database.js';
import { PathMatcher } from './path-matcher.js';

// Insert a minimal entry directly into the index (bypassing EntryRepository)
// so these tests stay tight on the matcher itself, not the write path.
function insertEntry(
  db: Db,
  id: string,
  paths: Array<{ path: string; is_dir?: boolean }>,
  symbols: string[] = [],
): void {
  db.prepare(
    `INSERT INTO entries (
      id, type, slug, name, feature_id, status, superseded_by,
      confidence, created_at, updated_at, last_verified, file_path, summary
    ) VALUES (
      @id, 'feature', @id, @id, NULL, 'active', NULL,
      80, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00Z', @fp, 'summary'
    )`,
  ).run({ id, fp: `${id}.md` });

  for (const p of paths) {
    db.prepare(
      'INSERT INTO entry_paths (entry_id, path, is_dir, content_hash) VALUES (?, ?, ?, ?)',
    ).run(id, p.path, p.is_dir ? 1 : 0, null);
  }
  for (const s of symbols) {
    db.prepare('INSERT INTO entry_symbols (entry_id, symbol) VALUES (?, ?)').run(
      id,
      s,
    );
  }
}

describe('PathMatcher', () => {
  let root: string;
  let db: Db;
  let matcher: PathMatcher;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-path-'));
    db = openDatabase({ path: join(root, 'idx.sqlite') });
    matcher = new PathMatcher(db);
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns an exact path match with score 1.0 and path_exact reason', () => {
    insertEntry(db, 'feat_a', [{ path: 'src/checkout.ts' }]);

    const hits = matcher.search({
      file_paths: ['src/checkout.ts'],
      symbols: [],
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.score).toBe(1);
    expect(hits[0]!.reasons).toContain('path_exact:src/checkout.ts');
  });

  it('matches by basename when the directory has changed (rename/move resilience)', () => {
    insertEntry(db, 'feat_a', [{ path: 'src/old/Service.ts' }]);

    const hits = matcher.search({
      file_paths: ['src/new/Service.ts'],
      symbols: [],
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.reasons[0]).toMatch(/path_basename/);
    expect(hits[0]!.score).toBeCloseTo(0.65, 5);
  });

  it('matches exact symbols with score 1.0', () => {
    insertEntry(db, 'feat_a', [], ['Acme\\Checkout\\TaxCalculator']);

    const hits = matcher.search({
      file_paths: [],
      symbols: ['Acme\\Checkout\\TaxCalculator'],
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.score).toBe(1);
    expect(hits[0]!.reasons.some((r) => r.startsWith('symbol_exact'))).toBe(true);
  });

  it('matches a symbol by its short name across namespaces (rename resilience)', () => {
    insertEntry(db, 'feat_a', [], ['Acme\\Old\\TaxCalculator']);

    const hits = matcher.search({
      file_paths: [],
      symbols: ['Acme\\New\\TaxCalculator'],
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.reasons.some((r) => r.startsWith('symbol_short'))).toBe(true);
  });

  it('collapses multiple reasons for the same entry without duplicating score', () => {
    insertEntry(
      db,
      'feat_a',
      [{ path: 'src/checkout.ts' }],
      ['Checkout'],
    );

    const hits = matcher.search({
      file_paths: ['src/checkout.ts'],
      symbols: ['Checkout'],
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.score).toBe(1);
    expect(hits[0]!.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('returns an empty list when nothing matches', () => {
    insertEntry(db, 'feat_a', [{ path: 'src/foo.ts' }]);
    const hits = matcher.search({
      file_paths: ['src/bar.ts'],
      symbols: [],
    });
    expect(hits).toEqual([]);
  });
});
