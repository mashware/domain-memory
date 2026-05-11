// The `html` tagged template literal in hono/html returns
// HtmlEscapedString | Promise<HtmlEscapedString> because interpolations
// may themselves be async. We never pass promises as interpolations,
// but TypeScript cannot prove that. Using this alias everywhere keeps
// the view signatures accurate and lets Hono's c.html() accept the
// result directly.

import type { HtmlEscapedString } from 'hono/utils/html';

export type HtmlContent = HtmlEscapedString | Promise<HtmlEscapedString>;
