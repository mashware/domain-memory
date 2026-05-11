// Creates and configures the MCP server with all domain-memory tools.
// Called by the stdio entry point; separated so tests can instantiate
// the server without a transport.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from './context.js';
import { loadPrimer } from './primer.js';
import { handleGetProjectPrimer } from './tools/get-project-primer.js';
import {
  searchKnowledgeInputShape,
  handleSearchKnowledge,
} from './tools/search-knowledge.js';
import {
  saveKnowledgeInputShape,
  handleSaveKnowledge,
} from './tools/save-knowledge.js';
import {
  stageFindingInputShape,
  handleStageFinding,
} from './tools/stage-finding.js';
import {
  readStagingInputShape,
  handleReadStaging,
} from './tools/read-staging.js';
import {
  checkDriftInputShape,
  handleCheckDrift,
} from './tools/check-drift.js';
import {
  resolveTopicKeyInputShape,
  handleResolveTopicKey,
} from './tools/resolve-topic-key.js';

export interface ServerInfo {
  name: string;
  version: string;
}

const DEFAULT_INFO: ServerInfo = {
  name: 'domain-memory',
  version: '0.1.0',
};

export function createMcpServer(
  ctx: ServerContext,
  info: ServerInfo = DEFAULT_INFO,
): McpServer {
  const primer = loadPrimer(ctx.paths);
  const server = new McpServer(
    info,
    primer ? { instructions: primer } : undefined,
  );

  server.registerTool(
    'get_project_primer',
    {
      title: 'Get project primer',
      description:
        'Re-read the project primer from `.domain-memory/primer.md`. The primer is auto-delivered as MCP instructions on connection; this tool refreshes the content after editing without reconnecting.',
      inputSchema: {},
    },
    async () => handleGetProjectPrimer(ctx),
  );

  server.registerTool(
    'search_knowledge',
    {
      title: 'Search knowledge',
      description:
        'Search the domain-memory knowledge store using semantic + keyword + path/symbol matchers. Returns ranked candidates. Call before writing to avoid duplicates.',
      inputSchema: searchKnowledgeInputShape,
    },
    async (input: unknown) => handleSearchKnowledge(ctx, input),
  );

  server.registerTool(
    'save_knowledge',
    {
      title: 'Save knowledge',
      description:
        'Create, update, archive or supersede a knowledge entry. Always call search_knowledge first. Conflicts block the write — resolve with the user before retrying.',
      inputSchema: saveKnowledgeInputShape,
    },
    async (input: unknown) => handleSaveKnowledge(ctx, input),
  );

  server.registerTool(
    'stage_finding',
    {
      title: 'Stage a finding',
      description:
        'Append a domain-knowledge finding to the per-branch staging. Findings survive session compaction and are consolidated later at /save-knowledge or PR time.',
      inputSchema: stageFindingInputShape,
    },
    async (input: unknown) => handleStageFinding(ctx, input),
  );

  server.registerTool(
    'read_staging',
    {
      title: 'Read staging',
      description:
        'Read all staged findings for a given branch, ordered chronologically.',
      inputSchema: readStagingInputShape,
    },
    async (input: unknown) => handleReadStaging(ctx, input),
  );

  server.registerTool(
    'resolve_topic_key',
    {
      title: 'Resolve topic key',
      description:
        'Look up an active entry by its canonical topic_key (feature slug, or "<featureSlug>/<aspectSlug>"). Use before save_knowledge(create) when you already know the exact slug — faster and more reliable than search_knowledge for dedup.',
      inputSchema: resolveTopicKeyInputShape,
    },
    async (input: unknown) => handleResolveTopicKey(ctx, input),
  );

  server.registerTool(
    'check_drift',
    {
      title: 'Check drift',
      description:
        'Given a list of file paths (typically the files a PR touches), return the knowledge entries that reference them. Use at PR time to flag potentially stale entries.',
      inputSchema: checkDriftInputShape,
    },
    async (input: unknown) => handleCheckDrift(ctx, input),
  );

  return server;
}
