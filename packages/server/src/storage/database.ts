// Opens the SQLite index database, loads sqlite-vec, applies the schema.
// The database is derived and rebuildable from the markdown files on disk.

import Database, { type Database as Db } from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  MIGRATION_V1_TO_V2,
  POST_MIGRATE_INDEXES,
  SCHEMA_SQL,
  SCHEMA_VERSION,
  VEC_TABLE_SQL,
} from './schema.sql.js';

export interface OpenDatabaseOptions {
  path: string;
  readonly?: boolean;
}

function runScript(db: Db, sql: string): void {
  // better-sqlite3 exposes multi-statement execution via .exec().
  // Wrapped in a helper to keep the surface area small.
  (db as unknown as { exec: (s: string) => void }).exec(sql);
}

export function openDatabase(options: OpenDatabaseOptions): Db {
  mkdirSync(dirname(options.path), { recursive: true });

  const db = new Database(options.path, {
    readonly: options.readonly ?? false,
  });

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  sqliteVec.load(db);

  // Run base schema (tables + safe indexes) first, then migrations that may
  // add columns, then the full set of indexes that depend on those columns.
  runScript(db, SCHEMA_SQL);
  runScript(db, VEC_TABLE_SQL);
  migrate(db);
  runScript(db, POST_MIGRATE_INDEXES);

  return db;
}

// Applies any pending schema migrations. Fresh databases created by SCHEMA_SQL
// already match the latest version, so migrate() only stamps schema_version.
// Existing databases replay the incremental steps between the stored version
// and the target one. Keep this idempotent — openDatabase runs on every boot.
function migrate(db: Db): void {
  const current = db
    .prepare('SELECT value FROM schema_meta WHERE key = ?')
    .get('schema_version') as { value: string } | undefined;

  if (!current) {
    db.prepare(
      'INSERT INTO schema_meta (key, value) VALUES (?, ?)',
    ).run('schema_version', SCHEMA_VERSION);
    return;
  }

  if (current.value === SCHEMA_VERSION) return;

  if (current.value === '1') {
    if (!hasColumn(db, 'entries', 'topic_key')) {
      runScript(db, MIGRATION_V1_TO_V2);
    }
    db.prepare('UPDATE schema_meta SET value = ? WHERE key = ?').run(
      SCHEMA_VERSION,
      'schema_version',
    );
  }
}

function hasColumn(db: Db, table: string, column: string): boolean {
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

export type { Db };
