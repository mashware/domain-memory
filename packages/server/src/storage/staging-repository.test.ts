import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePaths } from './paths.js';
import { StagingRepository, slugifyBranch } from './staging-repository.js';

describe('StagingRepository', () => {
  let root: string;
  let repo: StagingRepository;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-staging-'));
    repo = new StagingRepository(resolvePaths(root));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('appends and reads findings for a branch', () => {
    repo.append('feat/x', {
      topic: { feature_hint: 'checkout' },
      finding: 'one',
      file_paths: [],
      symbols: [],
      source: 'user_explained',
      session_id: 's',
      client: 'test',
    });
    repo.append('feat/x', {
      topic: { feature_hint: 'checkout', aspect_hint: 'taxes' },
      finding: 'two',
      file_paths: [],
      symbols: [],
      source: 'user_explained',
      session_id: 's',
      client: 'test',
    });

    const findings = repo.read('feat/x');
    expect(findings.map((f) => f.finding)).toEqual(['one', 'two']);
    expect(findings[0]!.id).toMatch(/^find_/);
  });

  it('survives a branch slug with slashes and uppercase', () => {
    repo.append('Feat/Abc-Def', {
      topic: { feature_hint: 'x' },
      finding: 'payload',
      file_paths: [],
      symbols: [],
      source: 'user_explained',
      session_id: 's',
      client: 'test',
    });
    expect(repo.read('Feat/Abc-Def')).toHaveLength(1);
  });

  it('slugifies branch names consistently', () => {
    expect(slugifyBranch('feat/abc')).toBe('feat_abc');
    expect(slugifyBranch('PROJ-42/My-Branch')).toBe('proj-42_my-branch');
    expect(slugifyBranch('///trim///')).toBe('trim');
  });

  it('returns [] when the branch has no staging file', () => {
    expect(repo.read('unknown')).toEqual([]);
  });

  it('consolidates by renaming to .consolidated-<ts>', () => {
    repo.append('feat/y', {
      topic: { feature_hint: 'x' },
      finding: 'one',
      file_paths: [],
      symbols: [],
      source: 'user_explained',
      session_id: 's',
      client: 'test',
    });

    const result = repo.consolidate('feat/y');
    expect(result.count).toBe(1);
    expect(result.archived).toBeTruthy();
    expect(existsSync(result.archived!)).toBe(true);

    // original file is gone
    expect(repo.read('feat/y')).toEqual([]);

    const stagingDir = join(root, '.domain-memory', 'staging');
    const files = readdirSync(stagingDir);
    const archives = files.filter((f) => f.includes('.consolidated-'));
    expect(archives).toHaveLength(1);
  });

  it('consolidate is a no-op when nothing is staged', () => {
    const result = repo.consolidate('nothing');
    expect(result.count).toBe(0);
    expect(result.archived).toBeNull();
  });
});
