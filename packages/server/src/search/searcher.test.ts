import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../storage/database.js';
import { EntryRepository } from '../storage/entry-repository.js';
import { resolvePaths, type DomainMemoryPaths } from '../storage/paths.js';
import { Embedder } from '../indexing/embedder.js';
import { VectorIndex } from '../indexing/vector-index.js';
import { Indexer } from '../indexing/indexer.js';
import { SaveKnowledgeFlow } from '../flows/save-knowledge-flow.js';
import { Searcher } from './searcher.js';

class FakeEmbedder extends Embedder {
  override async embed(text: string): Promise<Float32Array> {
    // Deterministic pseudo-embedding: hash the text into the first few slots.
    // Different texts → different vectors; same text → same vector.
    const vec = new Float32Array(384);
    let h = 0;
    for (let i = 0; i < text.length; i += 1) {
      h = (h * 31 + text.charCodeAt(i)) >>> 0;
    }
    vec[0] = (h & 0xff) / 255;
    vec[1] = ((h >> 8) & 0xff) / 255;
    vec[2] = ((h >> 16) & 0xff) / 255;
    return vec;
  }
}

class BrokenEmbedder extends Embedder {
  callCount = 0;

  override async embed(_text: string): Promise<Float32Array> {
    this.callCount += 1;
    // Mirror the real Embedder's contract: flip to 'failed' on first error
    // so the Searcher's status check short-circuits subsequent calls.
    (this as unknown as { _status: string })._status = 'failed';
    (this as unknown as { _failureReason: string })._failureReason =
      'broken on purpose';
    throw new Error('broken on purpose');
  }
}

