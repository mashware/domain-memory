import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInstall } from './install.js';

// The install orchestrator shells out to the interactive prompt library
// when options are missing. The tests always pass {clients, mode, yes}
// so no prompt ever runs, and rely on DOMAIN_MEMORY_TEMPLATES to point
// at the templates directory shipped in the repo root.

describe('runInstall orchestrator', () => {
  let root: string;
  let stdoutSpy: NodeJS.WritableStream['write'];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-install-'));

    // Silence the command's own stdout to keep test output clean.
    stdoutSpy = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: typeof stdoutSpy }).write = (() =>
      true) as unknown as typeof stdoutSpy;
  });

  afterEach(() => {
    (process.stdout as unknown as { write: typeof stdoutSpy }).write = stdoutSpy;
    rmSync(root, { recursive: true, force: true });
  });

  it('writes the expected files for Claude Code + Cursor', async () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    mkdirSync(join(root, '.cursor'), { recursive: true });

    await runInstall({
      root,
      mode: 'local',
      clients: ['claude-code', 'cursor'],
      yes: true,
    });

    expect(existsSync(join(root, '.domain-memory/instructions.md'))).toBe(true);
    expect(existsSync(join(root, '.domain-memory/config.json'))).toBe(true);
    expect(existsSync(join(root, '.gitignore'))).toBe(true);

    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(root, '.mcp.json'))).toBe(true);
    expect(existsSync(join(root, '.claude/commands/save-knowledge.md'))).toBe(true);

    expect(existsSync(join(root, '.cursor/rules/domain-memory.mdc'))).toBe(true);
    expect(existsSync(join(root, '.cursor/mcp.json'))).toBe(true);
  });

  it('persists mode and clients in config.json', async () => {
    await runInstall({
      root,
      mode: 'team-validated',
      clients: ['opencode'],
      yes: true,
    });

    const config = JSON.parse(
      readFileSync(join(root, '.domain-memory/config.json'), 'utf-8'),
    ) as { mode: string; clients: string[]; version: string };

    expect(config.mode).toBe('team-validated');
    expect(config.clients).toEqual(['opencode']);
    expect(config.version).toBeDefined();
  });

  it('is fully idempotent — running twice leaves one pointer block and one gitignore entry', async () => {
    await runInstall({
      root,
      mode: 'local',
      clients: ['claude-code'],
      yes: true,
    });
    await runInstall({
      root,
      mode: 'local',
      clients: ['claude-code'],
      yes: true,
    });

    const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    const starts = (claudeMd.match(/<!-- domain-memory:start -->/g) ?? []).length;
    expect(starts).toBe(1);

    const gitignore = readFileSync(join(root, '.gitignore'), 'utf-8');
    const stagingLines = (gitignore.match(/\.domain-memory\/staging\//g) ?? []).length;
    expect(stagingLines).toBe(1);

    const mcpJson = JSON.parse(
      readFileSync(join(root, '.mcp.json'), 'utf-8'),
    ) as Record<string, Record<string, unknown>>;
    expect(Object.keys(mcpJson['mcpServers']!)).toEqual(['domain-memory']);
  });

  it('preserves existing user content in CLAUDE.md when appending the pointer block', async () => {
    writeFileSync(
      join(root, 'CLAUDE.md'),
      '# Existing project\n\nImportant user rules here.\n',
      'utf-8',
    );

    await runInstall({
      root,
      mode: 'local',
      clients: ['claude-code'],
      yes: true,
    });

    const content = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('# Existing project');
    expect(content).toContain('Important user rules here.');
    expect(content).toContain('<!-- domain-memory:start -->');
  });

  it('preserves existing mcpServers entries when registering domain-memory', async () => {
    writeFileSync(
      join(root, '.mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            'other-server': { command: 'python', args: ['other.py'] },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    await runInstall({
      root,
      mode: 'local',
      clients: ['claude-code'],
      yes: true,
    });

    const parsed = JSON.parse(
      readFileSync(join(root, '.mcp.json'), 'utf-8'),
    ) as Record<string, Record<string, Record<string, unknown>>>;
    expect(parsed['mcpServers']!['other-server']).toBeDefined();
    expect(parsed['mcpServers']!['domain-memory']).toBeDefined();
  });

  it('configures all five clients when selected', async () => {
    await runInstall({
      root,
      mode: 'local',
      clients: ['claude-code', 'cursor', 'copilot', 'gemini', 'opencode'],
      yes: true,
    });

    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(root, '.mcp.json'))).toBe(true);
    expect(existsSync(join(root, '.cursor/rules/domain-memory.mdc'))).toBe(true);
    expect(existsSync(join(root, '.cursor/mcp.json'))).toBe(true);
    expect(existsSync(join(root, '.github/copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(root, '.vscode/mcp.json'))).toBe(true);
    expect(existsSync(join(root, 'GEMINI.md'))).toBe(true);
    expect(existsSync(join(root, '.gemini/settings.json'))).toBe(true);
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(root, 'opencode.json'))).toBe(true);
  });
});
