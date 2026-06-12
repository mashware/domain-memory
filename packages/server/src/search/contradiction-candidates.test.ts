import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../storage/database.js';
import { resolvePaths } from '../storage/paths.js';
import { VectorIndex } from '../indexing/vector-index.js';
import { EMBEDDING_DIM } from '../indexing/embedder.js';
import { findContradictionCandidates } from './contradiction-candidates.js';

// Builds an L2-normalized 384-dim vector from a sparse {dim: weight} map, so
// the cosine math in the detector (cos = 1 - d^2/2) holds.
function unit(dims: Record<number, number>): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  for (const [i, val] of Object.entries(dims)) v[Number(i)] = val;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i += 1) v[i] /= norm;
  return v;
}

interface SeedEntry {
  id: string;
  name: string;
  type?: 'feature' | 'aspect';
  featureId?: string | null;
}

describe('findContradictionCandidates', () => {
  let root: string;
  let db: Db;
  let vectors: VectorIndex;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-contradiction-'));
    const paths = resolvePaths(root);
    mkdirSync(paths.base, { recursive: true });
    db = openDatabase({ path: paths.indexDb });
    vectors = new VectorIndex(db);
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  function seed(entry: SeedEntry, embedding?: Float32Array): void {
    db.prepare(
      `INSERT INTO entries
        (id, type, slug, name, feature_id, status, confidence,
         created_at, updated_at, last_verified, file_path, summary)
       VALUES (?, ?, ?, ?, ?, 'active', 80,
         '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
         ?, ?)`,
    ).run(
      entry.id,
      entry.type ?? 'feature',
      entry.id,
      entry.name,
      entry.featureId ?? null,
      `${entry.id}.md`,
      entry.name,
    );
    if (embedding) vectors.upsert(entry.id, embedding);
  }

  it('flags two highly similar entries from different features', () => {
    seed({ id: 'a', name: 'VAT charged to clients' }, unit({ 0: 1 }));
    seed({ id: 'b', name: 'VAT absorbed by us' }, unit({ 0: 1, 1: 0.05 }));

    const result = findContradictionCandidates(db, vectors);

    expect(result.signal).toBe('embedding');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.similarity).toBeGreaterThan(0.85);
    expect(result.candidates[0]!.sameFeature).toBe(false);
  });

  it('does not flag unrelated entries', () => {
    seed({ id: 'a', name: 'VAT policy' }, unit({ 0: 1 }));
    seed({ id: 'b', name: 'Webhook retries' }, unit({ 50: 1 }));

    const result = findContradictionCandidates(db, vectors);
    expect(result.candidates).toHaveLength(0);
  });

  it('reports a pair only once even though both ends find each other', () => {
    seed({ id: 'a', name: 'Rule A' }, unit({ 0: 1 }));
    seed({ id: 'b', name: 'Rule B' }, unit({ 0: 1, 1: 0.05 }));

    const result = findContradictionCandidates(db, vectors);
    expect(result.candidates).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('excludes a feature and its own aspect (expected overlap)', () => {
    seed({ id: 'feat', name: 'Billing', type: 'feature' }, unit({ 0: 1 }));
    seed(
      { id: 'asp', name: 'Billing taxes', type: 'aspect', featureId: 'feat' },
      unit({ 0: 1, 1: 0.05 }),
    );

    const result = findContradictionCandidates(db, vectors);
    expect(result.candidates).toHaveLength(0);
  });

  it('flags two aspects of the same feature and marks sameFeature', () => {
    seed({ id: 'feat', name: 'Billing', type: 'feature' }, unit({ 30: 1 }));
    seed(
      { id: 'asp1', name: 'Taxes EU', type: 'aspect', featureId: 'feat' },
      unit({ 0: 1 }),
    );
    seed(
      { id: 'asp2', name: 'Taxes US', type: 'aspect', featureId: 'feat' },
      unit({ 0: 1, 1: 0.05 }),
    );

    const result = findContradictionCandidates(db, vectors);
    const pair = result.candidates.find(
      (c) =>
        (c.a.id === 'asp1' && c.b.id === 'asp2') ||
        (c.a.id === 'asp2' && c.b.id === 'asp1'),
    );
    expect(pair).toBeDefined();
    expect(pair!.sameFeature).toBe(true);
  });

  it('returns nothing when there are fewer than two active entries', () => {
    seed({ id: 'a', name: 'Lonely' }, unit({ 0: 1 }));
    const result = findContradictionCandidates(db, vectors);
    expect(result).toEqual({ candidates: [], total: 0, signal: 'none' });
  });

  it('degrades quietly to no signal when the index has no embeddings', () => {
    // Two entries, but no vectors upserted (e.g. indexed while the embedder
    // was down). The check offers nothing rather than guessing.
    seed({ id: 'a', name: 'billing vat policy' });
    seed({ id: 'b', name: 'billing vat policy' });

    const result = findContradictionCandidates(db, vectors);
    expect(result).toEqual({ candidates: [], total: 0, signal: 'none' });
  });
});
