// Core domain types for domain-memory storage.
// These mirror the schema in SCHEMA.md. Markdown files on disk are the
// source of truth; SQLite is a derived index. Keep these types in sync
// with the frontmatter fields and the SQL tables.

export type EntryType = 'feature' | 'aspect';
export type EntryStatus = 'active' | 'archived' | 'superseded';
export type RelationKind = 'depends_on' | 'triggers' | 'related_to';

export type FindingSource =
  | 'user_explained'
  | 'inferred_from_code'
  | 'inferred_from_tests'
  | 'user_correction';

export interface EntryRelations {
  depends_on?: string[];
  triggers?: string[];
  related_to?: string[];
}

export interface EntryFrontmatter {
  id: string;
  slug: string;
  name: string;
  type: EntryType;
  status: EntryStatus;
  superseded_by?: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
  last_verified: string;
  file_paths: string[];
  symbols: string[];
  content_hashes: Record<string, string>;
  relations?: EntryRelations;
  tags: string[];
  feature_id?: string;
}

export interface EntryBody {
  what: string;
  flow_mermaid: string | null;
  where: string;
}

export interface Entry {
  frontmatter: EntryFrontmatter;
  body: EntryBody;
}

export interface StagedFinding {
  id: string;
  ts: string;
  topic: {
    feature_hint: string;
    aspect_hint?: string;
  };
  finding: string;
  file_paths: string[];
  symbols: string[];
  source: FindingSource;
  session_id: string;
  client: string;
}

// Drift status for a candidate's referenced files. Computed by hashing the
// current file and comparing against the hash stored in the entry frontmatter
// when it was last saved. Lets the agent skip redundant verification when the
// entry's files haven't changed, and focus only on the ones that did.
export interface CandidateDrift {
  // 'fresh'   → every file with a stored hash still matches disk.
  // 'drifted' → at least one file changed or disappeared; check `drifted_files`
  //             and `missing_files` to know which.
  // 'unknown' → no comparable hashes (entry points only to directories, or
  //             was saved before hashes were stored).
  status: 'fresh' | 'drifted' | 'unknown';
  drifted_files: string[];
  missing_files: string[];
}

export interface SearchCandidate {
  id: string;
  type: EntryType;
  name: string;
  feature_id: string | null;
  feature_name: string | null;
  summary: string;
  confidence: number;
  status: EntryStatus;
  last_verified: string;
  scores: {
    embedding: number;
    bm25: number;
    path: number;
    combined: number;
  };
  match_reasons: string[];
  content_path: string;
  drift: CandidateDrift;
}
