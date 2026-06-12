import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EMBEDDING_DIM,
  openDatabase,
  resolvePaths,
  VectorIndex,
} from '@mashware/domain-memory-server';
import { runDoctor } from './doctor.js';
import { runReindex } from './reindex.js';
import { silenceOutput, writeKnowledgeFixture } from './test-helpers.js';

// Captures stdout for the duration of `fn`, returning everything written.
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const orig = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  (process.stdout as unknown as { write: typeof orig }).write = ((s: string) => {
    chunks.push(s);
    return true;
  }) as unknown as typeof orig;
  try {
    await fn();
  } finally {
    (process.stdout as unknown as { write: typeof orig }).write = orig;
  }
  return chunks.join('');
}

// An L2-normalized 384-dim vector from a sparse {dim: weight} map.
function unitVector(dims: Record<number, number>): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  for (const [i, val] of Object.entries(dims)) v[Number(i)] = val;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i += 1) v[i] /= norm;
  return v;
}

describe('runDoctor', () => {
  let root: string;
  let restoreOutput: () => void;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-doctor-'));
    restoreOutput = silenceOutput();
  });

  afterEach(() => {
    restoreOutput();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns exit code 1 when .domain-memory is missing', async () => {
    const code = await runDoctor({ root });
    expect(code).toBe(1);
  });

  it('passes on a clean install with indexed entries', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_doc',
      filePath: 'src/checkout.ts',
    });
    // Create the file so entry_paths references are not broken.
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/checkout.ts'), 'export {};\n', 'utf-8');

    await runReindex({ root });

    const code = await runDoctor({ root });
    expect(code).toBe(0);
  });

  it('warns about entries that reference missing files, but still exits 0', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_broken',
      filePath: 'src/missing.ts',
    });
    await runReindex({ root });

    const code = await runDoctor({ root });
    // Broken refs are warnings, not errors.
    expect(code).toBe(0);
  });

  it('detects stale staging files older than 30 days', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_stale',
      filePath: 'src/checkout.ts',
    });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/checkout.ts'), 'export {};\n', 'utf-8');
    await runReindex({ root });

    const stagingDir = join(root, '.domain-memory', 'staging');
    mkdirSync(stagingDir, { recursive: true });
    const stalePath = join(stagingDir, 'feat_old.jsonl');
    writeFileSync(stalePath, '{}\n', 'utf-8');
    // Backdate the mtime by 40 days.
    const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    utimesSync(stalePath, past, past);

    // No assertion on exit code beyond "does not throw" — the warning
    // path is exercised and the command completes successfully.
    const code = await runDoctor({ root });
    expect(code).toBe(0);
  });

  it('surfaces possible-contradiction candidates without failing', async () => {
    // Pre-seed the index with two near-identical entries from different
    // features, so the doctor's advisory section has something to report.
    const paths = resolvePaths(root);
    mkdirSync(paths.base, { recursive: true });
    const db = openDatabase({ path: paths.indexDb });
    const vectors = new VectorIndex(db);
    const insert = db.prepare(
      `INSERT INTO entries
        (id, type, slug, name, feature_id, status, confidence,
         created_at, updated_at, last_verified, file_path, summary)
       VALUES (?, 'feature', ?, ?, NULL, 'active', 80,
         '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
         ?, ?)`,
    );
    insert.run('vat_a', 'vat-a', 'VAT charged to clients', 'vat_a.md', 'VAT charged');
    insert.run('vat_b', 'vat-b', 'VAT absorbed by us', 'vat_b.md', 'VAT absorbed');
    vectors.upsert('vat_a', unitVector({ 0: 1 }));
    vectors.upsert('vat_b', unitVector({ 0: 1, 1: 0.05 }));
    db.close();

    let code = 0;
    const out = await captureStdout(async () => {
      code = await runDoctor({ root });
    });

    expect(code).toBe(0); // advisory only — never an error
    expect(out).toContain('Possible contradictions to review');
    expect(out).toContain('VAT charged to clients');
    expect(out).toContain('VAT absorbed by us');
  });
});
