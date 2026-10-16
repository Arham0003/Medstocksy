import { describe, it, expect } from 'vitest';
import { normalizePhone, phoneKey, normalizeName, normalizeGstin } from '../customer';

// A customer in this app is whatever the sales rows say. These rules decide
// whose bills end up together, so they are worth pinning down.

describe('normalizePhone', () => {
  it('stores every written form of one number the same way', () => {
    const forms = ['9876543210', '+919876543210', '91 98765 43210',
                   '098765 43210', '+91-98765-43210', '  9876543210  '];
    for (const f of forms) expect(normalizePhone(f)).toBe('+919876543210');
  });

  it('leaves blank input as null rather than inventing a number', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('keeps anything it cannot canonicalise instead of discarding it', () => {
    // A landline or a half-remembered number is still worth having on the bill.
    expect(normalizePhone('0512-2345678')).toBe('0512-2345678');
    expect(normalizePhone('12345')).toBe('12345');
  });
});

describe('phoneKey', () => {
  it('folds history saved before and after normalisation into one customer', () => {
    const before = phoneKey('9876543210');       // typed bare, saved raw
    const after = phoneKey('+919876543210');     // saved canonically
    expect(before).toBe(after);
    expect(before).toBe('9876543210');
  });

  it('keeps genuinely different numbers apart', () => {
    expect(phoneKey('9876543210')).not.toBe(phoneKey('9876543211'));
  });

  it('refuses to match on something too short to identify anyone', () => {
    expect(phoneKey('12345')).toBeNull();
    expect(phoneKey('')).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});

describe('normalizeName', () => {
  it('tidies spacing for display', () => {
    expect(normalizeName('  Ramesh   Kumar ')).toBe('Ramesh Kumar');
  });

  it('is not an identity: two people may share a name', () => {
    // Documents the rule the CRM relies on. Names are never a matching key,
    // because merging two Ramesh Kumars hands one of them the other's history.
    const a = normalizeName('Ramesh Kumar');
    const b = normalizeName('Ramesh Kumar');
    expect(a).toBe(b);
    expect(phoneKey('9876543210')).not.toBe(phoneKey('9000000000'));
  });
});

describe('normalizeGstin', () => {
  it('stores one case and no spaces', () => {
    expect(normalizeGstin(' 09aaack5555k1z5 ')).toBe('09AAACK5555K1Z5');
  });
  it('treats blank as absent', () => {
    expect(normalizeGstin('')).toBeNull();
  });
});
