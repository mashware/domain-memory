// Switch the install mode of a domain-memory project between
// local, team-direct and team-validated. Only touches
// .domain-memory/config.json — other files (instructions, pointer
// blocks, MCP registrations) are mode-agnostic for Phase 1.
//
// Listing the current mode is supported via `mode` with no argument.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import type { InstallMode } from '../install/writers.js';

const VALID_MODES: readonly InstallMode[] = ['local', 'team-direct', 'team-validated'];

export interface ModeOptions {
  root: string;
  target?: string;
}

export async function runMode(opts: ModeOptions): Promise<number> {
  const configPath = join(opts.root, '.domain-memory', 'config.json');
  if (!existsSync(configPath)) {
    process.stderr.write(
      pc.red(`No .domain-memory/config.json found at ${opts.root}. `) +
        pc.dim('Run `domain-memory install` first.\n'),
    );
    return 1;
  }

  const raw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw) as Record<string, unknown>;
  const currentMode = config['mode'] as InstallMode | undefined;

  if (!opts.target) {
    process.stdout.write(`Current mode: ${pc.cyan(currentMode ?? 'unknown')}\n`);
    return 0;
  }

  if (!VALID_MODES.includes(opts.target as InstallMode)) {
    process.stderr.write(
      pc.red(`Invalid mode: ${opts.target}. Valid modes: ${VALID_MODES.join(', ')}\n`),
    );
    return 1;
  }

  const next = opts.target as InstallMode;
  if (next === currentMode) {
    process.stdout.write(pc.dim(`Mode already set to ${next}.\n`));
    return 0;
  }

  config['mode'] = next;
  config['mode_changed_at'] = new Date().toISOString();
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');

  process.stdout.write(
    pc.green(`Mode changed: ${currentMode ?? '?'} → ${next}\n`),
  );
  if (next === 'team-direct') {
    process.stdout.write(
      pc.yellow(
        '\n  ! team-direct has no validation layer. All saved knowledge\n' +
          '    is shared immediately. Use this only in small, trusted teams.\n',
      ),
    );
  }
  if (next === 'team-validated') {
    process.stdout.write(
      pc.dim(
        '\n  · team-validated requires the pipeline agent to be configured\n' +
          '    separately with a team API key (not managed by this command).\n',
      ),
    );
  }
  return 0;
}
