import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_WEIGHTS,
  loadSettings,
} from './settings.js';

describe('loadSettings', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dm-settings-'));
    configPath = join(dir, 'config.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns defaults when the config file is missing', () => {
    const settings = loadSettings(configPath);
    expect(settings.search.weights).toEqual(DEFAULT_SEARCH_WEIGHTS);
  });

  it('returns defaults when the config has no search.weights block', () => {
    writeFileSync(
      configPath,
      JSON.stringify({ version: '0.1.0', mode: 'local', clients: [] }),
    );
    const settings = loadSettings(configPath);
    expect(settings.search.weights).toEqual(DEFAULT_SEARCH_WEIGHTS);
  });

  it('reads custom weights from the config file', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        search: { weights: { path: 0.7, embedding: 0.2, bm25: 0.1 } },
      }),
    );
    const settings = loadSettings(configPath);
    expect(settings.search.weights).toEqual({
      path: 0.7,
      embedding: 0.2,
      bm25: 0.1,
    });
  });

  it('falls back to defaults and warns when JSON is malformed', () => {
    writeFileSync(configPath, '{ not valid json');
    const messages: string[] = [];
    const settings = loadSettings(configPath, {
      onWarn: (msg) => messages.push(msg),
    });
    expect(settings.search.weights).toEqual(DEFAULT_SEARCH_WEIGHTS);
    expect(messages).toContain('config_parse_failed');
  });

  it('falls back to defaults and warns when weights are negative', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        search: { weights: { path: -1, embedding: 0.3, bm25: 0.2 } },
      }),
    );
    const messages: string[] = [];
    const settings = loadSettings(configPath, {
      onWarn: (msg) => messages.push(msg),
    });
    expect(settings.search.weights).toEqual(DEFAULT_SEARCH_WEIGHTS);
    expect(messages).toContain('config_invalid');
  });

  it('falls back to defaults and warns when all weights are zero', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        search: { weights: { path: 0, embedding: 0, bm25: 0 } },
      }),
    );
    const messages: string[] = [];
    const settings = loadSettings(configPath, {
      onWarn: (msg) => messages.push(msg),
    });
    expect(settings.search.weights).toEqual(DEFAULT_SEARCH_WEIGHTS);
    expect(messages).toContain('config_invalid');
  });
});
