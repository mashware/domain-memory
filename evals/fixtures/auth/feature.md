---
id: feat_auth
slug: auth
name: Authentication
type: feature
status: active
confidence: 80
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
last_verified: '2026-01-01T00:00:00.000Z'
file_paths:
  - src/auth/index.ts
  - src/auth/session.ts
symbols:
  - AuthService
  - SessionStore
content_hashes: {}
tags:
  - security
  - identity
---

## What it does

Authentication owns user sign-in, session lifecycle, and credential
recovery. It exposes a single AuthService façade that the rest of the
application uses; concrete strategies (password, OAuth, JWT) live behind
it.

## Where it lives

- src/auth/index.ts — AuthService facade
- src/auth/session.ts — SessionStore
