// Read and write entries. Markdown on disk is the source of truth — every
// write reindexes the corresponding rows in SQLite. Embeddings are handled
// by a separate layer (indexer) and are not touched here.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve, join } from 'node:path';
import type { Statement } from 'better-sqlite3';
import type { Db } from './database.js';
import {
  parseEntry,
  serializeEntry,
  summaryOf,
} from './markdown.js';
import {
  aspectFile,
  featureFile,
  type DomainMemoryPaths,
} from './paths.js';
import { stripPrivate } from './redact.js';
import type { Entry, EntryRelations } from './types.js';

export class EntryNotFoundError extends Error {
  constructor(id: string) {
    super(`Entry not found: ${id}`);
    this.name = 'EntryNotFoundError';
  }
}

export class EntryRepository {
  constructor(
    private readonly db: Db,
    private readonly paths: DomainMemoryPaths,
  ) {}

  loadById(id: string): Entry {
    const row = this.db
      .prepare('SELECT file_path FROM entries WHERE id = ?')
      .get(id) as { file_path: string } | undefined;
    if (!row) throw new EntryNotFoundError(id);
    return this.loadFromFile(resolve(this.paths.root, row.file_path));
  }

  loadFromFile(absolutePath: string): Entry {
    const raw = readFileSync(absolutePath, 'utf-8');
    return parseEntry(raw, absolutePath);
  }

  resolveFilePathFor(entry: Entry): string {
    const fm = entry.frontmatter;
    if (fm.type === 'feature') {
      return featureFile(this.paths, fm.slug);
    }
    if (!fm.feature_id) {
      throw new Error(`Aspect ${fm.id} missing feature_id`);
    }
    const featureSlug = this.slugOfFeature(fm.feature_id);
    return aspectFile(this.paths, featureSlug, fm.slug);
  }

  save(entry: Entry): { absolutePath: string; relativePath: string } {
    const absolutePath = this.resolveFilePathFor(entry);
    mkdirSync(dirname(absolutePath), { recursive: true });

    const serialized = serializeEntry(entry);
    writeFileSync(absolutePath, serialized, 'utf-8');

    const rel = relative(this.paths.root, absolutePath);
    this.indexEntry(entry, rel);

    return { absolutePath, relativePath: rel };
  }

