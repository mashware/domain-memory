# Domain Memory — Instructions for the agent

This project uses **domain-memory**, an MCP system that accumulates business-domain knowledge (flows, decisions, integrations, "why" nuances). Your behaviour must follow the rules in this document strictly.

The MCP server exposes these tools:
- `search_knowledge(query, context)` — search for relevant entries.
- `resolve_topic_key(topic_key)` — look up an active entry by its canonical key (feature slug, or `"<featureSlug>/<aspectSlug>"` for aspects). Use it before `save_knowledge(create)` when you already know the exact slug: it is deterministic and more reliable than fuzzy search for avoiding duplicates.
- `save_knowledge(payload)` — propose creating or updating an entry. If you create with a `topic_key` that is already active, it returns `conflict_duplicate` with the existing ID — update it instead of creating a duplicate.
- `stage_finding(finding)` — append a finding to the current branch's staging.
- `read_staging(branch)` — read the full staging for a branch.
- `check_drift(file_paths)` — given a set of files, return the entries that reference them.

---

## At the start of every session

1. Identify the task the user wants to solve in this session (read their first message and any context from the current branch).
2. Call `search_knowledge` with a query that describes that task. Don't ask for "all of the project's knowledge" — only what is relevant.
3. If the call takes longer than 2 seconds or fails, **continue without the context**. Don't block the session and don't tell the user about the failure. Just keep working normally.
4. If the call returns entries, treat them as background context. Don't recite them to the user unless asked. Use them to inform your answers and decisions.
5. Each candidate's `summary` field is a short summary, not the full content. If a candidate looks relevant but the `summary` isn't enough to answer in detail (or you see references like "three branches:", "two points:", "reinforced in..."), **read the file at `content_path` with Read before answering**. Don't conclude "I found nothing" based on `summary` alone: a candidate with relevant `match_reasons` usually has the full answer in the file.
6. Each candidate also carries a `drift` field with the state of its referenced files against disk. Use it to decide how much to re-verify:
   - `drift.status === 'fresh'` → the candidate's files have not changed since the entry was saved. **Trust the content** and use it directly; don't re-grep or re-read the files "just in case".
   - `drift.status === 'drifted'` → at least one file changed. Re-verify **only** the ones listed in `drift.drifted_files` and `drift.missing_files`; the rest are still aligned.
   - `drift.status === 'unknown'` → the entry has no comparable hashes (e.g. it only points to directories). Decide for yourself whether to re-verify, no automation.
7. If there is staging on the current branch (`read_staging` returns entries), read it too. Those are findings from earlier sessions on the same unit of work that haven't been consolidated yet.

---

## During the session — per-branch staging

When you learn something domain-relevant during the session, **write it to staging immediately with `stage_finding`**, before your context can get compacted. Staging lives at `.domain-memory/staging/<branch>.jsonl` and survives compaction, session close, and new sessions on the same branch.

A "finding" is a short note with:
- `topic` — what it is about (feature + aspect if applicable).
- `finding` — the prose note, 1–3 sentences.
- `file_paths` — relevant files.
- `symbols` — class/function/namespace names if applicable.
- `source` — why you know this (the user explained it, you inferred it from code, etc.).

**You don't dump anything into staging.** Only findings that satisfy the "why vs what" rule (below).

**Before compacting the conversation**, flush to staging any pending finding that isn't there yet. Compaction may erase nuances — staging preserves them.

---

## What counts as domain knowledge — the "why vs what" rule

> If, six months from now, a new developer would need this to understand **WHY** the code does what it does, it is knowledge.
> If it only describes **WHAT** it does, the code already says it — do not save it.

**This IS domain knowledge** (save):
- *"When a user cancels their subscription, access remains active until the end of the billed period because internal policy does not allow partial refunds."*
- *"The webhook ingestion pipeline runs through a `normaliser` service before the main backend because legacy clients send payloads in a deprecated format that has to be reshaped."*
- *"VAT for B2B EU customers uses reverse charge — we don't add tax, the customer self-assesses."*
- *"Stripe webhook `invoice.payment_succeeded` is ignored for trial subscriptions because the event arrives but does not represent a real payment."*

