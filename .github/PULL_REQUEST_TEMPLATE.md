<!--
Thanks for the PR. Please fill in the sections below. PRs without
context are hard to review and tend to sit.
-->

## What

<!-- One or two sentences. What does this change do, in plain language? -->

## Why

<!--
Motivation. What were you trying to accomplish? If this fixes a bug,
link the issue. If this implements a feature, link the discussion or
issue where the design was agreed.

Closes #
-->

## How

<!--
Brief tour of the diff. Anything non-obvious in the approach? Any
trade-offs the reviewer should know about?
-->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test --workspaces --if-present` passes
- [ ] `npm run evals` does not regress (or `evals/baseline.json` is updated with justification)
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] `DESIGN.md` updated if an architectural rule changed
- [ ] `SCHEMA.md` updated if the on-disk format or tool payloads changed
- [ ] No new dependencies, or the new dependencies are justified in the PR body

## Screenshots / output

<!-- Optional. CLI output, web viewer screenshots, etc. -->
