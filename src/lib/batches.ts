import { db } from '@/lib/supabaseLoose';

export interface StockBatch {
  id: string;
  batch_number: string;
  expiry_date: string;      // YYYY-MM-DD
  qty_available: number;
  mrp: number;
  gst_rate: number;
  effective_cost: number;
  hsn_code: string | null;
}

/**
 * Days of shelf life a batch must still have to be sellable.
 *
 * 0 keeps the plan's default: block only genuinely expired stock. Raise this
 * to 90 to enforce the Schedule M quarantine window — it is passed straight
 * through to deduct_fefo(), so the UI and the database agree.
 */
export const EXPIRY_QUARANTINE_DAYS = 0;

const isoDaysFromNow = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Sellable batches for a product, nearest expiry first (FEFO).
 *
 * Returns [] both when the product genuinely has no batches and when the
 * stock_batches table has not been migrated yet — callers fall back to the
 * product-level batch fields in either case, so billing never blocks on this.
 */
export async function fetchFefoBatches(
  accountId: string,
  productId: string,
): Promise<StockBatch[]> {
  const { data, error } = await db
    .from('stock_batches')
    .select('id, batch_number, expiry_date, qty_available, mrp, gst_rate, effective_cost, hsn_code')
    .eq('account_id', accountId)
    .eq('product_id', productId)
    .gt('qty_available', 0)
    .gte('expiry_date', isoDaysFromNow(EXPIRY_QUARANTINE_DAYS))
    .order('expiry_date', { ascending: true });

  if (error) return [];
  return (data ?? []) as StockBatch[];
}

/**
 * Take units out of the batch ledger for a sale.
 *
 * With no batch named, deduct_fefo() picks batches oldest-expiry-first and
 * refuses to touch expired or quarantined stock. With one named (the counter
 * staff overrode the suggestion) the units come off that batch specifically.
 *
 * Never throws: products.quantity is maintained separately by the sales
 * trigger, so a ledger hiccup must not fail a completed sale. The caller
 * gets a message back and surfaces it as a warning.
 */
export async function consumeBatchStock(params: {
  accountId: string;
  productId: string;
  batchNumber?: string | null;
  qty: number;
}): Promise<{ ok: boolean; message?: string }> {
  const { accountId, productId, batchNumber, qty } = params;
  if (!qty || qty <= 0) return { ok: true };

  if (batchNumber) {
    const { error } = await db.rpc('adjust_batch_stock', {
      p_account_id: accountId,
      p_product_id: productId,
      p_batch_number: batchNumber,
      p_delta: -qty,
    });
    return error ? { ok: false, message: error.message } : { ok: true };
  }

  const { error } = await db.rpc('deduct_fefo', {
    p_account_id: accountId,
    p_product_id: productId,
    p_qty_needed: qty,
    p_quarantine_days: EXPIRY_QUARANTINE_DAYS,
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}
