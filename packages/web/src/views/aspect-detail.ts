import { html, raw } from 'hono/html';
import type { HtmlContent } from './types.js';
import { layout } from './layout.js';
import type { EntrySummary } from '../data.js';

export interface AspectDetailInput {
  aspect: EntrySummary;
  feature: EntrySummary | null;
  raw_body: { what: string; flow_mermaid: string | null; where: string };
}

export function renderAspectDetail(
  input: AspectDetailInput,
): HtmlContent {
  const { aspect, feature, raw_body } = input;

  const body = html`
    <section class="entry-header">
      <p class="breadcrumb">
        <a href="/features">Features</a> /
        ${feature
          ? html`<a href="/features/${feature.id}">${feature.name}</a>`
          : html`<span class="muted">unknown parent</span>`}
        / ${aspect.name}
      </p>
      <h1>${aspect.name}</h1>
      <div class="meta-row">
        <span class="status-badge ${aspect.status}">${aspect.status}</span>
        <span
          class="confidence ${aspect.effective_confidence < 50 ? 'low' : ''}"
          >confidence ${aspect.effective_confidence}</span
        >
        <span class="muted">updated ${formatDate(aspect.updated_at)}</span>
        <span class="muted">${aspect.file_path}</span>
      </div>
      ${aspect.tags.length > 0
        ? html`<div class="meta-row">
            ${aspect.tags.map((t) => html`<span class="tag">#${t}</span>`)}
          </div>`
        : ''}
    </section>

    <section>
      <h2>What it does</h2>
      <div class="prose">${prose(raw_body.what)}</div>
    </section>

    ${raw_body.flow_mermaid
      ? html`
          <section>
            <h2>How it flows</h2>
            <div class="mermaid">${raw_body.flow_mermaid}</div>
          </section>
        `
      : ''}

    <section>
      <h2>Where it lives</h2>
      <div class="prose">${prose(raw_body.where)}</div>
    </section>
  `;

  return layout({
    title: aspect.name,
    active: 'features',
    children: body,
    includeMermaid: Boolean(raw_body.flow_mermaid),
  });
}

function prose(text: string): HtmlContent {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return raw(
    paragraphs
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
      .join('\n'),
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
