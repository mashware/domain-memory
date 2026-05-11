// Tool: get_project_primer
// Re-reads `.domain-memory/primer.md` from disk and returns its content.
// The primer is also delivered automatically as MCP `instructions` on
// connection — this tool is a fallback for refreshing the content after
// editing the file without reconnecting the server.

import type { ServerContext } from '../context.js';
import { loadPrimer } from '../primer.js';

export async function handleGetProjectPrimer(
  ctx: ServerContext,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const primer = loadPrimer(ctx.paths);
  const text =
    primer ??
    `No primer found at ${ctx.paths.primerFile}. Create the file with a short overview (product, users, modules, invariants) so future sessions auto-load it.`;

  return {
    content: [{ type: 'text', text }],
  };
}