describe('Searcher', () => {
  let root: string;
  let db: Db;
  let paths: DomainMemoryPaths;
  let searcher: Searcher;
  let flow: SaveKnowledgeFlow;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'dm-search-'));
    paths = resolvePaths(root);
    mkdirSync(paths.base, { recursive: true });
    db = openDatabase({ path: paths.indexDb });

    const entries = new EntryRepository(db, paths);
    const embedder = new FakeEmbedder();
    const vectors = new VectorIndex(db);
    const logger = { warn: () => {} };
    const indexer = new Indexer(embedder, vectors, logger);
    searcher = new Searcher(db, embedder, vectors, logger);

    flow = new SaveKnowledgeFlow({ db, paths, entries, indexer });

    await flow.execute({
      action: 'create',
      entry: {
        type: 'feature',
        slug: 'checkout',
        name: 'Checkout',
        body: {
          what: 'The checkout flow handles purchase, payment and invoicing.',
          where: '- src/checkout.ts',
        },
        file_paths: ['src/checkout.ts'],
        symbols: ['Checkout'],
        tags: ['payments'],
      },
    });
    const feature = await flow.execute({
      action: 'create',
      entry: {
        type: 'feature',
        slug: 'auth',
        name: 'Authentication',
        body: {
          what: 'Authentication manages user login and session tokens.',
          where: '- src/auth.ts',
        },
        file_paths: ['src/auth.ts'],
        symbols: ['AuthService'],
        tags: ['security'],
      },
    });
    if (feature.status !== 'ok') throw new Error('setup failed');

    // Re-index embeddings synchronously for deterministic tests.
    const allEntries = entries.listIndexed();
    for (const row of allEntries) {
      const entry = entries.loadById(row.id);
      await indexer.indexEntry(entry);
    }
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns a ranked result when matching by path exactly', async () => {
    const results = await searcher.search({
      query: 'payment flow',
      context: { file_paths: ['src/checkout.ts'] },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('Checkout');
    expect(results[0]!.match_reasons.some((r) => r.startsWith('path_exact'))).toBe(
      true,
    );
    expect(results[0]!.scores.path).toBe(1);
  });

  it('returns a ranked result when matching by symbol', async () => {
    const results = await searcher.search({
      query: 'unrelated query',
      context: { symbols: ['AuthService'] },
    });

    expect(results[0]!.name).toBe('Authentication');
    expect(
      results[0]!.match_reasons.some((r) => r.startsWith('symbol_exact')),
    ).toBe(true);
  });

  it('finds entries via BM25 keyword match alone', async () => {
    const results = await searcher.search({
      query: 'authentication login',
    });

    const ids = results.map((r) => r.id);
    expect(ids.some((id) => id.startsWith('feat_auth'))).toBe(true);
  });

  it('filters out non-active entries from hydration', async () => {
    const auth = await flow.execute({
      action: 'create',
      entry: {
        type: 'feature',
        slug: 'legacy',
        name: 'Legacy',
        body: { what: 'legacy auth flow (removed)', where: 'nowhere' },
        file_paths: ['src/legacy.ts'],
        symbols: ['LegacyAuth'],
      },
    });
    if (auth.status !== 'ok') throw new Error('setup failed');

    await flow.execute({
      action: 'archive',
      target_id: auth.entry_id,
    });

    const results = await searcher.search({
      query: 'legacy',
      context: { file_paths: ['src/legacy.ts'] },
    });

    const ids = results.map((r) => r.id);
    expect(ids).not.toContain(auth.entry_id);
  });

  it('does not drop aspects that only match by path when the embedding top-N fills up with noise', async () => {
    // Populate enough noise entries to exhaust a small embedding top-N,
    // then verify that an aspect matching only by path still reaches the
    // top of the ranked results. This is the regression the matcherLimit
    // bump addresses.
    for (let i = 0; i < 30; i += 1) {
      await flow.execute({
        action: 'create',
        entry: {
          type: 'feature',
          slug: `noise-${i}`,
          name: `Noise ${i}`,
          body: {
            what: `unrelated feature number ${i}`,
            where: `- src/noise${i}.ts`,
          },
          file_paths: [`src/noise${i}.ts`],
        },
      });
    }

    const feature = await flow.execute({
      action: 'create',
      entry: {
        type: 'feature',
        slug: 'billing',
        name: 'Billing',
        body: { what: 'billing', where: '- src/billing.ts' },
        file_paths: ['src/billing.ts'],
      },
    });
    if (feature.status !== 'ok') throw new Error('setup failed');

    await flow.execute({
      action: 'create',
      entry: {
        type: 'aspect',
        slug: 'invoice',
        name: 'Invoice issuing',
        feature_id: feature.entry_id,
        body: {
          what: 'invoice issuing against external tax service',
          where: '- src/billing.ts',
        },
        file_paths: ['src/billing.ts'],
      },
    });

    // Reindex embeddings so the noise has deterministic vectors too.
    const entries = new EntryRepository(db, paths);
    const embedder = new FakeEmbedder();
    const vectors = new VectorIndex(db);
    const indexer = new Indexer(embedder, vectors, { warn: () => {} });
    for (const row of entries.listIndexed()) {
      await indexer.indexEntry(entries.loadById(row.id));
    }

    const results = await searcher.search({
      query: 'unrelated query',
      context: { file_paths: ['src/billing.ts'] },
      limit: 5,
    });

    const names = results.map((r) => r.name);
    expect(names).toContain('Billing');
    expect(names).toContain('Invoice issuing');
  });

  it('fuses matchers into a combined score with path weighted strongest', async () => {
    const results = await searcher.search({
      query: 'checkout payment',
      context: { file_paths: ['src/checkout.ts'] },
    });

    const checkout = results.find((r) => r.name === 'Checkout');
    expect(checkout).toBeDefined();
    expect(checkout!.scores.path).toBe(1);
    expect(checkout!.scores.combined).toBeGreaterThanOrEqual(0.5);
  });

  it('still returns results when the embedder fails, logging only once', async () => {
    const broken = new BrokenEmbedder();
    const vectors = new VectorIndex(db);
    const warnings: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const logger = {
      warn: (msg: string, meta?: Record<string, unknown>) => {
        warnings.push({ msg, meta });
      },
    };
    const degraded = new Searcher(db, broken, vectors, logger);

    // Three queries against a broken embedder: BM25 + path keep working.
    for (let i = 0; i < 3; i += 1) {
      const results = await degraded.search({
        query: 'authentication login',
      });
      expect(results.length).toBeGreaterThan(0);
    }

    const embedderWarnings = warnings.filter(
      (w) => w.msg === 'embedder_unavailable',
    );
    expect(embedderWarnings).toHaveLength(1);
    expect(embedderWarnings[0]!.meta).toMatchObject({
      error: expect.stringContaining('broken on purpose'),
    });
    // Only the first query actually invokes embed(); subsequent queries
    // short-circuit on the cached failure status.
    expect(broken.callCount).toBe(1);
  });

  it('renormalises weights when the embedder is unavailable', async () => {
    const broken = new BrokenEmbedder();
    // Force the failure status before any search runs.
    (broken as unknown as { _status: string })._status = 'failed';

    const vectors = new VectorIndex(db);
    const logger = { warn: () => {} };
    const degraded = new Searcher(db, broken, vectors, logger);

    // Pure path match: with the embedder offline, weights renormalise from
    // (0.5, 0.3, 0.2) to (0.5/0.7, 0/0.7, 0.2/0.7). A path-only hit should
    // therefore reach combined ≈ 0.5/0.7 ≈ 0.714 instead of 0.5.
    const results = await degraded.search({
      query: 'no keyword overlap whatsoever',
      context: { file_paths: ['src/checkout.ts'] },
    });

    const checkout = results.find((r) => r.name === 'Checkout');
    expect(checkout).toBeDefined();
    expect(checkout!.scores.path).toBe(1);
    expect(checkout!.scores.combined).toBeGreaterThan(0.6);
  });

  it('honours custom weights passed to the constructor', async () => {
    const embedder = new FakeEmbedder();
    const vectors = new VectorIndex(db);
    const logger = { warn: () => {} };

    // With path weight 0 the path matcher contributes nothing — Checkout's
    // score should drop strictly below the default-weighted run.
    const noPath = new Searcher(db, embedder, vectors, logger, undefined, {
      weights: { path: 0, embedding: 0.5, bm25: 0.5 },
    });
    const noPathResults = await noPath.search({
      query: 'checkout payment',
      context: { file_paths: ['src/checkout.ts'] },
    });
    const noPathCheckout = noPathResults.find((r) => r.name === 'Checkout');

    const defaultResults = await searcher.search({
      query: 'checkout payment',
      context: { file_paths: ['src/checkout.ts'] },
    });
    const defaultCheckout = defaultResults.find((r) => r.name === 'Checkout');

    expect(defaultCheckout).toBeDefined();
    if (noPathCheckout) {
      expect(noPathCheckout.scores.combined).toBeLessThan(
        defaultCheckout!.scores.combined,
      );
    }
  });
});
