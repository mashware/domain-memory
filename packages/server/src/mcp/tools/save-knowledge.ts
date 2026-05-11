// Tool: save_knowledge
// Dispatches to SaveKnowledgeFlow after validating the payload. The agent
// is expected to have called search_knowledge first and resolved any
// contradictions with the user. The only conflict detected here is
// optimistic-lock staleness (conflict_stale).

import { z } from 'zod';
import type { ServerContext } from '../context.js';
import {
  SaveKnowledgeFlow,
  type SaveInput,
} from '../../flows/save-knowledge-flow.js';

const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(64);

const relationsSchema = z
  .object({
    depends_on: z.array(z.string()).optional(),
    triggers: z.array(z.string()).optional(),
    related_to: z.array(z.string()).optional(),
  })
  .optional();

const entryInputSchema = z.object({
  type: z.enum(['feature', 'aspect']),
  slug: slugSchema,
  name: z.string().min(1).max(200),
  feature_id: z.string().optional(),
  body: z.object({
    what: z.string().min(1),
    flow_mermaid: z.string().nullable().optional(),
    where: z.string().min(1),
  }),
  file_paths: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  relations: relationsSchema,
});

const saveInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    entry: entryInputSchema,
  }),
  z.object({
    action: z.literal('update'),
    target_id: z.string().min(1),
    entry: entryInputSchema,
    expected_updated_at: z.string().optional(),
  }),
  z.object({
    action: z.literal('archive'),
    target_id: z.string().min(1),
    expected_updated_at: z.string().optional(),
  }),
  z.object({
    action: z.literal('supersede'),
    target_id: z.string().min(1),
    superseded_by: z.string().min(1),
    expected_updated_at: z.string().optional(),
  }),
]);

// The MCP SDK wants a ZodRawShape for the inputSchema. We therefore expose
// the discriminated-union via a wrapper object with a single `payload` field
// and re-parse internally. Keeps the public shape compatible with the SDK
// while giving us the full discriminated-union validation.
export const saveKnowledgeInputShape = {
  action: z.enum(['create', 'update', 'archive', 'supersede']),
  entry: entryInputSchema.optional(),
  target_id: z.string().optional(),
  superseded_by: z.string().optional(),
  expected_updated_at: z.string().optional(),
};

export async function handleSaveKnowledge(
  ctx: ServerContext,
  rawInput: unknown,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = saveInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'error',
              code: 'invalid_input',
              message: parsed.error.message,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const flow = new SaveKnowledgeFlow({
    db: ctx.db,
    paths: ctx.paths,
    entries: ctx.entries,
    indexer: ctx.indexer,
  });

  const result = await flow.execute(parsed.data as SaveInput);

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
