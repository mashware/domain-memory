---
id: feat_invoicing
slug: invoicing
name: Invoicing
type: feature
status: active
confidence: 80
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
last_verified: '2026-01-01T00:00:00.000Z'
file_paths:
  - src/invoicing/index.ts
  - src/invoicing/tax-service.ts
symbols:
  - InvoiceGenerator
  - TaxServiceClient
content_hashes: {}
tags:
  - billing
  - compliance
---

## What it does

Generates and delivers invoices for completed orders. Pushes line items
to the tax service for compliant invoice numbering and EU sales reports,
then emails the resulting PDF to the buyer.

## Where it lives

- src/invoicing/index.ts — InvoiceGenerator
- src/invoicing/tax-service.ts — TaxServiceClient
