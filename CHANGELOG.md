# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the project is pre-1.0, breaking changes can land on any minor
release. Patch releases are bug-fix-only.

## [Unreleased]

### Added
- Apache-2.0 license.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and GitHub
  issue / PR templates.
- GitHub Actions CI workflow replacing the previous GitLab CI pipeline.

### Changed
- README, design and schema docs translated to English for consistency.

### Removed
- `presentation/` directory (talk material moved out of the repo).
- `.gitlab-ci.yml` (replaced by GitHub Actions).

## [0.1.1] — 2026-05-12

### Fixed
- Initial publish only released `@mashware/domain-memory-server`
  because the npm token was scoped to that single package. This
  release publishes all three workspaces together.

## [0.1.0] — 2026-05-11

Initial public release.

### Added
- MCP stdio server exposing six tools: `search_knowledge`,
  `save_knowledge`, `resolve_topic_key`, `stage_finding`,
  `read_staging`, `check_drift`.
- Local-first storage: markdown on disk as the source of truth,
  SQLite as a derived index rebuildable with `domain-memory reindex`.
- Triple matcher fusing semantic embeddings (Transformers.js,
  MiniLM-L6-v2), BM25 (SQLite FTS5), and path/symbol exact match.
- Per-branch staging at `.domain-memory/staging/<branch>.jsonl`,
  surviving session compaction and browser restarts.
- Lazy confidence decay (−5 points every 30 days without verification).
- Drift detection via SHA-256 of referenced files, surfaced by the
  `check_drift` tool.
- CLI commands: `install`, `bootstrap`, `enrich`, `reindex`, `doctor`,
  `mode`, `verify`, `check-drift`, `web`, `http`, `decay`, `export`.
- HTTP API (`domain-memory http`) mirroring the MCP tools, with
  optional bearer-token auth.
- Read-only web viewer (`domain-memory web`) with dashboard, feature
  detail, aspects, stale list, and a Mermaid relation graph.
- Installer with idempotent pointer-block writers for Claude Code,
  Cursor, GitHub Copilot, Gemini CLI, and OpenCode.
- Eval suite with an adversarial corpus and per-machine regression
  detection (`evals/baseline.json`).

[Unreleased]: https://github.com/mashware/domain-memory/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/mashware/domain-memory/releases/tag/v0.1.1
[0.1.0]: https://github.com/mashware/domain-memory/releases/tag/v0.1.0
