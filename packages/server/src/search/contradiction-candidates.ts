// Surfaces pairs of active entries that overlap heavily — candidates that an
// agent (or the user) should review for contradiction. This is deliberately a
// MECHANICAL signal only: it finds entries that talk about the same thing, not
// entries that actually contradict. Whether two overlapping entries conflict is
// a semantic judgment, and per the project's first principle that judgment lives
// in the LLM, never in SQL. So this never asserts a contradiction; it only flags
// what is worth a look.
//
// Signal: cosine similarity between the persisted embeddings of two entries.
// Reading stored vectors means no re-embedding, so this works even when the
// live embedder is down. When the index has no embeddings at all (e.g. it was
// built while the embedder was unavailable) the check degrades quietly to
// "no signal" rather than falling back to a lexical heuristic — BM25 relevance
// scores do not map onto a similarity threshold, so a lexical fallback would
// be noise. `doctor` already nudges the user to reindex when embeddings are
// missing, which is the real fix.

import type { Db } from '../storage/database.js';
import type { VectorIndex } from '../indexing/vector-index.js';

export interface ContradictionCandidate {
  a: { id: string; name: string };
  b: { id: string; name: string };
  // 0..1, higher = more similar. Cosine similarity between the two embeddings.
  similarity: number;
  // Both entries belong to the same feature (expected to overlap more).
  sameFeature: boolean;
}

export interface ContradictionScanResult {
  // Capped and sorted by similarity descending.
  candidates: ContradictionCandidate[];
  // Total candidates found before the cap, so callers can say "showing N of M".
  total: number;
  // 'none' when there are no embeddings to compare or nothing crossed the bar.
  signal: 'embedding' | 'none';
}

export interface ContradictionScanOptions {
  // Minimum cosine similarity to flag a pair.
  minSimilarity?: number;
  // Maximum number of pairs to return.
  maxPairs?: number;
  // Nearest neighbours to inspect per entry.
  neighbors?: number;
}

interface ActiveRow {
  id: string;
  name: string;
  type: string;
  feature_id: string | null;
}

const DEFAULT_MIN_SIMILARITY = 0.85;
const DEFAULT_MAX_PAIRS = 10;
const DEFAULT_NEIGHBORS = 5;

export function findContradictionCandidates(
  db: Db,
  vectors: VectorIndex,
  opts: ContradictionScanOptions = {},
): ContradictionScanResult {
  const minSimilarity = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const maxPairs = opts.maxPairs ?? DEFAULT_MAX_PAIRS;
  const neighbors = opts.neighbors ?? DEFAULT_NEIGHBORS;

  const active = db
    .prepare(
      "SELECT id, name, type, feature_id FROM entries WHERE status = 'active'",
    )
    .all() as ActiveRow[];
  if (active.length < 2) {
    return { candidates: [], total: 0, signal: 'none' };
  }

  const byId = new Map(active.map((row) => [row.id, row]));

  const hasVectors =
    (db.prepare('SELECT COUNT(*) AS n FROM entries_vec').get() as { n: number })
      .n > 0;
  if (!hasVectors) {
    return { candidates: [], total: 0, signal: 'none' };
  }

  const pairs = collectByEmbedding(
    active,
    byId,
    vectors,
    minSimilarity,
    neighbors,
  );
  pairs.sort((x, y) => y.similarity - x.similarity);

  return {
    candidates: pairs.slice(0, maxPairs),
    total: pairs.length,
    signal: pairs.length > 0 ? 'embedding' : 'none',
  };
}

function collectByEmbedding(
  active: ActiveRow[],
  byId: Map<string, ActiveRow>,
  vectors: VectorIndex,
  minSimilarity: number,
  neighbors: number,
): ContradictionCandidate[] {
  const seen = new Set<string>();
  const out: ContradictionCandidate[] = [];

  for (const entry of active) {
    const embedding = vectors.getEmbedding(entry.id);
    if (!embedding) continue;

    // +1 because the entry itself is its own nearest neighbour (distance ~0).
    const matches = vectors.search(embedding, neighbors + 1);
    for (const match of matches) {
      if (match.entry_id === entry.id) continue;
      const other = byId.get(match.entry_id);
      if (!other) continue;

      const similarity = cosineFromL2(match.distance);
      if (similarity < minSimilarity) continue;

      const candidate = buildPair(entry, other, similarity, seen);
      if (candidate) out.push(candidate);
    }
  }

  return out;
}

// Builds a deduplicated, noise-filtered candidate pair, or null when the pair
// should be ignored (already seen, or a feature and its own aspect, which are
// expected to overlap by design and elaborate rather than contradict).
function buildPair(
  a: ActiveRow,
  b: ActiveRow,
  similarity: number,
  seen: Set<string>,
): ContradictionCandidate | null {
  if (isParentChild(a, b)) return null;

  const [first, second] = a.id < b.id ? [a, b] : [b, a];
  const key = `${first.id}::${second.id}`;
  if (seen.has(key)) return null;
  seen.add(key);

  return {
    a: { id: first.id, name: first.name },
    b: { id: second.id, name: second.name },
    similarity,
    sameFeature: featureOf(a) !== null && featureOf(a) === featureOf(b),
  };
}

// A feature and one of its own aspects: the aspect's feature_id points at the
// feature's id. These describe the same area on purpose, so they are not
// contradiction candidates.
function isParentChild(a: ActiveRow, b: ActiveRow): boolean {
  return a.feature_id === b.id || b.feature_id === a.id;
}

// The feature an entry belongs to: itself if it is a feature, else its parent.
function featureOf(row: ActiveRow): string | null {
  return row.type === 'feature' ? row.id : row.feature_id;
}

// Embeddings are L2-normalized, so the L2 distance d returned by sqlite-vec
// maps to cosine similarity as cos = 1 - d^2 / 2. Clamped to [0, 1].
function cosineFromL2(distance: number): number {
  const cos = 1 - (distance * distance) / 2;
  if (cos < 0) return 0;
  if (cos > 1) return 1;
  return cos;
}
