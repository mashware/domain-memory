// Renders the feature relations graph using a Mermaid flowchart. This
// gives us a graph view for free, no D3 required. Edges are labeled
// with the relation kind; archived features are dimmed in the node
// style. If there are no features, show a helpful empty state.

import { html } from 'hono/html';
import type { HtmlContent } from './types.js';
import { layout } from './layout.js';
import type { GraphData } from '../data.js';

export function renderGraph(data: GraphData): HtmlContent {
  if (data.nodes.length === 0) {
    const empty = html`
      <section>
        <h1>Relations graph</h1>
        <p class="muted">No features yet. Nothing to graph.</p>
      </section>
    `;
    return layout({ title: 'Graph', active: 'graph', children: empty });
  }

  const mermaidSource = buildMermaid(data);
  const body = html`
    <section>
      <h1>Relations graph</h1>
      <p class="muted">
        Features and their relations. Edges are labeled with the kind
        (<code>depends_on</code>, <code>triggers</code>,
        <code>related_to</code>). Click a node to open its detail page.
      </p>
      <div class="graph-container">
        <pre class="mermaid">${mermaidSource}</pre>
      </div>
    </section>
  `;

  return layout({
    title: 'Graph',
    active: 'graph',
    children: body,
    includeMermaid: true,
  });
}

function buildMermaid(data: GraphData): string {
  const lines: string[] = ['flowchart LR'];
  for (const node of data.nodes) {
    const label = escapeLabel(node.name);
    const nodeId = toNodeId(node.id);
    lines.push(`    ${nodeId}["${label}"]`);
    lines.push(`    click ${nodeId} href "/features/${node.id}"`);
    if (node.status === 'archived') {
      lines.push(`    class ${nodeId} archived`);
    }
  }
  for (const edge of data.edges) {
    const from = toNodeId(edge.from);
    const to = toNodeId(edge.to);
    const label = edge.kind.replace(/_/g, ' ');
    lines.push(`    ${from} -- "${label}" --> ${to}`);
  }
  lines.push('    classDef archived fill:#eee,stroke:#999,color:#777');
  return lines.join('\n');
}

function toNodeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '_');
}

function escapeLabel(s: string): string {
  return s.replace(/"/g, '\\"');
}
