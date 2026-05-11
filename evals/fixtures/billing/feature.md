---
id: feat_billing
slug: billing
name: Billing
type: feature
status: active
confidence: 80
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
last_verified: '2026-01-01T00:00:00.000Z'
file_paths:
  - src/billing/index.ts
  - src/billing/subscription.ts
symbols:
  - SubscriptionManager
  - DunningWorker
content_hashes: {}
tags:
  - billing
  - revenue
---

## What it does

Recurring billing for subscription plans. Tracks renewal cycles, applies
proration on plan changes, and runs the dunning worker that retries
failed charges before downgrading the customer.

## Where it lives

- src/billing/index.ts — SubscriptionManager
- src/billing/subscription.ts — DunningWorker
