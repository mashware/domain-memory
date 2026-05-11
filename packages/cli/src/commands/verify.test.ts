import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runReindex } from './reindex.js';
import { runVerify } from './verify.js';
import { silenceOutput, writeKnowledgeFixture } from './test-helpers.js';

function readFrontmatter(path: string): Record<string, string> {
  const raw = readFileSync(path, 'utf-8');
  const end = raw.indexOf('\n---', 4);
  const block = raw.slice(4, end);
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m) out[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
  return out;
}

describe('runVerify', () => {
  let root: string;
  let restoreOutput: () => void;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-verify-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/checkout.ts'), 'export {};\n', 'utf-8');
    restoreOutput = silenceOutput();
  });

  afterEach(() => {
    restoreOutput();
    rmSync(root, { recursive: true, force: true });
  });

  it('bumps last_verified to now and leaves the body untouched', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_vfy',
      filePath: 'src/checkout.ts',
      timestamp: '2020-01-01T00:00:00Z',
    });
    await runReindex({ root });

    const code = await runVerify({ root, entryId: 'feat_checkout_vfy' });
    expect(code).toBe(0);

    const path = join(
      root,
      '.domain-memory/knowledge/checkout/feature.md',
    );
    const fm = readFrontmatter(path);
    expect(fm['last_verified']).not.toBe('2020-01-01T00:00:00Z');
    expect(fm['last_verified']!.length).toBeGreaterThan(0);

    const body = readFileSync(path, 'utf-8');
    expect(body).toContain('Feature fixture.');
  });

  it('returns exit code 1 when the entry does not exist', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_vfy2',
      filePath: 'src/checkout.ts',
    });
    await runReindex({ root });

    const code = await runVerify({ root, entryId: 'feat_missing' });
    expect(code).toBe(1);
  });
});
