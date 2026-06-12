import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../storage/database.js';
import { resolvePaths } from '../storage/paths.js';
import { VectorIndex } from './vector-index.js';
import { EMBEDDING_DIM } from './embedder.js';

describe('VectorIndex.getEmbedding', () => {
  let root: string;
  let db: Db;
  let vectors: VectorIndex;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-vec-'));
    const paths = resolvePaths(root);
    mkdirSync(paths.base, { recursive: true });
    db = openDatabase({ path: paths.indexDb });
    vectors = new VectorIndex(db);
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips a stored embedding', () => {
    const vec = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i += 1) vec[i] = (i % 7) / 10;

    vectors.upsert('entry-1', vec);
    const got = vectors.getEmbedding('entry-1');

    expect(got).not.toBeNull();
    expect(got!.length).toBe(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i += 1) {
      expect(got![i]).toBeCloseTo(vec[i]!, 5);
    }
  });

  it('returns null for an entry with no stored vector', () => {
    expect(vectors.getEmbedding('missing')).toBeNull();
  });
});
