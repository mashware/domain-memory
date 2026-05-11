// Tool: stage_finding
// Appends a finding to the per-branch staging file. Findings survive session
// compaction and client restarts — they are consolidated into real entries
// later, via /save-knowledge or the PR flow.

import { z } from 'zod';
import type { ServerContext } from '../context.js';
import type { FindingSource } from '../../storage/types.js';

const FINDING_SOURCES: readonly FindingSource[] = [
  'user_explained',
  'inferred_from_code',
  'inferred_from_tests',
  'user_correction',
] as const;

export const stageFindingInputShape = {
  branch: z.string().min(1).describe('Git branch the finding belongs to'),
  finding: z.object({
    topic: z.object({
      feature_hint: z.string().min(1),
      aspect_hint: z.string().optional(),
    }),
    finding: z.string().min(1).max(4000),
    file_paths: z.array(z.string()).default([]),
    symbols: z.array(z.string()).default([]),
    source: z.enum(FINDING_SOURCES as unknown as [FindingSource, ...FindingSource[]]),
    session_id: z.string().default('unknown'),
    client: z.string().default('unknown'),
  }),
};

const inputSchema = z.object(stageFindingInputShape);

export async function handleStageFinding(
  ctx: ServerContext,
  rawInput: unknown,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const input = inputSchema.parse(rawInput);

  const stored = ctx.staging.append(input.branch, input.finding);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ status: 'ok', finding_id: stored.id }, null, 2),
      },
    ],
  };
}
