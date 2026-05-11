---
id: asp_billing_stripe_subscriptions
slug: stripe-subscriptions
name: Stripe subscriptions
type: aspect
status: active
confidence: 80
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
last_verified: '2026-01-01T00:00:00.000Z'
file_paths:
  - src/billing/stripe-subscriptions.ts
symbols:
  - SubscriptionSyncer
  - handleInvoicePaid
content_hashes: {}
tags:
  - billing
  - stripe
feature_id: feat_billing
---

## What it does

Mirrors Stripe Subscription objects into our local plan ledger and
reacts to invoice.paid / invoice.payment_failed webhooks. Distinct from
checkout/stripe, which only handles one-off purchase PaymentIntents.

## Where it lives

- src/billing/stripe-subscriptions.ts — SubscriptionSyncer and handleInvoicePaid
