<!-- domain-memory:start -->
## Domain Memory

This project uses **domain-memory** to accumulate business-domain knowledge (flows, decisions, integrations, "why" nuances).

**Read the full instructions at `.domain-memory/instructions.md` at the start of every session.** They are mandatory and cover when to query the MCP, how to use per-branch staging, the "why vs what" rule, conflict handling, and the PR flow.

Minimum rules if you have not yet read the full instructions:
- On startup, query the `domain-memory` MCP with `search_knowledge` using the current task. If it fails or takes >2s, continue without context.
- Silence by default: do not propose saving knowledge unless there is a strong signal.
- Before writing to the store, always re-query. Never trust what you remember from the start of the session.
- Conflicts block the save and are resolved live with the user.
- MCP failures must never break the session or surface as an unsolicited error to the user.
<!-- domain-memory:end -->
