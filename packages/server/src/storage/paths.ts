// Resolves paths inside `.domain-memory/` for a given project root.
// The project root is the directory where `.domain-memory/` lives — usually
// the git repo root of the project where domain-memory is installed.

import { join } from 'node:path';

export interface DomainMemoryPaths {
  root: string;
  base: string;
  knowledge: string;
  staging: string;
  instructionsFile: string;
  primerFile: string;
  configFile: string;
  indexDb: string;
  errorsLog: string;
}

export function resolvePaths(projectRoot: string): DomainMemoryPaths {
  const base = join(projectRoot, '.domain-memory');
  return {
    root: projectRoot,
    base,
    knowledge: join(base, 'knowledge'),
    staging: join(base, 'staging'),
    instructionsFile: join(base, 'instructions.md'),
    primerFile: join(base, 'primer.md'),
    configFile: join(base, 'config.json'),
    indexDb: join(base, 'index.sqlite'),
    errorsLog: join(base, 'errors.log'),
  };
}

export function featureDir(paths: DomainMemoryPaths, featureSlug: string): string {
  return join(paths.knowledge, featureSlug);
}

export function featureFile(paths: DomainMemoryPaths, featureSlug: string): string {
  return join(featureDir(paths, featureSlug), 'feature.md');
}

export function aspectFile(
  paths: DomainMemoryPaths,
  featureSlug: string,
  aspectSlug: string,
): string {
  return join(featureDir(paths, featureSlug), 'aspects', `${aspectSlug}.md`);
}

export function stagingFile(paths: DomainMemoryPaths, branchSlug: string): string {
  return join(paths.staging, `${branchSlug}.jsonl`);
}
