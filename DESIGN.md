# Domain Memory — Consolidated design

> Design document agreed during the pre-implementation conversation.
> Locks in the architectural and behavioural decisions of the system.

## What this is

An MCP server that accumulates the business-domain knowledge of a software project. It captures the **why** behind the code (flows, decisions, integrations, nuances) and makes it available to any MCP-compatible client. The LLM is the criterion; the MCP is the store.

## What it stores and what it doesn't

**Stores**: business flows, domain concepts, external integrations and their quirks, counter-intuitive decisions, relations between features.

**Doesn't store**: bugs or their fixes (it does update entries if the bug reveals that what was documented was wrong), temporary code, style preferences, anything the code itself already says.

**Mental rule**: *if six months from now a new developer would need it to understand WHY the code does what it does, it is knowledge. If it only describes WHAT it does, the code already says it.*

## Unit of knowledge — Feature with aspects

The primary unit is the **feature** (checkout, authentication, notifications, search…). Each feature contains:

```
<feature>/
  feature.md          ← general prose + Mermaid of the whole flow
  aspects/
    <aspect1>.md      ← short prose + file_paths + optional Mermaid
    <aspect2>.md
    ...
```

**`feature.md`** is the primary context. A new developer asking about the feature receives this file and, with the general Mermaid, understands 70% of the case. It covers most queries without loading anything else.

**Aspects** are granular internal units (pricing, taxes, webhook, emails…). They are loaded **only when the question triggers them**. Each aspect has its own `file_paths`, its own `confidence`, and its own lifecycle.

Between features there are short relations: `depends_on`, `triggers`, `related_to`. Within a feature there are no relations — everything is together.

**Every entry (feature or aspect)** has three layers:
1. **What it does** — prose describing the business logic.
2. **How it flows** — Mermaid diagram (mandatory for flows and integrations).
3. **Where it lives** — `file_paths` + symbol names (class, namespace, function).

Metadata: `confidence (0–100)`, `status: active | archived | superseded_by`, `last_verified`, `content_hashes` of the referenced files.

## Capture — When and how it gets saved

**Single entry point**: `/save-knowledge`. Invoked manually by the developer or internally by the open-PR flow. There is no implicit detection from loose phrases.

**Silence by default**: the agent only proposes saving when it detects strong signals (a new integration, a counter-intuitive decision, a nuance explained during the session). With no signal, it does not ask.

**The agent drafts, the developer approves**: the cognitive cost of saving is *"yes, save it"* or *"no, this isn't domain"*. The developer never writes from scratch.

## Per-branch staging — Survives compaction

During the session, each relevant finding is written immediately to `.domain-memory/staging/<branch>.jsonl` (append-only, one line per finding). Indexed by **git branch**, not by session id, so it survives compaction, closing the laptop, and opening new sessions on the same feature.

When `/save-knowledge` runs or a PR is opened, the agent reads the full staging for the branch, cross-references it against the MCP, and decides what to create/update/mark as conflict. The staging is cleared on consolidation.

## Search before write — Triple matcher

Every write goes through `search_knowledge(query, context)`, which runs three searches in parallel:

1. **Embedding** (semantic) over title + summary of features and aspects.
2. **BM25 / keyword** over the full body.
3. **Path / symbol** — cross-references the files mentioned in the finding against the `file_paths` and `symbols` of existing entries. This is the most reliable.

Returns top candidates with scores. The agent decides: create, update, conflict, or enrich.

**Never trust what you remembered from the start of the session** — always re-query before writing, because the context may have been compacted.

## Conflicts and confidence

**Numeric confidence (0–100)** that decays on its own:
- Starts at 80.
- Goes up to 95 when another session uses it without contradiction.
- Drops to 40 when there is a conflict.
- Decays 5 points every 30 days without being touched.
- Below 50 it appears in red in the local web.

**Conflicts block the save**: if the agent detects a contradiction, it does not write. It creates a `pending_conflict` with the two versions and asks the developer there and then *"this contradicts entry X — which is correct?"*. It is resolved now or it is not saved. Nothing stays pending.

