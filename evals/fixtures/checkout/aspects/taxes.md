---
id: asp_checkout_taxes
slug: taxes
name: Tax calculation
type: aspect
status: active
confidence: 80
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
last_verified: '2026-01-01T00:00:00.000Z'
file_paths:
  - src/checkout/taxes.ts
symbols:
  - TaxCalculator
  - VatRule
content_hashes: {}
tags:
  - taxes
  - compliance
feature_id: feat_checkout
---

## What it does

Computes VAT and sales tax for each line item based on the buyer country,
the seller's tax registrations, and EU reverse-charge rules. Falls back
to a flat rate when the destination country is unsupported.

## Where it lives

- src/checkout/taxes.ts — TaxCalculator and VatRule
