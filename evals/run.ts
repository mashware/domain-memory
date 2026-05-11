// Eval runner for the domain-memory triple matcher.
//
// Indexes the fixtures under ./fixtures into a throwaway project root,
// runs every query in cases.jsonl, and reports Recall@K, MRR, and latency
// percentiles per category.
//
// Usage:
//   tsx evals/run.ts                  # run, print table, write evals/last-run.json
//   tsx evals/run.ts --update-baseline  # also overwrite evals/baseline.json
//   tsx evals/run.ts --json             # print machine-readable JSON to stdout
//
// The runner uses the *real* embedder so the metrics reflect the model
// actually shipped to users. The model (~90 MB) is downloaded on first
// run and cached by Transformers.js — subsequent runs are fast.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createServerContext,
  parseEntry,
  type Entry,
  type ServerContext,
} from '@mashware/domain-memory-server';

interface EvalCase {
  id: string;
  category: 'path' | 'semantic' | 'keyword';
  query: string;
  context?: { file_paths?: string[]; symbols?: string[] };
  expected: string;
}

interface CaseResult {
  case: EvalCase;
  rank: number; // 1-based rank of expected entry; -1 if not in top-N
  combined: number;
  elapsed_ms: number;
}

interface CategoryMetrics {
  count: number;
  recall_at_1: number;
  recall_at_3: number;
  recall_at_5: number;
  mrr: number;
  p50_ms: number;
  p95_ms: number;
}

interface RunReport {
  generated_at: string;
  cases: number;
  per_category: Record<string, CategoryMetrics>;
  overall: CategoryMetrics;
  failures: Array<{ id: string; rank: number; query: string; expected: string }>;
}

const SEARCH_LIMIT = 5;
const TOP_N_FOR_METRICS = 5;

const __dirname = dirname(fileURLToPath(import.meta.url));
const evalsRoot = __dirname;
const fixturesRoot = join(evalsRoot, 'fixtures');
const casesPath = join(evalsRoot, 'cases.jsonl');
const baselinePath = join(evalsRoot, 'baseline.json');
const lastRunPath = join(evalsRoot, 'last-run.json');

interface CliArgs {
  updateBaseline: boolean;
  json: boolean;
  weights: { path: number; embedding: number; bm25: number } | null;
  failOnRegression: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    updateBaseline: argv.includes('--update-baseline'),
    json: argv.includes('--json'),
    weights: null,
    failOnRegression: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--weights') {
      args.weights = parseWeights(argv[i + 1] ?? '');
      i += 1;
    } else if (arg.startsWith('--weights=')) {
      args.weights = parseWeights(arg.slice('--weights='.length));
    } else if (arg === '--fail-on-regression') {
      args.failOnRegression = Number(argv[i + 1] ?? '');
      i += 1;
    } else if (arg.startsWith('--fail-on-regression=')) {
      args.failOnRegression = Number(arg.slice('--fail-on-regression='.length));
    }
  }

  if (args.failOnRegression !== null && !Number.isFinite(args.failOnRegression)) {
    throw new Error('--fail-on-regression expects a number (e.g. 0.05)');
  }

  return args;
}

function parseWeights(spec: string): { path: number; embedding: number; bm25: number } {
  // Parses "path=0.6,embedding=0.3,bm25=0.1" into a weights object.
  // Missing keys default to 0; the runner later validates that at least
  // one weight is greater than zero (via the server's own loader).
  const out = { path: 0, embedding: 0, bm25: 0 };
  if (!spec) throw new Error('--weights expects a value like path=0.6,embedding=0.3,bm25=0.1');
  for (const part of spec.split(',')) {
    const [keyRaw, valueRaw] = part.split('=');
    const key = keyRaw?.trim();
    const value = Number(valueRaw);
    if (key !== 'path' && key !== 'embedding' && key !== 'bm25') {
      throw new Error(`unknown weight key "${key}" — allowed: path, embedding, bm25`);
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`weight "${key}" must be a non-negative number, got "${valueRaw}"`);
    }
    out[key] = value;
  }
  if (out.path + out.embedding + out.bm25 === 0) {
    throw new Error('at least one weight must be greater than zero');
  }
  return out;
}

