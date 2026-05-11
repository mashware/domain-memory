import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerContext } from '@mashware/domain-memory-server';
import { createApp } from './app.js';
import { seedProject } from './test-helpers.js';

// These tests exercise the full Hono app via app.fetch(), so no HTTP
// server is started. Each test seeds a minimal project on disk and
// asserts on the response body or headers.

describe('web app routes', () => {
  let root: string;
  let ctx: ServerContext;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-web-app-'));
    ctx = seedProject(root, [
      {
        type: 'feature',
        id: 'feat_checkout',
        slug: 'checkout',
        name: 'Checkout',
        tags: ['payments'],
        what: 'Full purchase flow.',
        flow_mermaid: 'flowchart TD\n  A --> B',
      },
      {
        type: 'aspect',
        id: 'asp_checkout_taxes',
        slug: 'taxes',
        name: 'Taxes',
        feature_id: 'feat_checkout',
        what: 'Reverse charge details.',
      },
      {
        type: 'feature',
        id: 'feat_auth',
        slug: 'auth',
        name: 'Authentication',
        tags: ['security'],
      },
    ]);
    app = createApp({ ctx });
  });

  afterEach(() => {
    ctx?.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function get(path: string): Promise<Response> {
    return app.fetch(new Request(`http://localhost${path}`));
  }

  it('serves the CSS file with the right content type', async () => {
    const res = await get('/static/styles.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/css/);
    const body = await res.text();
    expect(body).toContain('.site-header');
  });

  it('renders the dashboard with stats', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Dashboard');
    expect(body).toContain('Knowledge at a glance');
    expect(body).toContain('2 features');
    expect(body).toContain('1 aspects');
  });

  it('lists features on /features', async () => {
    const res = await get('/features');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Checkout');
    expect(body).toContain('Authentication');
  });

  it('filters features when ?q= is provided', async () => {
    const res = await get('/features?q=check');
    const body = await res.text();
    expect(body).toContain('Checkout');
    expect(body).not.toContain('>Authentication<');
  });

  it('renders a feature detail page with Mermaid and nested aspects', async () => {
    const res = await get('/features/feat_checkout');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<h1>Checkout</h1>');
    expect(body).toContain('Full purchase flow');
    expect(body).toContain('flowchart TD');
    expect(body).toContain('mermaid');
    expect(body).toContain('Taxes');
  });

  it('returns 404 for a missing feature', async () => {
    const res = await get('/features/feat_missing');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('Not found');
  });

  it('renders an aspect detail page with breadcrumb to the parent', async () => {
    const res = await get('/aspects/asp_checkout_taxes');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<h1>Taxes</h1>');
    expect(body).toContain('Reverse charge details');
    expect(body).toContain('/features/feat_checkout');
  });

  it('renders /stale with an empty state when there are no low-confidence entries', async () => {
    const res = await get('/stale');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Low confidence');
    expect(body).toContain('store is healthy');
  });

  it('renders /graph with a Mermaid flowchart', async () => {
    const res = await get('/graph');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('flowchart LR');
    expect(body).toContain('Checkout');
  });

  it('exposes /api/stats as JSON', async () => {
    const res = await get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as { features: number; aspects: number };
    expect(body.features).toBe(2);
    expect(body.aspects).toBe(1);
  });

  it('exposes /api/graph as JSON with nodes and edges', async () => {
    const res = await get('/api/graph');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: Array<{ id: string }>;
      edges: unknown[];
    };
    expect(body.nodes.map((n) => n.id).sort()).toEqual(['feat_auth', 'feat_checkout']);
  });

  it('returns 404 for an unknown route', async () => {
    const res = await get('/nope');
    expect(res.status).toBe(404);
  });
});
