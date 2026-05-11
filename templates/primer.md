# Project primer

> This file is served as MCP `instructions` on every agent connection.
> Keep it short (1–2 pages max). Put **stable** project context here;
> anything that churns belongs in knowledge entries.
>
> Replace the `<placeholders>` and delete the italic hints once you no
> longer need them. Drop sections that do not apply.

## What this is

<One or two sentences. What is the product, what problem does it solve, for whom.>

*Example: "Customer support platform that tracks ticket lifecycle from creation to resolution. SaaS product aimed at support teams handling inbound requests across multiple channels."*

## Users

- **<role/segment>**: <what they do with the product>.
- **<other role>**: <what they do>.

*Important so the agent understands the context behind decisions. If there is only one type of user, keep it on a single line.*

## Main modules / domains

- **<module>** — <why it exists, not how it is implemented>.
- **<module>** — <intent>.
- **<module>** — <intent>.

*The rule: describe **intent**, not implementation. If the code already says it, don't repeat it here. What does belong: why this module is separate, what its responsibility is, how it relates to the others.*

## Invariants / constraints

- <a rule that is NEVER broken — legal, technical, business>.
- <a rule that is NEVER broken>.

*These are the rules of the game: things the agent must assume without asking. E.g.: "all payments go through Stripe", "we never store raw user content beyond 30 days due to retention policy", "workers are idempotent — they can be re-run with no side effects".*

## External stakeholders / integrations

- **<service>** — <what we use it for, what makes it special>.

*Only integrations whose "why" is non-obvious. If you use Postgres as a database, no need to list it.*

## Glossary

- **<term>** — <what it means in this project>.
- **<term>** — <what it means>.

*Business-domain terms only, not implementation jargon. Things a new developer wouldn't know even if they were fluent in the language.*

## Stack (optional)

<Language, framework, runtime, key build/test commands if useful to the agent.>

*Only if it adds value not already in CLAUDE.md or the README. If the README says it, don't duplicate.*
