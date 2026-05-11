// Library entry point. The stdio bin in src/index.ts reuses these so
// importing @domain-memory/web programmatically (from CLI or tests)
// never triggers the HTTP server side effect.

export { createApp, type AppDeps } from './app.js';
export { WebData } from './data.js';
export type {
  EntrySummary,
  FeatureDetail,
  DashboardStats,
  GraphData,
} from './data.js';
