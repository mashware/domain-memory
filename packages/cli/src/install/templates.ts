// Resolves and reads the templates shipped with this repository. Templates
// live at <repo>/templates/ and are read at install time, not embedded in
// code, so editing a template and re-running install picks up the change.
//
// Resolution strategy:
//   1. env DOMAIN_MEMORY_TEMPLATES (explicit override)
//   2. <cli_package>/templates (future published layout)
//   3. <cli_package>/../../templates (monorepo dev layout, current)
//   4. throws with a helpful error

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientId } from './detect.js';

const here = dirname(fileURLToPath(import.meta.url));

export function resolveTemplatesDir(): string {
  const override = process.env['DOMAIN_MEMORY_TEMPLATES'];
  if (override && existsSync(override)) return override;

  // CLI compiled: packages/cli/dist/install/templates.js
  // -> packages/cli/templates
  const packaged = resolve(here, '..', '..', 'templates');
  if (existsSync(packaged)) return packaged;

  // Monorepo dev layout:
  // packages/cli/dist/install/templates.js -> <repo>/templates
  const monorepo = resolve(here, '..', '..', '..', '..', 'templates');
  if (existsSync(monorepo)) return monorepo;

  throw new Error(
    `Could not locate templates directory. Tried: ${packaged}, ${monorepo}. ` +
      `Set DOMAIN_MEMORY_TEMPLATES to override.`,
  );
}

export function readInstructionsTemplate(): string {
  return readFileSync(resolve(resolveTemplatesDir(), 'instructions.md'), 'utf-8');
}

export function readPrimerTemplate(): string {
  return readFileSync(resolve(resolveTemplatesDir(), 'primer.md'), 'utf-8');
}

export function readPointerBlock(client: ClientId): string {
  const map: Record<ClientId, string> = {
    'claude-code': 'pointer-blocks/claude-code.md',
    cursor: 'pointer-blocks/cursor.mdc',
    copilot: 'pointer-blocks/copilot.md',
    gemini: 'pointer-blocks/gemini.md',
    opencode: 'pointer-blocks/opencode.md',
  };
  return readFileSync(resolve(resolveTemplatesDir(), map[client]), 'utf-8');
}

export function readSlashCommandTemplate(): string {
  return readFileSync(
    resolve(resolveTemplatesDir(), 'save-knowledge-command.md'),
    'utf-8',
  );
}
