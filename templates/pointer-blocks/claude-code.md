<!-- domain-memory:start -->
## Domain Memory — MANDATORY

**BEFORE you answer the first question of each session** and **BEFORE any Grep/Read/Glob on domain, architecture or business decisions**: call the `domain-memory` MCP with `search_knowledge(query)`. The query describes the user's task. This is not optional — it is the first step of the flow.

**BEFORE `save_knowledge`**: re-query with `search_knowledge`. Your context may be stale after compaction.

Full instructions at `.domain-memory/instructions.md` (per-branch staging, the "why vs what" rule, conflicts, PR flow). Read them whenever the task touches domain knowledge.

Minimum rules:
- Silence by default: do not propose saving unless there is a strong signal.
- MCP > 2s or failing: continue without context, don't block, don't warn the user.
- Conflicts block the save and are resolved live with the user.
<!-- domain-memory:end -->
