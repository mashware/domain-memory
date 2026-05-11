// Tool: check_drift
// Given a list of file paths (typically the files a PR is about to touch),
// returns the entries whose `file_paths` intersect with that list. The agent
// uses this at PR time to ask the developer "this PR touches files referenced
// by these entries — are they still correct?".

import { basename } from 'node:path';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { effectiveConfidence } from '../../storage/confidence.js';
import {
  DEFAULT_DRIFT_TIMEOUT_MS,
  TimeoutError,
  withTimeout,
} from '../../util/timeout.js';

export const checkDriftInputShape = {
  file_paths: z.array(z.string()).min(1),
};

const inputSchema = z.object(checkDriftInputShape);

interface AffectedEntryRow {
  entry_id: string;
  matched_path: string;
}

export async function handleCheckDrift(
  ctx: ServerContext,
  rawInput: unknown,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const input = inputSchema.parse(rawInput);
  const timeoutMs = resolveDriftTimeout();

  try {
    return await withTimeout(
      Promise.resolve().then(() => computeDrift(ctx, input.file_paths)),
      timeoutMs,
      'check_drift',
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      ctx.logger.warn('check_drift_timeout', {
        timeout_ms: timeoutMs,
        file_count: input.file_paths.length,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { affected_entries: [], timed_out: true, timeout_ms: timeoutMs },
              null,
              2,
            ),
          },
        ],
      };
    }
    throw err;
  }
}

function resolveDriftTimeout(): number {
  const override = process.env['DOMAIN_MEMORY_DRIFT_TIMEOUT_MS'];
  if (!override) return DEFAULT_DRIFT_TIMEOUT_MS;
  const parsed = Number(override);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DRIFT_TIMEOUT_MS;
}

function computeDrift(
  ctx: ServerContext,
  filePaths: string[],
): { content: Array<{ type: 'text'; text: string }> } {
  const byEntry = new Map<string, Set<string>>();

  const exactStmt = ctx.db.prepare<[string]>(
    'SELECT entry_id, path AS matched_path FROM entry_paths WHERE path = ?',
  );
  const basenameStmt = ctx.db.prepare<[string]>(
    "SELECT entry_id, path AS matched_path FROM entry_paths WHERE path LIKE ? AND is_dir = 0",
  );
  const dirStmt = ctx.db.prepare<[string, string]>(
    'SELECT entry_id, path AS matched_path FROM entry_paths WHERE is_dir = 1 AND ? LIKE path || ?',
  );

  for (const p of filePaths) {
    const exactHits = exactStmt.all(p) as AffectedEntryRow[];
    for (const row of exactHits) bump(byEntry, row.entry_id, p);

    const name = basename(p);
    if (name) {
      const basenameHits = basenameStmt.all(`%/${name}`) as AffectedEntryRow[];
      for (const row of basenameHits) bump(byEntry, row.entry_id, p);
    }

    const dirHits = dirStmt.all(p, '%') as AffectedEntryRow[];
    for (const row of dirHits) bump(byEntry, row.entry_id, p);
  }

  if (byEntry.size === 0) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ affected_entries: [] }, null, 2) },
      ],
    };
  }

  const ids = Array.from(byEntry.keys());
  const placeholders = ids.map(() => '?').join(',');

  const rows = ctx.db
    .prepare(
      `SELECT
         e.id, e.name, e.last_verified, e.confidence, e.file_path AS content_path,
         f.name AS feature_name
       FROM entries e
       LEFT JOIN entries f ON f.id = e.feature_id
       WHERE e.id IN (${placeholders}) AND e.status = 'active'`,
    )
    .all(...ids) as Array<{
    id: string;
    name: string;
    last_verified: string;
    confidence: number;
    content_path: string;
    feature_name: string | null;
  }>;

  const affected = rows.map((row) => ({
    id: row.id,
    name: row.name,
    feature_name: row.feature_name,
    matched_paths: Array.from(byEntry.get(row.id) ?? []),
    last_verified: row.last_verified,
    confidence: effectiveConfidence(row.confidence, row.last_verified),
    content_path: row.content_path,
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ affected_entries: affected }, null, 2),
      },
    ],
  };
}

function bump(map: Map<string, Set<string>>, entryId: string, path: string): void {
  const existing = map.get(entryId);
  if (existing) {
    existing.add(path);
  } else {
    map.set(entryId, new Set([path]));
  }
}
