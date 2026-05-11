// The searcher orchestrates the three matchers (embedding, BM25, path/symbol),
// fuses their results into a single ranked list, and returns the top N as
// SearchCandidate objects ready for the MCP `search_knowledge` response.
//
// Fusion strategy: weighted sum of per-matcher 0-1 scores. The path/symbol
// score is the most reliable signal and receives the highest weight. When
// one of the matchers fails (e.g. embeddings unavailable), the others still
// produce a usable ranking — graceful degradation by construction.

import type { Db } from '../storage/database.js';
import type { SearchCandidate } from '../storage/types.js';
import { effectiveConfidence } from '../storage/confidence.js';
import {
  DEFAULT_SEARCH_WEIGHTS,
  type SearchWeights,
} from '../config/settings.js';
import type { Embedder } from '../indexing/embedder.js';
import type { VectorIndex } from '../indexing/vector-index.js';
import { Bm25Matcher } from './bm25-matcher.js';
import { PathMatcher } from './path-matcher.js';
import type { DriftChecker } from './drift-checker.js';

export interface SearchContext {
  file_paths?: string[];
  symbols?: string[];
  current_branch?: string;
}

export interface SearchInput {
  query: string;
  context?: SearchContext;
  limit?: number;
}

export interface SearcherLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

const DEFAULT_LIMIT = 10;
// Per-matcher limits are deliberately generous: if an aspect only matches
// by path/symbol and not by embedding, we still want it to reach the
// fusion stage instead of being dropped by a tight top-N cut in a single
// matcher. Concretely, a small top-N on the embedding matcher was masking
// aspects whose parent feature also matched by path.
const DEFAULT_MATCHER_LIMIT = 50;
const MIN_MATCHER_LIMIT = 20;

export interface SearcherOptions {
  weights?: SearchWeights;
}

interface Aggregated {
  entry_id: string;
  embedding: number;
  bm25: number;
  path: number;
  reasons: Set<string>;
}

export class Searcher {
  private readonly bm25: Bm25Matcher;
  private readonly paths: PathMatcher;
  private readonly weights: SearchWeights;
  // True once we've already logged that the embedder is unavailable. Prevents
  // a broken model from spamming errors.log on every query.
  private embedderFailureLogged = false;

  constructor(
    private readonly db: Db,
    private readonly embedder: Embedder,
    private readonly vectors: VectorIndex,
    private readonly logger: SearcherLogger,
    private readonly drift?: DriftChecker,
    options: SearcherOptions = {},
  ) {
    this.bm25 = new Bm25Matcher(db);
    this.paths = new PathMatcher(db);
    this.weights = options.weights ?? DEFAULT_SEARCH_WEIGHTS;
  }

  async search(input: SearchInput): Promise<SearchCandidate[]> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const matcherLimit = Math.max(
      limit * 5,
      DEFAULT_MATCHER_LIMIT,
      MIN_MATCHER_LIMIT,
    );
    const ctx = input.context ?? {};

    const [embeddingHits, bm25Hits, pathHits] = await Promise.all([
      this.runEmbedding(input.query, matcherLimit),
      Promise.resolve(this.runBm25(input.query, matcherLimit)),
      Promise.resolve(
        this.paths.search({
          file_paths: ctx.file_paths ?? [],
          symbols: ctx.symbols ?? [],
        }),
      ),
    ]);

    const aggregated = new Map<string, Aggregated>();

    for (const hit of embeddingHits) {
      this.bump(aggregated, hit.entry_id).embedding = hit.score;
      this.bump(aggregated, hit.entry_id).reasons.add('semantic');
    }
    for (const hit of bm25Hits) {
      this.bump(aggregated, hit.entry_id).bm25 = hit.score;
      this.bump(aggregated, hit.entry_id).reasons.add('keyword');
    }
    for (const hit of pathHits) {
      const agg = this.bump(aggregated, hit.entry_id);
      agg.path = hit.score;
      for (const r of hit.reasons) agg.reasons.add(r);
    }

    // When a whole signal is offline (e.g. embedder failed to load) the
    // raw weighted sum understates every candidate by that signal's
    // weight. Renormalise across the signals that are actually available
    // so the surfaced `combined` score stays comparable to a fully-healthy
    // ranker.
    const effectiveWeights = this.computeEffectiveWeights();

