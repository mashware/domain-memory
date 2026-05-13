// Interactive install flow. Detects the clients present in the project,
// asks the user which to configure, then writes every target file
// idempotently. Safe to re-run — it will update existing files in
// place instead of duplicating.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';
import pc from 'picocolors';
import { CLIENTS, detectClients, type ClientId } from '../install/detect.js';
import {
  resolveServerCommand,
  updateGitignore,
  writeConfig,
  writeInstructions,
  writeMcpRegistration,
  writePointerBlock,
  writePrimerIfMissing,
  writeSlashCommand,
  type WriteContext,
} from '../install/writers.js';

export interface InstallOptions {
  root: string;
  clients?: ClientId[];
  yes?: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));

export async function runInstall(opts: InstallOptions): Promise<void> {
  process.stdout.write(
    pc.bold('\nDomain Memory — install\n') +
      pc.dim(`  Project root: ${opts.root}\n\n`),
  );

  const detected = detectClients(opts.root);
  if (detected.length > 0) {
    process.stdout.write(
      pc.dim('Detected clients: ') +
        detected.map((c) => CLIENTS[c].displayName).join(', ') +
        '\n\n',
    );
  } else {
    process.stdout.write(pc.dim('No clients detected automatically.\n\n'));
  }

  const clients = await chooseClients(detected, opts);
  if (clients.length === 0) {
    process.stdout.write(pc.yellow('No clients selected — aborting.\n'));
    return;
  }

  const serverCommand = resolveServerCommand(here);
  const ctx: WriteContext = {
    projectRoot: opts.root,
    serverCommand,
  };

  process.stdout.write(pc.bold('\nWriting files...\n'));

  writeInstructions(ctx);
  logStep('.domain-memory/instructions.md');

  const primerWritten = writePrimerIfMissing(ctx);
  logStep(
    primerWritten
      ? '.domain-memory/primer.md (template — fill it in)'
      : '.domain-memory/primer.md (kept existing)',
  );

  writeConfig(ctx, clients);
  logStep('.domain-memory/config.json');

  updateGitignore(ctx, clients);
  logStep('.gitignore (updated)');

  for (const id of clients) {
    const client = CLIENTS[id];
    writePointerBlock(ctx, client);
    logStep(`${client.displayName}: ${client.instructionsFile}`);

    writeMcpRegistration(ctx, client);
    logStep(`${client.displayName}: ${client.mcpConfigFile} (MCP server registered)`);

    if (id === 'claude-code') {
      writeSlashCommand(ctx);
      logStep('Claude Code: .claude/commands/save-knowledge.md');
    }
  }

  process.stdout.write(
    '\n' +
      pc.green('Install complete.') +
      '\n\n' +
      pc.bold('Next steps:\n') +
      '  1. Fill in ' +
      pc.cyan('.domain-memory/primer.md') +
      ' with your project overview (the agent loads it as MCP instructions).\n' +
      '  2. Restart your MCP client(s) so they pick up the new server and primer.\n' +
      '  3. Run ' +
      pc.cyan('domain-memory doctor') +
      ' to verify.\n\n',
  );
}

async function chooseClients(
  detected: ClientId[],
  opts: InstallOptions,
): Promise<ClientId[]> {
  if (opts.clients && opts.clients.length > 0) return opts.clients;
  if (opts.yes) {
    return detected.length > 0 ? detected : (Object.keys(CLIENTS) as ClientId[]);
  }

  const detectedSet = new Set(detected);
  const response = await prompts({
    type: 'multiselect',
    name: 'selected',
    message: 'Which clients do you want to configure?',
    choices: (Object.values(CLIENTS) as Array<(typeof CLIENTS)[ClientId]>).map(
      (c) => ({
        title: c.displayName,
        value: c.id,
        selected: detectedSet.has(c.id),
      }),
    ),
    hint: 'Space to toggle, Enter to confirm',
    instructions: false,
  });

  return (response['selected'] as ClientId[] | undefined) ?? [];
}

function logStep(line: string): void {
  process.stdout.write(`  ${pc.green('✓')} ${line}\n`);
}
