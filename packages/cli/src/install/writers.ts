// Write operations for the install flow. Every writer is idempotent:
// running install twice must not produce duplicate blocks, duplicate
// server registrations, or repeated .gitignore lines.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { CLIENTS, type ClientId, type ClientInfo } from './detect.js';
import {
  readInstructionsTemplate,
  readPointerBlock,
  readPrimerTemplate,
  readSlashCommandTemplate,
} from './templates.js';

const POINTER_START = '<!-- domain-memory:start -->';
const POINTER_END = '<!-- domain-memory:end -->';

export interface WriteContext {
  projectRoot: string;
  serverCommand: { command: string; args: string[] };
}

// ----- Pointer blocks ---------------------------------------------------

export function writePointerBlock(ctx: WriteContext, client: ClientInfo): void {
  const target = join(ctx.projectRoot, client.instructionsFile);
  const block = readPointerBlock(client.id);
  mkdirSync(dirname(target), { recursive: true });

  if (client.instructionsFormat === 'mdc-frontmatter') {
    // .mdc files own the whole file — overwrite wholesale. The pointer
    // block for Cursor already contains the frontmatter.
    writeFileSync(target, block, 'utf-8');
    return;
  }

  if (!existsSync(target)) {
    writeFileSync(target, `${block.trim()}\n`, 'utf-8');
    return;
  }

  const current = readFileSync(target, 'utf-8');
  const merged = upsertDelimitedBlock(current, block);
  writeFileSync(target, merged, 'utf-8');
}

function upsertDelimitedBlock(current: string, block: string): string {
  const startIdx = current.indexOf(POINTER_START);
  const endIdx = current.indexOf(POINTER_END);
  const normalizedBlock = block.trim();

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = current.slice(0, startIdx).replace(/\s+$/, '');
    const after = current.slice(endIdx + POINTER_END.length).replace(/^\s+/, '');
    const joined = [before, normalizedBlock, after].filter((s) => s.length > 0).join('\n\n');
    return joined.endsWith('\n') ? joined : `${joined}\n`;
  }

  const trimmed = current.replace(/\s+$/, '');
  return `${trimmed}\n\n${normalizedBlock}\n`;
}

// ----- MCP server registration -----------------------------------------

export function writeMcpRegistration(ctx: WriteContext, client: ClientInfo): void {
  const target = join(ctx.projectRoot, client.mcpConfigFile);
  mkdirSync(dirname(target), { recursive: true });

  const existing = readJsonIfExists(target);

  switch (client.mcpConfigShape) {
    case 'mcp-servers':
      writeJson(target, upsertMcpServers(existing, ctx.serverCommand));
      break;
    case 'vscode-servers':
      writeJson(target, upsertVscodeServers(existing, ctx.serverCommand));
      break;
    case 'opencode-mcp':
      writeJson(target, upsertOpencodeMcp(existing, ctx.serverCommand));
      break;
  }
}

interface ServerCommand {
  command: string;
  args: string[];
}

function upsertMcpServers(
  current: Record<string, unknown>,
  srv: ServerCommand,
): Record<string, unknown> {
  const rootKey = 'mcpServers';
  const servers = (current[rootKey] as Record<string, unknown> | undefined) ?? {};
  servers['domain-memory'] = {
    command: srv.command,
    args: srv.args,
  };
  return { ...current, [rootKey]: servers };
}

function upsertVscodeServers(
  current: Record<string, unknown>,
  srv: ServerCommand,
): Record<string, unknown> {
  const rootKey = 'servers';
  const servers = (current[rootKey] as Record<string, unknown> | undefined) ?? {};
  servers['domain-memory'] = {
    type: 'stdio',
    command: srv.command,
    args: srv.args,
  };
  return { ...current, [rootKey]: servers };
}

function upsertOpencodeMcp(
  current: Record<string, unknown>,
  srv: ServerCommand,
): Record<string, unknown> {
  const rootKey = 'mcp';
  const servers = (current[rootKey] as Record<string, unknown> | undefined) ?? {};
  servers['domain-memory'] = {
    type: 'local',
    command: [srv.command, ...srv.args],
    // Explicit on purpose: OpenCode's schema documents no default for a
    // local server's "enabled", so we pin it rather than rely on one.
    enabled: true,
  };
  const withSchema =
    '$schema' in current
      ? current
      : { $schema: 'https://opencode.ai/config.json', ...current };
  return { ...withSchema, [rootKey]: servers };
}

