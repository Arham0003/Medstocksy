// Wholesale entitlement rules, kept free of any Supabase import so they can be
// read - and tested - on their own. The hook does the fetching and hands the
// three answers to decideWholesaleAccess below.

export interface WholesaleAccess {
  /** Entitled to wholesale: an active wholesale plan, OR a platform admin. */
  hasPlan: boolean;
  isActive: boolean;
  loading: boolean;
  /** True when entitlement comes from being a platform admin, not a purchase. */
  viaAdmin: boolean;
  /** Set when the wholesale columns are not installed yet. */
  needsMigration: boolean;
}

/**
 * Mirrors public.plan_has_wholesale() in SQL. Paid wholesale plans, plus
 * wholesale trials granted from the admin panel. Keep the two in step.
 */
export const planHasWholesale = (plan: string | null | undefined): boolean => {
  if (!plan) return false;
  const p = plan.trim().toLowerCase();
  return (
    p === 'wholesale_monthly' ||
    p === 'wholesale_annual' ||
    p.includes('wholesale') ||
    p.startsWith('trial_wholesale')
  );
};

/** What the three reads produced, as the decision below needs them. */
export interface WholesaleInputs {
  subscription: { status?: string | null; plan_type?: string | null } | null;
  settingsRow: { wholesale_mode?: boolean } | null;
  settingsError: { code?: string; message?: string } | null;
  isAdmin: boolean;
}

/**
 * Pure so the entitlement rules can be read, and tested, as a truth table.
 *
 * The subscription IS the entitlement - exactly what the RESTRICTIVE policy on
 * sales checks before admitting a wholesale row. wholesale_mode sits on top as
 * a display preference, for an account that does not sell wholesale.
 *
 * Which is why its absence cannot mean "denied". The column arrives with
 * 20260918000000 and nothing in the app ever wrote it, so on any database
 * without that migration it read false for everyone - and a paying subscriber
 * was redirected to a pricing page for what they had already bought. With no
 * stored preference, show it.
 */
export function decideWholesaleAccess(input: WholesaleInputs): WholesaleAccess {
  const { subscription, settingsRow, settingsError, isAdmin } = input;

  const paidPlan =
    subscription?.status === 'active' && planHasWholesale(subscription?.plan_type);

  const hasWholesaleCol = settingsRow != null && 'wholesale_mode' in settingsRow;
  const needsMigration =
    !hasWholesaleCol &&
    (settingsError?.code === '42703' ||
      Boolean(settingsError?.message?.toLowerCase().includes('wholesale_mode')));

  const hasPlan = paidPlan || isAdmin;
  const showWholesale = hasWholesaleCol ? Boolean(settingsRow?.wholesale_mode) : true;

  return {
    hasPlan,
    isActive: hasPlan && showWholesale,
    loading: false,
    viaAdmin: isAdmin && !paidPlan,
    needsMigration,
  };
}
