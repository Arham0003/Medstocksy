import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TableSkeleton } from "@/components/TableSkeleton";
import { DashboardStatCard } from "@/components/DashboardStatCard";
import { toast } from "sonner";
import {
  ShieldCheck, UserPlus, RefreshCcw, Users, CreditCard, Ticket, LayoutDashboard,
  Search, Clock, Diamond, Building2, AlertTriangle, Plus, Trash2, Settings2,
  BadgeCheck, IndianRupee, ChevronRight, Filter,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AdminGuard from "@/components/AdminGuard";
import { db } from "@/lib/supabaseLoose";
import { cn } from "@/lib/utils";

// ─── Types (shapes returned by the admin_* RPCs) ────────────────────────────
interface OverviewStats {
  total_accounts: number;
  total_users: number;
  active_subs: number;
  expiring_7d: number;
  expired: number;
  wholesale_subs: number;
  trial_subs: number;
  paid_subs: number;
  annual_subs: number;
  monthly_subs: number;
  no_subscription: number;
  new_accounts_30d: number;
  mrr: number;
  plan_mix: { plan_type: string; count: number; monthly_value: number }[];
}

interface Subscriber {
  user_id: string;
  email: string;
  account_id: string | null;
  account_name: string | null;
  plan_type: string | null;
  status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  signed_up_at: string | null;
  razorpay_payment_id: string | null;
}

interface Coupon {
  id: string;
  code: string;
  discount_type: "flat" | "percent";
  discount_value: number; // paise when flat, 1-100 when percent
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

/**
 * Every plan the panel can assign.
 *   kind  : what the account is paying for (trial, paid, or a one-off test)
 *   cycle : billing period
 *   price : rupees charged per cycle, matching Pricing.tsx and
 *           create-razorpay-order so the owner sees the real number
 */
const PLAN_OPTIONS = [
  { value: "trial_7_days",         label: "Trial (7 days)",                     days: 7,   kind: "Trial",   cycle: "7 days",  price: 0 },
  { value: "trial_28_days",        label: "Trial (28 days)",                    days: 28,  kind: "Trial",   cycle: "28 days", price: 0 },
  { value: "testing_weekly",       label: "Testing plan (7 days)",              days: 7,   kind: "Testing", cycle: "7 days",  price: 50 },
  { value: "professional_monthly", label: "Professional (monthly)",             days: 30,  kind: "Paid",    cycle: "Monthly", price: 499 },
  { value: "professional_annual",  label: "Professional (annual)",              days: 365, kind: "Paid",    cycle: "Annual",  price: 6000 },
  { value: "wholesale_monthly",    label: "Professional + Wholesale (monthly)", days: 30,  kind: "Paid",    cycle: "Monthly", price: 599 },
  { value: "wholesale_annual",     label: "Professional + Wholesale (annual)",  days: 365, kind: "Paid",    cycle: "Annual",  price: 7200 },
];

const WHOLESALE_PLANS = ["wholesale_monthly", "wholesale_annual"];

/** Mirrors public.plan_has_wholesale(): paid wholesale plans and wholesale trials. */
const hasWholesale = (plan: string | null | undefined) =>
  !!plan && (WHOLESALE_PLANS.includes(plan) || plan.startsWith("trial_wholesale_"));

/** trial_wholesale_14_days -> "Wholesale trial (14 days)" */
const wholesaleTrialLabel = (plan: string) => {
  const m = plan.match(/^trial_wholesale_(\d+)_days$/);
  return m ? "Wholesale trial (" + m[1] + " days)" : null;
};

const planInfo = (planType: string | null | undefined) =>
  planType ? PLAN_OPTIONS.find((o) => o.value === planType) : undefined;

/** Falls back gracefully for a plan_type this build does not know about. */
const planLabel = (planType: string | null | undefined) => {
  if (!planType) return "No plan";
  return planInfo(planType)?.label ?? wholesaleTrialLabel(planType) ?? planType;
};

/** Trial / Paid / Testing, inferred when the plan is not in the catalogue. */
function planKind(planType: string | null | undefined): string {
  if (!planType) return "None";
  const known = planInfo(planType);
  if (known) return known.kind;
  if (planType.startsWith("trial")) return "Trial";
  return "Paid";
}

const KIND_TONE: Record<string, string> = {
  Paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Trial: "bg-amber-50 text-amber-700 border-amber-200",
  Testing: "bg-blue-50 text-blue-700 border-blue-200",
  None: "bg-slate-100 text-slate-600 border-slate-200",
};

const EMPTY = "-"; // placeholder shown when a value does not exist

const fmtDate = (iso: string | null) => {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? EMPTY
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtMoney = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN");

const DOT = " · ";

const daysLeft = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / 86400000);
};

/** One consistent read of a subscriber's state, used everywhere a badge shows. */
function subState(s: Subscriber): { label: string; tone: string } {
  if (!s.plan_type) return { label: "No plan", tone: "bg-slate-100 text-slate-600 border-slate-200" };
  const left = daysLeft(s.current_period_end);
  if (s.status !== "active") return { label: s.status ?? "inactive", tone: "bg-rose-50 text-rose-700 border-rose-200" };
  if (left !== null && left < 0) return { label: "Expired", tone: "bg-rose-50 text-rose-700 border-rose-200" };
  if (left !== null && left <= 7) return { label: left + "d left", tone: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: "Active", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" };
}

const errMsg = (e: unknown, fallback: string) => {
  const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? "");
  if (/not authorized/i.test(m)) return "Not authorized. This account is not a platform admin.";
  if (/does not exist|schema cache/i.test(m)) {
    return "Admin functions are missing. Run supabase/APPLY_ALL_admin.sql first.";
  }
  return m || fallback;
};

// ═══════════════════════════════════════════════════════════════════════════
export default function AdminPanel() {
  return (
    <AdminGuard>
      <AdminPanelBody />
    </AdminGuard>
  );
}

function AdminPanelBody() {
  const [tab, setTab] = useState("overview");
  /** Drill-down opened by tapping a stat card or a plan row. */
  const [segment, setSegment] = useState<SegmentRequest | null>(null);
  /** Bumped after any change so open lists refetch. */
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((n) => n + 1), []);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* This console belongs to the Medstocksy owner, not to customers. */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-orange-600 to-amber-600 bg-clip-text text-transparent">
            Admin Control
          </h1>
          <p className="text-muted-foreground text-sm sm:text-lg mt-1 sm:mt-2">
            Every Medstocksy account, subscription and coupon in one place
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-50 border border-orange-200 text-xs text-orange-700 shrink-0">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="font-medium">Company owner only</span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="w-full h-auto p-1 bg-slate-100/80 rounded-xl grid grid-cols-4 sm:flex sm:justify-center gap-1">
          <TabsTrigger value="overview" className="flex-col sm:flex-row gap-1 sm:gap-2 data-[state=active]:bg-white data-[state=active]:text-orange-700 data-[state=active]:shadow-sm py-2 px-1 sm:px-3">
            <LayoutDashboard className="h-4 w-4" />
            <span className="text-[11px] sm:text-sm">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="subscribers" className="flex-col sm:flex-row gap-1 sm:gap-2 data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm py-2 px-1 sm:px-3">
            <Users className="h-4 w-4" />
            <span className="text-[11px] sm:text-sm">Accounts</span>
          </TabsTrigger>
          <TabsTrigger value="coupons" className="flex-col sm:flex-row gap-1 sm:gap-2 data-[state=active]:bg-white data-[state=active]:text-violet-700 data-[state=active]:shadow-sm py-2 px-1 sm:px-3">
            <Ticket className="h-4 w-4" />
            <span className="text-[11px] sm:text-sm">Coupons</span>
          </TabsTrigger>
          <TabsTrigger value="trial" className="flex-col sm:flex-row gap-1 sm:gap-2 data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm py-2 px-1 sm:px-3">
            <UserPlus className="h-4 w-4" />
            <span className="text-[11px] sm:text-sm">Trial</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5 sm:mt-6">
          <OverviewTab version={version} onDrill={setSegment} />
        </TabsContent>
        <TabsContent value="subscribers" className="mt-5 sm:mt-6">
          <SubscribersTab version={version} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="coupons" className="mt-5 sm:mt-6">
          <CouponsTab />
        </TabsContent>
        <TabsContent value="trial" className="mt-5 sm:mt-6">
          <GrantTrialTab onGranted={refresh} />
        </TabsContent>
      </Tabs>

      <SegmentDialog segment={segment} onClose={() => setSegment(null)} onChanged={refresh} />
    </div>
  );
}

