import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runExport } from './export.js';
import { runReindex } from './reindex.js';
import { silenceOutput, writeKnowledgeFixture } from './test-helpers.js';

describe('runExport', () => {
  let root: string;
  let out: string;
  let restoreOutput: () => void;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-export-'));
    out = mkdtempSync(join(tmpdir(), 'dm-export-out-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/checkout.ts'), 'export {};\n', 'utf-8');
    restoreOutput = silenceOutput();
  });

  afterEach(() => {
    restoreOutput();
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it('writes the expected static tree for a seeded project', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_exp',
      aspectSlug: 'taxes',
      aspectId: 'asp_checkout_taxes_exp',
      filePath: 'src/checkout.ts',
    });
    await runReindex({ root });

    const code = await runExport({ root, out });
    expect(code).toBe(0);

    expect(existsSync(join(out, 'index.html'))).toBe(true);
    expect(existsSync(join(out, 'features/index.html'))).toBe(true);
    expect(existsSync(join(out, 'stale/index.html'))).toBe(true);
    expect(existsSync(join(out, 'graph/index.html'))).toBe(true);
    expect(existsSync(join(out, 'static/styles.css'))).toBe(true);

    expect(
      existsSync(join(out, 'features/feat_checkout_exp/index.html')),
    ).toBe(true);
    expect(
      existsSync(join(out, 'aspects/asp_checkout_taxes_exp/index.html')),
    ).toBe(true);
  });

  it('embeds the feature content in the exported detail page', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_content',
      filePath: 'src/checkout.ts',
    });
    await runReindex({ root });

    await runExport({ root, out });

    const page = readFileSync(
      join(out, 'features/feat_checkout_content/index.html'),
      'utf-8',
    );
    expect(page).toContain('<h1>Checkout</h1>');
    expect(page).toContain('Feature fixture');
  });

  it('serves CSS with the full stylesheet content', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'x',
      featureId: 'feat_x_css',
      filePath: 'src/checkout.ts',
    });
    await runReindex({ root });

    await runExport({ root, out });

    const css = readFileSync(join(out, 'static/styles.css'), 'utf-8');
    expect(css).toContain('.site-header');
  });
});
