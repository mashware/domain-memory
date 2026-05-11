#!/usr/bin/env node
// Domain Memory MCP server — stdio entry point.
// Resolves the project root (env override or cwd), builds the server
// context, creates the McpServer and connects it to stdio.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServerContext } from './mcp/context.js';
import { createMcpServer } from './mcp/server.js';

async function main(): Promise<void> {
  const projectRoot = process.env['DOMAIN_MEMORY_ROOT'] ?? process.cwd();
  const ctx = createServerContext(projectRoot);
  const server = createMcpServer(ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(
    `domain-memory server failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
