import { html } from 'hono/html';
import type { HtmlContent } from './types.js';
import { layout } from './layout.js';
import type { EntrySummary } from '../data.js';

export interface FeaturesListInput {
  features: EntrySummary[];
  search: string;
}

export function renderFeaturesList(
  input: FeaturesListInput,
): HtmlContent {
  const body = html`
    <section>
      <h1>Features</h1>
      <form method="get" action="/features" class="search-form">
        <input
          type="search"
          name="q"
          value="${input.search}"
          placeholder="Search by name, summary or tag..."
          autofocus
        />
        ${input.search
          ? html`<a class="clear-link" href="/features">clear</a>`
          : ''}
      </form>
      ${input.features.length === 0
        ? html`<p class="muted">No features match.</p>`
        : html`
            <ul class="entry-list">
              ${input.features.map(
                (e) => html`
                  <li>
                    <a href="/features/${e.id}">
                      <strong>${e.name}</strong>
                    </a>
                    <p class="muted summary">${e.summary}</p>
                    <div class="meta-row">
                      <span class="status-badge ${e.status}">${e.status}</span>
                      <span
                        class="confidence ${e.effective_confidence < 50 ? 'low' : ''}"
                        >${e.effective_confidence}</span
                      >
                      ${e.tags.map(
                        (t) => html`<span class="tag">#${t}</span>`,
                      )}
                    </div>
                  </li>
                `,
              )}
            </ul>
          `}
    </section>
  `;
  return layout({ title: 'Features', active: 'features', children: body });
}
