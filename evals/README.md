# Evals

Regression suite for the triple-matcher (path / embedding / BM25). Indexes
the fixtures under `fixtures/`, runs every query in `cases.jsonl`, and
reports Recall@K, MRR, and latency percentiles per category.

## Usage

```bash
npm run evals                                          # run, print table, save evals/last-run.json
npm run evals -- --json                                # machine-readable JSON to stdout
npm run evals -- --update-baseline                     # overwrite evals/baseline.json
npm run evals -- --weights path=0.6,embedding=0.3,bm25=0.1  # try a different ranker config
npm run evals -- --fail-on-regression 0.05             # exit 1 if R@3 drops more than 0.05 vs baseline
```

The `--weights` flag lets you sweep configurations without editing the
project's `config.json`. Combined with `--fail-on-regression`, it is the
core of the GitLab CI gate: the runner exits non-zero whenever a change
moves R@3 below the committed baseline by more than the threshold.

The runner uses the **real** embedder (Transformers.js + all-MiniLM-L6-v2),
so the metrics reflect what users actually see. The model (~90 MB) is
downloaded on first run and cached by Transformers.js — subsequent runs
are fast.

## Structure

```
evals/
├── fixtures/             ← knowledge entries used as ground truth
│   ├── checkout/
│   │   ├── feature.md
│   │   └── aspects/
│   │       ├── stripe.md
│   │       └── taxes.md
│   ├── auth/
│   │   ├── feature.md
│   │   └── aspects/
│   │       └── jwt.md
│   └── invoicing/
│       └── feature.md
├── cases.jsonl           ← one query per line
├── baseline.json         ← reference metrics (committed)
├── last-run.json         ← latest run output (gitignored)
└── run.ts                ← runner
```

## Case format

```jsonc
{
  "id": "semantic-01",
  "category": "path | semantic | keyword",
  "query": "natural-language query the agent would send",
  "context": { "file_paths": [...], "symbols": [...] },  // optional
  "expected": "feat_checkout"                            // entry id from fixtures
}
```

The three categories isolate which matcher should be doing the heavy
lifting:

- **path** — query is generic; only the file_paths/symbols context
  identifies the answer. Tests the path matcher.
- **semantic** — query reformulates the concept; no token overlap with
  the entry. Tests the embedding matcher.
- **keyword** — query uses exact identifiers/jargon present in the
  entry body. Tests BM25.

A healthy ranker should dominate its own category; if `path` cases
suddenly drop, the path matcher likely regressed.

## Adding cases

1. Add an entry id (or write a new fixture under `fixtures/`).
2. Append a line to `cases.jsonl`.
3. Run `npm run evals` and inspect the failures section.
4. Once stable, run `npm run evals -- --update-baseline` and commit.

## Limitations

The current corpus is small (3 features, 3 aspects, 15 cases) and the
baseline is R@1 = 1.00 across every category — meaning the cases are
deliberately easy, sized for catching big regressions rather than
fine-grained tuning. Adversarial cases (ambiguous queries, entries
sharing vocabulary, near-duplicate paths) are the natural next step
once the system has accumulated enough real-world feedback to know
where it actually struggles.
