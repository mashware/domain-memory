---
id: asp_auth_jwt
slug: jwt
name: JWT validation
type: aspect
status: active
confidence: 80
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
last_verified: '2026-01-01T00:00:00.000Z'
file_paths:
  - src/auth/jwt.ts
symbols:
  - JwtValidator
  - decodeBearerToken
content_hashes: {}
tags:
  - security
  - tokens
feature_id: feat_auth
---

## What it does

Verifies bearer tokens on every API request: signature, expiration,
audience, and issuer. Caches public keys from the IdP's JWKS endpoint
and rotates them when a kid mismatch is detected.

## Where it lives

- src/auth/jwt.ts — JwtValidator and decodeBearerToken helper
