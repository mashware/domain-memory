---
id: asp_checkout_stripe
slug: stripe
name: Stripe integration
type: aspect
status: active
confidence: 80
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
last_verified: '2026-01-01T00:00:00.000Z'
file_paths:
  - src/checkout/stripe.ts
  - src/checkout/stripe-webhook.ts
symbols:
  - StripeClient
  - StripeWebhookHandler
content_hashes: {}
tags:
  - payments
  - integration
feature_id: feat_checkout
---

## What it does

Charges customers' credit cards via Stripe. Handles the PaymentIntent
lifecycle, listens for webhook events to confirm captures and refunds,
and maps Stripe failure codes to our domain-level errors.

## Where it lives

- src/checkout/stripe.ts — client wrapper
- src/checkout/stripe-webhook.ts — webhook receiver
