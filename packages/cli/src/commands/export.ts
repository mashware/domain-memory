// Pre-renders every page of the web viewer into a static directory.
// Useful for sharing the knowledge store with non-developers, committing
// snapshots, or generating a browsable archive for onboarding.
//
// Strategy: reuse @domain-memory/web's createApp() and call app.fetch()
// for each route we care about, writing the response body to a URL-
// matching directory layout. Absolute links in the rendered HTML keep
// working as long as the directory is served from the root of a static
// HTTP server (python -m http.server, caddy file_server, etc.).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pc from 'picocolors';
import { createServerContext } from '@domain-memory/server';
import { createApp, WebData } from '@domain-memory/web';

export interface ExportOptions {
  root: string;
  out: string;
}

export async function runExport(opts: ExportOptions): Promise<number> {
  const ctx = createServerContext(opts.root);
  const data = new WebData(ctx);
  const app = createApp({ ctx });

  mkdirSync(opts.out, { recursive: true });

  const staticRoutes: Array<{ url: string; outPath: string }> = [
    { url: '/', outPath: 'index.html' },
    { url: '/features', outPath: 'features/index.html' },
    { url: '/stale', outPath: 'stale/index.html' },
    { url: '/graph', outPath: 'graph/index.html' },
  ];

  const cssRoute = { url: '/static/styles.css', outPath: 'static/styles.css' };

  // Per-entry routes: one page per feature and per aspect.
  const entryRoutes: Array<{ url: string; outPath: string }> = [];
  for (const feature of data.listFeatures(undefined)) {
    entryRoutes.push({
      url: `/features/${feature.id}`,
      outPath: `features/${feature.id}/index.html`,
    });
  }
  const aspects = ctx.db
    .prepare("SELECT id FROM entries WHERE type = 'aspect' AND status = 'active'")
    .all() as Array<{ id: string }>;
  for (const aspect of aspects) {
    entryRoutes.push({
      url: `/aspects/${aspect.id}`,
      outPath: `aspects/${aspect.id}/index.html`,
    });
  }

  const all = [...staticRoutes, ...entryRoutes, cssRoute];
  let ok = 0;
  let failed = 0;

  for (const route of all) {
    const res = await app.fetch(new Request(`http://localhost${route.url}`));
    if (res.status !== 200) {
      failed += 1;
      process.stderr.write(
        pc.red(`  ✗ ${route.url} → ${res.status}\n`),
      );
      continue;
    }
    const body = await res.text();
    const targetPath = join(opts.out, route.outPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, body, 'utf-8');
    ok += 1;
  }

  ctx.db.close();

  process.stdout.write(
    pc.green(`Exported ${ok} pages to ${opts.out}`) +
      (failed > 0 ? pc.red(` (${failed} failed)`) : '') +
      '\n',
  );
  process.stdout.write(
    pc.dim(
      '\nServe locally with any static HTTP server, e.g.:\n' +
        `  python3 -m http.server --directory ${opts.out} 8080\n`,
    ),
  );
  return failed === 0 ? 0 : 1;
}
