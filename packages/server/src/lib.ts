// Programmatic entry point for @mashware/domain-memory-server. Re-exports the
// pieces other packages (CLI, tests, future web) need. The stdio bin
// entry lives in src/index.ts and must not be imported as a library —
// importing it would run the MCP server as a side effect.

export * from './storage/index.js';
export * from './indexing/index.js';
export * from './search/index.js';
export * from './flows/save-knowledge-flow.js';
export { createServerContext } from './mcp/context.js';
export type { ServerContext } from './mcp/context.js';
export { createMcpServer } from './mcp/server.js';
export { handleSearchKnowledge } from './mcp/tools/search-knowledge.js';
export { handleSaveKnowledge } from './mcp/tools/save-knowledge.js';
export { handleStageFinding } from './mcp/tools/stage-finding.js';
export { handleReadStaging } from './mcp/tools/read-staging.js';
export { handleCheckDrift } from './mcp/tools/check-drift.js';
export { handleResolveTopicKey } from './mcp/tools/resolve-topic-key.js';
export { FileLogger } from './mcp/logger.js';
export type { Logger } from './mcp/logger.js';
