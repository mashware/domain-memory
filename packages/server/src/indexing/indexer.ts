// Orchestrates embedding generation and vector-index maintenance for
// entries. Every time an entry is saved through EntryRepository, the
// indexer is called to recompute its vector. Failures are non-fatal —
// we log and continue, because embeddings are a secondary lookup path
// and the other matchers (BM25 + paths/symbols) keep working without them.

import { summaryOf, type Entry } from '../storage/index.js';
import type { Embedder } from './embedder.js';
import type { VectorIndex } from './vector-index.js';

export interface IndexerLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export class Indexer {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectors: VectorIndex,
    private readonly logger: IndexerLogger,
  ) {}

  async indexEntry(entry: Entry): Promise<void> {
    const text = embeddingTextFor(entry);
    try {
      const vec = await this.embedder.embed(text);
      this.vectors.upsert(entry.frontmatter.id, vec);
    } catch (err) {
      this.logger.warn('embedding_failed', {
        entry_id: entry.frontmatter.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async indexMany(entries: Entry[]): Promise<{ ok: number; failed: number }> {
    let ok = 0;
    let failed = 0;
    for (const entry of entries) {
      try {
        await this.indexEntry(entry);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    return { ok, failed };
  }

  removeEntry(entryId: string): void {
    this.vectors.remove(entryId);
  }
}

export function embeddingTextFor(entry: Entry): string {
  const name = entry.frontmatter.name;
  const summary = summaryOf(entry);
  return `${name}\n${summary}`;
}