**This is NOT domain knowledge** (don't save):
- *"Fixed a bug in `UserController.php`."* → that's the commit.
- *"We prefer async/await over promises."* → that's style.
- *"Test X was failing."* → temporary noise.
- *"The `calculateTax` function takes a `User` and returns a `Money`."* → the code already says it.
- *"Added an index to the `email` column."* → the schema says it.

---

## Silence by default

**Do not propose saving knowledge unless there is a strong signal.** Examples of strong signals:

- The user explains a counter-intuitive "why" that is not documented.
- A new external integration is described, or a nuance of an existing one.
- A business decision with consequences in several parts of the code appears.
- The user corrects an assumption of yours with domain information.
- An existing entry turns out to be outdated or wrong.

If the session is just refactoring, fixing obvious bugs, or writing code that reveals no new business logic, **propose nothing**. The system must be silent. If the developer has to fight the system to be allowed to work, the system dies.

---

## Before writing to the store — always re-query

When you are about to call `save_knowledge` (whether through an explicit user request, through `/save-knowledge`, or as part of the open-PR flow), **always re-query with `search_knowledge` first**. Don't trust what you remembered from the start of the session — your context may have been compacted and the information may be stale.

The `search_knowledge` call returns candidates from three channels (embedding, keyword, path/symbol). Use them like this:

- **No relevant candidate** → create a new entry.
- **Candidate that describes the same thing** → update that entry, enriching it with what you just learned.
- **Complementary candidate** (same area, different angle) → enrich the existing entry by adding the new aspect, do not create a parallel entry.
- **Candidate that contradicts the new finding** → **DO NOT WRITE**. Ask the user there and then: *"I found entry X which says A, but what you're describing now is B. Which is correct?"*. Resolve the conflict now. If the user can't decide, **don't save anything**. Nothing stays pending for "later review".

---

## Unit of knowledge — feature with aspects

The primary unit is the **feature** (`checkout`, `auth`, `notifications`, `search`…). Within each feature there are **aspects** (`pricing`, `taxes`, `webhook`, `stripe-integration`…).

When you are about to save knowledge:

1. Identify which **feature** it belongs to. If it's a new domain area, propose a new feature. If it fits in an existing one, use that.
2. Identify whether the knowledge describes the **whole feature** (general prose + optional diagram) or a **specific aspect** within it.
3. If the feature involves 3+ services or has non-linear decisions (forks, fallbacks, retries), a high-level Mermaid diagram (5–10 nodes) helps. For linear flows or simple CRUD, prose is enough — don't force a diagram.
4. Aspects are loaded on demand. Don't stuff into `feature.md` details that are only needed when someone asks about a specific slice — those belong in the matching aspect.

Each entry (feature or aspect) has three mandatory layers:
- **What it does** — short prose of business logic.
- **How it flows** — Mermaid diagram only if the flow warrants it (3+ services, non-linear decisions). Optional otherwise.
- **Where it lives** — `file_paths` + symbol names (classes, namespaces, functions).

---

## Marking sensitive content — `<private>`

When a nuance is relevant for the human developer but **should not travel to another session** (internal workaround, uncomfortable decision, comment about a specific customer, note that only makes sense for the team), wrap it in `<private>...</private>`:

```md
## What it does

Computes VAT per country and applies EU reverse-charge.
<private>
Customer ACME requested a manual exception until Q3 2026 — coordinate
with finance before touching the rule.
</private>
```

Rules:
- The **markdown on disk** keeps the block as-is — it's for the human developer reading the file.
- What's **served via MCP / HTTP / web viewer** is redacted to `[redacted]` before leaving.
- The **BM25 index and embeddings** never see the content — searching for a word inside the block doesn't find it.
- If you read a `feature.md` directly with the agent's `Read` tool you will see the unredacted content (local read); only do that when the user has asked you to inspect the raw entry.
- Nested or malformed blocks are redacted aggressively (the whole range). When in doubt, the system prefers to hide too much rather than too little.

If you need to inspect private content in the web viewer, start it with `domain-memory web --include-private`. The command warns on stdout when that flag is active.

---

## When opening a Pull Request

When the user asks you to open a PR (or you do it as part of a flow), execute this sequence **before** creating the PR:

1. **Consolidate the staging**: call `read_staging` for the current branch. Process each finding:
   - Re-query `search_knowledge` for that finding.
   - Decide create/update/conflict using the rules in the previous section.
   - Call `save_knowledge` with the decision.
   - Conflicts are resolved by asking the user there and then.

2. **Drift check**: compute the files this PR touches (`git diff --name-only main...HEAD`) and pass them to `check_drift(file_paths)`. This returns entries whose `file_paths` intersect with what the PR changes.

3. **Review potential stale entries**: for each entry returned by `check_drift`, ask the user *"this PR touches files of entry X — is it still correct?"*. Three possible answers:
   - *"Still correct"* → update `last_verified` on the entry, don't touch the content.
   - *"Needs updating"* → propose the changes and save.
   - *"No longer applies"* → archive it with `status: archived`, or mark it as `superseded_by` if a new entry replaces it.

4. **Lateral enrichment** (optional, once per touched feature):
   if the PR touches files of a feature that **has an active entry**, ask the user ONCE per feature: *"you've been working on files of feature X; is there anything you learned about that feature in general — not about your specific change — that should be added to the entry? You can skip this."*.
   - By default **the user skips** this question. It's explicitly optional.
   - If they respond with context, apply the "why vs what" rule and propose it as an update to the existing entry. Never create a new entry from a lateral enrichment: enrich the existing one.
   - If the user skips, don't insist and move on.

5. **Only then create the PR**.

If the user says *"don't check drift, just open the PR"*, respect the decision but warn briefly: *"Skipping drift review — X entries touch files of this PR and may go stale."*.

---

## Handling code changes

When the code changes, existing entries can fall out of alignment. Your role is to **detect the change and ask**, not to resolve automatically.

- **Rename / move** (the class changed name or location): the symbol matcher catches it. Update `file_paths` and `symbols` on the entry when saving.
- **Class deleted but the flow still exists**: the flow was implemented differently. Keep the prose and Mermaid if they are still accurate; update the references to the new files.
- **Feature removed from the product**: **archive, do not delete**. `status: archived`. Knowing *"we used to do X and removed it because Y"* is valuable knowledge — it stops someone reintroducing it without knowing why it was dropped.
- **Refactor that splits one feature into several**: propose to the user to split the original entry into several, or update it to reference the new files, or keep it archived with `superseded_by`. The user decides.

---

## Silent degradation — never break the session

- If any MCP call takes longer than 2 seconds, cancel it and continue without the result.
- If the MCP returns an error, log it internally and continue. **Don't tell the user** unless they explicitly invoked an action that depends on the MCP (e.g. `/save-knowledge`).
- If the MCP server is unavailable at session start, start without domain context. Work normally.
- A knowledge-system failure must **never** turn into a blocked session or an unsolicited error message to the user.

---

## Operating summary

1. **At startup**: query the MCP with the current task. If it fails, continue without context.
2. **During the session**: write findings to staging as they appear. Silence by default.
3. **Before saving**: always re-query. Apply the "why vs what" rule.
4. **Conflicts**: block the save, resolved live.
5. **At PR time**: consolidate staging, run drift check, ask about affected entries.
6. **Failures**: silent, never break the session.