  indexEntry(entry: Entry, relativePath: string): void {
    const fm = entry.frontmatter;
    const summary = summaryOf(entry);
    const bodyText = this.flatBody(entry);

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO entries (
            id, type, slug, name, feature_id, topic_key, status, superseded_by,
            confidence, created_at, updated_at, last_verified,
            file_path, summary
          ) VALUES (
            @id, @type, @slug, @name, @feature_id, @topic_key, @status, @superseded_by,
            @confidence, @created_at, @updated_at, @last_verified,
            @file_path, @summary
          )
          ON CONFLICT(id) DO UPDATE SET
            type = excluded.type,
            slug = excluded.slug,
            name = excluded.name,
            feature_id = excluded.feature_id,
            topic_key = excluded.topic_key,
            status = excluded.status,
            superseded_by = excluded.superseded_by,
            confidence = excluded.confidence,
            updated_at = excluded.updated_at,
            last_verified = excluded.last_verified,
            file_path = excluded.file_path,
            summary = excluded.summary`,
        )
        .run({
          id: fm.id,
          type: fm.type,
          slug: fm.slug,
          name: fm.name,
          feature_id: fm.feature_id ?? null,
          topic_key: this.computeTopicKey(entry),
          status: fm.status,
          superseded_by: fm.superseded_by ?? null,
          confidence: fm.confidence,
          created_at: fm.created_at,
          updated_at: fm.updated_at,
          last_verified: fm.last_verified,
          file_path: relativePath,
          summary,
        });

      this.db.prepare('DELETE FROM entry_paths WHERE entry_id = ?').run(fm.id);
      const insertPath = this.db.prepare(
        'INSERT INTO entry_paths (entry_id, path, is_dir, content_hash) VALUES (?, ?, ?, ?)',
      );
      for (const p of fm.file_paths) {
        const isDir = p.endsWith('/') ? 1 : 0;
        const hash = fm.content_hashes[p] ?? null;
        insertPath.run(fm.id, p, isDir, hash);
      }

      this.db.prepare('DELETE FROM entry_symbols WHERE entry_id = ?').run(fm.id);
      const insertSymbol = this.db.prepare(
        'INSERT INTO entry_symbols (entry_id, symbol) VALUES (?, ?)',
      );
      for (const s of fm.symbols) {
        insertSymbol.run(fm.id, s);
      }

      this.db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(fm.id);
      const insertTag = this.db.prepare(
        'INSERT INTO entry_tags (entry_id, tag) VALUES (?, ?)',
      );
      for (const t of fm.tags) {
        insertTag.run(fm.id, t);
      }

      this.db.prepare('DELETE FROM entry_relations WHERE from_id = ?').run(fm.id);
      if (fm.type === 'feature' && fm.relations) {
        const insertRel = this.db.prepare<[string, string, string]>(
          'INSERT INTO entry_relations (from_id, to_id, kind) VALUES (?, ?, ?)',
        );
        this.insertRelations(insertRel, fm.id, fm.relations);
      }

      this.db
        .prepare('DELETE FROM entries_fts WHERE entry_id = ?')
        .run(fm.id);
      this.db
        .prepare(
          'INSERT INTO entries_fts (entry_id, name, summary, body) VALUES (?, ?, ?, ?)',
        )
        .run(fm.id, fm.name, summary, bodyText);
    });

    tx();
  }

  removeFromIndex(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM entries_fts WHERE entry_id = ?').run(id);
      this.db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    });
    tx();
  }

  // Returns the canonical dedup key for an entry: features map to their slug,
  // aspects to "<featureSlug>/<aspectSlug>". Aspects whose parent feature is
  // not yet indexed fall back to null — this happens during a cold reindex
  // where features and aspects are processed separately; the two-pass reindex
  // then re-runs and the parent is available.
  computeTopicKey(entry: Entry): string | null {
    const fm = entry.frontmatter;
    if (fm.type === 'feature') return fm.slug;
    if (!fm.feature_id) return null;
    try {
      return `${this.slugOfFeature(fm.feature_id)}/${fm.slug}`;
    } catch {
      return null;
    }
  }

  // Resolves a topic_key to the currently active entry, if any. Returns the
  // minimal metadata an agent needs to decide whether to update vs create:
  // id and updated_at (for optimistic locking on the follow-up save).
  resolveTopicKey(
    topicKey: string,
  ): { id: string; updated_at: string; type: 'feature' | 'aspect'; status: string } | null {
    const row = this.db
      .prepare(
        `SELECT id, updated_at, type, status
         FROM entries
         WHERE topic_key = ? AND status = 'active'
         LIMIT 1`,
      )
      .get(topicKey) as
      | { id: string; updated_at: string; type: 'feature' | 'aspect'; status: string }
      | undefined;
    return row ?? null;
  }

  listIndexed(): Array<{ id: string; file_path: string }> {
    return this.db
      .prepare('SELECT id, file_path FROM entries ORDER BY id')
      .all() as Array<{ id: string; file_path: string }>;
  }

  scanDisk(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      let children: string[];
      try {
        children = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of children) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
        } else if (st.isFile() && name.endsWith('.md')) {
          out.push(full);
        }
      }
    };
    walk(this.paths.knowledge);
    return out;
  }

  private slugOfFeature(featureId: string): string {
    const row = this.db
      .prepare('SELECT slug FROM entries WHERE id = ? AND type = ?')
      .get(featureId, 'feature') as { slug: string } | undefined;
    if (!row) {
      throw new Error(`Feature not found in index: ${featureId}`);
    }
    return row.slug;
  }

  private flatBody(entry: Entry): string {
    // Redacted before joining — entries_fts must not index `<private>`
    // content, otherwise a BM25 query for a private term would expose
    // its presence and surrounding context.
    const parts: string[] = [
      stripPrivate(entry.body.what),
      stripPrivate(entry.body.where),
    ];
    if (entry.body.flow_mermaid) {
      parts.push(stripPrivate(entry.body.flow_mermaid));
    }
    return parts.join('\n\n');
  }

  private insertRelations(
    stmt: Statement<[string, string, string]>,
    fromId: string,
    relations: EntryRelations,
  ): void {
    const kinds: Array<keyof EntryRelations> = [
      'depends_on',
      'triggers',
      'related_to',
    ];
    for (const kind of kinds) {
      const targets = relations[kind];
      if (!targets) continue;
      for (const to of targets) {
        stmt.run(fromId, to, kind);
      }
    }
  }
}
