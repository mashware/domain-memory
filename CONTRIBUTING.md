# Contributing to Domain Memory

Thanks for your interest. This document covers how to run the project
locally, the conventions we follow, and what a good contribution looks like.

If you are reporting a bug or asking a question, an issue is the right place.
For anything code-related, please read this file first.

---

## Project layout

```
domain-memory/
├── DESIGN.md                Architectural principles and decisions
├── SCHEMA.md                File layout, frontmatter, SQLite schema, tool payloads
├── templates/               Markdown copied into each project on install
└── packages/
    ├── server/              @domain-memory/server — MCP stdio + storage + search
    ├── cli/                 @domain-memory/cli — install, reindex, doctor, web
    └── web/                 @domain-memory/web — Hono SSR viewer
```

The repo is an npm workspace. Every package builds to `dist/` and is
consumed via `npm link` (see the README for the user-facing flow).

---

## Local development

Requirements:

- Node.js `>= 20` (the repo pins `24.14.1` via Volta — install Volta if you
  want exact parity).
- A C toolchain available for `better-sqlite3` (`build-essential` on
  Debian/Ubuntu, Xcode CLT on macOS).

```bash
# Clone and install
git clone https://github.com/mashware/domain-memory.git
cd domain-memory
npm install                      # runs `npm rebuild better-sqlite3` via postinstall
npm run build                    # builds all workspaces in topological order

# Link binaries onto your PATH (only needed once)
npm run link:all
```

Verify:

```bash
domain-memory --version
domain-memory doctor
```

If you move or delete the repo later, run `npm run unlink:all` first or
the linked binaries will point at a stale path.

---

## Running tests

```bash
# All workspaces
npm test --workspaces --if-present

# A single workspace
cd packages/server && npx vitest run
cd packages/cli    && npx vitest run

# Watch mode
cd packages/server && npx vitest

# Typecheck everything
npm run typecheck
```

The eval suite measures retrieval quality. It is run on CI and can be run
locally:

```bash
npm run evals                              # full run, compares against baseline
npm run evals -- --fail-on-regression 0.05 # CI flag, 5 % regression tolerance
```

Eval output lands in `evals/last-run.json` (per-machine, gitignored).
`evals/baseline.json` is the committed reference and only changes when a
PR intentionally improves the baseline.

---

## Project conventions

### Style

- TypeScript everywhere. No JavaScript in `packages/*/src`.
- Strict mode is on. `any` should be a deliberate choice with a comment.
- 2-space indent, single quotes, semicolons, trailing commas. Matches what
  is already in the tree.
- Imports use ESM (`type: "module"`). All workspace imports go through
  the package entrypoint, never deep imports across packages.

### Naming

- Files: `kebab-case.ts`.
- Types and classes: `PascalCase`.
- Functions and variables: `camelCase`.
- Constants that are truly constant (not just `let`-free): `UPPER_SNAKE_CASE`.

### Tests

- `*.test.ts` colocated with the file it tests.
- Vitest, `describe` per surface, `it` per behaviour.
- Prefer integration tests that exercise the public tool surface
  (`save_knowledge`, `search_knowledge`, etc.) over deep unit tests of
  private helpers. The MCP tools **are** the contract.

### Markdown templates

The files under `templates/` are the source of truth for what `install`
writes into a project. Edits to a template are picked up the next time
`domain-memory install` runs in any project. Be conservative — these
files are read by the LLM at session start, so verbosity costs tokens
forever after.

---

## Commits

We follow a relaxed Conventional Commits style:

```
<type>(<scope>): <subject>

<optional body>
```

- `type`: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `ci`, `perf`.
- `scope`: usually a workspace (`server`, `cli`, `web`) or a topic
  (`evals`, `install`).
- `subject`: imperative, lower-case, no trailing period.

Examples from the history:

```
feat(evals): adversarial corpus that actually exercises the ranker
fix(ci): topological build order + better-sqlite3 cache
fix(presentation): hide Slidev goto-dialog during demos
```

The body explains the **why** when the diff does not make it obvious.
Bug-fix commits should reference the symptom, not just the patch.

---

## Pull requests

Before opening a PR:

1. `npm run typecheck` and `npm test` pass locally.
2. `npm run evals` does not regress (or you've updated `baseline.json`
   intentionally and explained why in the PR body).
3. The CI workflow on the branch is green.

PRs should:

- Have a single coherent motivation. If you discover an unrelated bug
  along the way, open a second PR.
- Update `DESIGN.md` if you change an architectural rule.
- Update `SCHEMA.md` if you change the on-disk format or the tool payloads.
- Update `CHANGELOG.md` under `[Unreleased]`.
- Keep diffs small. A 200-line PR gets reviewed; a 2000-line PR rots.

The PR template will prompt you for these — fill it in.

---

## Architecture rules worth knowing

These are explained in detail in `DESIGN.md`, but the short version:

1. **The LLM is the criterion, the MCP is the store.** Semantic decisions
   (is this worth saving, does this contradict existing knowledge, what
   slug should this have) live in the agent, not in TypeScript. If you
   find yourself writing a heuristic that approximates judgement,
   reconsider — that judgement belongs in the prompt, not in the server.

2. **Markdown on disk is the source of truth.** SQLite is a derived
   index, rebuildable from disk with `domain-memory reindex`. Never
   write data to SQLite that does not also live in a markdown file.

3. **Failures are silent.** A down embedder, a slow query, a corrupted
   staging line — none of it reaches the agent session. Log it,
   degrade gracefully, return whatever partial result you can. The
   agent should never see an error from us.

PRs that violate these are usually wrong and will get pushed back. PRs
that propose to revisit one of them are welcome — open an issue first
so we agree on the shape of the change before you write the code.

---

## Reporting bugs

Use the GitHub issue template. The fields that matter most:

- `domain-memory --version` output.
- `node --version` output.
- A minimal repro. Ideally a tiny knowledge tree (a feature with one
  aspect) that triggers the bug.
- Whether `domain-memory doctor` flags anything.

For security-related issues, do **not** open a public issue — see
[SECURITY.md](SECURITY.md).

---

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
By participating, you agree to abide by it.