function loadCases(): EvalCase[] {
  return readFileSync(casesPath, 'utf-8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('//'))
    .map((line) => JSON.parse(line) as EvalCase);
}

async function indexFixtures(ctx: ServerContext): Promise<void> {
  const files = ctx.entries.scanDisk();
  const features: Entry[] = [];
  const aspects: Entry[] = [];

  for (const abs of files) {
    const raw = readFileSync(abs, 'utf-8');
    const entry = parseEntry(raw, abs);
    if (entry.frontmatter.type === 'feature') features.push(entry);
    else aspects.push(entry);
  }

  // Two-pass indexing identical to the CLI's reindex command.
  for (const f of features) {
    const rel = relative(ctx.paths.root, ctx.entries.resolveFilePathFor(f));
    const stripped: Entry = {
      body: f.body,
      frontmatter: { ...f.frontmatter, relations: undefined },
    };
    ctx.entries.indexEntry(stripped, rel);
  }
  for (const f of features) {
    if (!f.frontmatter.relations) continue;
    const rel = relative(ctx.paths.root, ctx.entries.resolveFilePathFor(f));
    ctx.entries.indexEntry(f, rel);
  }
  for (const a of aspects) {
    const rel = relative(ctx.paths.root, ctx.entries.resolveFilePathFor(a));
    ctx.entries.indexEntry(a, rel);
  }

  await ctx.indexer.indexMany([...features, ...aspects]);
}

async function runCase(
  ctx: ServerContext,
  c: EvalCase,
): Promise<CaseResult> {
  const t0 = Date.now();
  const candidates = await ctx.searcher.search({
    query: c.query,
    context: c.context,
    limit: SEARCH_LIMIT,
  });
  const elapsed_ms = Date.now() - t0;

  const idx = candidates.findIndex((cand) => cand.id === c.expected);
  return {
    case: c,
    rank: idx === -1 ? -1 : idx + 1,
    combined: idx === -1 ? 0 : candidates[idx]!.scores.combined,
    elapsed_ms,
  };
}

function aggregate(results: CaseResult[]): CategoryMetrics {
  const n = results.length;
  if (n === 0) {
    return {
      count: 0,
      recall_at_1: 0,
      recall_at_3: 0,
      recall_at_5: 0,
      mrr: 0,
      p50_ms: 0,
      p95_ms: 0,
    };
  }
  const hit = (k: number) =>
    results.filter((r) => r.rank > 0 && r.rank <= k).length / n;
  const mrr =
    results.reduce((acc, r) => acc + (r.rank > 0 ? 1 / r.rank : 0), 0) / n;
  const sortedLat = [...results.map((r) => r.elapsed_ms)].sort(
    (a, b) => a - b,
  );
  const pct = (p: number) =>
    sortedLat[Math.min(sortedLat.length - 1, Math.floor(p * sortedLat.length))]!;

  return {
    count: n,
    recall_at_1: round(hit(1)),
    recall_at_3: round(hit(3)),
    recall_at_5: round(hit(TOP_N_FOR_METRICS)),
    mrr: round(mrr),
    p50_ms: pct(0.5),
    p95_ms: pct(0.95),
  };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function formatTable(report: RunReport): string {
  const head = ['Category', 'N', 'R@1', 'R@3', 'R@5', 'MRR', 'P50', 'P95'];
  const rows: string[][] = [head];
  for (const [cat, m] of Object.entries(report.per_category)) {
    rows.push([
      cat,
      String(m.count),
      m.recall_at_1.toFixed(2),
      m.recall_at_3.toFixed(2),
      m.recall_at_5.toFixed(2),
      m.mrr.toFixed(2),
      `${m.p50_ms}ms`,
      `${m.p95_ms}ms`,
    ]);
  }
  rows.push([
    'overall',
    String(report.overall.count),
    report.overall.recall_at_1.toFixed(2),
    report.overall.recall_at_3.toFixed(2),
    report.overall.recall_at_5.toFixed(2),
    report.overall.mrr.toFixed(2),
    `${report.overall.p50_ms}ms`,
    `${report.overall.p95_ms}ms`,
  ]);

  const widths = head.map((_, i) =>
    Math.max(...rows.map((r) => r[i]!.length)),
  );
  const fmt = (row: string[]) =>
    row.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  return [fmt(rows[0]!), '', ...rows.slice(1).map(fmt)].join('\n');
}

function compareToBaseline(report: RunReport): string | null {
  if (!existsSync(baselinePath)) return null;
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as RunReport;
  const delta = (cur: number, base: number) => round(cur - base);
  const lines = ['', 'Δ vs baseline:'];
  for (const cat of Object.keys(report.per_category)) {
    const cur = report.per_category[cat]!;
    const base = baseline.per_category[cat];
    if (!base) continue;
    lines.push(
      `  ${cat}: R@3 ${signed(delta(cur.recall_at_3, base.recall_at_3))}, MRR ${signed(delta(cur.mrr, base.mrr))}`,
    );
  }
  lines.push(
    `  overall: R@3 ${signed(delta(report.overall.recall_at_3, baseline.overall.recall_at_3))}, MRR ${signed(delta(report.overall.mrr, baseline.overall.mrr))}`,
  );
  return lines.join('\n');
}

function signed(v: number): string {
  return v >= 0 ? `+${v.toFixed(3)}` : v.toFixed(3);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const cases = loadCases();
  const tmpRoot = mkdtempSync(join(tmpdir(), 'dm-evals-'));

  try {
    // Materialise fixtures into <tmp>/.domain-memory/knowledge/
    const knowledgeDest = join(tmpRoot, '.domain-memory', 'knowledge');
    mkdirSync(knowledgeDest, { recursive: true });
    cpSync(fixturesRoot, knowledgeDest, { recursive: true });

    // If --weights was passed, write a config.json with the override
    // before opening the server context. The settings loader will pick
    // it up and the Searcher receives the custom weights through the
    // standard wiring — no special-casing needed.
    if (args.weights) {
      writeFileSync(
        join(tmpRoot, '.domain-memory', 'config.json'),
        `${JSON.stringify({ search: { weights: args.weights } }, null, 2)}\n`,
        'utf-8',
      );
    }

    const ctx = createServerContext(tmpRoot);
    if (!args.json) {
      const weightsLine = args.weights
        ? `Weights: path=${args.weights.path} embedding=${args.weights.embedding} bm25=${args.weights.bm25}\n`
        : '';
      process.stdout.write(`${weightsLine}Indexing fixtures...\n`);
    }
    await indexFixtures(ctx);

    const results: CaseResult[] = [];
    for (const c of cases) {
      results.push(await runCase(ctx, c));
    }

    ctx.db.close();

    const byCategory = new Map<string, CaseResult[]>();
    for (const r of results) {
      const list = byCategory.get(r.case.category) ?? [];
      list.push(r);
      byCategory.set(r.case.category, list);
    }

    const report: RunReport = {
      generated_at: new Date().toISOString(),
      cases: results.length,
      per_category: Object.fromEntries(
        [...byCategory.entries()].map(([cat, rs]) => [cat, aggregate(rs)]),
      ),
      overall: aggregate(results),
      failures: results
        .filter((r) => r.rank !== 1)
        .map((r) => ({
          id: r.case.id,
          rank: r.rank,
          query: r.case.query,
          expected: r.case.expected,
        })),
    };

    writeFileSync(lastRunPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
    if (args.updateBaseline) {
      writeFileSync(
        baselinePath,
        `${JSON.stringify(report, null, 2)}\n`,
        'utf-8',
      );
    }

    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`\n${formatTable(report)}\n`);
      const cmp = compareToBaseline(report);
      if (cmp) process.stdout.write(`${cmp}\n`);
      if (report.failures.length > 0) {
        process.stdout.write(
          `\n${report.failures.length} case(s) did not return the expected entry at rank 1:\n`,
        );
        for (const f of report.failures) {
          const where = f.rank === -1 ? 'not in top 5' : `rank ${f.rank}`;
          process.stdout.write(`  · ${f.id} (${where}) — "${f.query}"\n`);
        }
      }
    }

    if (args.failOnRegression !== null) {
      const regression = detectRegression(report, args.failOnRegression);
      if (regression) {
        process.stderr.write(`\n${regression}\n`);
        return 1;
      }
    }

    return 0;
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function detectRegression(
  report: RunReport,
  threshold: number,
): string | null {
  if (!existsSync(baselinePath)) {
    // No baseline yet — nothing to compare against. The runner stays
    // green so a brand-new repo doesn't fail CI on its first run.
    return null;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as RunReport;
  const offenders: string[] = [];

  // Watch R@3 per category and overall. R@3 is the most informative
  // single number — R@1 is too binary on a small corpus and R@5 is too
  // forgiving. MRR moves with R@3 so checking it separately would just
  // add noise.
  for (const [cat, cur] of Object.entries(report.per_category)) {
    const base = baseline.per_category[cat];
    if (!base) continue;
    const drop = round(base.recall_at_3 - cur.recall_at_3);
    if (drop > threshold) {
      offenders.push(
        `  ${cat}: R@3 dropped ${drop.toFixed(3)} (${base.recall_at_3.toFixed(2)} → ${cur.recall_at_3.toFixed(2)})`,
      );
    }
  }
  const overallDrop = round(
    baseline.overall.recall_at_3 - report.overall.recall_at_3,
  );
  if (overallDrop > threshold) {
    offenders.push(
      `  overall: R@3 dropped ${overallDrop.toFixed(3)} (${baseline.overall.recall_at_3.toFixed(2)} → ${report.overall.recall_at_3.toFixed(2)})`,
    );
  }

  if (offenders.length === 0) return null;
  return [
    `REGRESSION: R@3 fell by more than ${threshold} vs baseline:`,
    ...offenders,
    '',
    'If this drop is intentional, run `npm run evals -- --update-baseline` and commit.',
  ].join('\n');
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`evals failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
