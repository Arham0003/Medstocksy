import { describe, it, expect } from 'vitest';
import { decideWholesaleAccess, planHasWholesale } from '@/lib/wholesaleAccess';

// Who gets wholesale, as a truth table.
//
// The bug this pins down: settings.wholesale_mode is NOT NULL DEFAULT FALSE
// and nothing in the application ever wrote it, so every paying subscriber
// read false and was redirected to /pricing - a page selling what they had
// already bought.

const ACTIVE_WHOLESALE = { status: 'active', plan_type: 'professional_wholesale_monthly' };
const ACTIVE_RETAIL = { status: 'active', plan_type: 'professional_monthly' };
const EXPIRED_WHOLESALE = { status: 'expired', plan_type: 'wholesale_monthly' };

const NO_SETTINGS_ERROR = null;
const COLUMN_MISSING = { code: '42703', message: 'column settings.wholesale_mode does not exist' };

describe('planHasWholesale', () => {
  it('recognises the plans that include wholesale', () => {
    expect(planHasWholesale('wholesale_monthly')).toBe(true);
    expect(planHasWholesale('wholesale_annual')).toBe(true);
    expect(planHasWholesale('professional_wholesale_monthly')).toBe(true);
    expect(planHasWholesale('trial_wholesale_14d')).toBe(true);
    expect(planHasWholesale('  WHOLESALE_MONTHLY  ')).toBe(true);
  });

  it('does not hand wholesale to a retail plan', () => {
    expect(planHasWholesale('professional_monthly')).toBe(false);
    expect(planHasWholesale('basic')).toBe(false);
    expect(planHasWholesale('')).toBe(false);
    expect(planHasWholesale(null)).toBe(false);
  });
});

describe('decideWholesaleAccess - a paying subscriber', () => {
  it('gets wholesale on a database without the toggle column', () => {
    // This is the reported case: an active Professional + Wholesale plan, and
    // a database that has not taken 20260918000000.
    const access = decideWholesaleAccess({
      subscription: ACTIVE_WHOLESALE,
      settingsRow: null,
      settingsError: COLUMN_MISSING,
      isAdmin: false,
    });
    expect(access.hasPlan).toBe(true);
    expect(access.isActive).toBe(true);        // was false: the whole bug
    expect(access.needsMigration).toBe(true);
  });

  it('gets wholesale when the column exists and is on', () => {
    const access = decideWholesaleAccess({
      subscription: ACTIVE_WHOLESALE,
      settingsRow: { wholesale_mode: true },
      settingsError: NO_SETTINGS_ERROR,
      isAdmin: false,
    });
    expect(access.isActive).toBe(true);
    expect(access.needsMigration).toBe(false);
  });

  it('can still switch it off deliberately', () => {
    const access = decideWholesaleAccess({
      subscription: ACTIVE_WHOLESALE,
      settingsRow: { wholesale_mode: false },
      settingsError: NO_SETTINGS_ERROR,
      isAdmin: false,
    });
    // Entitled, but choosing not to show it - and the pages send someone in
    // this state to Settings rather than to Pricing.
    expect(access.hasPlan).toBe(true);
    expect(access.isActive).toBe(false);
  });
});

describe('decideWholesaleAccess - entitlement is not weakened', () => {
  it('denies an account with no subscription at all', () => {
    const access = decideWholesaleAccess({
      subscription: null, settingsRow: null, settingsError: COLUMN_MISSING, isAdmin: false,
    });
    expect(access.hasPlan).toBe(false);
    expect(access.isActive).toBe(false);
  });

  it('denies a retail plan, even with the toggle on', () => {
    const access = decideWholesaleAccess({
      subscription: ACTIVE_RETAIL,
      settingsRow: { wholesale_mode: true },
      settingsError: NO_SETTINGS_ERROR,
      isAdmin: false,
    });
    expect(access.hasPlan).toBe(false);
    expect(access.isActive).toBe(false);
  });

  it('denies an expired wholesale plan', () => {
    const access = decideWholesaleAccess({
      subscription: EXPIRED_WHOLESALE,
      settingsRow: { wholesale_mode: true },
      settingsError: NO_SETTINGS_ERROR,
      isAdmin: false,
    });
    expect(access.isActive).toBe(false);
  });

  it('denies a retail plan on an un-migrated database', () => {
    // The place a careless fix would leak the feature: no column to read, so
    // nothing to say no. The subscription still has to.
    const access = decideWholesaleAccess({
      subscription: ACTIVE_RETAIL, settingsRow: null, settingsError: COLUMN_MISSING, isAdmin: false,
    });
    expect(access.isActive).toBe(false);
  });
});

describe('decideWholesaleAccess - platform admins', () => {
  it('owns the product, so does not buy it', () => {
    const access = decideWholesaleAccess({
      subscription: null, settingsRow: { wholesale_mode: true },
      settingsError: NO_SETTINGS_ERROR, isAdmin: true,
    });
    expect(access.hasPlan).toBe(true);
    expect(access.isActive).toBe(true);
    expect(access.viaAdmin).toBe(true);
  });

  it('is not flagged as admin-granted when they also pay', () => {
    const access = decideWholesaleAccess({
      subscription: ACTIVE_WHOLESALE, settingsRow: { wholesale_mode: true },
      settingsError: NO_SETTINGS_ERROR, isAdmin: true,
    });
    expect(access.viaAdmin).toBe(false);
  });
});
