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
import { runDecay } from './decay.js';
import { runReindex } from './reindex.js';
import { silenceOutput, writeKnowledgeFixture } from './test-helpers.js';

describe('runDecay', () => {
  let root: string;
  let restoreOutput: () => void;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-decay-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/checkout.ts'), 'export {};\n', 'utf-8');
    restoreOutput = silenceOutput();
  });

  afterEach(() => {
    restoreOutput();
    rmSync(root, { recursive: true, force: true });
  });

  it('no-ops when there is nothing to decay', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_fresh',
      filePath: 'src/checkout.ts',
      timestamp: new Date().toISOString(),
    });
    await runReindex({ root });

    const code = await runDecay({ root, write: false });
    expect(code).toBe(0);
  });

  it('reports a decayed entry in dry-run mode without touching disk', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const old = new Date(Date.now() - 90 * DAY).toISOString(); // 3 decay periods
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_stale',
      filePath: 'src/checkout.ts',
      timestamp: old,
    });
    await runReindex({ root });

    const code = await runDecay({ root, write: false });
    expect(code).toBe(0);

    const raw = readFileSync(
      join(root, '.domain-memory/knowledge/checkout/feature.md'),
      'utf-8',
    );
    // Still the stored 80, not the decayed value.
    expect(raw).toMatch(/confidence:\s*80/);
  });

  it('persists the decayed value when --write is passed', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const old = new Date(Date.now() - 90 * DAY).toISOString();
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_persist',
      filePath: 'src/checkout.ts',
      timestamp: old,
    });
    await runReindex({ root });

    const code = await runDecay({ root, write: true });
    expect(code).toBe(0);

    const raw = readFileSync(
      join(root, '.domain-memory/knowledge/checkout/feature.md'),
      'utf-8',
    );
    // 80 - (3 periods * 5) = 65
    expect(raw).toMatch(/confidence:\s*65/);
  });
});
