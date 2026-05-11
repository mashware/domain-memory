import { html } from 'hono/html';
import type { HtmlContent } from './types.js';
import { layout } from './layout.js';
import type { EntrySummary } from '../data.js';

export function renderStale(entries: EntrySummary[]): HtmlContent {
  const body = html`
    <section>
      <h1>Low confidence</h1>
      <p class="muted">
        Entries whose effective confidence has dropped below 50. Review
        them and either update the content, run
        <code>domain-memory verify &lt;id&gt;</code> to reset the decay
        clock, or archive them if no longer relevant.
      </p>
      ${entries.length === 0
        ? html`<p class="muted">Nothing here — the store is healthy.</p>`
        : html`
            <ul class="entry-list">
              ${entries.map(
                (e) => html`
                  <li>
                    <a
                      href="${e.type === 'feature'
                        ? `/features/${e.id}`
                        : `/aspects/${e.id}`}"
                    >
                      <span class="type-badge ${e.type}">${e.type}</span>
                      <strong>${e.name}</strong>
                      ${e.feature_name && e.feature_name !== e.name
                        ? html`<span class="muted"> in ${e.feature_name}</span>`
                        : ''}
                    </a>
                    <p class="muted summary">${e.summary}</p>
                    <div class="meta-row">
                      <span class="confidence low"
                        >${e.effective_confidence}</span
                      >
                      <span class="muted"
                        >last verified ${formatDate(e.last_verified)}</span
                      >
                      <code class="muted">${e.id}</code>
                    </div>
                  </li>
                `,
              )}
            </ul>
          `}
    </section>
  `;
  return layout({ title: 'Low confidence', active: 'stale', children: body });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
