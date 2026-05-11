# Security Policy

## Reporting a vulnerability

If you find a security issue in Domain Memory, please report it
**privately**. Public issues for security bugs put users at risk before
a fix is available.

### Preferred channel

Use GitHub's private vulnerability reporting:

1. Open https://github.com/mashware/domain-memory/security/advisories
2. Click **"Report a vulnerability"**
3. Fill in the form with as much detail as you can share.

This gives us a private discussion thread, a draft advisory, and an
optional CVE if the issue warrants one.

### Fallback

If GitHub Security Advisories is not available to you, email
**mashware@gmail.com** with:

- A clear description of the issue and its impact.
- Steps to reproduce, ideally with a minimal proof-of-concept.
- Your name and any preferred attribution (or a request to stay
  anonymous in the published advisory).

Please **do not** include exploitation details on a public issue, a
public PR, or a public Discord/Slack/forum thread before the fix has
shipped.

---

## What we'll do

- We aim to acknowledge a report within **5 business days**.
- We will keep you in the loop while we investigate and develop a fix.
- Once a patch is ready, we coordinate disclosure with you: published
  advisory, CVE if applicable, credit in the changelog and the
  advisory (unless you've asked to remain anonymous).
- Expected resolution timelines:
  - Critical: target fix in **7 days**.
  - High: target fix in **30 days**.
  - Medium / low: scheduled into a normal release.

---

## Scope

Domain Memory is **local-first software**. The MCP server runs on the
developer's machine, reads files in the project tree, and exposes an
optional HTTP API on `127.0.0.1` (which can be put behind a bearer
token via `DOMAIN_MEMORY_HTTP_TOKEN`).

In scope:

- The `@domain-memory/server` MCP and HTTP surfaces.
- The `@domain-memory/cli` install flow (it writes files into the user's
  project — anything that escapes the project root is in scope).
- The `@domain-memory/web` viewer when bound to `0.0.0.0` or exposed
  via a tunnel.
- Path traversal, prompt-injection-as-persistence, dependency
  vulnerabilities surfaced by `npm audit`.

Out of scope (interesting but not security issues for this project):

- Issues that require the attacker to already have shell access on
  the developer's machine.
- Social-engineering scenarios where the developer is convinced to
  paste malicious content into their own knowledge store. The store
  is treated as trusted input — that is part of the threat model.
- Vulnerabilities in transitive dependencies that we cannot fix
  without an upstream release. We will track these but the upstream
  is the right place to file them.

---

## Supported versions

Domain Memory is pre-1.0. Only the latest tagged version receives
security fixes. If you need a patch on an older version, please open
an issue and we'll discuss case by case.

| Version | Supported |
|---------|-----------|
| `0.x` (latest) | ✅ |
| Older `0.x`    | ❌ |
