import { describe, expect, it } from 'vitest';
import { parseEntry, serializeEntry, summaryOf } from './markdown.js';
import type { Entry } from './types.js';

describe('markdown parser', () => {
  it('parses a minimal feature with required sections', () => {
    const raw = [
      '---',
      'id: feat_test',
      'slug: test',
      'name: Test Feature',
      'type: feature',
      'status: active',
      'confidence: 80',
      'created_at: 2026-04-11T10:00:00Z',
      'updated_at: 2026-04-11T10:00:00Z',
      'last_verified: 2026-04-11T10:00:00Z',
      'file_paths:',
      '  - src/test.ts',
      'symbols: []',
      'content_hashes: {}',
      'tags: []',
      '---',
      '',
      '## What it does',
      '',
      'Does things.',
      '',
      '## Where it lives',
      '',
      '- src/test.ts',
      '',
    ].join('\n');

    const entry = parseEntry(raw);
    expect(entry.frontmatter.id).toBe('feat_test');
    expect(entry.frontmatter.type).toBe('feature');
    expect(entry.body.what).toBe('Does things.');
    expect(entry.body.flow_mermaid).toBeNull();
  });

  it('coerces YAML timestamps to ISO strings instead of Date objects', () => {
    const raw = [
      '---',
      'id: feat_test',
      'slug: test',
      'name: Test',
      'type: feature',
      'status: active',
      'confidence: 80',
      'created_at: 2026-04-11T10:00:00Z',
      'updated_at: 2026-04-11T10:00:00Z',
      'last_verified: 2026-04-11T10:00:00Z',
      'file_paths: []',
      'symbols: []',
      'content_hashes: {}',
      'tags: []',
      '---',
      '## What it does',
      'x',
      '## Where it lives',
      'y',
    ].join('\n');

    const entry = parseEntry(raw);
    expect(typeof entry.frontmatter.created_at).toBe('string');
    expect(typeof entry.frontmatter.updated_at).toBe('string');
    expect(entry.frontmatter.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('extracts a Mermaid diagram from "How it flows"', () => {
    const raw = [
      '---',
      'id: feat_test',
      'slug: test',
      'name: Test',
      'type: feature',
      'status: active',
      'confidence: 80',
      'created_at: 2026-04-11T10:00:00Z',
      'updated_at: 2026-04-11T10:00:00Z',
      'last_verified: 2026-04-11T10:00:00Z',
      'file_paths: []',
      'symbols: []',
      'content_hashes: {}',
      'tags: []',
      '---',
      '## What it does',
      'x',
      '## How it flows',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '## Where it lives',
      'y',
    ].join('\n');

    const entry = parseEntry(raw);
    expect(entry.body.flow_mermaid).toBe('flowchart TD\n  A --> B');
  });

  it('fails when required sections are missing', () => {
    const raw = [
      '---',
      'id: feat_test',
      'slug: test',
      'name: Test',
      'type: feature',
      'status: active',
      'confidence: 80',
      'created_at: 2026-04-11T10:00:00Z',
      'updated_at: 2026-04-11T10:00:00Z',
      'last_verified: 2026-04-11T10:00:00Z',
      'file_paths: []',
      'symbols: []',
      'content_hashes: {}',
      'tags: []',
      '---',
      '## What it does',
      'x',
    ].join('\n');

    expect(() => parseEntry(raw)).toThrow(/Where it lives/);
  });

  it('fails when an aspect is missing feature_id', () => {
    const raw = [
      '---',
      'id: asp_test',
      'slug: test',
      'name: Test',
      'type: aspect',
      'status: active',
      'confidence: 80',
      'created_at: 2026-04-11T10:00:00Z',
      'updated_at: 2026-04-11T10:00:00Z',
      'last_verified: 2026-04-11T10:00:00Z',
      'file_paths: []',
      'symbols: []',
      'content_hashes: {}',
      'tags: []',
      '---',
      '## What it does',
      'x',
      '## Where it lives',
      'y',
    ].join('\n');

    expect(() => parseEntry(raw)).toThrow(/feature_id/);
  });

  it('round-trips through serialize + parse', () => {
    const entry: Entry = {
      frontmatter: {
        id: 'feat_rt',
        slug: 'rt',
        name: 'Round Trip',
        type: 'feature',
        status: 'active',
        confidence: 80,
        created_at: '2026-04-11T10:00:00Z',
        updated_at: '2026-04-11T10:00:00Z',
        last_verified: '2026-04-11T10:00:00Z',
        file_paths: ['src/rt.ts'],
        symbols: ['RT'],
        content_hashes: { 'src/rt.ts': 'sha256:abc' },
        tags: ['x'],
      },
      body: {
        what: 'It does a round trip.',
        flow_mermaid: 'flowchart TD\n  A --> B',
        where: '- src/rt.ts',
      },
    };

    const serialized = serializeEntry(entry);
    const parsed = parseEntry(serialized);

    expect(parsed.frontmatter.id).toBe(entry.frontmatter.id);
    expect(parsed.body.what).toBe(entry.body.what);
    expect(parsed.body.flow_mermaid).toBe(entry.body.flow_mermaid);
    expect(parsed.body.where).toBe(entry.body.where);
    expect(parsed.frontmatter.file_paths).toEqual(entry.frontmatter.file_paths);
  });

  it('accepts localized (Spanish) section headings, accent-insensitive', () => {
    const raw = [
      '---',
      'id: asp_test',
      'slug: test',
      'name: Test',
      'type: aspect',
      'feature_id: feat_test',
      'status: active',
      'confidence: 80',
      'created_at: 2026-04-11T10:00:00Z',
      'updated_at: 2026-04-11T10:00:00Z',
      'last_verified: 2026-04-11T10:00:00Z',
      'file_paths: []',
      'symbols: []',
      'content_hashes: {}',
      'tags: []',
      '---',
      '## Qué hace',
      'Hace cosas.',
      '## Cómo fluye',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '## Dónde vive',
      '- src/test.ts',
    ].join('\n');

    const entry = parseEntry(raw);
    expect(entry.body.what).toBe('Hace cosas.');
    expect(entry.body.flow_mermaid).toBe('flowchart TD\n  A --> B');
    expect(entry.body.where).toBe('- src/test.ts');
  });

  it('keeps non-structural "## ..." subheadings as content, not boundaries', () => {
    const raw = [
      '---',
      'id: feat_test',
      'slug: test',
      'name: Test',
      'type: feature',
      'status: active',
      'confidence: 80',
      'created_at: 2026-04-11T10:00:00Z',
      'updated_at: 2026-04-11T10:00:00Z',
      'last_verified: 2026-04-11T10:00:00Z',
      'file_paths: []',
      'symbols: []',
      'content_hashes: {}',
      'tags: []',
      '---',
      '## Qué hace',
      'Intro.',
      '',
      '## Por qué importa',
      'Razón crítica que no debe perderse.',
      '## Dónde vive',
      'y',
    ].join('\n');

    const entry = parseEntry(raw);
    expect(entry.body.what).toContain('Intro.');
    expect(entry.body.what).toContain('## Por qué importa');
    expect(entry.body.what).toContain('Razón crítica que no debe perderse.');
  });

  it('defaults content_hashes to {} when the field is absent', () => {
    const raw = [
      '---',
      'id: feat_test',
      'slug: test',
      'name: Test',
      'type: feature',
      'status: active',
      'confidence: 80',
      'created_at: 2026-04-11T10:00:00Z',
      'updated_at: 2026-04-11T10:00:00Z',
      'last_verified: 2026-04-11T10:00:00Z',
      'file_paths: []',
      'symbols: []',
      'tags: []',
      '---',
      '## What it does',
      'x',
      '## Where it lives',
      'y',
    ].join('\n');

    const entry = parseEntry(raw);
    expect(entry.frontmatter.content_hashes).toEqual({});
  });

  it('does not treat a "## ..." line inside a fenced code block as a boundary', () => {
    const raw = [
      '---',
      'id: feat_test',
      'slug: test',
      'name: Test',
      'type: feature',
      'status: active',
      'confidence: 80',
      'created_at: 2026-04-11T10:00:00Z',
      'updated_at: 2026-04-11T10:00:00Z',
      'last_verified: 2026-04-11T10:00:00Z',
      'file_paths: []',
      'symbols: []',
      'content_hashes: {}',
      'tags: []',
      '---',
      '## What it does',
      '```sh',
      '## Where it lives  # this is a shell comment, not a heading',
      'echo hi',
      '```',
      'real content',
      '## Where it lives',
      'y',
    ].join('\n');

    const entry = parseEntry(raw);
    expect(entry.body.what).toContain('## Where it lives  # this is a shell comment');
    expect(entry.body.what).toContain('real content');
    expect(entry.body.where).toBe('y');
  });

  it('summaryOf returns the full body.what when within the char budget', () => {
    const entry = makeEntry('First paragraph.\n\nSecond paragraph.');
    expect(summaryOf(entry)).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('summaryOf cuts at a paragraph boundary when the body exceeds the budget', () => {
    const long = 'a'.repeat(900);
    const longer = 'b'.repeat(900);
    const entry = makeEntry(`${long}\n\n${longer}`);
    expect(summaryOf(entry)).toBe(long);
  });

  it('summaryOf falls back to an ellipsis when no paragraph boundary fits', () => {
    const huge = 'c'.repeat(3000);
    const entry = makeEntry(huge);
    const result = summaryOf(entry);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(1501);
  });
});

function makeEntry(what: string): Entry {
  return {
    frontmatter: {
      id: 'x',
      slug: 'x',
      name: 'x',
      type: 'feature',
      status: 'active',
      confidence: 80,
      created_at: 'x',
      updated_at: 'x',
      last_verified: 'x',
      file_paths: [],
      symbols: [],
      content_hashes: {},
      tags: [],
    },
    body: {
      what,
      flow_mermaid: null,
      where: '',
    },
  };
}
