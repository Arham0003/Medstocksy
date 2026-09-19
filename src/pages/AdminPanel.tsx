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
  Search, Clock, Diamond, Building2, AlertTriangle, Plus, Trash2, Settings2, BadgeCheck,
} from "lucide-react";
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
  no_subscription: number;
  new_accounts_30d: number;
  plan_mix: { plan_type: string; count: number }[];
}

interface Subscriber {
  user_id: string;
  email: string;
  account_id: string | null;
  account_name: string | null;
  plan_type: string | null;
  status: string | null;
  current_period_end: string | null;
  signed_up_at: string | null;
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

/** Plans the panel can assign, with the period each one implies. */
const PLAN_OPTIONS = [
  { value: "trial_7_days", label: "Trial — 7 days", days: 7 },
  { value: "trial_28_days", label: "Trial — 28 days", days: 28 },
  { value: "testing_weekly", label: "Testing plan — 7 days", days: 7 },
  { value: "professional_monthly", label: "Professional — monthly", days: 30 },
  { value: "professional_annual", label: "Professional — annual", days: 365 },
  { value: "wholesale_monthly", label: "Professional + Wholesale — monthly", days: 30 },
  { value: "wholesale_annual", label: "Professional + Wholesale — annual", days: 365 },
];

const WHOLESALE_PLANS = ["wholesale_monthly", "wholesale_annual"];

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const daysLeft = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / 86400000);
};

