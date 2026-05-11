// Read-only data access over a ServerContext. All queries used by the
// web views live here so the view templates stay declarative. The web
// UI never writes to the store — it is a viewer, not an editor.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  effectiveConfidence,
  parseEntry,
  stripPrivate,
  type ServerContext,
} from '@domain-memory/server';

export interface WebDataOptions {
  // When true, `<private>...</private>` blocks are kept verbatim in the
  // rendered body. Off by default — the viewer is read-only but can be
  // accessed by anyone on the loopback interface, so private content
  // stays redacted unless the operator opts in explicitly.
  includePrivate?: boolean;
}

export interface EntrySummary {
  id: string;
  type: 'feature' | 'aspect';
  slug: string;
  name: string;
  feature_id: string | null;
  feature_name: string | null;
  status: 'active' | 'archived' | 'superseded';
  confidence: number;
  effective_confidence: number;
  last_verified: string;
  updated_at: string;
  file_path: string;
  summary: string;
  tags: string[];
}

export interface FeatureDetail {
  feature: EntrySummary;
  aspects: EntrySummary[];
  raw_body: {
    what: string;
    flow_mermaid: string | null;
    where: string;
  };
  relations: {
    depends_on: Array<{ id: string; name: string }>;
    triggers: Array<{ id: string; name: string }>;
    related_to: Array<{ id: string; name: string }>;
    incoming: Array<{ id: string; name: string; kind: string }>;
  };
}

export interface DashboardStats {
  features: number;
  aspects: number;
  active: number;
  archived: number;
  superseded: number;
  low_confidence: number;
  total: number;
}

export interface GraphData {
  nodes: Array<{ id: string; name: string; status: string }>;
  edges: Array<{ from: string; to: string; kind: string }>;
}

export class WebData {
  private readonly includePrivate: boolean;

  constructor(
    private readonly ctx: ServerContext,
    options: WebDataOptions = {},
  ) {
    this.includePrivate = options.includePrivate ?? false;
  }

  private redactBody(body: {
    what: string;
    flow_mermaid: string | null;
    where: string;
  }): { what: string; flow_mermaid: string | null; where: string } {
    if (this.includePrivate) return body;
    return {
      what: stripPrivate(body.what),
      flow_mermaid: body.flow_mermaid ? stripPrivate(body.flow_mermaid) : null,
      where: stripPrivate(body.where),
    };
  }

  stats(): DashboardStats {
    const row = this.ctx.db
      .prepare(
        `SELECT
          SUM(CASE WHEN type = 'feature' THEN 1 ELSE 0 END) AS features,
          SUM(CASE WHEN type = 'aspect' THEN 1 ELSE 0 END) AS aspects,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived,
          SUM(CASE WHEN status = 'superseded' THEN 1 ELSE 0 END) AS superseded,
          COUNT(*) AS total
         FROM entries`,
      )
      .get() as {
      features: number | null;
      aspects: number | null;
      active: number | null;
      archived: number | null;
      superseded: number | null;
      total: number | null;
    };

    const all = this.loadAllSummaries();
    const low = all.filter((e) => e.effective_confidence < 50).length;

    return {
      features: row.features ?? 0,
      aspects: row.aspects ?? 0,
      active: row.active ?? 0,
      archived: row.archived ?? 0,
      superseded: row.superseded ?? 0,
      total: row.total ?? 0,
      low_confidence: low,
    };
  }

