// Tool: read_staging
// Returns the staged findings for a given branch, sorted chronologically.
// Used by /save-knowledge and the PR flow to consolidate pending findings
// into real entries.

import { z } from 'zod';
import type { ServerContext } from '../context.js';

export const readStagingInputShape = {
  branch: z.string().min(1),
};

const inputSchema = z.object(readStagingInputShape);

export async function handleReadStaging(
  ctx: ServerContext,
  rawInput: unknown,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const input = inputSchema.parse(rawInput);
  const findings = ctx.staging.read(input.branch);

  const payload = {
    branch: input.branch,
    findings,
    count: findings.length,
    first_ts: findings[0]?.ts ?? null,
    last_ts: findings[findings.length - 1]?.ts ?? null,
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}
