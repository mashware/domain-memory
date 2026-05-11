import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCheckDrift } from './check-drift.js';
import { runReindex } from './reindex.js';
import { silenceOutput, writeKnowledgeFixture } from './test-helpers.js';

describe('runCheckDrift', () => {
  let root: string;
  let restoreOutput: () => void;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-drift-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/checkout.ts'), 'export {};\n', 'utf-8');
    restoreOutput = silenceOutput();
  });

  afterEach(() => {
    restoreOutput();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns 1 when no files are supplied', async () => {
    const code = await runCheckDrift({ root, files: [] });
    expect(code).toBe(1);
  });

  it('finds entries that reference the given file', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_drift',
      aspectSlug: 'taxes',
      aspectId: 'asp_checkout_taxes_drift',
      filePath: 'src/checkout.ts',
    });
    await runReindex({ root });

    // Re-silence: runReindex flipped stdout back after its own work.
    restoreOutput();
    const captured: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = ((
      chunk: string,
    ) => {
      captured.push(String(chunk));
      return true;
    }) as unknown as typeof origOut;

    const code = await runCheckDrift({
      root,
      files: ['src/checkout.ts'],
      json: true,
    });

    (process.stdout as unknown as { write: typeof origOut }).write = origOut;
    restoreOutput = silenceOutput();

    expect(code).toBe(0);
    const joined = captured.join('');
    const parsed = JSON.parse(joined) as {
      affected_entries: Array<{ id: string; matched_paths: string[] }>;
    };

    const ids = parsed.affected_entries.map((e) => e.id);
    expect(ids).toContain('feat_checkout_drift');
    expect(ids).toContain('asp_checkout_taxes_drift');
  });

  it('returns an empty affected list when no entry references the file', async () => {
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_unused',
      filePath: 'src/checkout.ts',
    });
    await runReindex({ root });

    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await runCheckDrift({
      root,
      files: ['src/unrelated.ts'],
      json: true,
    });
    const output = spy.mock.calls.map((c) => String(c[0])).join('');
    spy.mockRestore();

    expect(code).toBe(0);
    const parsed = JSON.parse(output) as { affected_entries: unknown[] };
    expect(parsed.affected_entries).toEqual([]);
  });
});
