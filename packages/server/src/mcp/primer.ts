// Loads the project primer from `.domain-memory/primer.md`.
// The primer is a short markdown document (1-2 pages) that defines what
// the project is, who uses it, the major modules and their intent, and
// any invariants. It is exposed as MCP `instructions` so clients deliver
// it to the LLM as system context on every connection.
//
// Note: distinct from `.domain-memory/instructions.md`, which holds the
// agent-behavior rules and is delivered via the host client's pointer
// block (CLAUDE.md, AGENTS.md, .cursor/rules/...).

import { readFileSync } from 'node:fs';
import type { DomainMemoryPaths } from '../storage/paths.js';

export function loadPrimer(paths: DomainMemoryPaths): string | null {
  try {
    const content = readFileSync(paths.primerFile, 'utf-8').trim();
    return content.length > 0 ? content : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
