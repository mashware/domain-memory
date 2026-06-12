// Read-only count of unconsolidated staged findings for a branch. Designed
// to be called from a pre-push git hook: it never opens the SQLite index,
// never fails (always exits 0), and with --quiet stays completely silent
// when there is nothing to report — so it can sit in the push path without
// ever blocking or spamming it.

import { execFileSync } from 'node:child_process';
import pc from 'picocolors';
import { resolvePaths, StagingRepository } from '@mashware/domain-memory-server';

export interface StagingStatusOptions {
  root: string;
  branch?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface StagingStatusResult {
  branch: string | null;
  count: number;
}

// Resolves the current git branch from `root`. Returns null when the
// directory is not a git repo or HEAD is detached — in both cases there is
// no branch to key staging on, and the caller should report nothing.
export function resolveCurrentBranch(root: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    return out.length > 0 && out !== 'HEAD' ? out : null;
  } catch {
    return null;
  }
}

export function collectStagingStatus(
  opts: StagingStatusOptions,
): StagingStatusResult {
  const branch = opts.branch ?? resolveCurrentBranch(opts.root);
  if (!branch) return { branch: null, count: 0 };

  // StagingRepository.read() slugifies the branch internally, so pass the
  // raw name. It returns [] when the .jsonl does not exist (nothing staged,
  // or domain-memory not installed here) — never throws.
  const staging = new StagingRepository(resolvePaths(opts.root));
  return { branch, count: staging.read(branch).length };
}

export async function runStagingStatus(
  opts: StagingStatusOptions,
): Promise<number> {
  const result = collectStagingStatus(opts);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }

  if (result.count === 0) {
    if (!opts.quiet) {
      process.stdout.write(
        pc.dim(
          result.branch
            ? `No unconsolidated findings on "${result.branch}".\n`
            : 'No branch resolved — nothing to report.\n',
        ),
      );
    }
    return 0;
  }

  const plural = result.count === 1 ? '' : 's';
  process.stdout.write(
    pc.yellow(
      `domain-memory: ${result.count} unconsolidated finding${plural} on "${result.branch}".\n`,
    ) +
      pc.dim('Run /save-knowledge to consolidate them into the store before merging.\n'),
  );
  return 0;
}
