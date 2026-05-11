import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SaveKnowledgeFlow } from './save-knowledge-flow.js';
import { openDatabase, type Db } from '../storage/database.js';
import { EntryRepository } from '../storage/entry-repository.js';
import { resolvePaths, type DomainMemoryPaths } from '../storage/paths.js';
import { Indexer } from '../indexing/indexer.js';
import { Embedder } from '../indexing/embedder.js';
import { VectorIndex } from '../indexing/vector-index.js';

// The indexer embed step is async and requires downloading a model; stub it
// with a fake embedder so tests stay fast and offline.
class FakeEmbedder extends Embedder {
  override async embed(_text: string): Promise<Float32Array> {
    return new Float32Array(384);
  }
}

describe('SaveKnowledgeFlow', () => {
  let root: string;
  let db: Db;
  let paths: DomainMemoryPaths;
  let flow: SaveKnowledgeFlow;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-save-'));
    paths = resolvePaths(root);
    mkdirSync(paths.base, { recursive: true });
    db = openDatabase({ path: paths.indexDb });

    const entries = new EntryRepository(db, paths);
    const embedder = new FakeEmbedder();
    const vectors = new VectorIndex(db);
    const indexer = new Indexer(embedder, vectors, { warn: () => {} });

    flow = new SaveKnowledgeFlow({ db, paths, entries, indexer });
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('creates a feature entry and writes its markdown file', async () => {
    const result = await flow.execute({
      action: 'create',
      entry: {
        type: 'feature',
        slug: 'checkout',
        name: 'Checkout',
        body: {
          what: 'Handles the purchase flow.',
          flow_mermaid: 'flowchart TD\n  A --> B',
          where: '- src/checkout.ts',
        },
        file_paths: ['src/checkout.ts'],
        symbols: ['Checkout'],
        tags: ['payments'],
      },
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.entry_id).toMatch(/^feat_checkout_/);
    expect(result.file_written).toBe('.domain-memory/knowledge/checkout/feature.md');
    expect(result.confidence_after).toBe(80);
  });

  it('rejects an aspect without feature_id', async () => {
    const result = await flow.execute({
      action: 'create',
      entry: {
        type: 'aspect',
        slug: 'taxes',
        name: 'Taxes',
        body: { what: 'x', where: 'y' },
      },
    });

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.code).toBe('invalid_input');
  });

  it('rejects an aspect whose parent feature does not exist', async () => {
    const result = await flow.execute({
      action: 'create',
      entry: {
        type: 'aspect',
        slug: 'taxes',
        name: 'Taxes',
        feature_id: 'feat_nope',
        body: { what: 'x', where: 'y' },
      },
    });

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.code).toBe('parent_not_found');
  });

  it('blocks an update when expected_updated_at does not match (conflict_stale)', async () => {
    const created = await flow.execute({
      action: 'create',
      entry: {
        type: 'feature',
        slug: 'x',
        name: 'X',
        body: { what: 'v1', where: 'w' },
      },
    });
    expect(created.status).toBe('ok');
    if (created.status !== 'ok') return;

    const result = await flow.execute({
      action: 'update',
      target_id: created.entry_id,
      entry: {
        type: 'feature',
        slug: 'x',
        name: 'X',
        body: { what: 'v2', where: 'w' },
      },
      expected_updated_at: '2000-01-01T00:00:00Z',
    });

    expect(result.status).toBe('conflict_stale');
  });

  it('archives an entry, preserving body and flipping status', async () => {
    const created = await flow.execute({
      action: 'create',
      entry: {
        type: 'feature',
        slug: 'dead',
        name: 'Dead',
        body: { what: 'x', where: 'y' },
      },
    });
    if (created.status !== 'ok') throw new Error('setup failed');

    const archived = await flow.execute({
      action: 'archive',
      target_id: created.entry_id,
    });
    expect(archived.status).toBe('ok');

    const row = db
      .prepare('SELECT status FROM entries WHERE id = ?')
      .get(created.entry_id) as { status: string } | undefined;
    expect(row?.status).toBe('archived');
  });

  it('creates an aspect attached to an existing feature', async () => {
    const feature = await flow.execute({
      action: 'create',
      entry: {
        type: 'feature',
        slug: 'checkout',
        name: 'Checkout',
        body: { what: 'x', where: 'y' },
      },
    });
    if (feature.status !== 'ok') throw new Error('setup failed');

    const aspect = await flow.execute({
      action: 'create',
      entry: {
        type: 'aspect',
        slug: 'taxes',
        name: 'Taxes',
        feature_id: feature.entry_id,
        body: { what: 'x', where: 'y' },
      },
    });

    expect(aspect.status).toBe('ok');
    if (aspect.status !== 'ok') return;
    expect(aspect.file_written).toContain('checkout/aspects/taxes.md');
  });
});
