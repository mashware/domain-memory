// Parses and serializes feature.md / aspect.md files.
// Markdown on disk is the source of truth. Frontmatter is YAML. The body has
// three required sections: "## What it does", "## How it flows" (optional for
// aspects), "## Where it lives". The Mermaid diagram lives inside the
// "How it flows" section, fenced as ```mermaid.

import matter from 'gray-matter';
import type { Entry, EntryBody, EntryFrontmatter } from './types.js';
import { stripPrivate } from './redact.js';

const SECTION_WHAT = '## What it does';
const SECTION_FLOW = '## How it flows';
const SECTION_WHERE = '## Where it lives';

export class MarkdownParseError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(path ? `${message} (${path})` : message);
    this.name = 'MarkdownParseError';
  }
}

export function parseEntry(raw: string, path?: string): Entry {
  const parsed = matter(raw);
  const frontmatter = coerceDates(parsed.data) as Partial<EntryFrontmatter>;

  validateFrontmatter(frontmatter, path);

  const body = parseBody(parsed.content, path);

  return {
    frontmatter: frontmatter as EntryFrontmatter,
    body,
  };
}

// YAML parses ISO-8601 timestamps as Date objects by default. SQLite can't
// bind Date values, and we want timestamps as strings everywhere downstream.
// This walks the parsed frontmatter and rewrites any Date to its ISO string.
function coerceDates(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Date) {
      out[key] = value.toISOString();
    } else {
      out[key] = value;
    }
  }
  return out;
}

function validateFrontmatter(
  fm: Partial<EntryFrontmatter>,
  path: string | undefined,
): asserts fm is EntryFrontmatter {
  const required: (keyof EntryFrontmatter)[] = [
    'id',
    'slug',
    'name',
    'type',
    'status',
    'confidence',
    'created_at',
    'updated_at',
    'last_verified',
    'file_paths',
    'symbols',
    'content_hashes',
    'tags',
  ];
  for (const key of required) {
    if (fm[key] === undefined || fm[key] === null) {
      throw new MarkdownParseError(`Missing frontmatter field: ${key}`, path);
    }
  }
  if (fm.type !== 'feature' && fm.type !== 'aspect') {
    throw new MarkdownParseError(`Invalid type: ${fm.type}`, path);
  }
  if (fm.type === 'aspect' && !fm.feature_id) {
    throw new MarkdownParseError('Aspect entry missing feature_id', path);
  }
}

function parseBody(content: string, path: string | undefined): EntryBody {
  const sections = splitSections(content);

  const what = sections.get(SECTION_WHAT);
  const where = sections.get(SECTION_WHERE);

  if (!what) {
    throw new MarkdownParseError(`Missing "${SECTION_WHAT}" section`, path);
  }
  if (!where) {
    throw new MarkdownParseError(`Missing "${SECTION_WHERE}" section`, path);
  }

  const flow = sections.get(SECTION_FLOW) ?? null;
  const flowMermaid = flow ? extractMermaid(flow) : null;

  return {
    what: what.trim(),
    flow_mermaid: flowMermaid,
    where: where.trim(),
  };
}

function splitSections(content: string): Map<string, string> {
  const lines = content.split('\n');
  const sections = new Map<string, string>();
  let currentHeader: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentHeader !== null) {
      sections.set(currentHeader, buffer.join('\n'));
    }
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush();
      currentHeader = line.trimEnd();
      buffer = [];
    } else if (currentHeader !== null) {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}

function extractMermaid(flowSection: string): string | null {
  const fenceStart = flowSection.indexOf('```mermaid');
  if (fenceStart === -1) return null;
  const afterFence = flowSection.indexOf('\n', fenceStart);
  if (afterFence === -1) return null;
  const fenceEnd = flowSection.indexOf('```', afterFence + 1);
  if (fenceEnd === -1) return null;
  return flowSection.slice(afterFence + 1, fenceEnd).trim();
}

export function serializeEntry(entry: Entry): string {
  const frontmatterYaml = matter.stringify('', entry.frontmatter).trim();
  const parts: string[] = [frontmatterYaml, ''];

  parts.push(SECTION_WHAT, '', entry.body.what, '');

  if (entry.body.flow_mermaid) {
    parts.push(
      SECTION_FLOW,
      '',
      '```mermaid',
      entry.body.flow_mermaid,
      '```',
      '',
    );
  }

  parts.push(SECTION_WHERE, '', entry.body.where, '');

  return parts.join('\n');
}

// Summary returned to search callers and used as the BM25/embedding text.
// Historically this was just the first paragraph of "## What it does", but
// that truncated aspects whose first paragraph was just a problem statement
// while the actual mechanism lived in later paragraphs — agents would read
// the summary, miss the answer, and report "found nothing". We now return
// the full "What it does" up to a char budget, cutting at a paragraph
// boundary so mid-sentence truncation never happens.
const SUMMARY_MAX_CHARS = 1500;

export function summaryOf(entry: Entry): string {
  // Redact `<private>` blocks before any character budget — the redaction
  // can shrink the text below the budget, and we never want private
  // content reaching SQLite/FTS/embedding caches.
  const trimmed = stripPrivate(entry.body.what).trim();
  if (trimmed.length <= SUMMARY_MAX_CHARS) return trimmed;

  const window = trimmed.slice(0, SUMMARY_MAX_CHARS);
  const lastParagraphBreak = window.lastIndexOf('\n\n');
  if (lastParagraphBreak >= SUMMARY_MAX_CHARS / 2) {
    return trimmed.slice(0, lastParagraphBreak).trim();
  }
  return window.trim() + '…';
}
