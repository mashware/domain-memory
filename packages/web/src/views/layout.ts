// Base HTML layout shared by every page. Uses hono/html template
// literals so interpolation is automatically escaped (only raw() bypasses
// it). No client JS framework — just Mermaid for diagrams and a tiny
// script tag per page when needed.

import { html } from 'hono/html';
import type { HtmlContent } from './types.js';

export interface LayoutOptions {
  title: string;
  active: 'home' | 'features' | 'stale' | 'graph';
  children: HtmlContent | string;
  extraHead?: HtmlContent;
  includeMermaid?: boolean;
}

export function layout(opts: LayoutOptions): HtmlContent {
  const mermaidScript = opts.includeMermaid
    ? html`<script type="module">
        import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
        mermaid.initialize({ startOnLoad: true, theme: 'default' });
      </script>`
    : '';

  return html`<!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${opts.title} · Domain Memory</title>
        <link rel="stylesheet" href="/static/styles.css" />
        ${opts.extraHead ?? ''}
      </head>
      <body>
        <header class="site-header">
          <a class="brand" href="/">Domain Memory</a>
          <nav>
            <a class="${opts.active === 'home' ? 'active' : ''}" href="/">Dashboard</a>
            <a class="${opts.active === 'features' ? 'active' : ''}" href="/features">Features</a>
            <a class="${opts.active === 'stale' ? 'active' : ''}" href="/stale">Stale</a>
            <a class="${opts.active === 'graph' ? 'active' : ''}" href="/graph">Graph</a>
          </nav>
        </header>
        <main>${opts.children}</main>
        <footer>
          <small>domain-memory · local view · read-only</small>
        </footer>
        ${mermaidScript}
      </body>
    </html>`;
}
