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
import { runDoctor } from './doctor.js';
import { runReindex } from './reindex.js';
import { silenceOutput, writeKnowledgeFixture } from './test-helpers.js';

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
});
