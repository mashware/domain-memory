// Bootstrap a knowledge store in a mature project.
//
// This command does NOT auto-generate knowledge. Auto-generated knowledge
// is noise: the agent reading code can only describe WHAT the code does,
// which is the part that lives in the code already. The valuable content
// is the WHY — the intentions, the rationale, the counterintuitive
// decisions — which only a human can provide.
//
// What bootstrap does is **guide the human+agent pair** through the
// project. It scans the code tree, proposes candidate features, and
// writes a checklist at .domain-memory/bootstrap-plan.md that the user
// can edit. Then it prints a ready-to-paste prompt for the agent to
// work through the plan one candidate at a time, asking the human the
// por-qué questions it cannot answer by reading code.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative } from 'node:path';
import pc from 'picocolors';
import prompts from 'prompts';

export interface BootstrapOptions {
  root: string;
  sourceRoot?: string;
  force?: boolean;
  minFiles?: number;
  topN?: number;
}

interface Candidate {
  slug: string;
  absolutePath: string;
  relativePath: string;
  fileCount: number;
  sampleFiles: string[];
  alreadyDocumentedAs: string | null;
}

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi',
  '.php',
  '.go',
  '.rs',
  '.java', '.kt',
  '.rb',
  '.cs',
  '.swift',
  '.scala',
  '.ex', '.exs',
]);

const IGNORE_DIRS = new Set([
  'node_modules', 'vendor', '.git', 'dist', 'build', 'out',
  '__pycache__', 'target', '.next', '.nuxt', '.svelte-kit',
  'coverage', '.nyc_output', '.cache', '.turbo',
  'public', 'static',
  '.domain-memory',
]);

const DEFAULT_SOURCE_ROOT_CANDIDATES = ['src', 'app', 'lib'];
const DEFAULT_MIN_FILES = 3;
const DEFAULT_TOP_N = 20;

export async function runBootstrap(opts: BootstrapOptions): Promise<number> {
  const minFiles = opts.minFiles ?? DEFAULT_MIN_FILES;
  const topN = opts.topN ?? DEFAULT_TOP_N;

  let sourceRoot: string;

  if (opts.sourceRoot) {
    sourceRoot = join(opts.root, opts.sourceRoot);
  } else {
    const detected = resolveSourceRoot(opts.root);
    const confirmed = await confirmSourceRoot(detected, opts.root);
    if (!confirmed) return 1;
    sourceRoot = confirmed;
  }

  if (!existsSync(sourceRoot)) {
    process.stderr.write(
      pc.red(`Source root not found: ${sourceRoot}\n`) +
        pc.dim('Pass --source-root <path> to point at the right directory.\n'),
    );
    return 1;
  }

  const planPath = join(opts.root, '.domain-memory', 'bootstrap-plan.md');
  if (existsSync(planPath) && !opts.force) {
    process.stderr.write(
      pc.yellow(`A bootstrap plan already exists at ${relative(opts.root, planPath)}.\n`) +
        pc.dim('Re-run with --force to overwrite it, or edit it by hand.\n'),
    );
    return 1;
  }

  const existingFeatures = loadExistingFeatureSlugs(opts.root);
  const candidates = scanCandidates(
    sourceRoot,
    existingFeatures,
    minFiles,
    topN,
    opts.root,
  );

  if (candidates.length === 0) {
    process.stdout.write(
      pc.yellow(
        `No candidates found in ${sourceRoot}.\n`,
      ) +
        pc.dim(
          `Lowered the --min-files threshold or pointed at the wrong directory?\n`,
        ),
    );
    return 0;
  }

  const planMarkdown = renderPlan({
    projectRoot: opts.root,
    sourceRoot,
    candidates,
  });

  mkdirSync(join(opts.root, '.domain-memory'), { recursive: true });
  writeFileSync(planPath, planMarkdown, 'utf-8');

  const newCount = candidates.filter((c) => !c.alreadyDocumentedAs).length;
  const existingCount = candidates.length - newCount;

  process.stdout.write(
    pc.bold(`Bootstrap plan written to ${relative(opts.root, planPath)}\n`),
  );
  process.stdout.write(
    pc.dim(
      `  ${candidates.length} candidates · ${newCount} new · ${existingCount} already documented\n\n`,
    ),
  );
  process.stdout.write(pc.bold('Next step:\n\n'));
  process.stdout.write(
    '  1. Review the plan and edit or remove candidates as needed.\n',
  );
  process.stdout.write(
    '  2. Open a session with your MCP agent and paste this prompt:\n\n',
  );
  process.stdout.write(pc.cyan(renderAgentPrompt(relative(opts.root, planPath))));
  process.stdout.write('\n');
  return 0;
}

