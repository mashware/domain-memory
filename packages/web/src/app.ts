// Hono app factory. Every request opens a fresh WebData view over the
// shared ServerContext. The app is intentionally read-only: no POST,
// no PUT, no DELETE. Writes go through the CLI or the MCP tools.

import { Hono } from 'hono';
import type { ServerContext } from '@mashware/domain-memory-server';
import { WebData, type WebDataOptions } from './data.js';
import { STYLES_CSS } from './assets/styles.js';
import { renderHome } from './views/home.js';
import { renderFeaturesList } from './views/features.js';
import { renderFeatureDetail } from './views/feature-detail.js';
import { renderAspectDetail } from './views/aspect-detail.js';
import { renderStale } from './views/stale.js';
import { renderGraph } from './views/graph.js';
import { layout } from './views/layout.js';
import { html } from 'hono/html';

export interface AppDeps {
  ctx: ServerContext;
  includePrivate?: WebDataOptions['includePrivate'];
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const data = new WebData(deps.ctx, { includePrivate: deps.includePrivate });

  app.get('/static/styles.css', (c) => {
    c.header('Content-Type', 'text/css; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=60');
    return c.body(STYLES_CSS);
  });

  app.get('/', (c) => {
    const stats = data.stats();
    const recentlyUpdated = data
      .listFeatures(undefined)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 10);
    return c.html(
      renderHome({ stats, recentlyUpdated, staleCount: stats.low_confidence }),
    );
  });

  app.get('/features', (c) => {
    const search = c.req.query('q') ?? '';
    const features = data.listFeatures(search || undefined);
    return c.html(renderFeaturesList({ features, search }));
  });

  app.get('/features/:id', (c) => {
    const id = c.req.param('id');
    const detail = data.loadFeatureDetail(id);
    if (!detail) return c.html(notFound(`Feature ${id}`), 404);
    return c.html(renderFeatureDetail(detail));
  });

  app.get('/aspects/:id', (c) => {
    const id = c.req.param('id');
    const detail = data.loadAspectDetail(id);
    if (!detail) return c.html(notFound(`Aspect ${id}`), 404);
    return c.html(renderAspectDetail(detail));
  });

  app.get('/stale', (c) => {
    const entries = data.listStale();
    return c.html(renderStale(entries));
  });

  app.get('/graph', (c) => {
    const graph = data.graphData();
    return c.html(renderGraph(graph));
  });

  app.get('/api/stats', (c) => c.json(data.stats()));
  app.get('/api/graph', (c) => c.json(data.graphData()));

  app.notFound((c) => c.html(notFound('Page'), 404));

  return app;
}

function notFound(what: string): string {
  const body = html`
    <section>
      <h1>Not found</h1>
      <p class="muted">${what} does not exist in this knowledge store.</p>
      <p><a href="/">Back to dashboard</a></p>
    </section>
  `;
  return layout({ title: 'Not found', active: 'home', children: body }).toString();
}
