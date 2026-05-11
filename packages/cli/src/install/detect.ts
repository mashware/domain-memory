// Detects which MCP-capable clients a project appears to be using, based
// on the presence of their well-known files or directories. A "detected"
// client is pre-selected in the install prompt, but the user can opt in
// to any client regardless of detection.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type ClientId = 'claude-code' | 'cursor' | 'copilot' | 'gemini' | 'opencode';

export interface ClientInfo {
  id: ClientId;
  displayName: string;
  instructionsFile: string; // relative to project root
  instructionsFormat: 'markdown-delimited' | 'mdc-frontmatter';
  mcpConfigFile: string; // relative to project root
  mcpConfigShape: 'mcp-servers' | 'vscode-servers' | 'opencode-mcp';
  extras?: {
    slashCommandFile?: string;
  };
}

export const CLIENTS: Record<ClientId, ClientInfo> = {
  'claude-code': {
    id: 'claude-code',
    displayName: 'Claude Code',
    instructionsFile: 'CLAUDE.md',
    instructionsFormat: 'markdown-delimited',
    mcpConfigFile: '.mcp.json',
    mcpConfigShape: 'mcp-servers',
    extras: {
      slashCommandFile: '.claude/commands/save-knowledge.md',
    },
  },
  cursor: {
    id: 'cursor',
    displayName: 'Cursor',
    instructionsFile: '.cursor/rules/domain-memory.mdc',
    instructionsFormat: 'mdc-frontmatter',
    mcpConfigFile: '.cursor/mcp.json',
    mcpConfigShape: 'mcp-servers',
  },
  copilot: {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    instructionsFile: '.github/copilot-instructions.md',
    instructionsFormat: 'markdown-delimited',
    mcpConfigFile: '.vscode/mcp.json',
    mcpConfigShape: 'vscode-servers',
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini CLI',
    instructionsFile: 'GEMINI.md',
    instructionsFormat: 'markdown-delimited',
    mcpConfigFile: '.gemini/settings.json',
    mcpConfigShape: 'mcp-servers',
  },
  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    instructionsFile: 'AGENTS.md',
    instructionsFormat: 'markdown-delimited',
    mcpConfigFile: 'opencode.json',
    mcpConfigShape: 'opencode-mcp',
  },
};

export function detectClients(projectRoot: string): ClientId[] {
  const detected: ClientId[] = [];

  if (existsSync(join(projectRoot, '.claude')) || existsSync(join(projectRoot, 'CLAUDE.md'))) {
    detected.push('claude-code');
  }
  if (existsSync(join(projectRoot, '.cursor'))) {
    detected.push('cursor');
  }
  if (
    existsSync(join(projectRoot, '.github/copilot-instructions.md')) ||
    existsSync(join(projectRoot, '.vscode/mcp.json'))
  ) {
    detected.push('copilot');
  }
  if (existsSync(join(projectRoot, 'GEMINI.md')) || existsSync(join(projectRoot, '.gemini'))) {
    detected.push('gemini');
  }
  if (existsSync(join(projectRoot, 'AGENTS.md')) || existsSync(join(projectRoot, 'opencode.json'))) {
    detected.push('opencode');
  }

  return detected;
}