function readJsonIfExists(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

// ----- Shared files ----------------------------------------------------

export function writeInstructions(ctx: WriteContext): void {
  const target = join(ctx.projectRoot, '.domain-memory', 'instructions.md');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readInstructionsTemplate(), 'utf-8');
}

// Seeds the project primer template if no primer exists yet. The primer
// is user-owned content (project overview), so once it exists install
// must never overwrite it. Returns true if it wrote, false if skipped.
export function writePrimerIfMissing(ctx: WriteContext): boolean {
  const target = join(ctx.projectRoot, '.domain-memory', 'primer.md');
  if (existsSync(target)) return false;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readPrimerTemplate(), 'utf-8');
  return true;
}

export function writeConfig(ctx: WriteContext, clients: ClientId[]): void {
  const target = join(ctx.projectRoot, '.domain-memory', 'config.json');
  mkdirSync(dirname(target), { recursive: true });
  const payload = {
    version: '0.1.0',
    clients,
    installed_at: new Date().toISOString(),
  };
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

export function writeSlashCommand(ctx: WriteContext): void {
  const client = CLIENTS['claude-code'];
  if (!client.extras?.slashCommandFile) return;
  const target = join(ctx.projectRoot, client.extras.slashCommandFile);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readSlashCommandTemplate(), 'utf-8');
}

export function updateGitignore(ctx: WriteContext, clients: ClientId[]): void {
  const target = join(ctx.projectRoot, '.gitignore');

  const mcpConfigFiles = [...new Set(
    clients.map((id) => CLIENTS[id].mcpConfigFile),
  )];

  const needed = [
    '# domain-memory (per-developer)',
    '.domain-memory/config.json',
    ...mcpConfigFiles,
    '',
    '# domain-memory runtime state',
    '.domain-memory/staging/',
    '.domain-memory/index.sqlite',
    '.domain-memory/index.sqlite-*',
    '.domain-memory/errors.log',
    '.domain-memory/*.consolidated-*',
  ];

  let current = '';
  if (existsSync(target)) {
    current = readFileSync(target, 'utf-8');
  }

  const existingLines = new Set(
    current
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );

  const missing = needed.filter(
    (l) => l === '' || !existingLines.has(l.trim()),
  );

  if (missing.every((l) => l === '' || l.startsWith('#'))) return;

  const trimmed = current.replace(/\s+$/, '');
  const joined = [trimmed, missing.join('\n')].filter((s) => s.length > 0).join('\n\n');
  writeFileSync(target, `${joined}\n`, 'utf-8');
}

// ----- Resolve the server command for the local environment -----------

// Resolution order:
//   1. DOMAIN_MEMORY_SERVER_BIN env var (absolute path or command name).
//   2. Monorepo dev layout relative to the CLI's own dist directory.
//   3. A plain `domain-memory-server` command, assuming the user has
//      installed the package globally (npm -g, Volta, Homebrew, ...).
// When (3) is used we skip absolute-path verification: globally-installed
// packages live in many different places and we do not want to fail
// install just because the CLI cannot prove the bin exists right now.

export function resolveServerCommand(cliDir: string): ServerCommand {
  const override = process.env['DOMAIN_MEMORY_SERVER_BIN'];
  if (override) {
    if (override.includes('/') || override.includes('\\')) {
      return { command: 'node', args: [override] };
    }
    return { command: override, args: [] };
  }

  const fromMonorepo = findMonorepoServerBin(cliDir);
  if (fromMonorepo) {
    return { command: 'node', args: [fromMonorepo] };
  }

  return { command: 'domain-memory-server', args: [] };
}

function findMonorepoServerBin(cliDir: string): string | null {
  const candidates = [
    join(cliDir, '..', '..', '..', 'server', 'dist', 'index.js'),
    join(cliDir, '..', '..', 'server', 'dist', 'index.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function relativePathFor(ctx: WriteContext, absolutePath: string): string {
  return relative(ctx.projectRoot, absolutePath);
}
