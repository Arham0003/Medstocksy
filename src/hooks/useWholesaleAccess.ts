import { useEffect, useState } from 'react';
import { db } from '@/lib/supabaseLoose';
import { useAuth } from '@/hooks/useAuth';

/**
 * Wholesale entitlement, in two parts:
 *
 *   hasPlan  — an active wholesale subscription exists (shows the Settings
 *              toggle and the 💎 badges; never unlocks a screen on its own)
 *   isActive — hasPlan AND the account's `settings.wholesale_mode` is ON
 *              (the real gate used everywhere else)
 *   loading  — the answer isn't known yet. Callers MUST wait on this before
 *              redirecting: `isActive` is false during the fetch, so acting on
 *              it early bounces genuine subscribers to /pricing.
 *
 * Direct fetch, same shape as SubscriptionGuard — this codebase has no query
 * cache in use. The module-level cache below means the handful of consumers
 * (Layout, Sales, Settings, the wholesale pages) share ONE pair of requests
 * per session instead of firing their own on every mount.
 *
 * `settings.wholesale_mode` is read here rather than from `subscriptions`
 * alone because Settings/SalesBilling/RecordSale already hold the settings
 * row — the billing path gains no extra round trip.
 */

export interface WholesaleAccess {
  hasPlan: boolean;
  isActive: boolean;
  loading: boolean;
}

const WHOLESALE_PLAN_TYPES = ['wholesale_monthly', 'wholesale_annual'];

const UNKNOWN: WholesaleAccess = { hasPlan: false, isActive: false, loading: true };
const NO_ACCESS: WholesaleAccess = { hasPlan: false, isActive: false, loading: false };

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
    const [subRes, settingsRes] = await Promise.all([
      db.from('subscriptions').select('status, plan_type').eq('user_id', userId).single(),
      db.from('settings').select('wholesale_mode').eq('account_id', accountId).single(),
    ]);

    const plan = subRes?.data;
    const hasPlan =
      plan?.status === 'active' && WHOLESALE_PLAN_TYPES.includes(plan?.plan_type);

    return {
      hasPlan,
      isActive: hasPlan && Boolean(settingsRes?.data?.wholesale_mode),
      loading: false,
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
    // Signed out, or the profile hasn't landed yet — nothing to check.
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
