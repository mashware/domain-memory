---
id: feat_search
slug: search
name: Search
type: feature
status: active
confidence: 80
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
last_verified: '2026-01-01T00:00:00.000Z'
file_paths:
  - src/search/index.ts
  - src/search/query-parser.ts
symbols:
  - SearchEngine
  - QueryParser
content_hashes: {}
tags:
  - search
  - indexing
---

## What it does

Full-text search over the product catalog. Parses the user query, applies
filters, and ranks results by a relevance score that mixes term frequency
with click-through history.

## Where it lives

- src/search/index.ts — SearchEngine
- src/search/query-parser.ts — QueryParser