    const scored = Array.from(aggregated.values())
      .map((a) => ({
        ...a,
        combined:
          effectiveWeights.embedding * a.embedding +
          effectiveWeights.bm25 * a.bm25 +
          effectiveWeights.path * a.path,
      }))
      .filter((a) => a.combined > 0)
      .sort((a, b) => b.combined - a.combined)
      .slice(0, limit);

    if (scored.length === 0) return [];

    return this.hydrate(scored);
  }

  private computeEffectiveWeights(): SearchWeights {
    const embedderAvailable = this.embedder.status !== 'failed';
    const raw = {
      path: this.weights.path,
      bm25: this.weights.bm25,
      embedding: embedderAvailable ? this.weights.embedding : 0,
    };
    const total = raw.path + raw.bm25 + raw.embedding;
    if (total === 0) return this.weights;
    return {
      path: raw.path / total,
      bm25: raw.bm25 / total,
      embedding: raw.embedding / total,
    };
  }

  private async runEmbedding(
    query: string,
    limit: number,
  ): Promise<Array<{ entry_id: string; score: number }>> {
    if (this.embedder.status === 'failed') {
      // Already known broken — skip silently. The first failure was logged;
      // re-attempting embed() would just throw the cached error again.
      return [];
    }
    try {
      const vec = await this.embedder.embed(query);
      const matches = this.vectors.search(vec, limit);
      if (matches.length === 0) return [];
      const maxDist = Math.max(...matches.map((m) => m.distance), 1);
      return matches.map((m) => ({
        entry_id: m.entry_id,
        score: clamp01(1 - m.distance / (maxDist || 1)),
      }));
    } catch (err) {
      if (!this.embedderFailureLogged) {
        this.logger.warn('embedder_unavailable', {
          error: err instanceof Error ? err.message : String(err),
          model: this.embedder.modelName,
        });
        this.embedderFailureLogged = true;
      }
      return [];
    }
  }

  private runBm25(query: string, limit: number): Array<{ entry_id: string; score: number }> {
    try {
      return this.bm25.search(query, limit);
    } catch (err) {
      this.logger.warn('bm25_search_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private bump(map: Map<string, Aggregated>, id: string): Aggregated {
    let existing = map.get(id);
    if (!existing) {
      existing = {
        entry_id: id,
        embedding: 0,
        bm25: 0,
        path: 0,
        reasons: new Set(),
      };
      map.set(id, existing);
    }
    return existing;
  }

  private hydrate(
    scored: Array<Aggregated & { combined: number }>,
  ): SearchCandidate[] {
    const ids = scored.map((s) => s.entry_id);
    const placeholders = ids.map(() => '?').join(',');

    const rows = this.db
      .prepare(
        `SELECT
           e.id, e.type, e.name, e.feature_id, e.status, e.confidence,
           e.last_verified, e.summary, e.file_path,
           f.name AS feature_name
         FROM entries e
         LEFT JOIN entries f ON f.id = e.feature_id
         WHERE e.id IN (${placeholders}) AND e.status = 'active'`,
      )
      .all(...ids) as Array<{
      id: string;
      type: 'feature' | 'aspect';
      name: string;
      feature_id: string | null;
      status: 'active' | 'archived' | 'superseded';
      confidence: number;
      last_verified: string;
      summary: string;
      file_path: string;
      feature_name: string | null;
    }>;

    const byId = new Map(rows.map((r) => [r.id, r]));

    // Drift is computed only for candidates that survived the fusion cut;
    // hashing files we'll discard anyway would be pure overhead.
    const driftById = this.drift
      ? this.drift.check(scored.map((s) => s.entry_id).filter((id) => byId.has(id)))
      : new Map();

    const out: SearchCandidate[] = [];
    for (const s of scored) {
      const row = byId.get(s.entry_id);
      if (!row) continue;
      out.push({
        id: row.id,
        type: row.type,
        name: row.name,
        feature_id: row.feature_id,
        feature_name: row.feature_name,
        summary: row.summary,
        confidence: effectiveConfidence(row.confidence, row.last_verified),
        status: row.status,
        last_verified: row.last_verified,
        scores: {
          embedding: round(s.embedding),
          bm25: round(s.bm25),
          path: round(s.path),
          combined: round(s.combined),
        },
        match_reasons: Array.from(s.reasons),
        content_path: row.file_path,
        drift: driftById.get(s.entry_id) ?? {
          status: 'unknown',
          drifted_files: [],
          missing_files: [],
        },
      });
    }
    return out;
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
