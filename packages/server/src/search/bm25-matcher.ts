// BM25 matcher via SQLite FTS5. FTS5's bm25() returns a negative value
// where lower means more relevant. We convert it into a 0-1 score by
// negating and clamping so the downstream fusion can combine it with
// the embedding and path scores.

import type { Db } from '../storage/database.js';

export interface Bm25Hit {
  entry_id: string;
  score: number;
}

export class Bm25Matcher {
  constructor(private readonly db: Db) {}

  search(query: string, limit: number): Bm25Hit[] {
    const sanitized = sanitizeQuery(query);
    if (!sanitized) return [];

    const rows = this.db
      .prepare(
        `SELECT entry_id, bm25(entries_fts) AS rank
         FROM entries_fts
         WHERE entries_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(sanitized, limit) as Array<{ entry_id: string; rank: number }>;

    if (rows.length === 0) return [];

    const ranks = rows.map((r) => -r.rank);
    const maxRank = Math.max(...ranks, 1);

    return rows.map((r) => ({
      entry_id: r.entry_id,
      score: clamp01(-r.rank / maxRank),
    }));
  }
}

function sanitizeQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `${t}*`).join(' OR ');
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
