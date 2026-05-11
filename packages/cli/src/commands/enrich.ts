// Prints a guided-enrichment prompt for a specific feature. This is
// the "I'm going to spend 20 minutes deepening the checkout entry"
// ritual: the agent gets a focused instruction, reads the existing
// entry and its referenced code, and asks the human the pointed
// questions whose answers would actually improve the entry.
//
// Accepts the feature by id (feat_checkout) or by slug (checkout).
// Prints to stdout; no state change. The user copies the prompt into
// their agent session.

import pc from 'picocolors';
import { createServerContext } from '@domain-memory/server';

export interface EnrichOptions {
  root: string;
  target: string;
}

interface ResolvedFeature {
  id: string;
  slug: string;
  name: string;
  confidence: number;
  file_path: string;
  summary: string;
  aspect_count: number;
  referenced_files: string[];
}

export async function runEnrich(opts: EnrichOptions): Promise<number> {
  const ctx = createServerContext(opts.root);
  try {
    const feature = resolveFeature(ctx, opts.target);
    if (!feature) {
      process.stderr.write(
        pc.red(`No feature found matching '${opts.target}'\n`) +
          pc.dim(`  Pass either a feature id (feat_xxx) or a slug.\n`),
      );
      return 1;
    }

    process.stdout.write(pc.bold(`Enrich plan for ${feature.name}\n`));
    process.stdout.write(
      pc.dim(
        `  id: ${feature.id}  ·  slug: ${feature.slug}  ·  aspects: ${feature.aspect_count}  ·  confidence: ${feature.confidence}\n`,
      ) +
        pc.dim(`  entry: ${feature.file_path}\n\n`),
    );

    process.stdout.write(pc.bold('Next step:\n\n'));
    process.stdout.write(
      '  Open a session with your MCP agent and paste this prompt:\n\n',
    );
    process.stdout.write(pc.cyan(renderPrompt(feature)));
    process.stdout.write('\n');
    return 0;
  } finally {
    ctx.db.close();
  }
}

function resolveFeature(
  ctx: ReturnType<typeof createServerContext>,
  target: string,
): ResolvedFeature | null {
  // Accept either a full id (feat_*) or a slug. Search by id first
  // because slug collisions between different features are possible.
  let row = ctx.db
    .prepare(
      `SELECT id, slug, name, confidence, file_path, summary
       FROM entries
       WHERE id = ? AND type = 'feature'`,
    )
    .get(target) as
    | {
        id: string;
        slug: string;
        name: string;
        confidence: number;
        file_path: string;
        summary: string;
      }
    | undefined;

  if (!row) {
    row = ctx.db
      .prepare(
        `SELECT id, slug, name, confidence, file_path, summary
         FROM entries
         WHERE slug = ? AND type = 'feature'`,
      )
      .get(target) as typeof row;
  }

  if (!row) return null;

  const aspectCount = (
    ctx.db
      .prepare(
        "SELECT COUNT(*) AS n FROM entries WHERE feature_id = ? AND type = 'aspect'",
      )
      .get(row.id) as { n: number }
  ).n;

  const files = (
    ctx.db
      .prepare('SELECT path FROM entry_paths WHERE entry_id = ?')
      .all(row.id) as Array<{ path: string }>
  ).map((r) => r.path);

  // Also include referenced files from aspects so the agent has the
  // full view of what to read.
  const aspectFiles = ctx.db
    .prepare(
      `SELECT DISTINCT ep.path
       FROM entry_paths ep
       INNER JOIN entries e ON e.id = ep.entry_id
       WHERE e.feature_id = ?`,
    )
    .all(row.id) as Array<{ path: string }>;

  const allFiles = Array.from(
    new Set([...files, ...aspectFiles.map((r) => r.path)]),
  );

  return {
    ...row,
    aspect_count: aspectCount,
    referenced_files: allFiles,
  };
}

function renderPrompt(feature: ResolvedFeature): string {
  const filesList =
    feature.referenced_files.length > 0
      ? feature.referenced_files.map((f) => `  - ${f}`).join('\n')
      : '  (no files referenced — ask the human where to look)';

  return [
    `Let's enrich the feature "${feature.name}" (${feature.id}).`,
    '',
    'Exact steps:',
    '',
    `1. Read the current entry at ${feature.file_path} and every aspect`,
    '   under this feature. They are the baseline of what we already know.',
    '',
    '2. Read the referenced code files:',
    filesList,
    '',
    '3. Identify the "whys" the code answers but that are NOT captured in',
    '   the current documentation. Examples of "whys" worth capturing:',
    '   - Counter-intuitive decisions ("we charge more when the third-party',
    '     validation service is down because we prefer overcharging to',
    '     non-compliance").',
    '   - Explicit trade-offs ("we don\'t use X because we need control Y").',
    '   - Edge cases handled deliberately in the code.',
    '   - Integrations with quirky external behaviour (a vendor that does',
    '     something unusual).',
    '',
    '4. Ask me 5-10 concrete questions, ONE at a time, about those whys.',
    '   Wait for my answer before the next question.',
    '',
    '5. With my answers, update the entry and/or create new aspects with',
    '   save_knowledge. Follow the "why vs what" rule: if the code already',
    '   says it, don\'t duplicate.',
    '',
    '6. When you are done, give me a short summary of what you changed and',
    '   how many of the original questions stayed unanswered because I did',
    '   not know or they were out of scope for this session.',
    '',
    'If while reading the code you notice that the feature.md Mermaid is',
    'out of date with respect to the real code, tell me and update the',
    'diagram in the same operation.',
  ].join('\n');
}
