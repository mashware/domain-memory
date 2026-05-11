// Tool: resolve_topic_key
// Deterministic dedup lookup. Given a canonical topic key
// (feature slug, or "<featureSlug>/<aspectSlug>" for aspects), returns the
// currently active entry under that key, or null if none exists.
//
// The agent is expected to call this before save_knowledge(create) whenever
// it already knows the exact slug it wants — this avoids the fuzzy
// search_knowledge round-trip and rules out accidental duplicates.

import { z } from 'zod';
import type { ServerContext } from '../context.js';

export const resolveTopicKeyInputShape = {
  topic_key: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Canonical dedup key: feature slug (e.g. "checkout") or "<featureSlug>/<aspectSlug>" for aspects (e.g. "checkout/taxes").',
    ),
};

const inputSchema = z.object(resolveTopicKeyInputShape);

export async function handleResolveTopicKey(
  ctx: ServerContext,
  rawInput: unknown,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = inputSchema.safeParse(rawInput);
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

  const existing = ctx.entries.resolveTopicKey(parsed.data.topic_key);

  const payload = existing
    ? {
        found: true,
        topic_key: parsed.data.topic_key,
        entry: existing,
      }
    : {
        found: false,
        topic_key: parsed.data.topic_key,
      };

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}