The conflict is resolved by whoever triggered it.

## Drift with the code — Self-healing + PR checkpoint

**Stored anchors**: each aspect saves `file_paths` + symbol names + `content_hash` of each file at write time.

**Drift detection**:
- The `domain-memory check-drift` command and a button in the local web walk the entries, recompute hashes, and mark them as `possibly stale` if the file changed >30% or disappeared.
- Stale entries appear in a separate panel of the web with the diff next to them.

**Mandatory PR checkpoint**: when opening a PR, the agent cross-references the touched files against the `file_paths` of every entry. If there is an intersection, it asks *"this PR touches files of N entries — do you want to review them?"*. You can't cleanly open a PR without at least confirming.

**Handling code changes**:
- **Rename / move**: the symbol matcher catches it, the entry auto-updates on save.
- **Class deleted, flow still exists**: check-drift marks stale; the developer updates `file_paths` while keeping prose and Mermaid.
- **Feature removed**: the entry is archived (not deleted). `status: archived` — knowing *"we used to do X and removed it because Y"* is still valuable.
- **Refactor that splits one into several**: the agent proposes splitting, updating, or superseding. The developer decides.

## Silent degradation — Never break the session

- All MCP calls with `timeout: 2000ms`.
- The MCP server runs in a separate process. If it crashes, the agent continues.
- Errors are logged to `~/.domain-memory/errors.log`, never propagated to the user.
- If the initial session query takes longer than 2s, it is cancelled and the session starts without knowledge.
- Explicit non-functional requirement in the README.

## Deployment

One developer, one machine, local database (SQLite + local embedding index). Zero infrastructure. The interactive install script generates the configuration.

## Generated agent instructions

The installer writes a section into the project's agent instruction file (e.g. `CLAUDE.md`) that tells the agent to:

1. **At session start**: query the MCP with the current task context, retrieve only the relevant part.
2. **During the session**: write findings to per-branch staging as they appear, before any compaction.
3. **Before writing**: always re-query the MCP, never trust the in-session context.
4. **At PR time**: consolidate the staging, cross-reference touched files against existing entries, ask for review if there is an intersection.
5. **Silence by default**: only propose saving on strong signals.
6. **The why-vs-what rule**: with concrete examples of what to save and what not to save.

## Visualisation — Local web

- Feature list with search.
- Detail with rendered Mermaid (feature + aspects).
- Graph of relations between features.
- Panel of entries with `confidence < 50` for review.
- `possibly stale` panel with the diff alongside.
- `pending_conflict` panel (almost always empty because conflicts are resolved live).
- Export to Markdown or static HTML.

## Cross-cutting principles

- **The LLM is the criterion, the MCP is the store.** Don't put decision logic into the server.
- **The agent's context is an ephemeral cache, never a store.** Everything important lives in MCP + staging.
- **Silence by default.** If the developer has to fight the system, the system dies.
- **Failures never break the session.** Silent degradation is a requirement, not a feature.
- **Checkpoint at the cheapest moment**: opening a PR, when the developer has fresh context.

## Repository layout (proposed)

```
domain-memory/
├── server/              ← MCP server (stdio + optional HTTP)
│   ├── storage/         ← SQLite + embedding index
│   ├── search/          ← triple matcher
│   ├── staging/         ← per-branch staging management
│   └── drift/           ← detection and hashes
├── cli/                 ← install script, check-drift
├── web/                 ← local visualisation
├── templates/
│   └── instructions.md  ← template written at install time
└── docs/
```

## Implementation order

1. Agent instructions template — defines behaviour.
2. Data schema — `feature.md`, `aspect.md`, staging `.jsonl`, metadata.
3. Minimal MCP server — stdio, `search_knowledge` and `save_knowledge`, SQLite + local embeddings.
4. Triple matcher.
5. Per-branch staging + consolidation at PR time.
6. Drift check — hashes and PR checkpoint.
7. CLI — install script, `check-drift`.
8. Local web — last.
