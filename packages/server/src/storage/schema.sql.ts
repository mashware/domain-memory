// SQLite schema for the derived index. The index is rebuildable from the
// markdown files in `.domain-memory/knowledge/`. See SCHEMA.md for the
// authoritative description.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entries (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL,
    slug            TEXT NOT NULL,
    name            TEXT NOT NULL,
    feature_id      TEXT,
    topic_key       TEXT,
    status          TEXT NOT NULL,
    superseded_by   TEXT,
    confidence      INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    last_verified   TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    summary         TEXT NOT NULL,
    FOREIGN KEY (feature_id) REFERENCES entries(id)
);

CREATE INDEX IF NOT EXISTS idx_entries_type       ON entries(type);
CREATE INDEX IF NOT EXISTS idx_entries_feature    ON entries(feature_id);
CREATE INDEX IF NOT EXISTS idx_entries_status     ON entries(status);
CREATE INDEX IF NOT EXISTS idx_entries_confidence ON entries(confidence);

CREATE TABLE IF NOT EXISTS entry_paths (
    entry_id     TEXT NOT NULL,
    path         TEXT NOT NULL,
    is_dir       INTEGER NOT NULL,
    content_hash TEXT,
    PRIMARY KEY (entry_id, path),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entry_paths_path ON entry_paths(path);

CREATE TABLE IF NOT EXISTS entry_symbols (
    entry_id TEXT NOT NULL,
    symbol   TEXT NOT NULL,
    PRIMARY KEY (entry_id, symbol),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entry_symbols_symbol ON entry_symbols(symbol);

CREATE TABLE IF NOT EXISTS entry_relations (
    from_id TEXT NOT NULL,
    to_id   TEXT NOT NULL,
    kind    TEXT NOT NULL,
    PRIMARY KEY (from_id, to_id, kind),
    FOREIGN KEY (from_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY (to_id)   REFERENCES entries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id TEXT NOT NULL,
    tag      TEXT NOT NULL,
    PRIMARY KEY (entry_id, tag),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    entry_id UNINDEXED,
    name,
    summary,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS pending_conflicts (
    id             TEXT PRIMARY KEY,
    entry_id       TEXT NOT NULL,
    proposed_at    TEXT NOT NULL,
    proposed_by    TEXT NOT NULL,
    existing_body  TEXT NOT NULL,
    proposed_body  TEXT NOT NULL,
    status         TEXT NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES entries(id)
);

CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

export const VEC_TABLE_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS entries_vec USING vec0(
    entry_id TEXT PRIMARY KEY,
    embedding FLOAT[384]
);
`;

// Indexes that depend on columns added by migrations. Executed after migrate()
// so the columns exist regardless of whether the database was freshly created
// or upgraded from v1.
export const POST_MIGRATE_INDEXES = `
-- Canonical dedup key: features -> slug, aspects -> "<featureSlug>/<slug>".
-- Only active rows are unique so archived/superseded history can coexist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_topic_key_active
    ON entries(topic_key) WHERE topic_key IS NOT NULL AND status = 'active';
`;

export const SCHEMA_VERSION = '2';

// Migration from v1 to v2: introduces entries.topic_key + unique active index.
// Existing databases predate the column, so ALTER TABLE ADD COLUMN is required.
// The partial unique index is created afterwards and will fail if duplicates
// exist under the same topic_key — surfacing data problems rather than masking
// them. Callers should `reindex` after migrating to populate topic_key values.
export const MIGRATION_V1_TO_V2 = `
ALTER TABLE entries ADD COLUMN topic_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_topic_key_active
    ON entries(topic_key) WHERE topic_key IS NOT NULL AND status = 'active';
`;