// ─── Shared: one responsive account list ────────────────────────────────────
/**
 * Table from `sm` up, stacked cards below it. An eight column table is
 * unreadable on a phone, and this console gets used on one.
 */
function SubscriberList({
  rows, loading, error, emptyTitle, emptyHint, onManage, onRetry,
}: {
  rows: Subscriber[];
  loading: boolean;
  error: string | null;
  emptyTitle: string;
  emptyHint?: string;
  onManage: (s: Subscriber) => void;
  onRetry?: () => void;
}) {
  if (error) {
    return (
      <div className="m-3 sm:m-0 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50/60 p-4">
        <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-medium text-rose-900">Could not load accounts</p>
          <p className="text-sm text-rose-700 mt-1 break-words">{error}</p>
          {onRetry && (
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              <RefreshCcw className="h-3.5 w-3.5 mr-1.5" /> Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return <TableSkeleton rows={6} cols={["w-40", "w-28", "w-20", "w-20", "w-16"]} />;
  }

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-slate-100 grid place-items-center">
          <Users className="h-6 w-6 text-slate-400" />
        </div>
        <p className="font-medium text-slate-800">{emptyTitle}</p>
        {emptyHint && <p className="text-sm text-muted-foreground mt-1">{emptyHint}</p>}
      </div>
    );
  }

  return (
    <>
      {/* Phone: one tappable card per account */}
      <div className="sm:hidden divide-y">
        {rows.map((s) => {
          const st = subState(s);
          const kind = planKind(s.plan_type);
          const info = planInfo(s.plan_type);
          return (
            <button
              key={s.user_id}
              type="button"
              onClick={() => onManage(s)}
              className="w-full text-left px-3 py-3 min-h-0 hover:bg-slate-50 active:bg-slate-100 transition-colors"
              aria-label={"Manage " + s.email}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-slate-900 truncate">{s.email}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {s.account_name || "No store name"}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <Badge variant="outline" className={cn("text-[10px] font-semibold", KIND_TONE[kind] ?? KIND_TONE.None)}>
                  {kind}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px] font-semibold", st.tone)}>{st.label}</Badge>
                {hasWholesale(s.plan_type) && (
                  <Diamond className="h-3 w-3 text-violet-500" />
                )}
                <span className="text-[11px] text-muted-foreground ml-auto">
                  {info ? info.cycle : EMPTY}
                  {info && info.price > 0 ? DOT + fmtMoney(info.price) : ""}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Tablet and desktop: full table, columns dropping as width shrinks */}
      <div className="hidden sm:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead className="hidden lg:table-cell">Store</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden md:table-cell">Plan</TableHead>
              <TableHead className="hidden xl:table-cell">Billing</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Expires</TableHead>
              <TableHead className="w-14 text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => {
              const st = subState(s);
              const kind = planKind(s.plan_type);
              const info = planInfo(s.plan_type);
              const isWholesale = hasWholesale(s.plan_type);
              return (
                <TableRow key={s.user_id} className="cursor-pointer" onClick={() => onManage(s)}>
                  <TableCell className="font-medium max-w-[200px] truncate" title={s.email}>{s.email}</TableCell>
                  <TableCell className="hidden lg:table-cell max-w-[140px] truncate" title={s.account_name ?? ""}>
                    {s.account_name || EMPTY}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-[11px] font-semibold", KIND_TONE[kind] ?? KIND_TONE.None)}>
                      {kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="flex items-center gap-1.5 text-sm">
                      {isWholesale && <Diamond className="h-3.5 w-3.5 text-violet-500 shrink-0" />}
                      {s.plan_type ? planLabel(s.plan_type) : <span className="text-muted-foreground">{EMPTY}</span>}
                    </span>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell whitespace-nowrap text-sm">
                    {info ? (
                      <span>
                        {info.cycle}
                        {info.price > 0 && (
                          <span className="text-muted-foreground">{DOT}{fmtMoney(info.price)}</span>
                        )}
                      </span>
                    ) : EMPTY}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-[11px] font-semibold", st.tone)}>{st.label}</Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell whitespace-nowrap text-sm">
                    {fmtDate(s.current_period_end)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8"
                      onClick={(e) => { e.stopPropagation(); onManage(s); }}
                      aria-label={"Manage " + s.email}
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ─── Drill-down opened from a stat card ────────────────────────
/**
 * Deliberately not a plain list in a box. Each segment carries its own colour,
 * a large count in the header, a worth-per-month strip, an inline filter, and
 * the accounts as a responsive card grid, so the extra width is actually used
 * instead of stretching a table across it.
 */
type SegmentTone = "emerald" | "amber" | "rose" | "violet" | "blue" | "slate";

export interface SegmentRequest {
  key: string;
  plan?: string;
  title: string;
  subtitle?: string;
  tone?: SegmentTone;
  icon?: LucideIcon;
}

const SEGMENT_THEME: Record<SegmentTone, {
  band: string; ring: string; tile: string; count: string;
}> = {
  emerald: {
    band: "from-emerald-500 to-teal-500", ring: "focus-visible:ring-emerald-300",
    tile: "bg-emerald-50 text-emerald-700", count: "text-emerald-700",
  },
  amber: {
    band: "from-amber-500 to-orange-500", ring: "focus-visible:ring-amber-300",
    tile: "bg-amber-50 text-amber-700", count: "text-amber-700",
  },
  rose: {
    band: "from-rose-500 to-red-500", ring: "focus-visible:ring-rose-300",
    tile: "bg-rose-50 text-rose-700", count: "text-rose-700",
  },
  violet: {
    band: "from-violet-500 to-indigo-500", ring: "focus-visible:ring-violet-300",
    tile: "bg-violet-50 text-violet-700", count: "text-violet-700",
  },
  blue: {
    band: "from-blue-500 to-sky-500", ring: "focus-visible:ring-blue-300",
    tile: "bg-blue-50 text-blue-700", count: "text-blue-700",
  },
  slate: {
    band: "from-slate-600 to-slate-700", ring: "focus-visible:ring-slate-300",
    tile: "bg-slate-100 text-slate-700", count: "text-slate-800",
  },
};

/** First letter of the store, falling back to the email, for the row avatar. */
const initialOf = (s: Subscriber) =>
  (s.account_name?.trim()?.[0] || s.email?.trim()?.[0] || "?").toUpperCase();

function SegmentDialog({
  segment, onClose, onChanged,
}: {
  segment: SegmentRequest | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<Subscriber | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    if (!segment) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await db.rpc("admin_segment_subscribers", {
        segment: segment.key,
        plan_filter: segment.plan ?? null,
        row_limit: 200,
      });
      if (e) throw e;
      setRows((data ?? []) as Subscriber[]);
    } catch (e) {
      setError(errMsg(e, "Could not load this list."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [segment]);

  useEffect(() => { if (segment) { setFilter(""); load(); } }, [segment, load]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.email.toLowerCase().includes(q) || (r.account_name ?? "").toLowerCase().includes(q));
  }, [rows, filter]);

  /** What this group is worth, and how urgent it is. */
  const summary = useMemo(() => {
    const paying = rows.filter((r) => planKind(r.plan_type) === "Paid").length;
    const mrr = rows.reduce((n, r) => {
      const info = planInfo(r.plan_type);
      if (!info || info.price <= 0) return n;
      return n + (info.cycle === "Annual" ? Math.round(info.price / 12) : info.price);
    }, 0);
    const soon = rows.filter((r) => {
      const d = daysLeft(r.current_period_end);
      return d !== null && d >= 0 && d <= 7;
    }).length;
    return { paying, mrr, soon };
  }, [rows]);

  const theme = SEGMENT_THEME[segment?.tone ?? "slate"];
  const Icon = segment?.icon ?? Users;

  return (
    <>
      <Dialog open={!!segment} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="w-[96vw] sm:max-w-5xl xl:max-w-6xl max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
          {/* Coloured band so each segment is recognisable at a glance */}
          <div className={cn("bg-gradient-to-r px-4 sm:px-6 py-4 sm:py-5 shrink-0", theme.band)}>
            <DialogHeader className="text-left space-y-0">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-white/20 grid place-items-center shrink-0">
                  <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-white text-lg sm:text-2xl font-bold leading-tight">
                    {segment?.title}
                  </DialogTitle>
                  <DialogDescription className="text-white/80 text-xs sm:text-sm mt-0.5">
                    {segment?.subtitle ?? "Tap any account to change its plan"}
                  </DialogDescription>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl sm:text-4xl font-bold text-white tabular-nums leading-none">
                    {loading ? "" : rows.length}
                  </div>
                  <div className="text-[10px] sm:text-xs text-white/80 mt-1">
                    account{rows.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
            </DialogHeader>
          </div>

          {/* Worth of this group, plus an inline filter */}
          <div className="px-4 sm:px-6 py-3 border-b bg-slate-50/60 shrink-0 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-5 sm:gap-7 text-xs">
              <div>
                <div className="text-muted-foreground">Paying</div>
                <div className={cn("font-bold text-sm tabular-nums", theme.count)}>
                  {loading ? EMPTY : summary.paying}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Worth per month</div>
                <div className={cn("font-bold text-sm tabular-nums", theme.count)}>
                  {loading ? EMPTY : fmtMoney(summary.mrr)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Expiring in 7 days</div>
                <div className={cn("font-bold text-sm tabular-nums", theme.count)}>
                  {loading ? EMPTY : summary.soon}
                </div>
              </div>
            </div>
            <div className="relative sm:ml-auto sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter this list..."
                className="h-9 pl-9 text-sm bg-white"
                aria-label="Filter accounts in this group"
              />
            </div>
          </div>

          {/* Accounts as cards: one across on a phone, three on a wide screen */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 bg-slate-50/30">
            {error ? (
              <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
                <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-medium text-rose-900">Could not load this list</p>
                  <p className="text-sm text-rose-700 mt-1 break-words">{error}</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={load}>
                    <RefreshCcw className="h-3.5 w-3.5 mr-1.5" /> Retry
                  </Button>
                </div>
              </div>
            ) : loading ? (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-28 rounded-xl bg-white border animate-pulse" />
                ))}
              </div>
            ) : shown.length === 0 ? (
              <div className="text-center py-14">
                <div className={cn("mx-auto mb-3 h-14 w-14 rounded-2xl grid place-items-center", theme.tile)}>
                  <Icon className="h-7 w-7" />
                </div>
                <p className="font-semibold text-slate-800">
                  {filter ? "Nothing matches that filter" : "Nothing in this group"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {filter ? "Try a different email or store name." : "No account falls into this group right now."}
                </p>
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {shown.map((s) => {
                  const st = subState(s);
                  const kind = planKind(s.plan_type);
                  const info = planInfo(s.plan_type);
                  return (
                    <button
                      key={s.user_id}
                      type="button"
                      onClick={() => setManaging(s)}
                      aria-label={"Manage " + s.email}
                      className={cn(
                        "group text-left rounded-xl border bg-white p-3 min-h-0 transition-all",
                        "hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2",
                        theme.ring,
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn("h-9 w-9 rounded-lg grid place-items-center font-bold text-sm shrink-0", theme.tile)}>
                          {initialOf(s)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm text-slate-900 truncate">
                            {s.account_name || s.email}
                          </p>
                          <p className="text-xs text-muted-foreground truncate" title={s.email}>
                            {s.account_name ? s.email : "No store name"}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 shrink-0 transition-colors" />
                      </div>

                      <div className="mt-3 pt-3 border-t flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {hasWholesale(s.plan_type) && (
                            <Diamond className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                          )}
                          <span className="text-xs text-slate-700 truncate">
                            {s.plan_type ? planLabel(s.plan_type) : "No plan"}
                          </span>
                        </div>
                        <Badge variant="outline" className={cn("text-[10px] font-semibold shrink-0", st.tone)}>
                          {st.label}
                        </Badge>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Badge variant="outline" className={cn("text-[10px] font-semibold", KIND_TONE[kind] ?? KIND_TONE.None)}>
                            {kind}
                          </Badge>
                          {info ? info.cycle : EMPTY}
                        </span>
                        <span className="tabular-nums">
                          {s.current_period_end ? "till " + fmtDate(s.current_period_end) : EMPTY}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="px-4 sm:px-6 py-3 border-t bg-white shrink-0 flex-row items-center justify-between gap-3 sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {loading ? "Loading..." : "Showing " + shown.length + " of " + rows.length}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                <RefreshCcw className={cn("h-3.5 w-3.5 sm:mr-1.5", loading && "animate-spin")} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button size="sm" onClick={onClose}>Close</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ManageSubscriberDialog
        subscriber={managing}
        onClose={() => setManaging(null)}
        onDone={() => { setManaging(null); load(); onChanged(); }}
      />
    </>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────
function OverviewTab({
  version, onDrill,
}: {
  version: number;
  onDrill: (s: SegmentRequest) => void;
}) {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await db.rpc("admin_overview_stats");
      if (e) throw e;
      setStats(data as OverviewStats);
    } catch (e) {
      setError(errMsg(e, "Could not load stats."));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, version]);

  if (error) {
    return (
      <Card className="border-rose-200 bg-rose-50/40">
        <CardContent className="p-4 sm:p-6 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium text-rose-900">Could not load the overview</p>
            <p className="text-sm text-rose-700 mt-1 break-words">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={load}>
              <RefreshCcw className="h-3.5 w-3.5 mr-1.5" /> Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const v = (n?: number) => (loading ? EMPTY : String(n ?? 0));
  const drill = (req: SegmentRequest) => () => { if (!loading) onDrill(req); };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Tap any card to see the accounts behind it</p>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="shrink-0">
          <RefreshCcw className={cn("h-3.5 w-3.5 sm:mr-1.5", loading && "animate-spin")} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-5">
        <DashboardStatCard title="Accounts" value={v(stats?.total_accounts)} icon={Building2}
          variant="info" loading={loading} description={(stats?.new_accounts_30d ?? 0) + " new in 30 days"}
          onClick={drill({ key: "accounts", title: "All accounts", tone: "blue", icon: Building2,
            subtitle: "Every pharmacy signed up to Medstocksy" })} />
        <DashboardStatCard title="Active subscriptions" value={v(stats?.active_subs)} icon={BadgeCheck}
          variant="success" loading={loading} description="Paid or on trial"
          onClick={drill({ key: "active", title: "Active subscriptions", tone: "emerald", icon: BadgeCheck,
            subtitle: "Paying or on a trial right now" })} />
        <DashboardStatCard title="Expiring in 7 days" value={v(stats?.expiring_7d)} icon={Clock}
          variant="warning" loading={loading} description="Needs a renewal nudge"
          onClick={drill({ key: "expiring_7d", title: "Expiring within 7 days", tone: "amber", icon: Clock,
            subtitle: "Reach out before these lapse" })} />
        <DashboardStatCard title="Wholesale plans" value={v(stats?.wholesale_subs)} icon={Diamond}
          variant="primary" loading={loading} description="On a B2B plan"
          onClick={drill({ key: "wholesale", title: "Wholesale accounts", tone: "violet", icon: Diamond,
            subtitle: "On a B2B plan with wholesale billing" })} />
        <DashboardStatCard title="Expired or cancelled" value={v(stats?.expired)} icon={AlertTriangle}
          variant="danger" loading={loading} description="Lost or lapsed"
          onClick={drill({ key: "expired", title: "Expired or cancelled", tone: "rose", icon: AlertTriangle,
            subtitle: "Lapsed accounts worth winning back" })} />
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4">
        <DashboardStatCard title="Monthly recurring revenue" value={loading ? EMPTY : fmtMoney(stats?.mrr ?? 0)}
          icon={IndianRupee} variant="success" loading={loading}
          description="Annual plans counted per month"
          onClick={drill({ key: "paid", title: "Paying accounts", tone: "emerald", icon: IndianRupee,
            subtitle: "Every account on a paid plan" })} />
        <DashboardStatCard title="Paid subscriptions" value={v(stats?.paid_subs)} icon={CreditCard}
          variant="primary" loading={loading}
          description={loading ? undefined : (stats?.monthly_subs ?? 0) + " monthly, " + (stats?.annual_subs ?? 0) + " annual"}
          onClick={drill({ key: "paid", title: "Paying accounts", tone: "emerald", icon: IndianRupee,
            subtitle: "Every account on a paid plan" })} />
        <DashboardStatCard title="Trials running" value={v(stats?.trial_subs)} icon={Clock}
          variant="warning" loading={loading} description="Not paying yet"
          onClick={drill({ key: "trial", title: "Accounts on a trial", tone: "amber", icon: Clock,
            subtitle: "Not paying yet, convert these" })} />
        <DashboardStatCard title="Never subscribed" value={v(stats?.no_subscription)} icon={Users}
          variant="default" loading={loading} description="Signed up, no plan"
          onClick={drill({ key: "no_subscription", title: "Never subscribed", tone: "slate", icon: Users,
            subtitle: "Signed up but never bought a plan" })} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg font-semibold">Plan mix</CardTitle>
          <CardDescription>Active subscriptions by plan, with monthly value. Tap a row for its accounts.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {loading ? (
            <TableSkeleton rows={4} cols={["w-44", "w-16", "w-16"]} />
          ) : !stats?.plan_mix?.length ? (
            <div className="text-center py-10 px-4">
              <p className="font-medium text-slate-800">No active subscriptions yet</p>
              <p className="text-sm text-muted-foreground mt-1">Plans appear here once accounts subscribe.</p>
            </div>
          ) : (
            <>
              {/* Phone: stacked, tappable */}
              <div className="sm:hidden divide-y">
                {stats.plan_mix.map((p) => {
                  const info = planInfo(p.plan_type);
                  const kind = planKind(p.plan_type);
                  return (
                    <button
                      key={p.plan_type}
                      type="button"
                      onClick={() => onDrill({
                        key: "plan", plan: p.plan_type, title: planLabel(p.plan_type),
                        tone: hasWholesale(p.plan_type) ? "violet" : "blue",
                        icon: hasWholesale(p.plan_type) ? Diamond : CreditCard,
                        subtitle: "Accounts currently on this plan",
                      })}
                      className="w-full text-left px-3 py-3 min-h-0 hover:bg-slate-50 active:bg-slate-100"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate flex items-center gap-1.5">
                          {hasWholesale(p.plan_type) && <Diamond className="h-3.5 w-3.5 text-violet-500 shrink-0" />}
                          {planLabel(p.plan_type)}
                        </span>
                        <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge variant="outline" className={cn("text-[10px] font-semibold", KIND_TONE[kind] ?? KIND_TONE.None)}>
                          {kind}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{info?.cycle ?? EMPTY}</span>
                        <span className="text-xs font-semibold ml-auto">
                          {p.count} acct{p.count === 1 ? "" : "s"}{DOT}{fmtMoney(p.monthly_value ?? 0)}
                        </span>
                      </div>
                    </button>
                  );
                })}
                <div className="flex items-center justify-between px-3 py-3 bg-slate-50/60 font-semibold text-sm">
                  <span>Total</span>
                  <span>
                    {stats.plan_mix.reduce((n, p) => n + p.count, 0)} accounts{DOT}{fmtMoney(stats.mrr ?? 0)}/mo
                  </span>
                </div>
              </div>

              {/* Tablet and up: table */}
              <div className="hidden sm:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="hidden md:table-cell">Billing</TableHead>
                      <TableHead className="hidden md:table-cell text-right">Price</TableHead>
                      <TableHead className="text-right">Accounts</TableHead>
                      <TableHead className="text-right">Per month</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.plan_mix.map((p) => {
                      const info = planInfo(p.plan_type);
                      const kind = planKind(p.plan_type);
                      return (
                        <TableRow
                          key={p.plan_type}
                          className="cursor-pointer"
                          onClick={() => onDrill({
                        key: "plan", plan: p.plan_type, title: planLabel(p.plan_type),
                        tone: hasWholesale(p.plan_type) ? "violet" : "blue",
                        icon: hasWholesale(p.plan_type) ? Diamond : CreditCard,
                        subtitle: "Accounts currently on this plan",
                      })}
                        >
                          <TableCell className="font-medium">
                            <span className="flex items-center gap-2">
                              {hasWholesale(p.plan_type) && <Diamond className="h-3.5 w-3.5 text-violet-500 shrink-0" />}
                              {planLabel(p.plan_type)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[11px] font-semibold", KIND_TONE[kind] ?? KIND_TONE.None)}>
                              {kind}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">{info?.cycle ?? EMPTY}</TableCell>
                          <TableCell className="hidden md:table-cell text-right tabular-nums">
                            {info ? (info.price > 0 ? fmtMoney(info.price) : "Free") : EMPTY}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{p.count}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(p.monthly_value ?? 0)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-slate-50/60 font-semibold">
                      <TableCell>Total</TableCell>
                      <TableCell />
                      <TableCell className="hidden md:table-cell" />
                      <TableCell className="hidden md:table-cell" />
                      <TableCell className="text-right tabular-nums">
                        {stats.plan_mix.reduce((n, p) => n + p.count, 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(stats.mrr ?? 0)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Accounts ───────────────────────────────────────────────────────────────
function SubscribersTab({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [rows, setRows] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [managing, setManaging] = useState<Subscriber | null>(null);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await db.rpc("admin_list_subscribers", {
        search_term: term.trim() || null,
        row_limit: 200,
      });
      if (e) throw e;
      setRows((data ?? []) as Subscriber[]);
    } catch (e) {
      setError(errMsg(e, "Could not load accounts."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(search), 350);
    return () => clearTimeout(t);
  }, [search, load, version]);

  const filtered = useMemo(() => rows.filter((s) => {
    if (kindFilter !== "all" && planKind(s.plan_type) !== kindFilter) return false;
    if (statusFilter === "all") return true;
    const left = daysLeft(s.current_period_end);
    const live = s.status === "active" && (left === null || left >= 0);
    if (statusFilter === "active") return live;
    if (statusFilter === "expiring") return live && left !== null && left <= 7;
    if (statusFilter === "expired") return Boolean(s.plan_type) && !live;
    if (statusFilter === "none") return !s.plan_type;
    return true;
  }), [rows, kindFilter, statusFilter]);

  const filtersOn = Boolean(search) || kindFilter !== "all" || statusFilter !== "all";

  return (
    <div className="space-y-4">
      <Card className="border-slate-200">
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search email or store..."
                className="h-10 pl-9"
                aria-label="Search subscribers"
              />
            </div>
            <Button variant="outline" onClick={() => load(search)} disabled={loading} className="h-10 shrink-0">
              <RefreshCcw className={cn("h-4 w-4 sm:mr-1.5", loading && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="h-9 flex-1 sm:w-40 sm:flex-none" aria-label="Filter by type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="Paid">Paid</SelectItem>
                <SelectItem value="Trial">Trial</SelectItem>
                <SelectItem value="Testing">Testing</SelectItem>
                <SelectItem value="None">No plan</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 flex-1 sm:w-44 sm:flex-none" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="expiring">Expiring in 7 days</SelectItem>
                <SelectItem value="expired">Expired or cancelled</SelectItem>
                <SelectItem value="none">Never subscribed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg font-semibold">Accounts</CardTitle>
          <CardDescription>
            {loading
              ? "Loading..."
              : filtered.length + " of " + rows.length + " account" + (rows.length === 1 ? "" : "s")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          <SubscriberList
            rows={filtered}
            loading={loading}
            error={error}
            emptyTitle={filtersOn ? "No account matches those filters" : "No accounts yet"}
            emptyHint={filtersOn ? "Try clearing the search or filters." : "Accounts appear here as people sign up."}
            onManage={setManaging}
            onRetry={() => load(search)}
          />
        </CardContent>
      </Card>

      <ManageSubscriberDialog
        subscriber={managing}
        onClose={() => setManaging(null)}
        onDone={() => { setManaging(null); load(search); onChanged(); }}
      />
    </div>
  );
}

// ─── Manage one account ─────────────────────────────────────────────────────
const EXTEND_PRESETS = [7, 30, 90, 365];

function ManageSubscriberDialog({
  subscriber, onClose, onDone,
}: { subscriber: Subscriber | null; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<string>("professional_monthly");
  const [days, setDays] = useState<number>(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    if (!subscriber) return;
    const current = planInfo(subscriber.plan_type);
    setPlan(current?.value ?? "professional_monthly");
    setDays(current?.days ?? 30);
  }, [subscriber]);

  const run = async (label: string, fn: () => Promise<{ error: unknown }>, success: string) => {
    setBusy(label);
    try {
      const { error } = await fn();
      if (error) throw error;
      toast.success(success);
      onDone();
    } catch (e) {
      toast.error(errMsg(e, "Action failed."));
    } finally {
      setBusy(null);
    }
  };

  if (!subscriber) return null;
  const st = subState(subscriber);
  const currentInfo = planInfo(subscriber.plan_type);
  const currentKind = planKind(subscriber.plan_type);
  const remaining = daysLeft(subscriber.current_period_end);

  return (
    <>
      <Dialog open={!!subscriber} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base sm:text-lg break-all">{subscriber.email}</DialogTitle>
            <DialogDescription>
              {subscriber.account_name || "No store name"}{DOT}joined {fmtDate(subscriber.signed_up_at)}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-slate-50/60 p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Current plan</p>
                <p className="font-medium text-sm">
                  {subscriber.plan_type ? planLabel(subscriber.plan_type) : "No subscription"}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
                <Badge variant="outline" className={cn("text-[11px] font-semibold", KIND_TONE[currentKind] ?? KIND_TONE.None)}>
                  {currentKind}
                </Badge>
                <Badge variant="outline" className={cn("text-[11px] font-semibold", st.tone)}>{st.label}</Badge>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs border-t pt-3">
              <div>
                <dt className="text-muted-foreground">Billing cycle</dt>
                <dd className="font-medium text-slate-800">{currentInfo?.cycle ?? EMPTY}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Price</dt>
                <dd className="font-medium text-slate-800">
                  {currentInfo ? (currentInfo.price > 0 ? fmtMoney(currentInfo.price) : "Free") : EMPTY}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Started</dt>
                <dd className="font-medium text-slate-800">{fmtDate(subscriber.current_period_start)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Expires</dt>
                <dd className="font-medium text-slate-800">
                  {fmtDate(subscriber.current_period_end)}
                  {remaining !== null && (
                    <span className={cn("ml-1 font-normal", remaining < 0 ? "text-rose-600" : "text-muted-foreground")}>
                      ({remaining < 0 ? Math.abs(remaining) + "d ago" : remaining + "d left"})
                    </span>
                  )}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Razorpay payment</dt>
                <dd className="font-mono text-[11px] text-slate-800 break-all" title={subscriber.razorpay_payment_id ?? ""}>
                  {subscriber.razorpay_payment_id || (
                    <span className="font-sans text-muted-foreground">Not a Razorpay payment (granted manually)</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <Label htmlFor="admin-plan">Set plan</Label>
              <Select
                value={plan}
                onValueChange={(v) => {
                  setPlan(v);
                  const d = planInfo(v)?.days;
                  if (d) setDays(d);
                }}
              >
                <SelectTrigger id="admin-plan"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLAN_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}{o.price > 0 ? DOT + fmtMoney(o.price) : DOT + "Free"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-days">Valid for (days)</Label>
              <Input
                id="admin-days" type="number" min={1} max={3650} value={days}
                onChange={(e) => setDays(Math.max(1, parseInt(e.target.value) || 1))}
              />
              <p className="text-xs text-muted-foreground">
                Sets the expiry to {days} day{days === 1 ? "" : "s"} from now, replacing any current plan.
              </p>
            </div>

            {subscriber.plan_type && (
              <div className="space-y-2">
                <Label>Extend the current plan</Label>
                <div className="grid grid-cols-4 gap-2">
                  {EXTEND_PRESETS.map((d) => (
                    <Button
                      key={d}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => run("extend",
                        () => db.rpc("admin_extend_subscription", { target_user_id: subscriber.user_id, extra_days: d }),
                        "Extended by " + d + " days.")}
                    >
                      {busy === "extend" ? <RefreshCcw className="h-3.5 w-3.5 animate-spin" /> : "+" + d + "d"}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto text-rose-700 border-rose-200 hover:bg-rose-50"
              disabled={!!busy || !subscriber.plan_type}
              onClick={() => setConfirmRevoke(true)}
            >
              Revoke access
            </Button>
            <Button
              className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700"
              disabled={!!busy}
              onClick={() => run("set",
                () => db.rpc("admin_set_subscription", { target_user_id: subscriber.user_id, new_plan_type: plan, days }),
                "Plan updated.")}
            >
              {busy === "set" ? <RefreshCcw className="h-4 w-4 mr-1.5 animate-spin" /> : <CreditCard className="h-4 w-4 mr-1.5" />}
              Apply plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke access for this account?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="break-all">{subscriber.email}</strong> will be marked cancelled and lose access
              immediately. You can grant a new plan afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep access</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => {
                setConfirmRevoke(false);
                run("revoke",
                  () => db.rpc("admin_revoke_subscription", { target_user_id: subscriber.user_id }),
                  "Access revoked.");
              }}
            >
              Revoke access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Coupons ────────────────────────────────────────────────────────────────
const blankCoupon = {
  code: "",
  discount_type: "flat" as "flat" | "percent",
  amount: "",       // rupees when flat, percent when percent
  max_uses: "1",
  expires_at: "",
  is_active: true,
};

function CouponsTab() {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blankCoupon);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Coupon | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await db.rpc("admin_list_coupons");
      if (e) throw e;
      setRows((data ?? []) as Coupon[]);
    } catch (e) {
      setError(errMsg(e, "Could not load coupons."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const code = form.code.trim().toUpperCase();
    const amount = parseFloat(form.amount);
    const maxUses = parseInt(form.max_uses);

    if (!code) return toast.error("Enter a coupon code.");
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Enter a discount greater than zero.");
    if (form.discount_type === "percent" && amount > 100) return toast.error("A percent discount cannot exceed 100.");
    if (!Number.isFinite(maxUses) || maxUses < 1) return toast.error("Max uses must be at least 1.");

    setSaving(true);
    try {
      // create-razorpay-order reads flat discounts in PAISE.
      const value = form.discount_type === "flat" ? Math.round(amount * 100) : amount;
      const { error: e } = await db.rpc("admin_upsert_coupon", {
        coupon_code: code,
        d_type: form.discount_type,
        d_value: value,
        p_max_uses: maxUses,
        p_expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        p_is_active: form.is_active,
      });
      if (e) throw e;
      toast.success("Coupon " + code + " saved.");
      setOpen(false);
      setForm(blankCoupon);
      load();
    } catch (e) {
      toast.error(errMsg(e, "Could not save the coupon."));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (c: Coupon) => {
    try {
      const { error: e } = await db.rpc("admin_set_coupon_active", { coupon_id: c.id, active: !c.is_active });
      if (e) throw e;
      setRows((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_active: !x.is_active } : x)));
      toast.success(c.code + (c.is_active ? " disabled." : " enabled."));
    } catch (e) {
      toast.error(errMsg(e, "Could not update the coupon."));
    }
  };

  const remove = async (c: Coupon) => {
    try {
      const { error: e } = await db.rpc("admin_delete_coupon", { coupon_id: c.id });
      if (e) throw e;
      toast.success(c.code + " deleted.");
      load();
    } catch (e) {
      toast.error(errMsg(e, "Could not delete the coupon."));
    } finally {
      setToDelete(null);
    }
  };

  const showValue = (c: Coupon) =>
    c.discount_type === "percent" ? c.discount_value + "%" : fmtMoney(Number(c.discount_value) / 100);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base sm:text-lg font-semibold">Coupon codes</CardTitle>
              <CardDescription>
                Used by the Razorpay checkout. Flat discounts are stored in paise.
              </CardDescription>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={load} disabled={loading} className="flex-1 sm:flex-none">
                <RefreshCcw className={cn("h-3.5 w-3.5 sm:mr-1.5", loading && "animate-spin")} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700 flex-1 sm:flex-none"
                onClick={() => { setForm(blankCoupon); setOpen(true); }}>
                <Plus className="h-4 w-4 mr-1.5" /> New coupon
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {error ? (
            <div className="m-3 sm:m-0 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50/60 p-4">
              <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-medium text-rose-900">Could not load coupons</p>
                <p className="text-sm text-rose-700 mt-1 break-words">{error}</p>
              </div>
            </div>
          ) : loading ? (
            <TableSkeleton rows={4} cols={["w-32", "w-24", "w-20", "w-20", "w-16"]} />
          ) : rows.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-violet-50 grid place-items-center">
                <Ticket className="h-6 w-6 text-violet-500" />
              </div>
              <p className="font-medium text-slate-800">No coupons yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create one and it works at checkout immediately.</p>
            </div>
          ) : (
            <>
              {/* Phone: one card per coupon */}
              <div className="sm:hidden divide-y">
                {rows.map((c) => {
                  const exhausted = c.used_count >= c.max_uses;
                  const expired = c.expires_at ? new Date(c.expires_at) < new Date() : false;
                  return (
                    <div key={c.id} className="px-3 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono font-semibold uppercase text-sm">{c.code}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {showValue(c)} {c.discount_type === "percent" ? "off" : "flat"}
                            {DOT}
                            <span className={cn(exhausted && "text-rose-600 font-medium")}>
                              {c.used_count}/{c.max_uses} used
                            </span>
                          </p>
                          <p className={cn("text-xs mt-0.5", expired ? "text-rose-600" : "text-muted-foreground")}>
                            {c.expires_at ? "Expires " + fmtDate(c.expires_at) : "Never expires"}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <Switch checked={c.is_active} onCheckedChange={() => toggle(c)} aria-label={"Toggle " + c.code} />
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                            onClick={() => setToDelete(c)} aria-label={"Delete " + c.code}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tablet and up: table */}
              <div className="hidden sm:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Discount</TableHead>
                      <TableHead>Used</TableHead>
                      <TableHead className="hidden md:table-cell">Expires</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((c) => {
                      const exhausted = c.used_count >= c.max_uses;
                      const expired = c.expires_at ? new Date(c.expires_at) < new Date() : false;
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono font-semibold uppercase">{c.code}</TableCell>
                          <TableCell>
                            <span className="font-medium">{showValue(c)}</span>
                            <span className="text-xs text-muted-foreground ml-1">
                              {c.discount_type === "percent" ? "off" : "flat"}
                            </span>
                          </TableCell>
                          <TableCell className="tabular-nums">
                            <span className={cn(exhausted && "text-rose-600 font-medium")}>
                              {c.used_count}/{c.max_uses}
                            </span>
                          </TableCell>
                          <TableCell className="hidden md:table-cell whitespace-nowrap text-sm">
                            <span className={cn(expired && "text-rose-600")}>
                              {c.expires_at ? fmtDate(c.expires_at) : "Never"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Switch checked={c.is_active} onCheckedChange={() => toggle(c)} aria-label={"Toggle " + c.code} />
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                              onClick={() => setToDelete(c)} aria-label={"Delete " + c.code}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader className="text-left">
            <DialogTitle>New coupon</DialogTitle>
            <DialogDescription>Saving an existing code updates it instead of creating a duplicate.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="c-code">Code</Label>
              <Input id="c-code" value={form.code} placeholder="SAVE200"
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                className="font-mono tracking-widest uppercase" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="c-type">Type</Label>
                <Select value={form.discount_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, discount_type: v as "flat" | "percent" }))}>
                  <SelectTrigger id="c-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat">Flat (rupees)</SelectItem>
                    <SelectItem value="percent">Percent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-amount">{form.discount_type === "flat" ? "Amount (rupees)" : "Percent"}</Label>
                <Input id="c-amount" type="number" min="0" step={form.discount_type === "flat" ? "1" : "0.1"}
                  value={form.amount} placeholder={form.discount_type === "flat" ? "200" : "20"}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="c-uses">Max uses</Label>
                <Input id="c-uses" type="number" min="1" value={form.max_uses}
                  onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-exp">Expires (optional)</Label>
                <Input id="c-exp" type="date" value={form.expires_at}
                  onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3 gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Active immediately</p>
                <p className="text-xs text-muted-foreground">Inactive codes are rejected at checkout.</p>
              </div>
              <Switch checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} aria-label="Active" />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button className="bg-violet-600 hover:bg-violet-700 w-full sm:w-auto" onClick={save} disabled={saving}>
              {saving ? <RefreshCcw className="h-4 w-4 mr-1.5 animate-spin" /> : <Ticket className="h-4 w-4 mr-1.5" />}
              Save coupon
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this coupon?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{toDelete?.code}</strong> will stop working at checkout. This cannot be undone;
              disable it instead if you may want it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700"
              onClick={() => toDelete && remove(toDelete)}>
              Delete coupon
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Grant trial ────────────────────────────────────────────
const TRIAL_DURATIONS = [7, 14, 28, 90];

/**
 * grant_admin_trial upserts, so it REPLACES whatever plan the account is on.
 * Typing an email and pressing the button used to be a blind write: get the
 * address slightly wrong and you wipe a paying customer's annual plan. So the
 * account is looked up first, shown in full, and overwriting a live paid plan
 * takes a second confirmation.
 */
function GrantTrialTab({ onGranted }: { onGranted: () => void }) {
  const [targetEmail, setTargetEmail] = useState("");
  const [trialDays, setTrialDays] = useState(7);
  const [customDays, setCustomDays] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [looking, setLooking] = useState(false);
  const [match, setMatch] = useState<Subscriber | null>(null);
  const [searched, setSearched] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [withWholesale, setWithWholesale] = useState(false);
  const [granted, setGranted] = useState<{ email: string; days: number; wholesale: boolean } | null>(null);

  const days = customDays.trim() ? Math.max(1, Math.min(365, parseInt(customDays) || 0)) : trialDays;

  // Look the address up as it is typed, so the owner sees who they are about
  // to change before anything is written.
  useEffect(() => {
    const term = targetEmail.trim();
    if (term.length < 3) { setMatch(null); setSearched(false); return; }
    let cancelled = false;
    setLooking(true);
    const t = setTimeout(async () => {
      try {
        const { data, error } = await db.rpc("admin_list_subscribers", { search_term: term, row_limit: 5 });
        if (cancelled) return;
        if (error) throw error;
        const rows = (data ?? []) as Subscriber[];
        const exact = rows.find((r) => r.email.toLowerCase() === term.toLowerCase());
        setMatch(exact ?? (rows.length === 1 ? rows[0] : null));
      } catch {
        if (!cancelled) setMatch(null);
      } finally {
        if (!cancelled) { setLooking(false); setSearched(true); }
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [targetEmail]);

  const currentKind = planKind(match?.plan_type);
  const left = daysLeft(match?.current_period_end ?? null);
  const replacingPaid = Boolean(
    match && currentKind === "Paid" && match.status === "active" && (left === null || left >= 0),
  );

  const doGrant = async () => {
    if (!match) return;
    setIsLoading(true);
    try {
      // admin_grant_trial picks the plan name, so wholesale trials are written
      // as trial_wholesale_<days>_days and never counted as revenue.
      const { error } = await db.rpc("admin_grant_trial", {
        target_user_id: match.user_id,
        trial_days: days,
        with_wholesale: withWholesale,
      });
      if (error) throw error;
      setGranted({ email: match.email, days, wholesale: withWholesale });
      toast.success(
        match.email + " now has " + days + " days of "
        + (withWholesale ? "access including wholesale billing." : "access."));
      setTargetEmail("");
      setMatch(null);
      setSearched(false);
      onGranted();
    } catch (e) {
      toast.error(errMsg(e, "Could not grant the trial."));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3 overflow-hidden">
          {/* Same banded header language as the drill-down popups */}
          <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-4 sm:px-6 py-4">
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="h-11 w-11 rounded-xl bg-white/20 grid place-items-center shrink-0">
                <UserPlus className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-white text-lg sm:text-xl font-bold leading-tight">Grant free access</h2>
                <p className="text-white/80 text-xs sm:text-sm mt-0.5">
                  For demos, support fixes and win-backs. No payment taken.
                </p>
              </div>
            </div>
          </div>

          <CardContent className="p-4 sm:p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="trial-email">Account email</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="trial-email"
                  placeholder="owner@pharmacy.in"
                  value={targetEmail}
                  onChange={(e) => setTargetEmail(e.target.value)}
                  type="email"
                  autoComplete="off"
                  className="pl-9"
                />
                {looking && (
                  <RefreshCcw className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                The account is looked up as you type, so you can check it before anything changes.
              </p>
            </div>

            {/* Who this is about to affect */}
            {match ? (
              <div className="rounded-xl border bg-slate-50/60 p-3">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-emerald-50 text-emerald-700 grid place-items-center font-bold text-sm shrink-0">
                    {initialOf(match)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-slate-900 truncate">
                      {match.account_name || "No store name"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{match.email}</p>
                  </div>
                  <Badge variant="outline" className={cn("text-[10px] font-semibold shrink-0", subState(match).tone)}>
                    {subState(match).label}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs border-t mt-3 pt-3">
                  <div>
                    <dt className="text-muted-foreground">Current plan</dt>
                    <dd className="font-medium text-slate-800 truncate">
                      {match.plan_type ? planLabel(match.plan_type) : "No subscription"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Expires</dt>
                    <dd className="font-medium text-slate-800">
                      {fmtDate(match.current_period_end)}
                      {left !== null && (
                        <span className="text-muted-foreground font-normal">
                          {" "}({left < 0 ? Math.abs(left) + "d ago" : left + "d left"})
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : searched && targetEmail.trim().length >= 3 && !looking ? (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-900">
                  No account matches that address. Check the spelling, or ask them to sign up first.
                </p>
              </div>
            ) : null}

            {/* Overwriting a live paid plan is the dangerous case */}
            {replacingPaid && (
              <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-sm text-rose-900">
                  <p className="font-medium">This account is on a paid plan</p>
                  <p className="mt-0.5">
                    Granting a trial replaces {planLabel(match?.plan_type)} and shortens their access to {days} days.
                    Use Accounts {"\u2192"} Manage to extend instead.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Length of access</Label>
              <div className="grid grid-cols-4 gap-2">
                {TRIAL_DURATIONS.map((d) => (
                  <Button
                    key={d}
                    type="button"
                    variant={!customDays.trim() && trialDays === d ? "default" : "outline"}
                    onClick={() => { setTrialDays(d); setCustomDays(""); }}
                    className={!customDays.trim() && trialDays === d
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}
                  >
                    {d}d
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Label htmlFor="trial-custom" className="text-xs text-muted-foreground shrink-0">
                  or custom
                </Label>
                <Input
                  id="trial-custom"
                  type="number"
                  min={1}
                  max={365}
                  placeholder="days"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  className="h-9 w-28"
                />
                <span className="text-xs text-muted-foreground">max 365</span>
              </div>
            </div>

            {/* Wholesale is a separate entitlement, so it is an explicit choice */}
            <div className={cn(
              "flex items-start justify-between gap-3 rounded-xl border p-3 transition-colors",
              withWholesale ? "border-violet-300 bg-violet-50/60" : "border-slate-200 bg-white",
            )}>
              <div className="flex items-start gap-3 min-w-0">
                <div className={cn(
                  "h-9 w-9 rounded-lg grid place-items-center shrink-0 transition-colors",
                  withWholesale ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500",
                )}>
                  <Diamond className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="trial-wholesale" className="text-sm font-medium text-slate-900 cursor-pointer">
                    Include wholesale billing
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {withWholesale
                      ? "B2B invoicing, free-qty and wholesale reports are unlocked for the trial."
                      : "Off means the base app only. Wholesale stays locked."}
                  </p>
                </div>
              </div>
              <Switch
                id="trial-wholesale"
                checked={withWholesale}
                onCheckedChange={setWithWholesale}
                aria-label="Include wholesale billing"
              />
            </div>

            <Button
              onClick={() => (replacingPaid ? setConfirmOverwrite(true) : doGrant())}
              disabled={isLoading || !match}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              size="lg"
            >
              {isLoading
                ? <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />
                : <UserPlus className="mr-2 h-4 w-4" />}
              {match
                ? "Grant " + days + " days" + (withWholesale ? " with wholesale" : "")
                : "Find an account first"}
            </Button>
          </CardContent>
        </Card>

        {/* What this actually does */}
        <Card className="lg:col-span-2 bg-slate-50/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">What happens</CardTitle>
            <CardDescription>Before you press the button</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex gap-3">
              <div className="h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-xs font-bold shrink-0">1</div>
              <p className="text-slate-700">
                The plan becomes{" "}
                <code className="text-xs bg-slate-200/70 px-1 py-0.5 rounded break-all">
                  {withWholesale ? "trial_wholesale_" + days + "_days" : "trial_" + days + "_days"}
                </code>
                , active immediately.
              </p>
            </div>
            <div className="flex gap-3">
              <div className="h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-xs font-bold shrink-0">2</div>
              <p className="text-slate-700">Access expires {days} days from now.</p>
            </div>
            <div className="flex gap-3">
              <div className={cn(
                "h-6 w-6 rounded-full grid place-items-center text-xs font-bold shrink-0",
                withWholesale ? "bg-violet-100 text-violet-700" : "bg-slate-200 text-slate-600",
              )}>
                <Diamond className="h-3 w-3" />
              </div>
              <p className="text-slate-700">
                {withWholesale
                  ? "Wholesale billing is included, and it costs nothing: a wholesale trial adds zero to your recurring revenue."
                  : "Wholesale billing is not included. Turn the switch on to add it."}
              </p>
            </div>
            <div className="flex gap-3">
              <div className="h-6 w-6 rounded-full bg-rose-100 text-rose-700 grid place-items-center text-xs font-bold shrink-0">3</div>
              <p className="text-slate-700">
                Any existing plan is <strong>replaced</strong>, not extended. To add time to a paying
                account, open it under Accounts and use the extend buttons.
              </p>
            </div>

            {granted && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 mt-4">
                <BadgeCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-900">
                  Granted {granted.days} days{granted.wholesale ? " with wholesale" : ""} to{" "}
                  <strong className="break-all">{granted.email}</strong>.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmOverwrite} onOpenChange={setConfirmOverwrite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace a paid plan with a trial?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="break-all">{match?.email}</strong> is on {planLabel(match?.plan_type)}
              {match?.current_period_end ? ", valid until " + fmtDate(match.current_period_end) : ""}.
              Granting a {days} day trial replaces it and they lose the remaining time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep their plan</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => { setConfirmOverwrite(false); doGrant(); }}
            >
              Replace with a trial
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
