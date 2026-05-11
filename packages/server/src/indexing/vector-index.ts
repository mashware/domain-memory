// Wraps the entries_vec virtual table (sqlite-vec). Upserts a 384-dim
// embedding for a given entry id and runs nearest-neighbour queries.

import type { Db } from '../storage/database.js';
import { EMBEDDING_DIM, embeddingToBuffer } from './embedder.js';

export interface VectorMatch {
  entry_id: string;
  distance: number;
}

export class VectorIndex {
  constructor(private readonly db: Db) {}

  upsert(entryId: string, embedding: Float32Array): void {
    if (embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `Vector length ${embedding.length} does not match expected ${EMBEDDING_DIM}`,
      );
    }
    const buf = embeddingToBuffer(embedding);
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM entries_vec WHERE entry_id = ?').run(entryId);
      this.db
        .prepare('INSERT INTO entries_vec (entry_id, embedding) VALUES (?, ?)')
        .run(entryId, buf);
    });
    tx();
  }

  remove(entryId: string): void {
    this.db.prepare('DELETE FROM entries_vec WHERE entry_id = ?').run(entryId);
  }

  search(embedding: Float32Array, limit: number): VectorMatch[] {
    if (embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `Query vector length ${embedding.length} does not match expected ${EMBEDDING_DIM}`,
      );
    }
    const buf = embeddingToBuffer(embedding);
    const rows = this.db
      .prepare(
        `SELECT entry_id, distance
         FROM entries_vec
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`,
      )
      .all(buf, limit) as Array<{ entry_id: string; distance: number }>;
    return rows;
  }
}
