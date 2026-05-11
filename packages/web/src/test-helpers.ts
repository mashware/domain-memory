// Minimal fixture helper for the web package tests. Writes a realistic
// .domain-memory tree and populates the SQLite index via the server
// library so the web layer can query it end-to-end.

import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, join } from 'node:path';
import {
  createServerContext,
  type ServerContext,
} from '@mashware/domain-memory-server';

export interface SeedEntry {
  type: 'feature' | 'aspect';
  id: string;
  slug: string;
  name: string;
  feature_id?: string;
  file_paths?: string[];
  tags?: string[];
  what?: string;
  flow_mermaid?: string | null;
  confidence?: number;
  last_verified?: string;
  status?: 'active' | 'archived' | 'superseded';
  relations?: {
    depends_on?: string[];
    triggers?: string[];
    related_to?: string[];
  };
}

export function seedProject(root: string, entries: SeedEntry[]): ServerContext {
  mkdirSync(join(root, '.domain-memory'), { recursive: true });

  for (const entry of entries) {
    const markdown = buildEntryMarkdown(entry);
    const file = entryFile(root, entry);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, markdown, 'utf-8');
  }

  const ctx = createServerContext(root);

  // Index features first so aspect feature_id references resolve.
  const sorted = [...entries].sort((a, b) =>
    a.type === 'feature' ? -1 : b.type === 'feature' ? 1 : 0,
  );
  for (const entry of sorted) {
    const file = entryFile(root, entry);
    const loaded = ctx.entries.loadFromFile(file);
    ctx.entries.indexEntry(loaded, relative(root, file));
  }

  return ctx;
}

function entryFile(root: string, entry: SeedEntry): string {
  if (entry.type === 'feature') {
    return join(
      root,
      '.domain-memory',
      'knowledge',
      entry.slug,
      'feature.md',
    );
  }
  const featureSlug = entry.feature_id?.replace(/^feat_/, '').replace(/_.*$/, '');
  return join(
    root,
    '.domain-memory',
    'knowledge',
    featureSlug ?? 'unknown',
    'aspects',
    `${entry.slug}.md`,
  );
}

function buildEntryMarkdown(entry: SeedEntry): string {
  const ts = entry.last_verified ?? '2026-04-11T10:00:00Z';
  const lines: string[] = ['---'];
  lines.push(`id: ${entry.id}`);
  lines.push(`slug: ${entry.slug}`);
  lines.push(`name: ${entry.name}`);
  lines.push(`type: ${entry.type}`);
  if (entry.feature_id) lines.push(`feature_id: ${entry.feature_id}`);
  lines.push(`status: ${entry.status ?? 'active'}`);
  lines.push(`confidence: ${entry.confidence ?? 80}`);
  lines.push(`created_at: ${ts}`);
  lines.push(`updated_at: ${ts}`);
  lines.push(`last_verified: ${ts}`);
  const filePaths = entry.file_paths ?? [];
  if (filePaths.length === 0) {
    lines.push('file_paths: []');
  } else {
    lines.push('file_paths:');
    for (const p of filePaths) lines.push(`  - ${p}`);
  }
  lines.push('symbols: []');
  lines.push('content_hashes: {}');
  if (entry.tags && entry.tags.length > 0) {
    lines.push('tags:');
    for (const t of entry.tags) lines.push(`  - ${t}`);
  } else {
    lines.push('tags: []');
  }
  if (entry.relations) {
    lines.push('relations:');
    if (entry.relations.depends_on) {
      lines.push('  depends_on:');
      for (const r of entry.relations.depends_on) lines.push(`    - ${r}`);
    }
    if (entry.relations.triggers) {
      lines.push('  triggers:');
      for (const r of entry.relations.triggers) lines.push(`    - ${r}`);
    }
    if (entry.relations.related_to) {
      lines.push('  related_to:');
      for (const r of entry.relations.related_to) lines.push(`    - ${r}`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push('## What it does');
  lines.push('');
  lines.push(entry.what ?? `${entry.name} fixture.`);
  lines.push('');
  if (entry.flow_mermaid) {
    lines.push('## How it flows');
    lines.push('');
    lines.push('```mermaid');
    lines.push(entry.flow_mermaid);
    lines.push('```');
    lines.push('');
  }
  lines.push('## Where it lives');
  lines.push('');
  for (const p of entry.file_paths ?? []) lines.push(`- ${p}`);
  if ((entry.file_paths ?? []).length === 0) lines.push('- (none)');
  lines.push('');
  return lines.join('\n');
}
