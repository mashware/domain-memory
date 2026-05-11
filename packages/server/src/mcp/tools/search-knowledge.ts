// Tool: search_knowledge
// Runs the triple matcher (embedding + BM25 + path/symbol) over the current
// project's knowledge store. Returns ranked candidates as structured JSON
// inside a text content block. The agent reads `content_path` to load the
// full entry when it needs more than the summary.

import { z } from 'zod';
import type { ServerContext } from '../context.js';
import {
  DEFAULT_SEARCH_TIMEOUT_MS,
  TimeoutError,
  withTimeout,
} from '../../util/timeout.js';

export const searchKnowledgeInputShape = {
  query: z.string().min(1).describe('Natural language query describing the topic'),
  context: z
    .object({
      file_paths: z.array(z.string()).optional(),
      symbols: z.array(z.string()).optional(),
      current_branch: z.string().optional(),
    })
    .optional()
    .describe('Optional context: files touched, symbols, current branch'),
  limit: z.number().int().positive().max(50).optional(),
};

const inputSchema = z.object(searchKnowledgeInputShape);
type SearchKnowledgeInput = z.infer<typeof inputSchema>;

export async function handleSearchKnowledge(
  ctx: ServerContext,
  rawInput: unknown,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const started = Date.now();
  const input = inputSchema.parse(rawInput) as SearchKnowledgeInput;

  const timeoutMs = resolveSearchTimeout();

  let candidates: Awaited<ReturnType<typeof ctx.searcher.search>> = [];
  let timedOut = false;

  try {
    candidates = await withTimeout(
      ctx.searcher.search({
        query: input.query,
        context: input.context,
        limit: input.limit ?? 10,
      }),
      timeoutMs,
      'search_knowledge',
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      timedOut = true;
      ctx.logger.warn('search_knowledge_timeout', {
        timeout_ms: timeoutMs,
        query: input.query,
      });
    } else {
      ctx.logger.warn('search_knowledge_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const payload = {
    candidates,
    elapsed_ms: Date.now() - started,
    ...(timedOut ? { timed_out: true, timeout_ms: timeoutMs } : {}),
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function resolveSearchTimeout(): number {
  const override = process.env['DOMAIN_MEMORY_SEARCH_TIMEOUT_MS'];
  if (!override) return DEFAULT_SEARCH_TIMEOUT_MS;
  const parsed = Number(override);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SEARCH_TIMEOUT_MS;
}
