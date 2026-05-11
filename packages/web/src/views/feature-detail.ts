import { html, raw } from 'hono/html';
import type { HtmlContent } from './types.js';
import { layout } from './layout.js';
import type { FeatureDetail } from '../data.js';

export function renderFeatureDetail(input: FeatureDetail): HtmlContent {
  const { feature, aspects, raw_body, relations } = input;

  const body = html`
    <section class="entry-header">
      <p class="breadcrumb"><a href="/features">Features</a> / ${feature.name}</p>
      <h1>${feature.name}</h1>
      <div class="meta-row">
        <span class="status-badge ${feature.status}">${feature.status}</span>
        <span
          class="confidence ${feature.effective_confidence < 50 ? 'low' : ''}"
          >confidence ${feature.effective_confidence}</span
        >
        <span class="muted">updated ${formatDate(feature.updated_at)}</span>
        <span class="muted">${feature.file_path}</span>
      </div>
      ${feature.tags.length > 0
        ? html`<div class="meta-row">
            ${feature.tags.map((t) => html`<span class="tag">#${t}</span>`)}
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

    ${aspects.length > 0
      ? html`
          <section>
            <h2>Aspects</h2>
            <ul class="entry-list">
              ${aspects.map(
                (a) => html`
                  <li>
                    <a href="/aspects/${a.id}">
                      <strong>${a.name}</strong>
                    </a>
                    <p class="muted summary">${a.summary}</p>
                    <div class="meta-row">
                      <span class="confidence ${a.effective_confidence < 50 ? 'low' : ''}"
                        >${a.effective_confidence}</span
                      >
                      ${a.tags.map((t) => html`<span class="tag">#${t}</span>`)}
                    </div>
                  </li>
                `,
              )}
            </ul>
          </section>
        `
      : ''}

    ${hasAnyRelation(relations)
      ? html`
          <section>
            <h2>Relations</h2>
            ${relationBlock('Depends on', relations.depends_on)}
            ${relationBlock('Triggers', relations.triggers)}
            ${relationBlock('Related to', relations.related_to)}
            ${relations.incoming.length > 0
              ? html`
                  <h3>Incoming</h3>
                  <ul>
                    ${relations.incoming.map(
                      (i) => html`
                        <li>
                          <span class="muted">${i.kind}</span>
                          <a href="/features/${i.id}">${i.name}</a>
                        </li>
                      `,
                    )}
                  </ul>
                `
              : ''}
          </section>
        `
      : ''}
  `;

  return layout({
    title: feature.name,
    active: 'features',
    children: body,
    includeMermaid: Boolean(raw_body.flow_mermaid),
  });
}

function hasAnyRelation(r: FeatureDetail['relations']): boolean {
  return (
    r.depends_on.length > 0 ||
    r.triggers.length > 0 ||
    r.related_to.length > 0 ||
    r.incoming.length > 0
  );
}

function relationBlock(
  label: string,
  targets: Array<{ id: string; name: string }>,
): HtmlContent {
  if (targets.length === 0) return html``;
  return html`
    <h3>${label}</h3>
    <ul>
      ${targets.map(
        (t) => html`
          <li><a href="/features/${t.id}">${t.name}</a></li>
        `,
      )}
    </ul>
  `;
}

function prose(text: string): HtmlContent {
  // Split on blank lines into paragraphs; inside paragraphs preserve
  // newlines as <br>. Escape via html`` interpolation, then emit via raw.
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return raw(
    paragraphs
      .map((p) => {
        const escaped = escapeHtml(p).replace(/\n/g, '<br>');
        return `<p>${escaped}</p>`;
      })
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
