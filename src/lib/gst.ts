// GST + inventory costing helpers.
//
// Single home for the arithmetic that has to agree between the POS, the
// printed invoice, the returns screens and the database functions. If a
// formula here changes, the matching SQL in supabase/migrations must change
// with it.

/** Two-digit GST state codes (as published by the GST Council). */
export const GST_STATE_CODES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
];

export const stateNameForCode = (code?: string | null) =>
  GST_STATE_CODES.find((s) => s.code === code)?.name ?? '';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface GstSplit {
  taxable: number;
  rate: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  /** taxable + total tax */
  gross: number;
}

/**
 * Split a tax amount into CGST/SGST or IGST.
 *
 * The store's `is_interstate_billing` flag decides which, account-wide —
 * there is deliberately no per-bill override. SGST absorbs the odd paise so
 * CGST + SGST always adds back to the total exactly; the same rule is
 * applied in the SQL functions.
 */
export const splitGst = (
  taxableValue: number,
  rate: number,
  isInterstate = false,
): GstSplit => {
  const taxable = round2(taxableValue);
  const gstRate = Number(rate) || 0;
  const total = round2((taxable * gstRate) / 100);

  if (isInterstate) {
    return { taxable, rate: gstRate, cgst: 0, sgst: 0, igst: total, total, gross: round2(taxable + total) };
  }
  const cgst = round2(total / 2);
  return { taxable, rate: gstRate, cgst, sgst: round2(total - cgst), igst: 0, total, gross: round2(taxable + total) };
};

/**
 * Apportion a tax amount that has already been calculated.
 *
 * Use this rather than splitGst wherever the tax is derived from a
 * discounted line total — recomputing taxable x rate there would drift from
 * the figure actually charged. SGST absorbs the odd paise, matching the SQL.
 */
export const apportionGst = (taxAmount: number, isInterstate = false) => {
  const total = round2(taxAmount);
  if (isInterstate) return { cgst: 0, sgst: 0, igst: total };
  const cgst = round2(total / 2);
  return { cgst, sgst: round2(total - cgst), igst: 0 };
};

/**
 * Back the tax out of a GST-inclusive amount (MRP-based pharma billing) or
 * add it on top of an exclusive one.
 */
export const splitGstFromGross = (
  amount: number,
  rate: number,
  gstType: 'inclusive' | 'exclusive',
  isInterstate = false,
): GstSplit => {
  const gstRate = Number(rate) || 0;
  const value = Number(amount) || 0;
  const taxable = gstType === 'inclusive' ? (value * 100) / (100 + gstRate) : value;
  return splitGst(taxable, gstRate, isInterstate);
};

/**
 * Landed cost per saleable unit.
 *
 * Trade discount reduces what is paid; free goods increase what is received.
 * Both belong in COGS, otherwise margin on a free-goods scheme reads high.
 * Mirrors add_stock_batch() in SQL.
 *
 *   10 units @ 100, 1 free  ->  1000 / 11  =  90.9091
 */
export const computeEffectiveCost = (
  qty: number,
  invoiceRate: number,
  discountPct = 0,
  freeQty = 0,
): number => {
  const q = Number(qty) || 0;
  const free = Number(freeQty) || 0;
  const units = q + free;
  if (units <= 0) return 0;
  return (q * (Number(invoiceRate) || 0) * (1 - (Number(discountPct) || 0) / 100)) / units;
};

/** Days until a batch expires. Negative once it has expired. */
export const daysToExpiry = (expiry: string | Date | null | undefined): number | null => {
  if (!expiry) return null;
  const d = new Date(expiry);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
};

/** Compact MM/YYYY expiry, the form printed on a medicine pack. */
export const formatExpiryShort = (expiry: string | Date | null | undefined): string => {
  if (!expiry) return '—';
  const d = new Date(expiry);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export type ExpiryStatus = 'expired' | 'critical' | 'warning' | 'ok';

/**
 * Shelf-life banding used by the batch picker and the expiry report.
 * 90 days is the Schedule M quarantine window the plan calls out.
 */
export const expiryStatus = (expiry: string | Date | null | undefined): ExpiryStatus => {
  const days = daysToExpiry(expiry);
  if (days === null) return 'ok';
  if (days < 0) return 'expired';
  if (days <= 30) return 'critical';
  if (days <= 90) return 'warning';
  return 'ok';
};