/** One consistent read of a subscriber's state, used for the badge and sorting. */
function subState(s: Subscriber): { label: string; tone: string } {
  if (!s.plan_type) return { label: "No plan", tone: "bg-slate-100 text-slate-600 border-slate-200" };
  const left = daysLeft(s.current_period_end);
  if (s.status !== "active") return { label: s.status ?? "inactive", tone: "bg-rose-50 text-rose-700 border-rose-200" };
  if (left !== null && left < 0) return { label: "Expired", tone: "bg-rose-50 text-rose-700 border-rose-200" };
  if (left !== null && left <= 7) return { label: `${left}d left`, tone: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: "Active", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" };
}

const errMsg = (e: unknown, fallback: string) => {
  const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? "");
  if (/not authorized/i.test(m)) return "Not authorized — this account is not a platform admin.";
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

  return (
    <div className="space-y-6">
      {/* Header — matches the gradient-title convention used across the app */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-orange-600 to-amber-600 bg-clip-text text-transparent">
            Admin Control
          </h1>
          <p className="text-muted-foreground text-lg mt-2">
            Platform-wide subscriptions, coupons and account access
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-50 border border-orange-200 text-xs text-orange-700">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="font-medium">Restricted area</span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="w-full h-auto p-1 bg-slate-100/80 rounded-xl flex-wrap justify-start sm:justify-center">
          <TabsTrigger value="overview" className="flex-1 sm:flex-none gap-2 data-[state=active]:bg-white data-[state=active]:text-orange-700 data-[state=active]:shadow-sm py-2 px-3">
            <LayoutDashboard className="h-4 w-4" />
            <span className="hidden sm:inline">Overview</span>
            <span className="sm:hidden">Stats</span>
          </TabsTrigger>
          <TabsTrigger value="subscribers" className="flex-1 sm:flex-none gap-2 data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm py-2 px-3">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Subscribers</span>
            <span className="sm:hidden">Users</span>
          </TabsTrigger>
          <TabsTrigger value="coupons" className="flex-1 sm:flex-none gap-2 data-[state=active]:bg-white data-[state=active]:text-violet-700 data-[state=active]:shadow-sm py-2 px-3">
            <Ticket className="h-4 w-4" />
            <span>Coupons</span>
          </TabsTrigger>
          <TabsTrigger value="trial" className="flex-1 sm:flex-none gap-2 data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm py-2 px-3">
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Grant Trial</span>
            <span className="sm:hidden">Trial</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6"><OverviewTab /></TabsContent>
        <TabsContent value="subscribers" className="mt-6"><SubscribersTab /></TabsContent>
        <TabsContent value="coupons" className="mt-6"><CouponsTab /></TabsContent>
        <TabsContent value="trial" className="mt-6"><GrantTrialTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────
function OverviewTab() {
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

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <Card className="border-rose-200 bg-rose-50/40">
        <CardContent className="p-6 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium text-rose-900">Couldn't load the overview</p>
            <p className="text-sm text-rose-700 mt-1 break-words">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={load}>
              <RefreshCcw className="h-3.5 w-3.5 mr-1.5" /> Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const v = (n?: number) => (loading ? "—" : String(n ?? 0));

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCcw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardStatCard title="Accounts" value={v(stats?.total_accounts)} icon={Building2}
          variant="info" loading={loading} description={`${stats?.new_accounts_30d ?? 0} new in 30 days`} />
        <DashboardStatCard title="Active subscriptions" value={v(stats?.active_subs)} icon={BadgeCheck}
          variant="success" loading={loading} description="Currently paid or on trial" />
        <DashboardStatCard title="Expiring in 7 days" value={v(stats?.expiring_7d)} icon={Clock}
          variant="warning" loading={loading} description="Needs a renewal nudge" />
        <DashboardStatCard title="Wholesale plans" value={v(stats?.wholesale_subs)} icon={Diamond}
          variant="primary" loading={loading} description="On a B2B plan" />
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <DashboardStatCard title="Trials running" value={v(stats?.trial_subs)} icon={Clock}
          variant="default" loading={loading} />
        <DashboardStatCard title="Expired / cancelled" value={v(stats?.expired)} icon={AlertTriangle}
          variant="danger" loading={loading} />
        <DashboardStatCard title="Never subscribed" value={v(stats?.no_subscription)} icon={Users}
          variant="default" loading={loading} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Plan mix</CardTitle>
          <CardDescription>Active subscriptions grouped by plan</CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {loading ? (
            <TableSkeleton rows={4} cols={["w-48", "w-16"]} />
          ) : !stats?.plan_mix?.length ? (
            <div className="text-center py-10 px-4">
              <p className="font-medium text-slate-800">No active subscriptions yet</p>
              <p className="text-sm text-muted-foreground mt-1">Plans will appear here once users subscribe.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Plan</TableHead><TableHead className="text-right">Accounts</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {stats.plan_mix.map((p) => (
                  <TableRow key={p.plan_type}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {WHOLESALE_PLANS.includes(p.plan_type) && <Diamond className="h-3.5 w-3.5 text-violet-500" />}
                        {PLAN_OPTIONS.find((o) => o.value === p.plan_type)?.label ?? p.plan_type}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{p.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Subscribers ────────────────────────────────────────────────────────────
function SubscribersTab() {
  const [rows, setRows] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [managing, setManaging] = useState<Subscriber | null>(null);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await db.rpc("admin_list_subscribers", {
        search_term: term.trim() || null,
        row_limit: 100,
      });
      if (e) throw e;
      setRows((data ?? []) as Subscriber[]);
    } catch (e) {
      setError(errMsg(e, "Could not load subscribers."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(""); }, [load]);

  // Debounce so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(search), 350);
    return () => clearTimeout(t);
  }, [search, load]);

  return (
    <div className="space-y-4">
      <Card className="border-slate-200">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by email or store name…"
                className="h-10 pl-9"
                aria-label="Search subscribers"
              />
            </div>
            <Button variant="outline" onClick={() => load(search)} disabled={loading} className="h-10">
              <RefreshCcw className={cn("h-4 w-4 mr-1.5", loading && "animate-spin")} /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Subscribers</CardTitle>
          <CardDescription>
            {loading ? "Loading…" : `${rows.length} account${rows.length === 1 ? "" : "s"}${search ? " matching" : ""}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {error ? (
            <div className="m-4 sm:m-0 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50/60 p-4">
              <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-medium text-rose-900">Couldn't load subscribers</p>
                <p className="text-sm text-rose-700 mt-1 break-words">{error}</p>
              </div>
            </div>
          ) : loading ? (
            <TableSkeleton rows={6} cols={["w-52", "w-40", "w-32", "w-24", "w-24", "w-20"]} />
          ) : rows.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-slate-100 grid place-items-center">
                <Users className="h-6 w-6 text-slate-400" />
              </div>
              <p className="font-medium text-slate-800">
                {search ? "No account matches that search" : "No accounts yet"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {search ? "Try a different email or store name." : "Accounts appear here as users sign up."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead className="hidden md:table-cell">Store</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Expires</TableHead>
                    <TableHead className="w-24 text-right">Manage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((s) => {
                    const st = subState(s);
                    const isWholesale = s.plan_type ? WHOLESALE_PLANS.includes(s.plan_type) : false;
                    return (
                      <TableRow key={s.user_id}>
                        <TableCell className="font-medium max-w-[220px] truncate" title={s.email}>{s.email}</TableCell>
                        <TableCell className="hidden md:table-cell max-w-[160px] truncate" title={s.account_name ?? ""}>
                          {s.account_name || "—"}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-sm">
                            {isWholesale && <Diamond className="h-3.5 w-3.5 text-violet-500 shrink-0" />}
                            {s.plan_type
                              ? PLAN_OPTIONS.find((o) => o.value === s.plan_type)?.label ?? s.plan_type
                              : <span className="text-muted-foreground">—</span>}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[11px] font-semibold", st.tone)}>{st.label}</Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell whitespace-nowrap text-sm">
                          {fmtDate(s.current_period_end)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => setManaging(s)} aria-label={`Manage ${s.email}`}>
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ManageSubscriberDialog
        subscriber={managing}
        onClose={() => setManaging(null)}
        onDone={() => { setManaging(null); load(search); }}
      />
    </div>
  );
}

function ManageSubscriberDialog({
  subscriber, onClose, onDone,
}: { subscriber: Subscriber | null; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<string>("professional_monthly");
  const [days, setDays] = useState<number>(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  // Re-seed the form whenever a different subscriber is opened.
  useEffect(() => {
    if (!subscriber) return;
    const current = PLAN_OPTIONS.find((o) => o.value === subscriber.plan_type);
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

  return (
    <>
      <Dialog open={!!subscriber} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="truncate">{subscriber.email}</DialogTitle>
            <DialogDescription>
              {subscriber.account_name || "No store name"} · joined {fmtDate(subscriber.signed_up_at)}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-slate-50/60 p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Current plan</p>
              <p className="font-medium text-sm truncate">
                {subscriber.plan_type
                  ? PLAN_OPTIONS.find((o) => o.value === subscriber.plan_type)?.label ?? subscriber.plan_type
                  : "No subscription"}
              </p>
            </div>
            <div className="text-right shrink-0">
              <Badge variant="outline" className={cn("text-[11px] font-semibold", st.tone)}>{st.label}</Badge>
              <p className="text-xs text-muted-foreground mt-1">{fmtDate(subscriber.current_period_end)}</p>
            </div>
          </div>

          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <Label htmlFor="admin-plan">Set plan</Label>
              <Select
                value={plan}
                onValueChange={(v) => {
                  setPlan(v);
                  const d = PLAN_OPTIONS.find((o) => o.value === v)?.days;
                  if (d) setDays(d);
                }}
              >
                <SelectTrigger id="admin-plan"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLAN_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
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
              variant="outline"
              className="w-full sm:w-auto"
              disabled={!!busy || !subscriber.plan_type}
              onClick={() => run("extend",
                () => db.rpc("admin_extend_subscription", { target_user_id: subscriber.user_id, extra_days: 30 }),
                "Extended by 30 days.")}
            >
              {busy === "extend" ? <RefreshCcw className="h-4 w-4 mr-1.5 animate-spin" /> : <Clock className="h-4 w-4 mr-1.5" />}
              +30 days
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
              <strong>{subscriber.email}</strong> will be marked cancelled and lose access immediately.
              You can grant a new plan afterwards.
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
      toast.success(`Coupon ${code} saved.`);
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
      toast.success(`${c.code} ${c.is_active ? "disabled" : "enabled"}.`);
    } catch (e) {
      toast.error(errMsg(e, "Could not update the coupon."));
    }
  };

  const remove = async (c: Coupon) => {
    try {
      const { error: e } = await db.rpc("admin_delete_coupon", { coupon_id: c.id });
      if (e) throw e;
      toast.success(`${c.code} deleted.`);
      load();
    } catch (e) {
      toast.error(errMsg(e, "Could not delete the coupon."));
    } finally {
      setToDelete(null);
    }
  };

  const showValue = (c: Coupon) =>
    c.discount_type === "percent" ? `${c.discount_value}%` : `₹${(Number(c.discount_value) / 100).toFixed(2)}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-lg font-semibold">Coupon codes</CardTitle>
              <CardDescription>
                Used by the Razorpay checkout. Flat discounts are stored in paise.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                <RefreshCcw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} /> Refresh
              </Button>
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700"
                onClick={() => { setForm(blankCoupon); setOpen(true); }}>
                <Plus className="h-4 w-4 mr-1.5" /> New coupon
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {error ? (
            <div className="m-4 sm:m-0 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50/60 p-4">
              <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-medium text-rose-900">Couldn't load coupons</p>
                <p className="text-sm text-rose-700 mt-1 break-words">{error}</p>
              </div>
            </div>
          ) : loading ? (
            <TableSkeleton rows={4} cols={["w-32", "w-24", "w-20", "w-20", "w-24", "w-16"]} />
          ) : rows.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-violet-50 grid place-items-center">
                <Ticket className="h-6 w-6 text-violet-500" />
              </div>
              <p className="font-medium text-slate-800">No coupons yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create one and it works at checkout immediately.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead className="hidden sm:table-cell">Used</TableHead>
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
                        <TableCell className="hidden sm:table-cell tabular-nums">
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
                          <Switch
                            checked={c.is_active}
                            onCheckedChange={() => toggle(c)}
                            aria-label={`Toggle ${c.code}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                            onClick={() => setToDelete(c)} aria-label={`Delete ${c.code}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / update */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
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
                    <SelectItem value="flat">Flat (₹)</SelectItem>
                    <SelectItem value="percent">Percent (%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-amount">{form.discount_type === "flat" ? "Amount (₹)" : "Percent (%)"}</Label>
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
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active immediately</p>
                <p className="text-xs text-muted-foreground">Inactive codes are rejected at checkout.</p>
              </div>
              <Switch checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} aria-label="Active" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button className="bg-violet-600 hover:bg-violet-700" onClick={save} disabled={saving}>
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
              <strong>{toDelete?.code}</strong> will stop working at checkout. This can't be undone —
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

// ─── Grant trial (the original flow, restyled) ──────────────────────────────
function GrantTrialTab() {
  const [targetEmail, setTargetEmail] = useState("");
  const [trialDays, setTrialDays] = useState(7);
  const [isLoading, setIsLoading] = useState(false);

  const handleGrantTrial = async () => {
    if (!targetEmail.trim()) {
      toast.error("Please enter an email address");
      return;
    }
    setIsLoading(true);
    try {
      const { data: userId, error: userError } = await db.rpc("get_user_id_by_email", {
        email_input: targetEmail.trim(),
      });
      if (userError) throw userError;
      if (!userId) {
        toast.error("User not found: " + targetEmail);
        return;
      }

      const { error: subError } = await db.rpc("grant_admin_trial", {
        target_user_id: userId,
        trial_days: trialDays,
      });
      if (subError) throw subError;

      toast.success(`Success! ${targetEmail} now has ${trialDays} days of access.`);
      setTargetEmail("");
    } catch (e) {
      toast.error(errMsg(e, "An error occurred."));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-emerald-200 bg-emerald-50/30 max-w-2xl">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-100 shrink-0">
            <UserPlus className="h-5 w-5 text-emerald-700" />
          </div>
          <div>
            <CardTitle className="text-lg font-semibold text-slate-900">Grant a free trial</CardTitle>
            <CardDescription>
              Unlock access without payment — for demos or resolving support issues.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="bg-white p-4 sm:p-6 rounded-lg border shadow-sm space-y-5">
          <div className="space-y-2">
            <Label>Trial duration</Label>
            <div className="flex gap-3">
              {[7, 28].map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant={trialDays === d ? "default" : "outline"}
                  onClick={() => setTrialDays(d)}
                  className={trialDays === d
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}
                >
                  {d} Days
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="trial-email">User email address</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="trial-email"
                placeholder="user@example.com"
                value={targetEmail}
                onChange={(e) => setTargetEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleGrantTrial(); }}
                type="email"
                className="flex-1"
              />
              <Button onClick={handleGrantTrial} disabled={isLoading}
                className="bg-emerald-600 hover:bg-emerald-700 w-full sm:w-auto">
                {isLoading ? <RefreshCcw className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                Grant {trialDays} days
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Sets the plan to <code>trial_{trialDays}_days</code>, expiring {trialDays} days from now.
              This overwrites any existing plan.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
