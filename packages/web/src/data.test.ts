import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerContext } from '@mashware/domain-memory-server';
import { WebData } from './data.js';
import { seedProject } from './test-helpers.js';

describe('WebData', () => {
  let root: string;
  let ctx: ServerContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-web-data-'));
  });

  afterEach(() => {
    ctx?.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('reports dashboard stats for features, aspects and totals', () => {
    ctx = seedProject(root, [
      {
        type: 'feature',
        id: 'feat_checkout',
        slug: 'checkout',
        name: 'Checkout',
        file_paths: ['src/checkout.ts'],
      },
      {
        type: 'aspect',
        id: 'asp_checkout_taxes',
        slug: 'taxes',
        name: 'Taxes',
        feature_id: 'feat_checkout',
      },
      {
        type: 'feature',
        id: 'feat_auth',
        slug: 'auth',
        name: 'Auth',
        status: 'archived',
      },
    ]);
    const data = new WebData(ctx);
    const stats = data.stats();

    expect(stats.total).toBe(3);
    expect(stats.features).toBe(2);
    expect(stats.aspects).toBe(1);
    expect(stats.active).toBe(2);
    expect(stats.archived).toBe(1);
  });

  it('lists features filtered by name, summary and tags', () => {
    ctx = seedProject(root, [
      {
        type: 'feature',
        id: 'feat_checkout',
        slug: 'checkout',
        name: 'Checkout',
        tags: ['payments', 'billing'],
        what: 'Purchase and invoicing flow.',
      },
      {
        type: 'feature',
        id: 'feat_auth',
        slug: 'auth',
        name: 'Authentication',
        tags: ['security'],
        what: 'Login and session handling.',
      },
    ]);
    const data = new WebData(ctx);

    expect(data.listFeatures(undefined).map((e) => e.name)).toEqual([
      'Authentication',
      'Checkout',
    ]);

    expect(data.listFeatures('checkout').map((e) => e.name)).toEqual(['Checkout']);
    expect(data.listFeatures('payments').map((e) => e.name)).toEqual(['Checkout']);
    expect(data.listFeatures('login').map((e) => e.name)).toEqual([
      'Authentication',
    ]);
  });

  it('lists stale entries only when effective confidence is below 50', () => {
    const DAY = 24 * 60 * 60 * 1000;
    // 300 days ago → decay of 50 points, effective = 30.
    const longAgo = new Date(Date.now() - 300 * DAY).toISOString();
    const recent = new Date().toISOString();

    ctx = seedProject(root, [
      {
        type: 'feature',
        id: 'feat_old',
        slug: 'old',
        name: 'Old',
        confidence: 80,
        last_verified: longAgo,
      },
      {
        type: 'feature',
        id: 'feat_fresh',
        slug: 'fresh',
        name: 'Fresh',
        confidence: 80,
        last_verified: recent,
      },
    ]);
    const stale = new WebData(ctx).listStale();

    expect(stale.map((e) => e.name)).toEqual(['Old']);
    expect(stale[0]!.effective_confidence).toBeLessThan(50);
  });

  it('loads a feature with its aspects, prose and Mermaid flow', () => {
    ctx = seedProject(root, [
      {
        type: 'feature',
        id: 'feat_checkout',
        slug: 'checkout',
        name: 'Checkout',
        what: 'Full purchase flow description.',
        flow_mermaid: 'flowchart TD\n  A --> B',
      },
      {
        type: 'aspect',
        id: 'asp_checkout_taxes',
        slug: 'taxes',
        name: 'Taxes',
        feature_id: 'feat_checkout',
      },
    ]);
    const data = new WebData(ctx);
    const detail = data.loadFeatureDetail('feat_checkout');

    expect(detail).not.toBeNull();
    expect(detail!.feature.name).toBe('Checkout');
    expect(detail!.raw_body.what).toContain('Full purchase flow');
    expect(detail!.raw_body.flow_mermaid).toContain('flowchart TD');
    expect(detail!.aspects.map((a) => a.name)).toEqual(['Taxes']);
  });

  it('returns null for a missing feature id', () => {
    ctx = seedProject(root, [
      { type: 'feature', id: 'feat_checkout', slug: 'checkout', name: 'Checkout' },
    ]);
    const data = new WebData(ctx);

    expect(data.loadFeatureDetail('feat_nope')).toBeNull();
  });

  it('redacts <private> blocks in the rendered body by default', () => {
    ctx = seedProject(root, [
      {
        type: 'feature',
        id: 'feat_checkout',
        slug: 'checkout',
        name: 'Checkout',
        what: 'Public description.\n\n<private>\nInternal note about ACME.\n</private>',
      },
    ]);
    const data = new WebData(ctx);
    const detail = data.loadFeatureDetail('feat_checkout');

    expect(detail).not.toBeNull();
    expect(detail!.raw_body.what).toContain('Public description');
    expect(detail!.raw_body.what).not.toContain('Internal note about ACME');
    expect(detail!.raw_body.what).toContain('[redacted]');
  });

  it('keeps <private> blocks verbatim when includePrivate is true', () => {
    ctx = seedProject(root, [
      {
        type: 'feature',
        id: 'feat_checkout',
        slug: 'checkout',
        name: 'Checkout',
        what: 'Public.\n\n<private>\nInternal note about ACME.\n</private>',
      },
    ]);
    const data = new WebData(ctx, { includePrivate: true });
    const detail = data.loadFeatureDetail('feat_checkout');

    expect(detail).not.toBeNull();
    expect(detail!.raw_body.what).toContain('Internal note about ACME');
    expect(detail!.raw_body.what).not.toContain('[redacted]');
  });

  it('returns null when asking for an aspect id via loadFeatureDetail', () => {
    ctx = seedProject(root, [
      { type: 'feature', id: 'feat_checkout', slug: 'checkout', name: 'Checkout' },
      {
        type: 'aspect',
        id: 'asp_checkout_taxes',
        slug: 'taxes',
        name: 'Taxes',
        feature_id: 'feat_checkout',
      },
    ]);
    const data = new WebData(ctx);

    expect(data.loadFeatureDetail('asp_checkout_taxes')).toBeNull();
  });

  it('loads an aspect with its parent feature', () => {
    ctx = seedProject(root, [
      { type: 'feature', id: 'feat_checkout', slug: 'checkout', name: 'Checkout' },
      {
        type: 'aspect',
        id: 'asp_checkout_taxes',
        slug: 'taxes',
        name: 'Taxes',
        feature_id: 'feat_checkout',
        what: 'Reverse charge logic.',
      },
    ]);
    const data = new WebData(ctx);
    const detail = data.loadAspectDetail('asp_checkout_taxes');

    expect(detail).not.toBeNull();
    expect(detail!.aspect.name).toBe('Taxes');
    expect(detail!.feature?.name).toBe('Checkout');
    expect(detail!.raw_body.what).toContain('Reverse charge');
  });

  it('returns graph data with feature-to-feature relations only', () => {
    ctx = seedProject(root, [
      {
        type: 'feature',
        id: 'feat_checkout',
        slug: 'checkout',
        name: 'Checkout',
        relations: { triggers: ['feat_subs'] },
      },
      {
        type: 'feature',
        id: 'feat_subs',
        slug: 'subs',
        name: 'Subscriptions',
      },
      {
        type: 'aspect',
        id: 'asp_checkout_taxes',
        slug: 'taxes',
        name: 'Taxes',
        feature_id: 'feat_checkout',
      },
    ]);
    const data = new WebData(ctx);
    const graph = data.graphData();

    expect(graph.nodes.map((n) => n.id).sort()).toEqual([
      'feat_checkout',
      'feat_subs',
    ]);
    expect(graph.edges).toEqual([
      { from: 'feat_checkout', to: 'feat_subs', kind: 'triggers' },
    ]);
  });
});