function resolveSourceRoot(projectRoot: string): string {
  for (const candidate of DEFAULT_SOURCE_ROOT_CANDIDATES) {
    const path = join(projectRoot, candidate);
    if (existsSync(path) && statSync(path).isDirectory()) {
      return path;
    }
  }
  return projectRoot;
}

async function confirmSourceRoot(
  detected: string,
  projectRoot: string,
): Promise<string | null> {
  const rel = relative(projectRoot, detected) || '.';
  const subdirs = listSubdirs(detected);
  const hint = subdirs.length > 0
    ? `${subdirs.length} subdirectories`
    : 'no subdirectories';

  const response = await prompts({
    type: 'text',
    name: 'path',
    message: `Source root detected: ${pc.bold(rel)} (${hint}). Use this?`,
    initial: rel,
  });

  const value = response['path'] as string | undefined;
  if (value === undefined) return null; // user cancelled (Ctrl+C)

  const resolved = join(projectRoot, value);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    process.stderr.write(pc.red(`Not a directory: ${value}\n`));
    return null;
  }
  return resolved;
}

function loadExistingFeatureSlugs(projectRoot: string): Map<string, string> {
  const out = new Map<string, string>();
  const knowledge = join(projectRoot, '.domain-memory', 'knowledge');
  if (!existsSync(knowledge)) return out;
  let entries: string[];
  try {
    entries = readdirSync(knowledge);
  } catch {
    return out;
  }
  for (const dir of entries) {
    const featureFile = join(knowledge, dir, 'feature.md');
    if (!existsSync(featureFile)) continue;
    try {
      const raw = readFileSync(featureFile, 'utf-8');
      const idMatch = raw.match(/^id:\s*(\S+)/m);
      if (idMatch?.[1]) {
        out.set(dir, idMatch[1]);
      } else {
        out.set(dir, dir);
      }
    } catch {
      // ignore
    }
  }
  return out;
}

function listSubdirs(parent: string): { name: string; full: string }[] {
  return readdirSync(parent)
    .map((name) => ({ name, full: join(parent, name) }))
    .filter(({ name, full }) => {
      if (IGNORE_DIRS.has(name)) return false;
      if (name.startsWith('.')) return false;
      try {
        return statSync(full).isDirectory();
      } catch {
        return false;
      }
    });
}

function scanCandidates(
  sourceRoot: string,
  existingFeatures: Map<string, string>,
  minFiles: number,
  topN: number,
  projectRoot: string,
): Candidate[] {
  const subdirs = listSubdirs(sourceRoot);

  // When a single subdirectory holds the vast majority of code (>80%),
  // it is a wrapper (e.g. src/Acme/) — descend into its children
  // to find the real feature modules.
  const expanded = expandMonoDirs(subdirs, minFiles);

  const candidates: Candidate[] = [];
  for (const dir of expanded) {
    const { fileCount, samples } = walkForCode(dir.full, 4);
    if (fileCount < minFiles) continue;
    const slug = slugify(dir.name);
    candidates.push({
      slug,
      absolutePath: dir.full,
      relativePath: relative(projectRoot, dir.full),
      fileCount,
      sampleFiles: samples.slice(0, 5).map((s) => relative(projectRoot, s)),
      alreadyDocumentedAs: existingFeatures.get(slug) ?? null,
    });
  }

  candidates.sort((a, b) => b.fileCount - a.fileCount);
  return candidates.slice(0, topN);
}

function expandMonoDirs(
  subdirs: { name: string; full: string }[],
  minFiles: number,
): { name: string; full: string }[] {
  if (subdirs.length === 0) return subdirs;

  const counts = subdirs.map((d) => ({
    ...d,
    fileCount: walkForCode(d.full, 4).fileCount,
  }));
  const total = counts.reduce((s, c) => s + c.fileCount, 0);
  if (total === 0) return subdirs;

  const largest = counts.reduce((a, b) => (a.fileCount > b.fileCount ? a : b));
  if (largest.fileCount / total < 0.8) return subdirs;

  // The largest dir is a mono-dir — replace it with its children,
  // keep any siblings that meet the threshold.
  const children = listSubdirs(largest.full);
  if (children.length === 0) return subdirs;

  const siblings = subdirs.filter((d) => d.full !== largest.full);

  // Recurse in case the children are also mono-dirs.
  return expandMonoDirs([...children, ...siblings], minFiles);
}

