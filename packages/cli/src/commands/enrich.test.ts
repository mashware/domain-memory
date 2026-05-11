import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEnrich } from './enrich.js';
import { runReindex } from './reindex.js';
import { writeKnowledgeFixture } from './test-helpers.js';

function captureStdout(): { out: () => string; restore: () => void } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: typeof orig }).write = ((
    c: string,
  ) => {
    chunks.push(String(c));
    return true;
  }) as unknown as typeof orig;
  return {
    out: () => chunks.join(''),
    restore: () => {
      (process.stdout as unknown as { write: typeof orig }).write = orig;
    },
  };
}

describe('runEnrich', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-enrich-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'checkout.ts'), 'export {};\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds a feature by id and prints a guided prompt', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_e1',
      filePath: 'src/checkout.ts',
    });
    await new Promise<void>((resolve) => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      void runReindex({ root }).then(() => {
        spy.mockRestore();
        resolve();
      });
    });

    const cap = captureStdout();
    const code = await runEnrich({ root, target: 'feat_checkout_e1' });
    cap.restore();

    expect(code).toBe(0);
    const out = cap.out();
    expect(out).toContain('Enrich plan for Checkout');
    expect(out).toContain('feat_checkout_e1');
    expect(out).toContain('save_knowledge');
    expect(out).toContain('src/checkout.ts');
  });

  it('finds a feature by slug when id is not given', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_slug',
      filePath: 'src/checkout.ts',
    });
    await new Promise<void>((resolve) => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      void runReindex({ root }).then(() => {
        spy.mockRestore();
        resolve();
      });
    });

    const cap = captureStdout();
    const code = await runEnrich({ root, target: 'checkout' });
    cap.restore();

    expect(code).toBe(0);
    expect(cap.out()).toContain('feat_checkout_slug');
  });

  it('returns 1 and an error message when nothing matches', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_missing',
      filePath: 'src/checkout.ts',
    });
    await new Promise<void>((resolve) => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      void runReindex({ root }).then(() => {
        spy.mockRestore();
        resolve();
      });
    });

    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await runEnrich({ root, target: 'feat_nope' });
    errSpy.mockRestore();
    expect(code).toBe(1);
  });
});
