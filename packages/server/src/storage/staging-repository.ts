// Per-branch staging of findings. Append-only JSONL during a session;
// consolidated (renamed with a timestamp suffix) when `/save-knowledge`
// or the PR flow processes the findings. Indexed by git branch, not by
// session, so it survives compaction and session restarts.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from 'node:fs';
import { ulid } from 'ulid';
import { stagingFile, type DomainMemoryPaths } from './paths.js';
import type { StagedFinding } from './types.js';

export class StagingRepository {
  constructor(private readonly paths: DomainMemoryPaths) {}

  append(branch: string, finding: Omit<StagedFinding, 'id' | 'ts'>): StagedFinding {
    const complete: StagedFinding = {
      id: `find_${ulid()}`,
      ts: new Date().toISOString(),
      ...finding,
    };

    const file = stagingFile(this.paths, slugifyBranch(branch));
    mkdirSync(this.paths.staging, { recursive: true });
    appendFileSync(file, JSON.stringify(complete) + '\n', 'utf-8');

    return complete;
  }

  read(branch: string): StagedFinding[] {
    const file = stagingFile(this.paths, slugifyBranch(branch));
    if (!existsSync(file)) return [];

    const raw = readFileSync(file, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const out: StagedFinding[] = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as StagedFinding);
      } catch {
        // Skip corrupted lines; staging is append-only and best-effort.
      }
    }
    return out;
  }

  consolidate(branch: string): { archived: string | null; count: number } {
    const file = stagingFile(this.paths, slugifyBranch(branch));
    if (!existsSync(file)) return { archived: null, count: 0 };

    const findings = this.read(branch);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const archivedPath = `${file}.consolidated-${ts}`;
    renameSync(file, archivedPath);

    return { archived: archivedPath, count: findings.length };
  }
}

export function slugifyBranch(branch: string): string {
  // Git branches can contain slashes (feat/xyz) and other chars. Map to a
  // filesystem-safe slug while keeping it reversible enough for debugging.
  return branch
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}
