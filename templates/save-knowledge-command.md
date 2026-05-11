---
description: Consolidate this branch's staged findings into the domain-memory store
---

You are running the `/save-knowledge` flow. The user is asking you to consolidate into the store the knowledge learned in this session (or in earlier sessions on the same branch).

Execute this sequence:

1. **Read the staging** for the current branch with `read_staging`. If it is empty and you have no new findings in the current session context either, tell the user *"Nothing to consolidate on this branch."* and stop.

2. **Combine** the staged findings with any relevant findings that came up in the current session and are not yet in the staging. Apply the "why vs what" rule: discard anything that is not domain knowledge.

3. **For each consolidated finding**:
   - Call `search_knowledge` with the topic and the finding's `file_paths`.
   - Decide: create a new entry, update an existing one, enrich it with a new angle, or flag a conflict.
   - If there is a conflict, ask the user there and then. Do not save until it is resolved.
   - If there is no conflict, call `save_knowledge` with the decision.

4. **Summarise to the user** what you did, briefly: *"Created: N. Updated: M. Archived: K. Conflicts resolved: J."*

5. **Clear the staging** for the branch once consolidation succeeds.

If any MCP call fails, tell the user about the specific failure — this flow is explicit, failures are visible.

See `.domain-memory/instructions.md` for the full behaviour spec.
