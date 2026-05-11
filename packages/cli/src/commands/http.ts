// Starts a local HTTP server that exposes the same tools as the MCP stdio
// server. Useful for CI hooks, shell scripts, or any tooling that cannot
// (or does not want to) speak MCP. Binds to 127.0.0.1 by default — the
// server must never listen on a public interface without a reverse proxy
// in front. If DOMAIN_MEMORY_HTTP_TOKEN is set, all /api/* routes require
// a matching bearer token; unauthenticated requests get a 401.
//
// Each route mirrors one MCP tool. The handler reuses the same underlying
// logic and parses the content[0].text JSON back into a structured response
// so callers get a plain JSON body.

import pc from 'picocolors';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createServerContext } from '@domain-memory/server';
import {
  handleSearchKnowledge,
  handleSaveKnowledge,
  handleStageFinding,
  handleReadStaging,
  handleCheckDrift,
  handleResolveTopicKey,
} from '@domain-memory/server';

export interface HttpOptions {
  root: string;
  port: number;
  host: string;
}

export async function runHttp(opts: HttpOptions): Promise<void> {
  const ctx = createServerContext(opts.root);
  const app = new Hono();
  const token = process.env['DOMAIN_MEMORY_HTTP_TOKEN'];

  app.use('/api/*', async (c, next) => {
    if (!token) return next();
    const header = c.req.header('authorization') ?? '';
    const expected = `Bearer ${token}`;
    if (header !== expected) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return next();
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  const tool = (
    path: string,
    handler: (ctx: ReturnType<typeof createServerContext>, input: unknown) => Promise<{
      content: Array<{ type: 'text'; text: string }>;
    }>,
  ) => {
    app.post(path, async (c) => {
      let body: unknown = {};
      try {
        body = await c.req.json();
      } catch {
        // Empty or non-JSON body: keep {} so downstream zod validation owns the error.
      }
      const result = await handler(ctx, body);
      const text = result.content[0]?.text ?? '{}';
      try {
        return c.json(JSON.parse(text));
      } catch {
        return c.json({ raw: text });
      }
    });
  };

  tool('/api/search_knowledge', handleSearchKnowledge);
  tool('/api/save_knowledge', handleSaveKnowledge);
  tool('/api/stage_finding', handleStageFinding);
  tool('/api/read_staging', handleReadStaging);
  tool('/api/check_drift', handleCheckDrift);
  tool('/api/resolve_topic_key', handleResolveTopicKey);

  await new Promise<void>((resolve) => {
    serve({ fetch: app.fetch, port: opts.port, hostname: opts.host }, (info) => {
      process.stdout.write(
        pc.bold('Domain Memory HTTP API\n') +
          `  URL:   ${pc.cyan(`http://${opts.host}:${info.port}`)}\n` +
          `  Root:  ${pc.dim(opts.root)}\n` +
          `  Auth:  ${token ? pc.green('bearer token required') : pc.yellow('disabled (set DOMAIN_MEMORY_HTTP_TOKEN to enable)')}\n\n` +
          pc.dim('Routes: POST /api/{search_knowledge|save_knowledge|stage_finding|read_staging|check_drift|resolve_topic_key}\n') +
          pc.dim('Press Ctrl+C to stop.\n'),
      );
      resolve();
    });
  });
}
