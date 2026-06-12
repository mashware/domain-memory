# Domain Memory

![domain-memory](https://socialify.git.ci/mashware/domain-memory/image?description=1&font=Raleway&language=1&name=1&owner=1&stargazers=1&theme=Auto)

[![CI](https://github.com/mashware/domain-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/mashware/domain-memory/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-43853d.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-8A2BE2.svg)](https://modelcontextprotocol.io/)
[![GitHub stars](https://img.shields.io/github/stars/mashware/domain-memory?style=flat)](https://github.com/mashware/domain-memory/stargazers)

A local MCP server that accumulates the **business-domain knowledge** of a software project — flows, integrations, decisions, nuances — and makes it available to any MCP-compatible agent (Claude Code, Cursor, Copilot, Gemini, OpenCode).

The goal is to capture the **why** behind the code: the stuff a new developer would need six months from now to understand why a thing is built the way it is. The **what** is already in the code — domain-memory does not duplicate it.

> **Status**: Functional. Local install, single developer, local SQLite.

## What this is

Domain Memory is a **living glossary of your project's business domain** — the concepts, rules, entities, and the *why* behind decisions — that grows as you build. The frame that matters: this is **semantic memory** (what "a German invoice" or "a deactivated account" means in your project, and why it behaves the way it does), not **episodic memory** (what you changed last Tuesday and in which commit). The episodic record already lives in git history; Domain Memory holds the part no diff captures.

You don't stop to write documentation. As the agent works it records findings on its own, and they are folded into the glossary when you run `/save-knowledge` or open a pull request — so the knowledge accrues from real work instead of becoming a separate authoring chore you have to remember.

Everything is **plain markdown you own and version in git**. Each entry is a human-readable file under `.domain-memory/`; the search index is derived from those files and can be rebuilt from them at any time, so the knowledge stays portable, reviewable in a pull request, and never locked inside a database.

If what you want is a history of work sessions, cross-machine sync, or generic per-user assistant memory, this is deliberately not that. Domain Memory stays narrow on purpose: the domain knowledge of one project, and nothing else.

## How is this different from…

Domain Memory occupies a narrow niche. The closest neighbours and where it differs:

| Tool | What it stores | Scope |
|---|---|---|
| **Domain Memory** | Business-domain knowledge — the *why* behind the code, decisions, integrations, flows | Per-project, local, source-controlled markdown |
| `mem0`, `letta` | Conversation / agent memory — what the user said, preferences | Per-user, cross-conversation |
| RAG over docs (`continue.dev`, custom pipelines) | Whatever text you embed (READMEs, Confluence, code) | Reuses existing artefacts; no new authoring layer |
| `CLAUDE.md` / `AGENTS.md` | A single hand-written context file | One file, no structure, no search |

If you're asking "where does the agent remember that I prefer dark mode?", you want `mem0`. If you're asking "where does the agent remember that we deliberately bypass tax validation for German invoices because of the 2024 ruling?", you want this.

---

## How it works

Three principles run the whole system:

1. **The LLM is the criterion, the MCP is the store.** All judgment calls — "does this contradict existing knowledge?", "is this worth remembering?" — live in the agent. The server just persists, searches, and reports. Semantic reasoning never happens in SQL.
2. **Markdown on disk is the source of truth.** Every entry is a human-readable `.md` file under `.domain-memory/knowledge/`. SQLite is a derived index that can be rebuilt from disk at any time (`domain-memory reindex`).
3. **Failures are silent.** A down embedder, a slow query, a corrupted staging line — none of it is ever surfaced to the agent session. If domain-memory cannot help, it stays out of the way.

### Unit of knowledge: Feature + Aspects

The unit is the **feature** (`checkout`, `auth`, `notifications`, `search`…). Each feature is one directory with a `feature.md` and optional `aspects/` underneath:

```
.domain-memory/knowledge/
  checkout/
    feature.md           ← high-level prose + Mermaid of the whole flow
    aspects/
      taxes.md           ← specific subtopic
      stripe.md
      webhook.md
```

A feature is the **primary context**: the general Mermaid diagram in `feature.md` typically answers 70% of questions. Aspects are loaded on demand when the agent needs detail on a specific slice.

Each entry carries three layers:
- **What it does** — short prose (no code duplication).
- **How it flows** — a Mermaid diagram (mandatory for flows and integrations).
- **Where it lives** — `file_paths` + qualified symbol names.

### Per-branch staging

While you work, the agent appends **findings** to `.domain-memory/staging/<branch>.jsonl`. Findings survive session compaction, browser closes, new sessions on the same branch — indexed by git branch, not by session id. When you open a PR or run `/save-knowledge`, the staging is consolidated into real entries.

If you sometimes push without going through the agent, those findings can sit unconsolidated. The optional **pre-push reminder** closes that gap: `domain-memory install --git-hook` writes a non-blocking `.git/hooks/pre-push` that prints a one-line nudge when the branch you are pushing still has staged findings. It never blocks the push, stays silent when there is nothing to consolidate, and is a no-op if the CLI is not on `PATH`. It is opt-in — plain `install` asks before touching `.git/hooks`.

### Triple matcher

`search_knowledge` runs three matchers in parallel and fuses them:

1. **Embedding** (semantic, local Transformers.js with all-MiniLM-L6-v2, no API key).
2. **BM25** (SQLite FTS5, for exact keyword matches).
3. **Path / symbol** (exact + basename + short-symbol, resilient to renames).

The fusion is weighted: path = 0.5, embedding = 0.3, bm25 = 0.2. Path/symbol is weighted strongest because it is the most reliable signal when two pieces of knowledge are about the same code.

### Drift

Every entry stores SHA-256 hashes of the files it references. On PR open, the agent cross-references the PR's touched files against the knowledge store via `check_drift` and asks the developer to review any affected entries. Rename/move is absorbed by matching on basename and short symbol; deletes are caught on the next reindex.

### Lazy confidence decay

Every entry has a `confidence` (0–100) that decays **-5 points every 30 days** without verification. Computed lazily at read time — no scheduled job, always consistent with the wall clock. Below 50 the entry shows up red in `/stale` and the web viewer. A human review resets it with `domain-memory verify <id>`.

---

## Install

Two ways to run it. Pick the one that matches what you're trying to do.

### Just the MCP server (most common)

Add it to your MCP client's config. No global install needed — `npx` fetches and runs it on demand.

```json
{
  "mcpServers": {
    "domain-memory": {
      "command": "npx",
      "args": ["-y", "@mashware/domain-memory-server"]
    }
  }
}
```

That goes in `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor), `.vscode/mcp.json` (Copilot), `.gemini/settings.json` (Gemini), or `opencode.json` (OpenCode).

Restart your client. From then on the agent will call `search_knowledge` at the start of each session.

### Server + CLI (web viewer, install helper, drift checks)

If you also want the `domain-memory` CLI (to bootstrap entries, run the web viewer, check drift, etc.):

```bash
npm install -g @mashware/domain-memory
```

This installs three commands globally: `domain-memory`, `domain-memory-server`, `domain-memory-web`. Then in any project:

```bash
cd /path/to/your/project
domain-memory install      # writes the MCP config + pointer blocks for the clients you use
domain-memory doctor       # sanity check
domain-memory web          # open the viewer at http://localhost:4373
```

`install` is idempotent — re-running updates files in place without clobbering your content.

### Updating

```bash
npm update -g @mashware/domain-memory
```

### Uninstalling

```bash
npm uninstall -g @mashware/domain-memory
```

To remove domain-memory from a specific project: delete `.domain-memory/`, remove the `<!-- domain-memory:start -->` block from the client instruction files, and drop the `domain-memory` entry from `.mcp.json` / `.cursor/mcp.json` / `.vscode/mcp.json` / `.gemini/settings.json` / `opencode.json`. If you installed the pre-push reminder, also remove the `# >>> domain-memory pre-push >>>` block from `.git/hooks/pre-push` (or delete the file if it contains nothing else).

### From source (contributors)

If you want to hack on the project itself, see [CONTRIBUTING.md](CONTRIBUTING.md) for the clone-and-link dev workflow.

---

## CLI commands

| Command | What it does |
|---|---|
| `domain-memory install` | Interactive setup. Detects which MCP clients the project uses and writes pointer blocks, MCP registrations, and `.gitignore` entries idempotently. Pass `--git-hook` to also install the pre-push reminder without prompting. |
| `domain-memory bootstrap [--source-root path]` | Scan a mature project and write `.domain-memory/bootstrap-plan.md` — a checklist of candidate features for the agent to process with you. Prints a ready-to-paste prompt. See "Mature projects" below. |
| `domain-memory enrich <id\|slug>` | Print a guided prompt to deepen an existing feature entry. Useful for ritualized "spend 20 minutes improving checkout" sessions. |
| `domain-memory reindex [--fresh]` | Rebuilds `index.sqlite` and embeddings from the markdown files on disk. Use `--fresh` to wipe the index first. |
| `domain-memory doctor` | Read-only health check: index vs. disk consistency, broken file references, embedding coverage, stale staging files, and possible-contradiction candidates (entries that overlap enough to be worth a review). |
| `domain-memory verify <entry-id>` | Mark an entry as verified now. Resets the lazy confidence decay clock. Body unchanged. |
| `domain-memory check-drift --files a.ts,b.ts` | Print the knowledge entries that reference the given files. Supports `--json` and stdin for git hooks. |
| `domain-memory staging-status [--branch name]` | Report how many unconsolidated findings are staged on a branch. Read-only, always exits 0. Supports `--json` and `--quiet` — the engine behind the optional pre-push reminder. |
| `domain-memory web [--port 4373]` | Start the local read-only viewer. |
| `domain-memory http [--port 4374] [--host 127.0.0.1]` | Start an HTTP API exposing the same tools as the MCP server (for CI hooks and external scripts). Set `DOMAIN_MEMORY_HTTP_TOKEN` to require bearer-token auth. |
| `domain-memory decay [--write]` | Report (or persist with `--write`) the lazy confidence decay into the stored values. Maintenance command. |
| `domain-memory export --out <dir>` | Pre-render every viewer page into a static directory, suitable for any static HTTP server. |

---

## MCP tools

The server exposes six tools over stdio MCP:

- **`search_knowledge(query, context?)`** — run the triple matcher, return ranked candidates. Respects a 2000 ms timeout (configurable via `DOMAIN_MEMORY_SEARCH_TIMEOUT_MS`).
- **`resolve_topic_key(topic_key)`** — deterministic dedup lookup. Returns the active entry under a canonical key (feature slug, or `"<featureSlug>/<aspectSlug>"` for aspects) or `null`. Use before `save_knowledge(create)` when you already know the exact slug.
- **`save_knowledge({action: create|update|archive|supersede, …})`** — persist an entry with optimistic locking. Detects `conflict_stale` (a race on `expected_updated_at`) and `conflict_duplicate` (create under an existing active `topic_key`). Semantic contradictions are the agent's job.
- **`stage_finding(branch, finding)`** — append to the branch's JSONL staging.
- **`read_staging(branch)`** — read the staged findings for a branch.
- **`check_drift(file_paths)`** — return entries that reference any of the given files. Respects a 2000 ms timeout.

The same tools are reachable over HTTP via `domain-memory http`: each is a `POST /api/<tool_name>` route with the MCP payload as JSON body. This is the integration point for CI hooks, shell scripts, and any future pipeline agents.

Agent behavior is defined in `templates/instructions.md`, which the install script copies to `.domain-memory/instructions.md` in the target project. Every supported client gets a short pointer block that tells its agent to read the full instructions at session start.

---

## Supported clients

| Client | Instructions file | MCP config file |
|---|---|---|
| Claude Code | `CLAUDE.md` + `.claude/commands/save-knowledge.md` | `.mcp.json` |
| Cursor | `.cursor/rules/domain-memory.mdc` | `.cursor/mcp.json` |
| GitHub Copilot (VS Code) | `.github/copilot-instructions.md` | `.vscode/mcp.json` |
| Gemini CLI | `GEMINI.md` | `.gemini/settings.json` |
| OpenCode | `AGENTS.md` | `opencode.json` |

The install writes one delimited block per file (`<!-- domain-memory:start -->` / `<!-- domain-memory:end -->`). Re-running install updates the block in place — your own content is never clobbered.

---

## Mature projects — the cold start

A fresh install on a large, mature codebase starts **empty**. The system
learns by **silence by default**: the agent only stages findings when
the developer explicitly explains a "por qué" during a session. In a
legacy project with years of history, that means most of the valuable
knowledge never appears organically — it is already obvious to whoever
wrote the code, and they will never think to dictate it.

Three mechanisms are available to populate and enrich the store without
falling into the trap of auto-generating what the code already says:

### 1. `domain-memory bootstrap` — guided cold start

Scans the project tree, ranks directories by code density, and writes
a `.domain-memory/bootstrap-plan.md` with one checkbox per candidate
feature. Already-documented directories are marked `[x]`. The command
prints a ready-to-paste prompt that tells the agent to work the plan
one candidate at a time, **reading the code and asking you** the
por-qué questions it cannot answer alone.

```bash
domain-memory bootstrap
# review and edit .domain-memory/bootstrap-plan.md
# open a session and paste the printed prompt
# the agent walks the list, one feature at a time, asking you questions
```

A good bootstrap takes **3-5 focused 30-minute sessions** for a project
of 15-20 features. Do it incrementally, not in one sitting — quality
depends on your attention.

### 2. Enrich-on-PR — passive sedimentation

When you open a PR that touches an already-documented feature, the
agent asks you once, optionally, if anything you learned while working
deserves to be added to the feature's entry. Default answer is "skip".
No friction, no mandatory ritual — but the opportunity is there every
single PR. Over months, this is what keeps entries fresh.

### 3. `domain-memory enrich <feature>` — dirigido deepening

For when you want to explicitly sit down and improve a specific entry:

```bash
domain-memory enrich checkout
```

Prints a prompt that tells the agent to reread the existing entry, open
all the referenced code, and ask you 5-10 pointed questions whose
answers would actually improve the entry. You spend 20 minutes, you
answer in voice, the agent updates everything.

### The principle

None of these auto-generate knowledge. Auto-generated knowledge is
noise: the agent reading code can only describe **what** the code does,
and that is the part that already lives in the code. The valuable
content — the **why**, the contraintuitive decisions, the trade-offs —
lives in the human's head. The three mechanisms get that human talking
in the right moments. The agent listens and writes.

---

## Web viewer

`domain-memory web` starts a Hono-backed HTTP server on port 4373 with:

- **Dashboard** — counts, recently updated entries, low-confidence warning card.
- **Features** — list with substring search over name, summary, and tags.
- **Feature detail** — prose + Mermaid diagram + aspects + relations (incoming and outgoing).
- **Aspect detail** — breadcrumb back to the parent, prose, optional Mermaid.
- **Stale** — all entries whose effective confidence has dropped below 50.
- **Graph** — Mermaid `flowchart LR` of feature relations with clickable nodes.
- **JSON APIs** — `/api/stats`, `/api/graph` for tooling.

Read-only by design. Writes go through the CLI or the MCP tools.

---

## Project layout

```
domain-memory/
├── DESIGN.md                ← architectural decisions and principles
├── SCHEMA.md                ← file layout, frontmatter, SQLite schema, tool payloads
├── templates/               ← single source of truth for installed instructions
│   ├── instructions.md
│   ├── save-knowledge-command.md
│   └── pointer-blocks/
└── packages/
    ├── server/              ← @mashware/domain-memory-server (MCP stdio + storage + search + flows)
    ├── cli/                 ← @mashware/domain-memory (install, reindex, doctor, mode, verify, check-drift, web)
    └── web/                 ← @mashware/domain-memory-web (Hono SSR viewer)
```

---

## Development

```bash
npm install
npm run build                       # all workspaces
npm run typecheck                   # all workspaces

# Tests
cd packages/server && npx vitest run
cd packages/cli    && npx vitest run

# Run the MCP server directly (stdio) for debugging
node packages/server/dist/index.js

# Run the web viewer directly
node packages/web/dist/index.js

# Point install at a custom server bin
DOMAIN_MEMORY_SERVER_BIN=/custom/path/to/server.js domain-memory install
```

The markdown templates live at `templates/` and are resolved at install time via `DOMAIN_MEMORY_TEMPLATES` (override) → packaged `templates/` → monorepo dev fallback. Editing a template and re-running install picks up the change immediately.

---

## Configuration via environment variables

| Variable | Default | What it does |
|---|---|---|
| `DOMAIN_MEMORY_ROOT` | `cwd` | Project root where `.domain-memory/` lives. |
| `DOMAIN_MEMORY_TEMPLATES` | — | Override the templates directory used by `install`. |
| `DOMAIN_MEMORY_SERVER_BIN` | — | Override the server bin path or command registered by `install`. |
| `DOMAIN_MEMORY_SEARCH_TIMEOUT_MS` | `2000` | Hard budget for `search_knowledge`. |
| `DOMAIN_MEMORY_DRIFT_TIMEOUT_MS` | `2000` | Hard budget for `check_drift`. |
| `DOMAIN_MEMORY_WEB_PORT` | `4373` | Port for `domain-memory-web`. |
| `DOMAIN_MEMORY_HTTP_TOKEN` | — | If set, the HTTP API requires `Authorization: Bearer <token>` on every `/api/*` route. |

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR, and abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

For security issues, follow the disclosure process in [SECURITY.md](SECURITY.md) — please do not file public issues for vulnerabilities.

---

## License

[Apache License 2.0](LICENSE) © 2026 Alberto Vioque.
