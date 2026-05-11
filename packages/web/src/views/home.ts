import { html } from 'hono/html';
import type { HtmlContent } from './types.js';
import { layout } from './layout.js';
import type { DashboardStats, EntrySummary } from '../data.js';

export interface HomeViewInput {
  stats: DashboardStats;
  recentlyUpdated: EntrySummary[];
  staleCount: number;
}

export function renderHome(input: HomeViewInput): HtmlContent {
  const body = html`
    <section class="hero">
      <h1>Knowledge at a glance</h1>
      <p class="muted">
        ${input.stats.total} entries — ${input.stats.features} features,
        ${input.stats.aspects} aspects.
      </p>
    </section>

    <section class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${input.stats.active}</div>
        <div class="stat-label">Active</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${input.stats.archived}</div>
        <div class="stat-label">Archived</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${input.stats.superseded}</div>
        <div class="stat-label">Superseded</div>
      </div>
      <div class="stat-card ${input.staleCount > 0 ? 'warn' : ''}">
        <div class="stat-value">${input.staleCount}</div>
        <div class="stat-label">
          <a href="/stale">Low confidence</a>
        </div>
      </div>
    </section>

    <section>
      <h2>Recently updated</h2>
      ${input.recentlyUpdated.length === 0
        ? html`<p class="muted">No entries yet. Run <code>domain-memory reindex</code> to populate the index.</p>`
        : html`
            <ul class="entry-list">
              ${input.recentlyUpdated.map(
                (e) => html`
                  <li>
                    <a href="${detailLink(e)}">
                      <span class="type-badge ${e.type}">${e.type}</span>
                      <strong>${e.name}</strong>
                      ${e.feature_name && e.feature_name !== e.name
                        ? html`<span class="muted"> in ${e.feature_name}</span>`
                        : ''}
                    </a>
                    <span class="muted">
                      ${formatDate(e.updated_at)}
                      · confidence ${e.effective_confidence}
                    </span>
                  </li>
                `,
              )}
            </ul>
          `}
    </section>
  `;

  return layout({ title: 'Dashboard', active: 'home', children: body });
}

function detailLink(e: EntrySummary): string {
  return e.type === 'feature' ? `/features/${e.id}` : `/aspects/${e.id}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
