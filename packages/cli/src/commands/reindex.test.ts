import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runReindex } from './reindex.js';
import { silenceOutput, writeKnowledgeFixture } from './test-helpers.js';

describe('runReindex', () => {
  let root: string;
  let restoreOutput: () => void;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-reindex-'));
    restoreOutput = silenceOutput();
  });

  afterEach(() => {
    restoreOutput();
    rmSync(root, { recursive: true, force: true });
  });

  it('indexes both features and aspects from disk', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_rx',
      aspectSlug: 'taxes',
      aspectId: 'asp_checkout_taxes_rx',
      filePath: 'src/checkout.ts',
    });

    await runReindex({ root });

    const db = new Database(join(root, '.domain-memory', 'index.sqlite'));
    const entries = db.prepare('SELECT id, type FROM entries ORDER BY id').all() as Array<{
      id: string;
      type: string;
    }>;
    db.close();

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.type).sort()).toEqual(['aspect', 'feature']);
  });

  it('populates entry_paths and entry_symbols so the matcher can find entries', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_rx2',
      filePath: 'src/billing.ts',
    });

    await runReindex({ root });

    const db = new Database(join(root, '.domain-memory', 'index.sqlite'));
    const paths = db.prepare('SELECT path FROM entry_paths').all() as Array<{
      path: string;
    }>;
    db.close();

    expect(paths.map((p) => p.path)).toContain('src/billing.ts');
  });

  it('tolerates parse errors in individual files and still indexes the good ones', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'good',
      featureId: 'feat_good_rx',
      filePath: 'src/good.ts',
    });

    const badDir = join(root, '.domain-memory', 'knowledge', 'bad');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(
      join(badDir, 'feature.md'),
      '---\nmissing: everything\n---\n\nNot a valid entry.\n',
      'utf-8',
    );

    await runReindex({ root });

    const db = new Database(join(root, '.domain-memory', 'index.sqlite'));
    const entries = db.prepare('SELECT id FROM entries').all() as Array<{ id: string }>;
    db.close();

    expect(entries.map((e) => e.id)).toContain('feat_good_rx');
  });

  it('is a no-op when no knowledge files are present', async () => {
    mkdirSync(join(root, '.domain-memory', 'knowledge'), { recursive: true });
    await runReindex({ root });

    const dbPath = join(root, '.domain-memory', 'index.sqlite');
    if (existsSync(dbPath)) {
      const db = new Database(dbPath);
      const count = db.prepare('SELECT COUNT(*) AS n FROM entries').get() as {
        n: number;
      };
      db.close();
      expect(count.n).toBe(0);
    }
  });

  it('honors --fresh by wiping the existing index before rebuilding', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'x',
      featureId: 'feat_x_rx',
      filePath: 'src/x.ts',
    });
    await runReindex({ root });

    // Insert a sentinel row that should not survive a fresh reindex.
    const dbPath = join(root, '.domain-memory', 'index.sqlite');
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO entries (id, type, slug, name, status, confidence,
        created_at, updated_at, last_verified, file_path, summary)
       VALUES ('ghost', 'feature', 'ghost', 'Ghost', 'active', 80,
        '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
        '2026-01-01T00:00:00Z', 'ghost.md', 'ghost')`,
    ).run();
    db.close();

    await runReindex({ root, fresh: true });

    const db2 = new Database(dbPath);
    const ghost = db2
      .prepare("SELECT id FROM entries WHERE id = 'ghost'")
      .get();
    db2.close();
    expect(ghost).toBeUndefined();
  });
});
