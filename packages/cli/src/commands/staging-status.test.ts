import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePaths, StagingRepository } from '@mashware/domain-memory-server';
import {
  collectStagingStatus,
  resolveCurrentBranch,
  runStagingStatus,
} from './staging-status.js';
import { silenceOutput } from './test-helpers.js';

function stage(root: string, branch: string, finding: string): void {
  const repo = new StagingRepository(resolvePaths(root));
  repo.append(branch, {
    topic: { feature_hint: 'checkout' },
    finding,
    file_paths: [],
    symbols: [],
    source: 'inferred_from_code',
    session_id: 'test-session',
    client: 'test',
  });
}

describe('staging-status', () => {
  let root: string;
  let restoreOutput: () => void;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-staging-status-'));
    restoreOutput = silenceOutput();
  });

  afterEach(() => {
    restoreOutput();
    rmSync(root, { recursive: true, force: true });
  });

  describe('collectStagingStatus', () => {
    it('returns the finding count for an explicit branch', () => {
      stage(root, 'feat/checkout', 'first finding');
      stage(root, 'feat/checkout', 'second finding');

      const result = collectStagingStatus({ root, branch: 'feat/checkout' });
      expect(result).toEqual({ branch: 'feat/checkout', count: 2 });
    });

    it('returns zero when nothing is staged for the branch', () => {
      const result = collectStagingStatus({ root, branch: 'feat/empty' });
      expect(result).toEqual({ branch: 'feat/empty', count: 0 });
    });

    it('keys staging by branch — a different branch sees nothing', () => {
      stage(root, 'feat/a', 'only on a');
      const result = collectStagingStatus({ root, branch: 'feat/b' });
      expect(result.count).toBe(0);
    });

    it('reports no branch when none can be resolved and none is given', () => {
      // A bare temp dir is not a git repo, so branch resolution returns null.
      const result = collectStagingStatus({ root });
      expect(result).toEqual({ branch: null, count: 0 });
    });
  });

  describe('resolveCurrentBranch', () => {
    it('returns null outside a git repository instead of throwing', () => {
      expect(resolveCurrentBranch(root)).toBeNull();
    });
  });

  describe('runStagingStatus', () => {
    it('always exits 0, even with unconsolidated findings', async () => {
      stage(root, 'feat/checkout', 'a finding');
      const code = await runStagingStatus({ root, branch: 'feat/checkout' });
      expect(code).toBe(0);
    });

    it('exits 0 when there is nothing to report', async () => {
      const code = await runStagingStatus({ root, branch: 'feat/empty', quiet: true });
      expect(code).toBe(0);
    });

    it('emits machine-readable JSON with --json', async () => {
      stage(root, 'feat/checkout', 'a finding');
      const chunks: string[] = [];
      const orig = process.stdout.write.bind(process.stdout);
      (process.stdout as unknown as { write: typeof orig }).write = ((s: string) => {
        chunks.push(s);
        return true;
      }) as unknown as typeof orig;
      try {
        await runStagingStatus({ root, branch: 'feat/checkout', json: true });
      } finally {
        (process.stdout as unknown as { write: typeof orig }).write = orig;
      }
      expect(JSON.parse(chunks.join(''))).toEqual({
        branch: 'feat/checkout',
        count: 1,
      });
    });
  });
});
