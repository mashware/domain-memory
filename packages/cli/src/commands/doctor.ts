// Health check for a domain-memory installation. Reports on index
// consistency vs. disk, missing referenced files, stale staging, and
// per-entry embedding presence. Read-only — never mutates anything.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import {
  createServerContext,
  findContradictionCandidates,
} from '@mashware/domain-memory-server';
import pc from 'picocolors';

export interface DoctorOptions {
  root: string;
}

interface Finding {
  level: 'info' | 'warn' | 'error';
  message: string;
}

export async function runDoctor(opts: DoctorOptions): Promise<number> {
  const findings: Finding[] = [];

  // Check for .domain-memory/ before creating the server context: the
  // context opens the SQLite database which would auto-create the
  // directory as a side effect, masking the "not installed" state.
  const baseDir = join(opts.root, '.domain-memory');
  if (!existsSync(baseDir)) {
    findings.push({
      level: 'error',
      message: `.domain-memory/ not found at ${baseDir}`,
    });
    report(findings);
    return 1;
  }

  const ctx = createServerContext(opts.root);

  findings.push({
    level: 'info',
    message: `Project root: ${ctx.paths.root}`,
  });

  const indexed = ctx.entries.listIndexed();
  const diskFiles = ctx.entries.scanDisk();

  findings.push({
    level: 'info',
    message: `Indexed entries: ${indexed.length}`,
  });
  findings.push({
    level: 'info',
    message: `Markdown files on disk: ${diskFiles.length}`,
  });

  const indexedPaths = new Set(
    indexed.map((row) => resolve(ctx.paths.root, row.file_path)),
  );
  const diskSet = new Set(diskFiles);

  for (const path of diskSet) {
    if (!indexedPaths.has(path)) {
      findings.push({
        level: 'warn',
        message: `On disk but not in index: ${relative(ctx.paths.root, path)} — run reindex`,
      });
    }
  }
  for (const path of indexedPaths) {
    if (!diskSet.has(path)) {
      findings.push({
        level: 'warn',
        message: `Indexed but missing on disk: ${relative(ctx.paths.root, path)} — run reindex`,
      });
    }
  }

  const missingFiles = ctx.db
    .prepare(
      `SELECT ep.entry_id, ep.path
       FROM entry_paths ep
       WHERE ep.is_dir = 0`,
    )
    .all() as Array<{ entry_id: string; path: string }>;

  let brokenRefs = 0;
  for (const row of missingFiles) {
    const abs = resolve(ctx.paths.root, row.path);
    if (!existsSync(abs)) {
      brokenRefs += 1;
      findings.push({
        level: 'warn',
        message: `Entry ${row.entry_id} references missing file: ${row.path}`,
      });
    }
  }
  if (brokenRefs > 0) {
    findings.push({
      level: 'warn',
      message: `${brokenRefs} entries reference files that no longer exist — consider drift review`,
    });
  }

  const vecCount = (
    ctx.db.prepare('SELECT COUNT(*) AS n FROM entries_vec').get() as { n: number }
  ).n;
  if (vecCount < indexed.length) {
    findings.push({
      level: 'warn',
      message: `Embeddings: ${vecCount}/${indexed.length} — run reindex to refresh`,
    });
  } else {
    findings.push({
      level: 'info',
      message: `Embeddings: ${vecCount}/${indexed.length}`,
    });
  }

  switch (ctx.embedder.status) {
    case 'ready':
      findings.push({
        level: 'info',
        message: `Embedder: ready (${ctx.embedder.modelName})`,
      });
      break;
    case 'failed':
      findings.push({
        level: 'warn',
        message: `Embedder: unavailable — ${ctx.embedder.failureReason ?? 'unknown'}. Search is degrading to BM25 + path/symbol only.`,
      });
      break;
    case 'unknown':
      findings.push({
        level: 'info',
        message: `Embedder: not yet exercised this run (${ctx.embedder.modelName}). Run reindex or a search to verify.`,
      });
      break;
  }

  if (existsSync(ctx.paths.staging)) {
    const stagingFiles = readdirSync(ctx.paths.staging).filter((f) =>
      f.endsWith('.jsonl'),
    );
    findings.push({
      level: 'info',
      message: `Active staging branches: ${stagingFiles.length}`,
    });
    const now = Date.now();
    for (const f of stagingFiles) {
      const abs = `${ctx.paths.staging}/${f}`;
      const ageDays = (now - statSync(abs).mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > 30) {
        findings.push({
          level: 'warn',
          message: `Staging file ${f} is ${Math.round(ageDays)} days old — consider consolidating or discarding`,
        });
      }
    }
  }

  // Advisory only: pairs of entries that overlap enough to be worth a look.
  // Mechanical signal — overlap is not contradiction; an agent decides whether
  // they actually conflict. Never affects the exit code.
  const contradictions = findContradictionCandidates(ctx.db, ctx.vectors);
  if (contradictions.candidates.length > 0) {
    const shown = contradictions.candidates.length;
    const suffix =
      contradictions.total > shown ? ` (showing top ${shown})` : '';
    findings.push({
      level: 'info',
      message: `Possible contradictions to review: ${contradictions.total}${suffix} — ask an agent to check whether each pair conflicts`,
    });
    for (const c of contradictions.candidates) {
      const sameFeature = c.sameFeature ? ', same feature' : '';
      findings.push({
        level: 'info',
        message: `  ~ "${c.a.name}" ↔ "${c.b.name}" (${Math.round(c.similarity * 100)}% similar${sameFeature})`,
      });
    }
  }

  ctx.db.close();

  const exitCode = report(findings);
  return exitCode;
}

function report(findings: Finding[]): number {
  let errors = 0;
  let warnings = 0;
  for (const f of findings) {
    switch (f.level) {
      case 'info':
        process.stdout.write(`  ${pc.dim('·')} ${f.message}\n`);
        break;
      case 'warn':
        warnings += 1;
        process.stdout.write(`  ${pc.yellow('!')} ${f.message}\n`);
        break;
      case 'error':
        errors += 1;
        process.stdout.write(`  ${pc.red('✗')} ${f.message}\n`);
        break;
    }
  }

  process.stdout.write('\n');
  if (errors > 0) {
    process.stdout.write(pc.red(`${errors} error(s), ${warnings} warning(s)\n`));
    return 1;
  }
  if (warnings > 0) {
    process.stdout.write(pc.yellow(`${warnings} warning(s)\n`));
    return 0;
  }
  process.stdout.write(pc.green('All checks passed\n'));
  return 0;
}
