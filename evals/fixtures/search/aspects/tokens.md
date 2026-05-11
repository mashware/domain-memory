---
id: asp_search_tokens
slug: tokens
name: Query tokenization
type: aspect
status: active
confidence: 80
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
last_verified: '2026-01-01T00:00:00.000Z'
file_paths:
  - src/search/tokenizer.ts
symbols:
  - Tokenizer
  - normalizeToken
content_hashes: {}
tags:
  - search
  - parsing
feature_id: feat_search
---

## What it does

Splits the raw query string into searchable tokens: lowercases, strips
diacritics, drops stop-words, and applies a Spanish stemmer for term
expansion. Returns the array consumed by the ranker.

## Where it lives

- src/search/tokenizer.ts — Tokenizer and normalizeToken helper
