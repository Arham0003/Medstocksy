import { useEffect, useState } from 'react';
import { db } from '@/lib/supabaseLoose';
import { useAuth } from '@/hooks/useAuth';

/**
 * Wholesale entitlement, in two parts:
 *
 *   hasPlan  - an active wholesale subscription exists (shows the Settings
 *              toggle and the 💎 badges; never unlocks a screen on its own)
 *   isActive - hasPlan AND the account's `settings.wholesale_mode` is ON
 *              (the real gate used everywhere else)
 *   loading  - the answer isn't known yet. Callers MUST wait on this before
 *              redirecting: `isActive` is false during the fetch, so acting on
 *              it early bounces genuine subscribers to /pricing.
 *
 * Direct fetch, same shape as SubscriptionGuard - this codebase has no query
 * cache in use. The module-level cache below means the handful of consumers
 * (Layout, Sales, Settings, the wholesale pages) share ONE pair of requests
 * per session instead of firing their own on every mount.
 *
 * `settings.wholesale_mode` is read here rather than from `subscriptions`
 * alone because Settings/SalesBilling/RecordSale already hold the settings
 * row - the billing path gains no extra round trip.
 */

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
export const planHasWholesale = (plan: string | null | undefined): boolean =>
  !!plan && (plan === 'wholesale_monthly' || plan === 'wholesale_annual'
             || plan.startsWith('trial_wholesale_'));

const UNKNOWN: WholesaleAccess = { hasPlan: false, isActive: false, loading: true, viaAdmin: false, needsMigration: false };
const NO_ACCESS: WholesaleAccess = { hasPlan: false, isActive: false, loading: false, viaAdmin: false, needsMigration: false };

// Shared across consumers so N components = 1 fetch. Keyed by user+account so
// a re-login or account switch can never read the previous user's answer.
let cacheKey: string | null = null;
let cached: WholesaleAccess | null = null;
let inFlight: Promise<WholesaleAccess> | null = null;
const subscribers = new Set<(value: WholesaleAccess) => void>();

function publish(value: WholesaleAccess) {
  cached = value;
  subscribers.forEach(fn => fn(value));
}

async function load(userId: string, accountId: string): Promise<WholesaleAccess> {
  try {
    const [subRes, settingsRes, adminRes] = await Promise.all([
      db.from('subscriptions').select('status, plan_type').eq('user_id', userId).single(),
      db.from('settings').select('wholesale_mode').eq('account_id', accountId).single(),
      // Platform admins own the product, so they do not have to buy it from
      // themselves. Absent before the admin migration, which is not an error.
      db.rpc('is_platform_admin'),
    ]);

    const plan = subRes?.data;
    const paidPlan =
      plan?.status === 'active' && planHasWholesale(plan?.plan_type);
    const viaAdmin = adminRes?.error ? false : Boolean(adminRes?.data);

    // The column arrives with 20260918000000. Its absence is why the toggle
    // would otherwise refuse to stick, so surface it rather than failing mute.
    const settingsRow = settingsRes?.data as { wholesale_mode?: boolean } | null;
    const needsMigration =
      Boolean(settingsRes?.error) ||
      (settingsRow != null && !('wholesale_mode' in settingsRow));

    const hasPlan = paidPlan || viaAdmin;

    return {
      hasPlan,
      isActive: hasPlan && Boolean(settingsRow?.wholesale_mode),
      loading: false,
      viaAdmin: viaAdmin && !paidPlan,
      needsMigration,
    };
  } catch {
    // Fail CLOSED: an unreadable subscription must not unlock a paid feature.
    // The RLS policy is the real gate either way.
    return NO_ACCESS;
  }
}

/**
 * Drop the cached answer so the next read re-fetches. Called after the
 * Settings toggle is saved, so the nav/badges update without a page reload.
 */
export function refreshWholesaleAccess() {
  cached = null;
  inFlight = null;
  const [userId, accountId] = (cacheKey ?? '|').split('|');
  if (!userId || !accountId) return;
  publish(UNKNOWN);
  inFlight = load(userId, accountId);
  inFlight.then(publish);
}

export function useWholesaleAccess(): WholesaleAccess {
  const { user, profile } = useAuth();
  const key = user?.id && profile?.account_id ? `${user.id}|${profile.account_id}` : null;

  const [state, setState] = useState<WholesaleAccess>(() =>
    key && key === cacheKey && cached ? cached : UNKNOWN
  );

  useEffect(() => {
    // Signed out, or the profile hasn't landed yet - nothing to check.
    if (!key) {
      setState(prev => (prev.loading ? prev : UNKNOWN));
      return;
    }

    let cancelled = false;
    const apply = (value: WholesaleAccess) => { if (!cancelled) setState(value); };

    // A different user/account than the cached one → start clean.
    if (key !== cacheKey) {
      cacheKey = key;
      cached = null;
      inFlight = null;
    }

    subscribers.add(apply);

    if (cached) {
      apply(cached);
    } else {
      apply(UNKNOWN);
      const [userId, accountId] = key.split('|');
      if (!inFlight) inFlight = load(userId, accountId);
      inFlight.then(value => {
        // Ignore a response that outlived its user/account.
        if (cacheKey === key) publish(value);
      });
    }

    return () => {
      cancelled = true;
      subscribers.delete(apply);
    };
  }, [key]);

  return state;
}
