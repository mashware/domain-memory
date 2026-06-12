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
import { CLIENTS, type ClientId } from './detect.js';
import {
  resolveServerCommand,
  updateGitignore,
  writeConfig,
  writeInstructions,
  writeMcpRegistration,
  writePointerBlock,
  writePrimerIfMissing,
  type WriteContext,
} from './writers.js';

const FAKE_SERVER = {
  command: 'node',
  args: ['/abs/path/to/server/dist/index.js'],
};

function makeContext(root: string): WriteContext {
  return {
    projectRoot: root,
    serverCommand: FAKE_SERVER,
  };
}

describe('install writers', () => {
  let root: string;
  let ctx: WriteContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-writers-'));
    ctx = makeContext(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('writePointerBlock (markdown-delimited)', () => {
    const client = CLIENTS['claude-code'];

    it('creates a new file when none exists', () => {
      writePointerBlock(ctx, client);
      const target = join(root, client.instructionsFile);
      expect(existsSync(target)).toBe(true);
      const content = readFileSync(target, 'utf-8');
      expect(content).toContain('<!-- domain-memory:start -->');
      expect(content).toContain('<!-- domain-memory:end -->');
    });

    it('appends to an existing file without touching user content', () => {
      const target = join(root, client.instructionsFile);
      writeFileSync(target, '# My Project\n\nExisting content.\n', 'utf-8');
      writePointerBlock(ctx, client);
      const content = readFileSync(target, 'utf-8');
      expect(content).toContain('# My Project');
      expect(content).toContain('Existing content.');
      expect(content).toContain('<!-- domain-memory:start -->');
    });

    it('is idempotent — running twice keeps a single block', () => {
      writePointerBlock(ctx, client);
      writePointerBlock(ctx, client);
      const content = readFileSync(join(root, client.instructionsFile), 'utf-8');
      const starts = (content.match(/<!-- domain-memory:start -->/g) ?? []).length;
      const ends = (content.match(/<!-- domain-memory:end -->/g) ?? []).length;
      expect(starts).toBe(1);
      expect(ends).toBe(1);
    });

    it('updates the block in place when the template changes', () => {
      const target = join(root, client.instructionsFile);
      writeFileSync(
        target,
        [
          '# Project',
          '',
          '<!-- domain-memory:start -->',
          'OLD BLOCK CONTENT',
          '<!-- domain-memory:end -->',
          '',
          '## Other section',
          'kept.',
          '',
        ].join('\n'),
        'utf-8',
      );

      writePointerBlock(ctx, client);
      const content = readFileSync(target, 'utf-8');
      expect(content).not.toContain('OLD BLOCK CONTENT');
      expect(content).toContain('## Other section');
      expect(content).toContain('kept.');
      expect((content.match(/<!-- domain-memory:start -->/g) ?? []).length).toBe(1);
    });
  });

  describe('writePointerBlock (mdc-frontmatter)', () => {
    it('overwrites .mdc files wholesale because they own the file', () => {
      const client = CLIENTS['cursor'];
      const target = join(root, client.instructionsFile);
      mkdirSync(join(root, '.cursor/rules'), { recursive: true });
      writeFileSync(target, '---\ndescription: stale\n---\n\nstale body\n', 'utf-8');

      writePointerBlock(ctx, client);

      const content = readFileSync(target, 'utf-8');
      expect(content).not.toContain('stale body');
      expect(content).toContain('alwaysApply: true');
    });
  });

  describe('writeMcpRegistration', () => {
    it('creates .mcp.json with mcpServers shape for Claude Code', () => {
      writeMcpRegistration(ctx, CLIENTS['claude-code']);
      const target = join(root, '.mcp.json');
      expect(existsSync(target)).toBe(true);
      const parsed = JSON.parse(readFileSync(target, 'utf-8')) as Record<
        string,
        Record<string, unknown>
      >;
      expect(parsed['mcpServers']).toBeDefined();
      expect(parsed['mcpServers']!['domain-memory']).toEqual({
        command: 'node',
        args: FAKE_SERVER.args,
      });
    });

    it('uses the vscode servers shape with type:stdio for Copilot', () => {
      writeMcpRegistration(ctx, CLIENTS['copilot']);
      const target = join(root, '.vscode/mcp.json');
      const parsed = JSON.parse(readFileSync(target, 'utf-8')) as Record<
        string,
        Record<string, Record<string, unknown>>
      >;
      expect(parsed['servers']!['domain-memory']).toEqual({
        type: 'stdio',
        command: 'node',
        args: FAKE_SERVER.args,
      });
    });

    it('uses opencode-mcp shape (mcp, type:local, command as array, enabled) for OpenCode', () => {
      writeMcpRegistration(ctx, CLIENTS['opencode']);
      const target = join(root, 'opencode.json');
      const parsed = JSON.parse(readFileSync(target, 'utf-8')) as Record<
        string,
        unknown
      >;
      expect(parsed['$schema']).toBe('https://opencode.ai/config.json');
      const mcp = parsed['mcp'] as Record<string, Record<string, unknown>>;
      expect(mcp['domain-memory']).toEqual({
        type: 'local',
        command: ['node', ...FAKE_SERVER.args],
        enabled: true,
      });
    });

    it('does not overwrite an existing $schema and keeps other OpenCode keys', () => {
      const target = join(root, 'opencode.json');
      writeFileSync(
        target,
        JSON.stringify(
          {
            $schema: 'https://custom.example/schema.json',
            model: 'anthropic/claude-opus-4',
            mcp: {
              'other-server': { type: 'local', command: ['python', 'x.py'] },
            },
          },
          null,
          2,
        ),
        'utf-8',
      );

      writeMcpRegistration(ctx, CLIENTS['opencode']);
      const parsed = JSON.parse(readFileSync(target, 'utf-8')) as Record<
        string,
        unknown
      >;
      expect(parsed['$schema']).toBe('https://custom.example/schema.json');
      expect(parsed['model']).toBe('anthropic/claude-opus-4');
      const mcp = parsed['mcp'] as Record<string, Record<string, unknown>>;
      expect(mcp['other-server']).toEqual({
        type: 'local',
        command: ['python', 'x.py'],
      });
      expect(mcp['domain-memory']).toEqual({
        type: 'local',
        command: ['node', ...FAKE_SERVER.args],
        enabled: true,
      });
    });

    it('is idempotent for OpenCode — re-running keeps a single entry', () => {
      writeMcpRegistration(ctx, CLIENTS['opencode']);
      writeMcpRegistration(ctx, CLIENTS['opencode']);
      const parsed = JSON.parse(
        readFileSync(join(root, 'opencode.json'), 'utf-8'),
      ) as Record<string, Record<string, unknown>>;
      expect(Object.keys(parsed['mcp']!)).toEqual(['domain-memory']);
    });

    it('merges into an existing config without clobbering other servers', () => {
      const target = join(root, '.mcp.json');
      writeFileSync(
        target,
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

      writeMcpRegistration(ctx, CLIENTS['claude-code']);
      const parsed = JSON.parse(readFileSync(target, 'utf-8')) as Record<
        string,
        Record<string, unknown>
      >;
      expect(parsed['mcpServers']!['other-server']).toEqual({
        command: 'python',
        args: ['other.py'],
      });
      expect(parsed['mcpServers']!['domain-memory']).toBeDefined();
    });

    it('is idempotent — re-running overwrites only the domain-memory entry', () => {
      writeMcpRegistration(ctx, CLIENTS['claude-code']);
      writeMcpRegistration(ctx, CLIENTS['claude-code']);
      const parsed = JSON.parse(
        readFileSync(join(root, '.mcp.json'), 'utf-8'),
      ) as Record<string, Record<string, unknown>>;
      expect(Object.keys(parsed['mcpServers']!)).toEqual(['domain-memory']);
    });
  });

  describe('updateGitignore', () => {
    const clients: ClientId[] = ['claude-code', 'opencode'];

    it('creates .gitignore with per-developer and runtime blocks when none exists', () => {
      updateGitignore(ctx, clients);
      const content = readFileSync(join(root, '.gitignore'), 'utf-8');
      expect(content).toContain('# domain-memory (per-developer)');
      expect(content).toContain('.domain-memory/config.json');
      expect(content).toContain('.mcp.json');
      expect(content).toContain('opencode.json');
      expect(content).toContain('# domain-memory runtime state');
      expect(content).toContain('.domain-memory/staging/');
      expect(content).toContain('.domain-memory/index.sqlite');
    });

    it('appends to an existing .gitignore without touching user entries', () => {
      writeFileSync(join(root, '.gitignore'), 'node_modules/\n*.log\n', 'utf-8');
      updateGitignore(ctx, clients);
      const content = readFileSync(join(root, '.gitignore'), 'utf-8');
      expect(content).toContain('node_modules/');
      expect(content).toContain('*.log');
      expect(content).toContain('.domain-memory/staging/');
      expect(content).toContain('.mcp.json');
    });

    it('is idempotent — re-running does not duplicate entries', () => {
      updateGitignore(ctx, clients);
      updateGitignore(ctx, clients);
      const content = readFileSync(join(root, '.gitignore'), 'utf-8');
      const count = (content.match(/\.domain-memory\/staging\//g) ?? []).length;
      expect(count).toBe(1);
    });
  });

  describe('resolveServerCommand', () => {
    const origEnv = process.env['DOMAIN_MEMORY_SERVER_BIN'];

    afterEach(() => {
      if (origEnv === undefined) {
        delete process.env['DOMAIN_MEMORY_SERVER_BIN'];
      } else {
        process.env['DOMAIN_MEMORY_SERVER_BIN'] = origEnv;
      }
    });

    it('honors DOMAIN_MEMORY_SERVER_BIN when set to an absolute path', () => {
      process.env['DOMAIN_MEMORY_SERVER_BIN'] = '/opt/domain-memory/bin/server.js';
      const cmd = resolveServerCommand('/unused/dir');
      expect(cmd).toEqual({
        command: 'node',
        args: ['/opt/domain-memory/bin/server.js'],
      });
    });

    it('uses the env var as a bare command when it has no slashes', () => {
      process.env['DOMAIN_MEMORY_SERVER_BIN'] = 'my-custom-server';
      const cmd = resolveServerCommand('/unused/dir');
      expect(cmd).toEqual({ command: 'my-custom-server', args: [] });
    });

    it('falls back to domain-memory-server when no bin is found on disk', () => {
      delete process.env['DOMAIN_MEMORY_SERVER_BIN'];
      const cmd = resolveServerCommand(root);
      expect(cmd).toEqual({ command: 'domain-memory-server', args: [] });
    });
  });

  describe('writeInstructions and writeConfig', () => {
    it('writes .domain-memory/instructions.md', () => {
      writeInstructions(ctx);
      const target = join(root, '.domain-memory/instructions.md');
      expect(existsSync(target)).toBe(true);
      const content = readFileSync(target, 'utf-8');
      expect(content).toContain('Domain Memory');
    });

    it('seeds .domain-memory/primer.md from template when missing', () => {
      const wrote = writePrimerIfMissing(ctx);
      expect(wrote).toBe(true);
      const target = join(root, '.domain-memory/primer.md');
      expect(existsSync(target)).toBe(true);
      const content = readFileSync(target, 'utf-8');
      expect(content).toContain('Project primer');
    });

    it('does not overwrite an existing primer.md', () => {
      const target = join(root, '.domain-memory/primer.md');
      mkdirSync(join(root, '.domain-memory'), { recursive: true });
      writeFileSync(target, '# my custom primer\n', 'utf-8');

      const wrote = writePrimerIfMissing(ctx);
      expect(wrote).toBe(false);
      expect(readFileSync(target, 'utf-8')).toBe('# my custom primer\n');
    });

    it('writes .domain-memory/config.json with the selected clients', () => {
      writeConfig(ctx, ['claude-code', 'cursor']);
      const target = join(root, '.domain-memory/config.json');
      const parsed = JSON.parse(readFileSync(target, 'utf-8')) as {
        clients: string[];
        installed_at: string;
      };
      expect(parsed.clients).toEqual(['claude-code', 'cursor']);
      expect(parsed.installed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
