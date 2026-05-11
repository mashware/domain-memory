import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../storage/database.js';
import { resolvePaths, type DomainMemoryPaths } from '../storage/paths.js';
import { DriftChecker } from './drift-checker.js';

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(content)).digest('hex')}`;
}

describe('DriftChecker', () => {
  let root: string;
  let db: Db;
  let paths: DomainMemoryPaths;
  let drift: DriftChecker;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-drift-'));
    paths = resolvePaths(root);
    mkdirSync(paths.base, { recursive: true });
    db = openDatabase({ path: paths.indexDb });
    drift = new DriftChecker(db, root);
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  function insertEntry(id: string): void {
    db.prepare(
      `INSERT INTO entries (
         id, type, slug, name, feature_id, status, confidence,
         created_at, updated_at, last_verified, file_path, summary
       ) VALUES (?, 'feature', ?, ?, NULL, 'active', 80, 'x', 'x', 'x', 'x', '')`,
    ).run(id, id, id);
  }

  function insertPath(
    entryId: string,
    path: string,
    isDir: number,
    hash: string | null,
  ): void {
    db.prepare(
      'INSERT INTO entry_paths (entry_id, path, is_dir, content_hash) VALUES (?, ?, ?, ?)',
    ).run(entryId, path, isDir, hash);
  }

  function writeSource(relPath: string, content: string): void {
    const full = join(root, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }

  it('reports fresh when every stored hash matches the file on disk', () => {
    insertEntry('feat_a');
    writeSource('src/a.ts', 'content a');
    insertPath('feat_a', 'src/a.ts', 0, sha256('content a'));

    const result = drift.check(['feat_a']);

    expect(result.get('feat_a')).toEqual({
      status: 'fresh',
      drifted_files: [],
      missing_files: [],
    });
  });

  it('reports drifted when a file hash differs from the stored one', () => {
    insertEntry('feat_b');
    writeSource('src/b.ts', 'new content');
    insertPath('feat_b', 'src/b.ts', 0, sha256('old content'));

    const result = drift.check(['feat_b']);

    expect(result.get('feat_b')).toEqual({
      status: 'drifted',
      drifted_files: ['src/b.ts'],
      missing_files: [],
    });
  });

  it('reports drifted with missing_files when a file no longer exists', () => {
    insertEntry('feat_c');
    insertPath('feat_c', 'src/gone.ts', 0, sha256('was here'));

    const result = drift.check(['feat_c']);

    expect(result.get('feat_c')).toEqual({
      status: 'drifted',
      drifted_files: [],
      missing_files: ['src/gone.ts'],
    });
  });

  it('reports unknown when the entry only references directories', () => {
    insertEntry('feat_d');
    insertPath('feat_d', 'src/pkg/', 1, null);

    const result = drift.check(['feat_d']);

    expect(result.get('feat_d')).toEqual({
      status: 'unknown',
      drifted_files: [],
      missing_files: [],
    });
  });

  it('reports unknown when all stored hashes are null', () => {
    insertEntry('feat_e');
    writeSource('src/e.ts', 'hi');
    insertPath('feat_e', 'src/e.ts', 0, null);

    const result = drift.check(['feat_e']);

    expect(result.get('feat_e')?.status).toBe('unknown');
  });

  it('classifies a mix of fresh and drifted files on the same entry', () => {
    insertEntry('feat_f');
    writeSource('src/ok.ts', 'same');
    writeSource('src/bad.ts', 'different');
    insertPath('feat_f', 'src/ok.ts', 0, sha256('same'));
    insertPath('feat_f', 'src/bad.ts', 0, sha256('original'));

    const result = drift.check(['feat_f']);

    expect(result.get('feat_f')).toEqual({
      status: 'drifted',
      drifted_files: ['src/bad.ts'],
      missing_files: [],
    });
  });

  it('returns an empty map when called with no ids', () => {
    const result = drift.check([]);
    expect(result.size).toBe(0);
  });
});
