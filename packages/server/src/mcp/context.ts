// Assembles all server dependencies from a project root. One instance per
// running server process. Opens the SQLite database, creates the embedder,
// and wires up the repositories, indexer, and searcher.

import { resolvePaths, type DomainMemoryPaths } from '../storage/paths.js';
import { openDatabase, type Db } from '../storage/database.js';
import { EntryRepository } from '../storage/entry-repository.js';
import { StagingRepository } from '../storage/staging-repository.js';
import { Embedder } from '../indexing/embedder.js';
import { VectorIndex } from '../indexing/vector-index.js';
import { Indexer } from '../indexing/indexer.js';
import { Searcher } from '../search/searcher.js';
import { DriftChecker } from '../search/drift-checker.js';
import { loadSettings } from '../config/settings.js';
import { FileLogger, type Logger } from './logger.js';

export interface ServerContext {
  paths: DomainMemoryPaths;
  db: Db;
  logger: Logger;
  entries: EntryRepository;
  staging: StagingRepository;
  embedder: Embedder;
  vectors: VectorIndex;
  indexer: Indexer;
  drift: DriftChecker;
  searcher: Searcher;
}

export function createServerContext(projectRoot: string): ServerContext {
  const paths = resolvePaths(projectRoot);
  const db = openDatabase({ path: paths.indexDb });
  const logger = new FileLogger(paths.errorsLog);
  const settings = loadSettings(paths.configFile, {
    onWarn: (message, meta) => logger.warn(message, meta),
  });

  const entries = new EntryRepository(db, paths);
  const staging = new StagingRepository(paths);
  const embedder = new Embedder();
  const vectors = new VectorIndex(db);
  const indexer = new Indexer(embedder, vectors, logger);
  const drift = new DriftChecker(db, paths.root, logger);
  const searcher = new Searcher(db, embedder, vectors, logger, drift, {
    weights: settings.search.weights,
  });

  return {
    paths,
    db,
    logger,
    entries,
    staging,
    embedder,
    vectors,
    indexer,
    drift,
    searcher,
  };
}
