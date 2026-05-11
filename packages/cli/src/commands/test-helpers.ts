// Shared helpers for CLI command tests. Silences stdout/stderr during a
// command run so test output stays clean, and restores the originals
// afterwards. Also provides a small fixture factory for writing a
// minimal knowledge tree on disk.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function silenceOutput(): () => void {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  (process.stdout as unknown as { write: typeof origOut }).write = (() =>
    true) as unknown as typeof origOut;
  (process.stderr as unknown as { write: typeof origErr }).write = (() =>
    true) as unknown as typeof origErr;
  return () => {
    (process.stdout as unknown as { write: typeof origOut }).write = origOut;
    (process.stderr as unknown as { write: typeof origErr }).write = origErr;
  };
}

export interface KnowledgeFixtureOptions {
  root: string;
  featureSlug: string;
  featureId: string;
  aspectSlug?: string;
  aspectId?: string;
  filePath: string;
  timestamp?: string;
}

export function writeKnowledgeFixture(opts: KnowledgeFixtureOptions): void {
  const ts = opts.timestamp ?? '2026-04-11T10:00:00Z';
  const base = join(opts.root, '.domain-memory', 'knowledge', opts.featureSlug);
  mkdirSync(base, { recursive: true });

  const featureYaml = [
    '---',
    `id: ${opts.featureId}`,
    `slug: ${opts.featureSlug}`,
    `name: ${capitalize(opts.featureSlug)}`,
    'type: feature',
    'status: active',
    'confidence: 80',
    `created_at: ${ts}`,
    `updated_at: ${ts}`,
    `last_verified: ${ts}`,
    'file_paths:',
    `  - ${opts.filePath}`,
    'symbols: []',
    'content_hashes: {}',
    'tags: []',
    '---',
    '',
    '## What it does',
    '',
    'Feature fixture.',
    '',
    '## Where it lives',
    '',
    `- ${opts.filePath}`,
    '',
  ].join('\n');

  writeFileSync(join(base, 'feature.md'), featureYaml, 'utf-8');

  if (opts.aspectSlug && opts.aspectId) {
    const aspectsDir = join(base, 'aspects');
    mkdirSync(aspectsDir, { recursive: true });

    const aspectYaml = [
      '---',
      `id: ${opts.aspectId}`,
      `slug: ${opts.aspectSlug}`,
      `name: ${capitalize(opts.aspectSlug)}`,
      'type: aspect',
      `feature_id: ${opts.featureId}`,
      'status: active',
      'confidence: 85',
      `created_at: ${ts}`,
      `updated_at: ${ts}`,
      `last_verified: ${ts}`,
      'file_paths:',
      `  - ${opts.filePath}`,
      'symbols: []',
      'content_hashes: {}',
      'tags: []',
      '---',
      '',
      '## What it does',
      '',
      'Aspect fixture.',
      '',
      '## Where it lives',
      '',
      `- ${opts.filePath}`,
      '',
    ].join('\n');

    writeFileSync(join(aspectsDir, `${opts.aspectSlug}.md`), aspectYaml, 'utf-8');
  }
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}
