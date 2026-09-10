# Lean Compliance Build — Run Order

Implements the Revised Lean Compliance Plan: batch-level stock (FEFO), HSN-driven
GST rates, CGST/SGST split on sales, ITC reversal on purchase returns, and
expired-return routing.

**Nothing here has been run against a database.** Take a Supabase backup before
starting — Migration 2 creates the table the rest of the build depends on.

## Decisions taken

| Question | Decision |
|---|---|
| Q1 — existing stock | **Fresh start.** Current `products.quantity` is frozen into one `OPENING` batch per product (Migration 2b). |
| Q2 — interstate billing | **No.** `accounts.is_interstate_billing` defaults to `false`, so every bill is CGST + SGST. The toggle is in Settings → Store Info if that ever changes. Account-wide; no per-bill override. |
| Expiry quarantine | Guard is **on** (never sell expired). The 90-day Schedule M buffer is **off**, per the plan. To enable: set `EXPIRY_QUARANTINE_DAYS = 90` in `src/lib/batches.ts` — it is passed to `deduct_fefo`, so UI and database stay in agreement. |

## SQL run order

Run in this order in the Supabase SQL editor. Each file is idempotent.

| # | File | What it does |
|---|---|---|
| 1 | `supabase/migrations/20260910000000_create_hsn_codes.sql` | `hsn_codes` table, `accounts.state_code`, `accounts.is_interstate_billing` |
| 2 | `supabase/migrations/20260910100000_create_stock_batches.sql` | `stock_batches` — the FEFO ledger. **Back up first.** |
| 3 | `supabase/migrations/20260910150000_backfill_opening_stock_batches.sql` | Freezes existing stock as `OPENING` batches |
| 4 | `supabase/migrations/20260910200000_add_gst_split_columns.sql` | GST-split columns on `sales`, ITC columns on `purchase_returns` |
| 5 | `supabase/migrations/20260910250000_create_add_stock_batch.sql` | `add_stock_batch()` — inward stock + `effective_cost` |
| 6 | `supabase/migrations/20260910300000_create_deduct_fefo.sql` | `deduct_fefo()` — FEFO consumption + expiry guard |
| 7 | `supabase/migrations/20260910320000_create_adjust_batch_stock.sql` | `adjust_batch_stock()` — shared ledger helper |
| 8 | `supabase/migrations/20260910350000_purchase_return_itc_and_batches.sql` | ITC reversal on purchase returns |
| 9 | `supabase/migrations/20260910400000_patch_sales_return.sql` | `record_sales_return()` + patched stock trigger |
| 10 | `supabase/seed_hsn_codes.sql` | Seeds common pharma HSN codes (one-time DML, safe to re-run) |

After running, regenerate the Supabase types and delete the escape hatch:

```
npx supabase gen types typescript --project-id <id> > src/integrations/supabase/types.ts
```

`src/lib/supabaseLoose.ts` exists only because `types.ts` predates these tables.
It already lagged the schema before this work (no `purchase_returns`, no
`bill_id`, no `payment_mode`).

## Where the two stock numbers live

`products.quantity` stays the aggregate the existing UI reads, maintained by the
`update_product_stock` trigger on `sales`. `stock_batches.qty_available` is the
per-batch ledger underneath it, maintained by `add_stock_batch`, `deduct_fefo`
and `adjust_batch_stock`. They are kept in step deliberately rather than merged,
so no existing screen had to be rewritten.

A batch-ledger failure never fails a committed sale — the bill saves and a
warning toast names the problem. Reconcile with:

```sql
SELECT p.id, p.name, p.quantity, COALESCE(SUM(b.qty_available), 0) AS batched
FROM products p LEFT JOIN stock_batches b ON b.product_id = p.id
GROUP BY p.id, p.name, p.quantity
HAVING p.quantity <> COALESCE(SUM(b.qty_available), 0);
```

## Verification

```sql
-- Effective cost must account for free goods (10+1 @ 100 -> 90.9091)
SELECT batch_number, qty_purchased, qty_free, invoice_rate, effective_cost,
       (qty_purchased * invoice_rate) / (qty_purchased + qty_free) AS expected
FROM stock_batches WHERE qty_free > 0;

-- FEFO order: row 1 is always what sells next
SELECT batch_number, expiry_date, qty_available
FROM stock_batches
WHERE product_id = '<product_id>' AND qty_available > 0
ORDER BY expiry_date ASC;
```

In the app:

1. Add a product: qty 10, free 1, rate ₹100 → the form shows **₹90.91** effective cost; the batch stores the same.
2. Bill 1 unit → the batch picker defaults to the nearest expiry; `qty_available` drops on that batch.
3. Sales return marked **Expired** → neither `products.quantity` nor `qty_available` increases.
4. Sales return marked **Salable** → both increase.
5. Print the bill → per-line CGST/SGST plus the HSN-wise tax summary.
6. Purchase return with a GST rate → the ITC reversal figure shows before confirming.

## Deviations from the plan

The plan was written against a different checkout
(`e:/Pivot New Work/Medstocksy-inventory-10-05-2026/...`). Four things did not
map, and were changed deliberately:

1. **B1 has no target here.** There is no `purchase_headers`, `purchase_items`, or
   `record_purchase` RPC in this repo — stock is taken in by creating/editing a
   `products` row. The same logic lives in `add_stock_batch()`, called from the
   product form.
2. **C3 has no target here.** `Pricing.tsx` in this repo is the Razorpay
   subscription page. The effective-cost field went into the product form
   (`Products.tsx`) instead, alongside new Free Qty and Trade Discount inputs.
3. **B3 sign correction.** The plan restores stock on a purchase return
   (`qty_available + p_quantity`). A purchase return sends goods *back to the
   supplier*, so the ledger is decremented, matching the existing
   `products.quantity - p_quantity`.
4. **B2 ambiguity fix.** The plan's `deduct_fefo` selects bare `effective_cost` /
   `gst_rate` while OUT parameters of those names are in scope — Postgres
   rejects that as ambiguous. The table is aliased and every column qualified.

Two additions the plan did not cover but this codebase needs:

- **The stock trigger had to be patched.** `update_product_stock` fires on every
  `sales` insert and unconditionally restores stock on a negative quantity. It
  now skips `return_type IN ('expired','damaged')` — without this the write-off
  would silently go back on the shelf.
- **`sales.returned_from_sale_id`** links a return to the line it reverses, so
  over-returning is rejected in the database rather than only in the UI.

## Still out of scope

Per the plan: double-entry journal, chart of accounts, per-sale place of supply,
GSTR-1 JSON export.