  listFeatures(search: string | undefined): EntrySummary[] {
    const rows = this.loadAllSummaries().filter((e) => e.type === 'feature');
    if (!search) return rows.sort((a, b) => a.name.localeCompare(b.name));
    const q = search.toLowerCase();
    return rows
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  listStale(): EntrySummary[] {
    return this.loadAllSummaries()
      .filter((e) => e.status === 'active' && e.effective_confidence < 50)
      .sort((a, b) => a.effective_confidence - b.effective_confidence);
  }

  loadFeatureDetail(id: string): FeatureDetail | null {
    const summary = this.loadSummary(id);
    if (!summary || summary.type !== 'feature') return null;

    const absolutePath = resolve(this.ctx.paths.root, summary.file_path);
    const raw = readFileSync(absolutePath, 'utf-8');
    const parsed = parseEntry(raw, absolutePath);

    const aspects = this.loadAllSummaries()
      .filter((e) => e.type === 'aspect' && e.feature_id === id)
      .sort((a, b) => a.name.localeCompare(b.name));

    const outgoing = this.ctx.db
      .prepare(
        `SELECT r.to_id AS id, e.name AS name, r.kind AS kind
         FROM entry_relations r
         LEFT JOIN entries e ON e.id = r.to_id
         WHERE r.from_id = ?`,
      )
      .all(id) as Array<{ id: string; name: string | null; kind: string }>;

    const incoming = this.ctx.db
      .prepare(
        `SELECT r.from_id AS id, e.name AS name, r.kind AS kind
         FROM entry_relations r
         LEFT JOIN entries e ON e.id = r.from_id
         WHERE r.to_id = ?`,
      )
      .all(id) as Array<{ id: string; name: string | null; kind: string }>;

    const relations: FeatureDetail['relations'] = {
      depends_on: [],
      triggers: [],
      related_to: [],
      incoming: incoming.map((i) => ({
        id: i.id,
        name: i.name ?? i.id,
        kind: i.kind,
      })),
    };
    for (const o of outgoing) {
      const target = { id: o.id, name: o.name ?? o.id };
      if (o.kind === 'depends_on') relations.depends_on.push(target);
      if (o.kind === 'triggers') relations.triggers.push(target);
      if (o.kind === 'related_to') relations.related_to.push(target);
    }

    return {
      feature: summary,
      aspects,
      raw_body: this.redactBody(parsed.body),
      relations,
    };
  }

  loadAspectDetail(id: string): {
    aspect: EntrySummary;
    feature: EntrySummary | null;
    raw_body: { what: string; flow_mermaid: string | null; where: string };
  } | null {
    const summary = this.loadSummary(id);
    if (!summary || summary.type !== 'aspect') return null;
    const parent = summary.feature_id ? this.loadSummary(summary.feature_id) : null;

    const absolutePath = resolve(this.ctx.paths.root, summary.file_path);
    const raw = readFileSync(absolutePath, 'utf-8');
    const parsed = parseEntry(raw, absolutePath);

    return {
      aspect: summary,
      feature: parent,
      raw_body: this.redactBody(parsed.body),
    };
  }

  graphData(): GraphData {
    const nodes = this.ctx.db
      .prepare("SELECT id, name, status FROM entries WHERE type = 'feature'")
      .all() as Array<{ id: string; name: string; status: string }>;

    const edges = this.ctx.db
      .prepare(
        `SELECT r.from_id AS "from", r.to_id AS "to", r.kind
         FROM entry_relations r
         INNER JOIN entries fe ON fe.id = r.from_id AND fe.type = 'feature'
         INNER JOIN entries te ON te.id = r.to_id   AND te.type = 'feature'`,
      )
      .all() as Array<{ from: string; to: string; kind: string }>;

    return { nodes, edges };
  }

  private loadSummary(id: string): EntrySummary | null {
    const row = this.ctx.db
      .prepare(
        `SELECT e.id, e.type, e.slug, e.name, e.feature_id, e.status,
                e.confidence, e.last_verified, e.updated_at,
                e.file_path, e.summary,
                f.name AS feature_name
         FROM entries e
         LEFT JOIN entries f ON f.id = e.feature_id
         WHERE e.id = ?`,
      )
      .get(id) as
      | {
          id: string;
          type: 'feature' | 'aspect';
          slug: string;
          name: string;
          feature_id: string | null;
          status: 'active' | 'archived' | 'superseded';
          confidence: number;
          last_verified: string;
          updated_at: string;
          file_path: string;
          summary: string;
          feature_name: string | null;
        }
      | undefined;
    if (!row) return null;

    const tags = (
      this.ctx.db
        .prepare('SELECT tag FROM entry_tags WHERE entry_id = ?')
        .all(row.id) as Array<{ tag: string }>
    ).map((t) => t.tag);

    return {
      ...row,
      tags,
      effective_confidence: effectiveConfidence(row.confidence, row.last_verified),
    };
  }

  private loadAllSummaries(): EntrySummary[] {
    const rows = this.ctx.db
      .prepare(
        `SELECT e.id, e.type, e.slug, e.name, e.feature_id, e.status,
                e.confidence, e.last_verified, e.updated_at,
                e.file_path, e.summary,
                f.name AS feature_name
         FROM entries e
         LEFT JOIN entries f ON f.id = e.feature_id`,
      )
      .all() as Array<{
      id: string;
      type: 'feature' | 'aspect';
      slug: string;
      name: string;
      feature_id: string | null;
      status: 'active' | 'archived' | 'superseded';
      confidence: number;
      last_verified: string;
      updated_at: string;
      file_path: string;
      summary: string;
      feature_name: string | null;
    }>;

    const tagsByEntry = new Map<string, string[]>();
    const tagRows = this.ctx.db
      .prepare('SELECT entry_id, tag FROM entry_tags')
      .all() as Array<{ entry_id: string; tag: string }>;
    for (const t of tagRows) {
      const list = tagsByEntry.get(t.entry_id) ?? [];
      list.push(t.tag);
      tagsByEntry.set(t.entry_id, list);
    }

    return rows.map((row) => ({
      ...row,
      tags: tagsByEntry.get(row.id) ?? [],
      effective_confidence: effectiveConfidence(row.confidence, row.last_verified),
    }));
  }
}
