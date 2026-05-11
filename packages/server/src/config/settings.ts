// Settings loaded from `.domain-memory/config.json`. The file is created by
// `domain-memory install`; this loader is tolerant of missing or partial
// content and falls back to defaults silently — consistent with the project
// principle of staying out of the way when configuration cannot help.

import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

const SearchWeightsSchema = z
  .object({
    path: z.number().nonnegative(),
    embedding: z.number().nonnegative(),
    bm25: z.number().nonnegative(),
  })
  .refine((w) => w.path + w.embedding + w.bm25 > 0, {
    message: 'at least one search weight must be greater than zero',
  });

export type SearchWeights = z.infer<typeof SearchWeightsSchema>;

export const DEFAULT_SEARCH_WEIGHTS: SearchWeights = {
  path: 0.5,
  embedding: 0.3,
  bm25: 0.2,
};

const SettingsSchema = z
  .object({
    search: z
      .object({
        weights: SearchWeightsSchema.optional(),
      })
      .optional(),
  })
  .passthrough();

export interface Settings {
  search: {
    weights: SearchWeights;
  };
}

export interface LoadSettingsOptions {
  onWarn?: (message: string, meta?: Record<string, unknown>) => void;
}

export function loadSettings(
  configPath: string,
  options: LoadSettingsOptions = {},
): Settings {
  const warn = options.onWarn ?? (() => {});

  if (!existsSync(configPath)) {
    return { search: { weights: DEFAULT_SEARCH_WEIGHTS } };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (err) {
    warn('config_parse_failed', {
      path: configPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return { search: { weights: DEFAULT_SEARCH_WEIGHTS } };
  }

  const parsed = SettingsSchema.safeParse(raw);
  if (!parsed.success) {
    warn('config_invalid', {
      path: configPath,
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return { search: { weights: DEFAULT_SEARCH_WEIGHTS } };
  }

  return {
    search: {
      weights: parsed.data.search?.weights ?? DEFAULT_SEARCH_WEIGHTS,
    },
  };
}
