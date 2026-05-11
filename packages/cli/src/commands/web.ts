// Starts the local web viewer. Imports the @mashware/domain-memory-web factory
// and the @hono/node-server adapter in-process so a single `domain-memory
// web` command boots everything without spawning a child.

import pc from 'picocolors';
import { serve } from '@hono/node-server';
import { createServerContext } from '@mashware/domain-memory-server';
import { createApp } from '@mashware/domain-memory-web';

export interface WebOptions {
  root: string;
  port: number;
  includePrivate?: boolean;
}

export async function runWeb(opts: WebOptions): Promise<void> {
  const ctx = createServerContext(opts.root);
  const app = createApp({ ctx, includePrivate: opts.includePrivate });

  await new Promise<void>((resolve) => {
    serve({ fetch: app.fetch, port: opts.port }, (info) => {
      const privacyLine = opts.includePrivate
        ? `  ${pc.yellow('!')} Private content visible (--include-private)\n`
        : '';
      process.stdout.write(
        pc.bold('Domain Memory web\n') +
          `  URL:  ${pc.cyan(`http://localhost:${info.port}`)}\n` +
          `  Root: ${pc.dim(opts.root)}\n` +
          privacyLine +
          '\n' +
          pc.dim('Press Ctrl+C to stop.\n'),
      );
      resolve();
    });
  });
}
