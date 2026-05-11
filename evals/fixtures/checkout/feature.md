---
id: feat_checkout
slug: checkout
name: Checkout
type: feature
status: active
confidence: 80
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
last_verified: '2026-01-01T00:00:00.000Z'
file_paths:
  - src/checkout/index.ts
  - src/checkout/cart.ts
symbols:
  - CheckoutController
  - CartService
content_hashes: {}
tags:
  - payments
  - revenue
---

## What it does

The checkout flow turns a populated cart into a paid order. It coordinates
the cart, payment provider, and invoice generation, and is the only path
that produces revenue events for downstream analytics.

## Where it lives

- src/checkout/index.ts — entry point
- src/checkout/cart.ts — cart aggregate
