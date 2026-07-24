/**
 * GST Calculation Utility — Medstocksy
 *
 * Indian GST Standard (matches MARG ERP, Tally Prime, Busy, Zoho Books):
 *
 * EXCLUSIVE  — entered price is BEFORE tax
 *   taxable  = price
 *   gst      = taxable × rate / 100
 *   total    = taxable + gst
 *
 * INCLUSIVE  — entered price ALREADY contains tax
 *   taxable  = price / (1 + rate / 100)
 *   gst      = price − taxable  =  (price × rate) / (100 + rate)
 *   total    = price  (customer pays exactly the entered price)
 */

export interface GstResult {
  /** Extracted / added GST amount */
  gstAmount: number;
  /** What the customer pays (inclusive → same as input; exclusive → input + gst) */
  totalPrice: number;
  /** Base before GST (taxable value) */
  taxableValue: number;
}

/**
 * Calculate GST for a single line value (after discounts have been applied).
 *
 * @param netValue   - The amount after all discounts.
 *                     For EXCLUSIVE this is the taxable base.
 *                     For INCLUSIVE this is the all-in price (tax already baked in).
 * @param rate       - GST rate in percent (e.g. 18 for 18%).
 * @param inclusive  - true → Inclusive mode; false → Exclusive mode.
 */
export function calcGst(netValue: number, rate: number, inclusive: boolean): GstResult {
  if (rate <= 0 || netValue <= 0) {
    return { gstAmount: 0, totalPrice: netValue, taxableValue: netValue };
  }

  if (inclusive) {
    // Extract GST that is already embedded in the price
    // Formula: GST = (price × rate) / (100 + rate)
    const gstAmount = (netValue * rate) / (100 + rate);
    const taxableValue = netValue - gstAmount;
    return { gstAmount, totalPrice: netValue, taxableValue };
  }

  // Exclusive: add GST on top
  const gstAmount = (netValue * rate) / 100;
  return { gstAmount, totalPrice: netValue + gstAmount, taxableValue: netValue };
}
