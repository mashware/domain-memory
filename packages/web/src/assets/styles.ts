// CSS embedded as a string so the web package has zero runtime
// filesystem lookups at request time. Served verbatim from /static/styles.css.

export const STYLES_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: #1a1a1a;
  background: #fafafa;
  line-height: 1.55;
  font-size: 15px;
}
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre { font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; font-size: 0.9em; }

.site-header {
  background: #fff;
  border-bottom: 1px solid #e5e5e5;
  padding: 0.75rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 2rem;
}
.site-header .brand {
  font-weight: 700;
  font-size: 1.05rem;
  color: #1a1a1a;
}
.site-header nav { display: flex; gap: 1.25rem; }
.site-header nav a {
  color: #555;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}
.site-header nav a.active {
  color: #1a1a1a;
  background: #eef2f6;
}

main {
  max-width: 920px;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
}

footer {
  max-width: 920px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  color: #888;
}

.muted { color: #666; }
h1 { font-size: 1.75rem; margin-top: 0; }
h2 { font-size: 1.25rem; margin-top: 2rem; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.35rem; }
h3 { font-size: 1.05rem; margin-top: 1.5rem; }

.hero { margin-bottom: 2rem; }
.hero p { margin: 0; }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 1rem;
  margin-bottom: 2.5rem;
}
.stat-card {
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  padding: 1rem 1.25rem;
}
.stat-card.warn { border-color: #e6a23c; background: #fff8eb; }
.stat-value { font-size: 2rem; font-weight: 700; line-height: 1; }
.stat-label { color: #666; font-size: 0.9rem; margin-top: 0.35rem; }

.entry-list { list-style: none; padding: 0; margin: 0; }
.entry-list > li {
  padding: 1rem 0;
  border-bottom: 1px solid #e5e5e5;
}
.entry-list > li:last-child { border-bottom: 0; }
.entry-list .summary {
  margin: 0.25rem 0 0.5rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  font-size: 0.85rem;
}

.type-badge {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 3px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #fff;
  margin-right: 0.4rem;
}
.type-badge.feature { background: #0969da; }
.type-badge.aspect { background: #6b7280; }

.status-badge {
  display: inline-block;
  padding: 0.1rem 0.55rem;
  border-radius: 99px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.status-badge.active { background: #dcfce7; color: #166534; }
.status-badge.archived { background: #f3f4f6; color: #555; }
.status-badge.superseded { background: #fef3c7; color: #854d0e; }

.confidence {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 4px;
  background: #eef2f6;
  color: #333;
  font-size: 0.8rem;
}
.confidence.low { background: #fee2e2; color: #991b1b; }

.tag {
  color: #0969da;
  font-size: 0.8rem;
  background: #eaf3ff;
  padding: 0.1rem 0.5rem;
  border-radius: 3px;
}

.search-form {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.search-form input[type='search'] {
  flex: 1;
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
}
.clear-link { font-size: 0.85rem; color: #666; }

.entry-header { margin-bottom: 1.5rem; }
.breadcrumb { margin: 0 0 0.5rem; color: #666; font-size: 0.9rem; }

.prose p { margin: 0 0 1rem; }
.prose code { background: #eef2f6; padding: 0.1rem 0.35rem; border-radius: 3px; }

.graph-container { overflow-x: auto; }
pre.mermaid { background: transparent; padding: 0; margin: 0; }
`;
