// The save_knowledge flow. Owns the full write path: create / update /
// archive / supersede, optimistic locking, content-hash computation,
// markdown serialization on disk, SQLite reindex, and async embedding
// reindex. Kept outside the MCP tool handler so it can also be driven
// from the CLI (reindex, import, etc.) in the future.
//
// What this flow does NOT do:
//  - Detect semantic contradictions between existing and proposed entries.
//    That decision lives in the agent; by the time save_knowledge is called
//    the agent has already decided it wants to write.
//  - Generate content. The agent supplies the full body.
//
// The only conflict detected here is `conflict_stale`: when the caller
// passes `expected_updated_at` and the stored entry has been modified
// since. That is a true data race and must block the write.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ulid } from 'ulid';
import type { Db } from '../storage/database.js';
import type { DomainMemoryPaths } from '../storage/paths.js';
import type { EntryRepository } from '../storage/entry-repository.js';
import type {
  Entry,
  EntryBody,
  EntryFrontmatter,
  EntryRelations,
} from '../storage/types.js';
import type { Indexer } from '../indexing/indexer.js';

export interface SaveFlowDeps {
  db: Db;
  paths: DomainMemoryPaths;
  entries: EntryRepository;
  indexer: Indexer;
}

export interface EntryInput {
  type: 'feature' | 'aspect';
  slug: string;
  name: string;
  feature_id?: string;
  body: {
    what: string;
    flow_mermaid?: string | null;
    where: string;
  };
  file_paths?: string[];
  symbols?: string[];
  tags?: string[];
  relations?: EntryRelations;
}

export type SaveInput =
  | { action: 'create'; entry: EntryInput }
  | {
      action: 'update';
      target_id: string;
      entry: EntryInput;
      expected_updated_at?: string;
    }
  | {
      action: 'archive';
      target_id: string;
      expected_updated_at?: string;
    }
  | {
      action: 'supersede';
      target_id: string;
      superseded_by: string;
      expected_updated_at?: string;
    };

export type SaveResult =
  | {
      status: 'ok';
      entry_id: string;
      file_written: string;
      confidence_after: number;
    }
  | {
      status: 'conflict_stale';
      entry_id: string;
      stored_updated_at: string;
      expected_updated_at: string;
      message: string;
    }
  | {
      status: 'conflict_duplicate';
      topic_key: string;
      existing_id: string;
      existing_updated_at: string;
      message: string;
    }
  | {
      status: 'error';
      code: string;
      message: string;
    };

const INITIAL_CONFIDENCE = 80;

export class SaveKnowledgeFlow {
  constructor(private readonly deps: SaveFlowDeps) {}