function walkForCode(
  dir: string,
  maxDepth: number,
): { fileCount: number; samples: string[] } {
  let count = 0;
  const samples: string[] = [];

  const walk = (current: string, depth: number) => {
    if (depth < 0) return;
    let children: string[];
    try {
      children = readdirSync(current);
    } catch {
      return;
    }
    for (const name of children) {
      if (IGNORE_DIRS.has(name)) continue;
      if (name.startsWith('.')) continue;
      const full = join(current, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full, depth - 1);
      } else if (stat.isFile()) {
        const ext = name.slice(name.lastIndexOf('.'));
        if (CODE_EXTENSIONS.has(ext) && !name.includes('.test.') && !name.includes('.spec.')) {
          count += 1;
          if (samples.length < 10) samples.push(full);
        }
      }
    }
  };

  walk(dir, maxDepth);
  return { fileCount: count, samples };
}

function slugify(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

interface PlanContext {
  projectRoot: string;
  sourceRoot: string;
  candidates: Candidate[];
}

function renderPlan(ctx: PlanContext): string {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push('# Bootstrap plan');
  lines.push('');
  lines.push(`Generated: ${now}`);
  lines.push(`Project root: ${ctx.projectRoot}`);
  lines.push(`Source root: ${ctx.sourceRoot}`);
  lines.push('');

  const newOnes = ctx.candidates.filter((c) => !c.alreadyDocumentedAs);
  const documented = ctx.candidates.filter((c) => c.alreadyDocumentedAs);
  lines.push(
    `${ctx.candidates.length} candidates — ${newOnes.length} new, ${documented.length} already documented.`,
  );
  lines.push('');

  lines.push('## How to use this file');
  lines.push('');
  lines.push('1. Review the candidates below. Edit slugs, merge related ones,');
  lines.push('   delete ones that are not real features.');
  lines.push('2. Open a session with your MCP agent and paste the prompt from');
  lines.push('   the "Agent prompt" section at the bottom of this file.');
  lines.push('3. The agent will work through the list one candidate at a time,');
  lines.push('   reading the code and asking you the por-qué questions.');
  lines.push('4. Mark candidates as [x] done when the entry has been created.');
  lines.push('5. You can stop and resume across sessions — the [x] marks');
  lines.push('   track your progress. Paste the same prompt again to continue.');
  lines.push('6. This file is safe to delete once the bootstrap is complete.');
  lines.push('');

  lines.push('## Candidates');
  lines.push('');

  for (const c of ctx.candidates) {
    const checkbox = c.alreadyDocumentedAs ? '[x]' : '[ ]';
    const status = c.alreadyDocumentedAs
      ? `already documented as \`${c.alreadyDocumentedAs}\``
      : `new, ${c.fileCount} files`;
    lines.push(`### ${checkbox} ${c.slug}  (${status})`);
    lines.push('');
    lines.push(`- Directory: \`${c.relativePath}\``);
    if (c.sampleFiles.length > 0) {
      lines.push('- Sample files:');
      for (const f of c.sampleFiles) {
        lines.push(`  - \`${f}\``);
      }
    }
    lines.push('- Notes: _(fill in as you review)_');
    lines.push('');
  }

  const planRelPath = relative(
    ctx.projectRoot,
    join(ctx.projectRoot, '.domain-memory', 'bootstrap-plan.md'),
  );
  lines.push('---');
  lines.push('');
  lines.push('## Agent prompt');
  lines.push('');
  lines.push('Copy and paste the text below into a session with your MCP agent.');
  lines.push('You can reuse it across sessions — the [x] marks track progress.');
  lines.push('');
  lines.push('```');
  lines.push(renderAgentPrompt(planRelPath));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

function renderAgentPrompt(planPath: string): string {
  return [
    `Read ${planPath} and work it feature by feature, top to bottom.`,
    '',
    'For each candidate marked as [ ] (not done):',
    '',
    '1. Read the candidate\'s listed files.',
    '2. Identify 3-8 "whys" that the code answers but are NOT obvious from',
    '   reading the code: counter-intuitive decisions, trade-offs, edge',
    '   cases handled deliberately, integrations with quirks, etc.',
    '3. Ask me those questions ONE at a time.',
    '4. With my answers, create the entry by calling save_knowledge.',
    '   If the feature has several clear subtopics, also create the',
    '   matching aspects.',
    '5. When you finish a candidate, mark it as [x] in the plan and',
    '   STOP. Ask me whether to continue with the next one or end the',
    '   session. Do not move on without my confirmation.',
    '',
    'If a candidate has no documentable value (pure utility, boilerplate,',
    'or only contains code that already explains itself), tell me and we',
    'will drop it from the plan instead of creating an empty entry.',
    '',
    'Remember the "why vs what" rule: do not save descriptions of the',
    'code, save the decisions and nuances I only know from having worked',
    'on it.',
  ].join('\n');
}
