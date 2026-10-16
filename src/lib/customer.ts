// Customer identity.
//
// This app has no customers table: a customer is whatever distinct values the
// sales rows happen to carry. That makes the written form of a phone number
// load-bearing, because it is the only thing tying a person's bills together.
// "+919876543210", "9876543210", "98765 43210" and "09876543210" are one
// person typed four ways, and without normalising they become four customers
// in the CRM, each with a fraction of the history.

/**
 * The canonical stored form of an Indian mobile number: +91 followed by ten
 * digits. Anything that is not a recognisable ten-digit number is returned
 * trimmed but otherwise untouched - a landline or an eight-digit note is still
 * worth keeping, it just cannot be canonicalised.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, '');

  // Indian mobile numbers begin 6-9. That is what separates "09876543210"
  // (a mobile with a dialling zero) from "0512-2345678" (a Kanpur landline):
  // both are eleven digits starting with a zero, and only the first one is
  // ten significant digits with a prefix in front. Without this test the
  // landline would be rewritten as +915122345678 - a number nobody has.
  const mobile = (d: string) => d.length === 10 && /^[6-9]/.test(d);

  const ten =
    mobile(digits) ? digits
    : digits.length === 12 && digits.startsWith('91') && mobile(digits.slice(2)) ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') && mobile(digits.slice(1)) ? digits.slice(1)
    : digits.length === 13 && digits.startsWith('091') && mobile(digits.slice(3)) ? digits.slice(3)
    : null;

  return ten ? '+91' + ten : trimmed;
}

/**
 * The key two rows must share to be the same customer. Returns the ten
 * significant digits, so history saved before normalisation still folds in
 * with history saved after it. Null when there is no usable number, which is
 * the caller's signal that this row cannot be matched on phone at all.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  // Last ten digits: strips +91, 91, 0 and any other dialling prefix at once.
  return digits.slice(-10);
}

/**
 * Display name, collapsed whitespace. Deliberately NOT a matching key: two
 * people really can both be "Ramesh Kumar", and merging them would hand one
 * customer another's purchase history. Names are matched only as a last
 * resort, and only where no phone number exists on either side.
 */
export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ');
}

/** Uppercased, space-free GSTIN. The checksum format is validated at entry. */
export function normalizeGstin(raw: string | null | undefined): string | null {
  const v = (raw ?? '').replace(/\s/g, '').toUpperCase();
  return v || null;
}
