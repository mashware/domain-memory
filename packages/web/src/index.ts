#!/usr/bin/env node
// Standalone entry for `domain-memory-web`. Reads DOMAIN_MEMORY_ROOT
// (or cwd), builds a ServerContext, and serves the Hono app on a
// configurable port.

import { serve } from '@hono/node-server';
import { createServerContext } from '@mashware/domain-memory-server';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const projectRoot = process.env['DOMAIN_MEMORY_ROOT'] ?? process.cwd();
  const port = Number(process.env['DOMAIN_MEMORY_WEB_PORT'] ?? 4373);

  const ctx = createServerContext(projectRoot);
  const app = createApp({ ctx });

  serve({ fetch: app.fetch, port }, (info) => {
    process.stdout.write(
      `Domain Memory web running at http://localhost:${info.port}\n` +
        `  Project root: ${projectRoot}\n`,
    );
  });
}

main().catch((err) => {
  process.stderr.write(
    `domain-memory-web failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