  async execute(input: SaveInput): Promise<SaveResult> {
    try {
      switch (input.action) {
        case 'create':
          return await this.create(input.entry);
        case 'update':
          return await this.update(
            input.target_id,
            input.entry,
            input.expected_updated_at,
          );
        case 'archive':
          return await this.archive(input.target_id, input.expected_updated_at);
        case 'supersede':
          return await this.supersede(
            input.target_id,
            input.superseded_by,
            input.expected_updated_at,
          );
      }
    } catch (err) {
      return {
        status: 'error',
        code: 'internal_error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Bumps last_verified (and updated_at) on an existing entry without
  // touching its body. Used after a human review confirms the knowledge
  // is still accurate — resets the lazy confidence decay clock.
  async verify(targetId: string, expected?: string): Promise<SaveResult> {
    try {
      const existing = this.loadExisting(targetId);
      if (!existing) {
        return {
          status: 'error',
          code: 'not_found',
          message: `Entry not found: ${targetId}`,
        };
      }
      const staleCheck = this.checkOptimisticLock(existing, expected);
      if (staleCheck) return staleCheck;

      const now = new Date().toISOString();
      const updated: Entry = {
        frontmatter: {
          ...existing.frontmatter,
          updated_at: now,
          last_verified: now,
        },
        body: existing.body,
      };
      return await this.persist(updated);
    } catch (err) {
      return {
        status: 'error',
        code: 'internal_error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async create(entry: EntryInput): Promise<SaveResult> {
    if (entry.type === 'aspect' && !entry.feature_id) {
      return {
        status: 'error',
        code: 'invalid_input',
        message: 'Aspect entries require feature_id',
      };
    }
    if (entry.type === 'aspect' && entry.feature_id) {
      if (!this.featureExists(entry.feature_id)) {
        return {
          status: 'error',
          code: 'parent_not_found',
          message: `Parent feature not found: ${entry.feature_id}`,
        };
      }
    }

    const topicKey = this.deriveTopicKey(entry);
    if (topicKey) {
      const existing = this.deps.entries.resolveTopicKey(topicKey);
      if (existing) {
        return {
          status: 'conflict_duplicate',
          topic_key: topicKey,
          existing_id: existing.id,
          existing_updated_at: existing.updated_at,
          message:
            'An active entry already exists under this topic_key. Update it instead of creating a duplicate, or archive the existing one first.',
        };
      }
    }

    const now = new Date().toISOString();
    const id = this.generateId(entry);

    const frontmatter: EntryFrontmatter = {
      id,
      slug: entry.slug,
      name: entry.name,
      type: entry.type,
      status: 'active',
      superseded_by: null,
      confidence: INITIAL_CONFIDENCE,
      created_at: now,
      updated_at: now,
      last_verified: now,
      file_paths: entry.file_paths ?? [],
      symbols: entry.symbols ?? [],
      content_hashes: this.computeHashes(entry.file_paths ?? []),
      tags: entry.tags ?? [],
      ...(entry.type === 'feature' && entry.relations
        ? { relations: entry.relations }
        : {}),
      ...(entry.type === 'aspect' && entry.feature_id
        ? { feature_id: entry.feature_id }
        : {}),
    };

    const full: Entry = {
      frontmatter,
      body: normalizeBody(entry.body),
    };

    return this.persist(full);
  }

  private async update(
    targetId: string,
    entry: EntryInput,
    expected: string | undefined,
  ): Promise<SaveResult> {
    const existing = this.loadExisting(targetId);
    if (!existing) {
      return {
        status: 'error',
        code: 'not_found',
        message: `Entry not found: ${targetId}`,
      };
    }

    const staleCheck = this.checkOptimisticLock(existing, expected);
    if (staleCheck) return staleCheck;

    const now = new Date().toISOString();
    const merged: EntryFrontmatter = {
      ...existing.frontmatter,
      name: entry.name,
      slug: entry.slug,
      type: entry.type,
      file_paths: entry.file_paths ?? existing.frontmatter.file_paths,
      symbols: entry.symbols ?? existing.frontmatter.symbols,
      content_hashes: this.computeHashes(
        entry.file_paths ?? existing.frontmatter.file_paths,
      ),
      tags: entry.tags ?? existing.frontmatter.tags,
      updated_at: now,
      last_verified: now,
    };

    if (entry.type === 'feature') {
      merged.relations = entry.relations ?? existing.frontmatter.relations;
      delete (merged as Partial<EntryFrontmatter>).feature_id;
    } else {
      merged.feature_id =
        entry.feature_id ?? existing.frontmatter.feature_id;
      delete (merged as Partial<EntryFrontmatter>).relations;
    }

    const updated: Entry = {
      frontmatter: merged,
      body: normalizeBody(entry.body),
    };

    return this.persist(updated);
  }

  private async archive(
    targetId: string,
    expected: string | undefined,
  ): Promise<SaveResult> {
    const existing = this.loadExisting(targetId);
    if (!existing) {
      return {
        status: 'error',
        code: 'not_found',
        message: `Entry not found: ${targetId}`,
      };
    }

    const staleCheck = this.checkOptimisticLock(existing, expected);
    if (staleCheck) return staleCheck;

    const now = new Date().toISOString();
    const updated: Entry = {
      frontmatter: {
        ...existing.frontmatter,
        status: 'archived',
        updated_at: now,
      },
      body: existing.body,
    };

    return this.persist(updated);
  }

  private async supersede(
    targetId: string,
    supersededBy: string,
    expected: string | undefined,
  ): Promise<SaveResult> {
    const existing = this.loadExisting(targetId);
    if (!existing) {
      return {
        status: 'error',
        code: 'not_found',
        message: `Entry not found: ${targetId}`,
      };
    }
    if (!this.entryExists(supersededBy)) {
      return {
        status: 'error',
        code: 'replacement_not_found',
        message: `Replacement entry not found: ${supersededBy}`,
      };
    }

    const staleCheck = this.checkOptimisticLock(existing, expected);
    if (staleCheck) return staleCheck;

    const now = new Date().toISOString();
    const updated: Entry = {
      frontmatter: {
        ...existing.frontmatter,
        status: 'superseded',
        superseded_by: supersededBy,
        updated_at: now,
      },
      body: existing.body,
    };

    return this.persist(updated);
  }

  private async persist(entry: Entry): Promise<SaveResult> {
    const written = this.deps.entries.save(entry);
    void this.deps.indexer.indexEntry(entry);

    return {
      status: 'ok',
      entry_id: entry.frontmatter.id,
      file_written: written.relativePath,
      confidence_after: entry.frontmatter.confidence,
    };
  }

  private loadExisting(id: string): Entry | null {
    try {
      return this.deps.entries.loadById(id);
    } catch {
      return null;
    }
  }

  private checkOptimisticLock(
    existing: Entry,
    expected: string | undefined,
  ): SaveResult | null {
    if (!expected) return null;
    if (existing.frontmatter.updated_at === expected) return null;
    return {
      status: 'conflict_stale',
      entry_id: existing.frontmatter.id,
      stored_updated_at: existing.frontmatter.updated_at,
      expected_updated_at: expected,
      message:
        'Entry was modified since the caller last observed it. Re-read and retry.',
    };
  }

  private featureExists(featureId: string): boolean {
    const row = this.deps.db
      .prepare('SELECT id FROM entries WHERE id = ? AND type = ?')
      .get(featureId, 'feature');
    return row !== undefined;
  }

  private entryExists(id: string): boolean {
    const row = this.deps.db
      .prepare('SELECT id FROM entries WHERE id = ?')
      .get(id);
    return row !== undefined;
  }

  private deriveTopicKey(entry: EntryInput): string | null {
    if (entry.type === 'feature') return entry.slug;
    if (!entry.feature_id) return null;
    const row = this.deps.db
      .prepare('SELECT slug FROM entries WHERE id = ? AND type = ?')
      .get(entry.feature_id, 'feature') as { slug: string } | undefined;
    if (!row) return null;
    return `${row.slug}/${entry.slug}`;
  }

  private generateId(entry: EntryInput): string {
    const suffix = ulid().toLowerCase();
    const prefix = entry.type === 'feature' ? 'feat' : 'asp';
    return `${prefix}_${entry.slug}_${suffix.slice(-6)}`;
  }

  private computeHashes(filePaths: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of filePaths) {
      if (p.endsWith('/')) continue;
      const abs = resolve(this.deps.paths.root, p);
      try {
        const content = readFileSync(abs);
        const hash = createHash('sha256').update(content).digest('hex');
        out[p] = `sha256:${hash}`;
      } catch {
        // File not present or not readable — skip. Drift check will pick it up.
      }
    }
    return out;
  }
}

function normalizeBody(body: EntryInput['body']): EntryBody {
  return {
    what: body.what,
    flow_mermaid: body.flow_mermaid ?? null,
    where: body.where,
  };
}
