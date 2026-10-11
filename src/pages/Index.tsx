import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardStatCard } from '@/components/DashboardStatCard';
import {
  Package,
  ShoppingCart,
  AlertTriangle,
  Clock,
  FileText,
  RefreshCw,
  TrendingUp,
  Plus,
  Search,
  Trash2,
  CalendarClock,
  CheckCircle2,
  PieChart as PieChartIcon
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db_conn/supabaseClient';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend
} from 'recharts';

/** One unsettled credit bill, folded up from the rows sharing its bill_id. */
interface CreditDue {
  billId: string;
  customer: string;
  due: number;
  dueDate: string;
  isWholesale: boolean;
  overdue: boolean;
}

const Index = () => {
  const { isOwner, profile } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalProducts: 0,
    lowStock: 0,
    todaySales: 0,
    expired: 0,
    expiringSoon: 0,
    activePrescriptions: 0,
    dueRefills: 0,
    totalCredit: 0,
    healthy: 0,
  });
  const [creditDues, setCreditDues] = useState<CreditDue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Seven days ahead, per the PRD. Computed once so the query and any
        // later comparison cannot drift apart.
        const windowEnd = new Date();
        windowEnd.setDate(windowEnd.getDate() + 7);
        const dueWindowEnd = windowEnd.toISOString().slice(0, 10);

        const [productsRes, salesRes, salesForCrmRes, creditRes, duesRes] = await Promise.all([
          supabase.from('products').select('quantity, low_stock_threshold, expiry_date') as any,
          supabase.from('sales').select('id, created_at') as any,
          supabase.from('sales').select('id, created_at, prescription_months, months_taken') as any,
          supabase.from('sales').select('total_price, received_amount').eq('is_settled', false) as any,
          // Unsettled credit falling due inside the next week, plus anything
          // already overdue. Account scoping comes from RLS. The partial index
          // on (account_id, credit_due_date) backs exactly this filter.
          supabase
            .from('sales')
            .select('bill_id, customer_name, wholesale_customer_name, total_price, received_amount, credit_due_date, sale_type')
            .eq('payment_mode', 'credit')
            .eq('is_settled', false)
            .not('credit_due_date', 'is', null)
            .lte('credit_due_date', dueWindowEnd)
            .order('credit_due_date', { ascending: true }) as any,
        ]);

        interface ProductData {
          quantity: number;
          low_stock_threshold: number;
          expiry_date: string | null;
        }

        interface SaleData {
          id: string;
          created_at: string;
          prescription_months?: number | null;
          months_taken?: number | null;
        }

        const products = (productsRes.data || []) as unknown as ProductData[];
        const sales = (salesRes.data || []) as unknown as SaleData[];
        const today = new Date().toISOString().split('T')[0];
        const todaySales = sales.filter(sale => sale.created_at?.startsWith(today));

        const now = new Date();
        const isExpired = (p: ProductData) => !!p.expiry_date && new Date(p.expiry_date) < now;
        const isExpiringSoon = (p: ProductData) => {
          if (!p.expiry_date) return false;
          const exp = new Date(p.expiry_date);
          const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          return diffDays >= 0 && diffDays <= 30;
        };
        const isLowStock = (p: ProductData) => p.quantity <= (p.low_stock_threshold || 10);

        const expired = products.filter(isExpired).length;
        const expiringSoon = products.filter(isExpiringSoon).length;
        const lowStock = products.filter(isLowStock).length;
        // Bucket each product once by priority: expired > expiring soon > low stock > healthy
        const healthy = products.filter(
          (p) => !isExpired(p) && !isExpiringSoon(p) && !isLowStock(p)
        ).length;

        const crm = (salesForCrmRes.data || []) as unknown as SaleData[];
        const activePrescriptions = crm.filter(s => (s.prescription_months ?? null) !== null && (s.months_taken ?? null) !== null && s.months_taken! < s.prescription_months!).length;
        const dueRefills = crm.filter(s => {
          if ((s.prescription_months ?? null) === null || (s.months_taken ?? null) === null) return false;
          if (!s.created_at) return false;
          const start = new Date(s.created_at);
          const elapsedDays = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
          const allowedDays = (s.months_taken! * 30);
          return s.months_taken! < s.prescription_months! && elapsedDays >= allowedDays;
        }).length;

        const totalCredit = (creditRes.data || []).reduce((sum, s: any) => {
          const bal = (s.total_price || 0) - (s.received_amount || 0);
          return sum + (bal > 0.01 ? bal : 0);
        }, 0);

        setStats({
          totalProducts: products.length,
          lowStock,
          todaySales: todaySales.length,
          expired,
          expiringSoon,
          activePrescriptions,
          dueRefills,
          totalCredit,
          healthy,
        });

        // A bill is many rows; the dues list is one line per invoice, so the
        // balance is accumulated across every row sharing a bill_id.
        if (!duesRes.error && duesRes.data) {
          const byBill = new Map<string, CreditDue>();
          for (const r of duesRes.data as Record<string, unknown>[]) {
            const key = String(r.bill_id || '');
            if (!key) continue;
            const balance = (Number(r.total_price) || 0) - (Number(r.received_amount) || 0);
            const existing = byBill.get(key);
            if (existing) {
              existing.due += balance;
              continue;
            }
            const dueDate = String(r.credit_due_date || '');
            byBill.set(key, {
              billId: key,
              customer: String(r.wholesale_customer_name || r.customer_name || 'Walk-in'),
              due: balance,
              dueDate,
              isWholesale: r.sale_type === 'wholesale',
              overdue: !!dueDate && dueDate < today,
            });
          }
          // Drop bills that are fully paid despite not being flagged settled,
          // then keep the most urgent first.
          setCreditDues(
            [...byBill.values()]
              .filter(d => d.due > 0.01)
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
          );
        }
      } catch (error) {
        console.error('Error fetching stats:', error);
      } finally {
        setLoading(false);
      }
    };

    if (profile?.account_id) fetchStats();
  }, [profile]);

  const stockHealthData = [
    { name: 'Healthy', value: stats.healthy, color: '#10b981' },
    { name: 'Low Stock', value: stats.lowStock, color: '#f59e0b' },
    { name: 'Expiring Soon', value: stats.expiringSoon, color: '#f43f5e' },
    { name: 'Expired', value: stats.expired, color: '#64748b' },
  ].filter(d => d.value > 0);


  return (
    <div className="space-y-10">
      {/* Title */}
      <div className="text-center py-6">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Medstocksy
        </h1>
        <p className="text-muted-foreground text-lg mt-2">
          Manage your Inventory and Pharmacy performance
        </p>
      </div>

      {/* Hero KPI row - the 4 headline metrics */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">At a glance</h2>
            <p className="text-sm text-muted-foreground">Your most important numbers today</p>
          </div>
        </div>
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <DashboardStatCard
            title="Total Products"
            value={loading ? '-' : stats.totalProducts}
            icon={Package}
            description="Items in inventory"
            variant="info"
            onClick={() => navigate('/products')}
          />
          <DashboardStatCard
            title="Today's Sales"
            value={loading ? '-' : stats.todaySales}
            icon={TrendingUp}
            variant="success"
            description="Transactions today"
            onClick={() => navigate('/sales')}
          />
          <DashboardStatCard
            title="Low Stock Alerts"
            value={loading ? '-' : stats.lowStock}
            icon={AlertTriangle}
            variant="warning"
            description="Items need restocking"
            onClick={() => navigate('/inventory')}
          />
          <DashboardStatCard
            title="Outstanding Credit"
            value={loading ? '-' : `\u20B9${stats.totalCredit.toFixed(2)}`}
            icon={TrendingUp}
            variant="primary"
            description="Unpaid customer dues"
            onClick={() => navigate('/reports')}
          />
        </div>
      </section>

      {/* Main content grid: chart (left) + activity feed (right) */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Insights</h2>
            <p className="text-sm text-muted-foreground">Stock health and recent activity</p>
          </div>
        </div>
        <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-3">
          {/* Chart - left (spans 2 cols on desktop) */}
          <Card className="lg:col-span-2 shadow-sm border-slate-200">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-50">
                  <PieChartIcon className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Stock Health Overview</CardTitle>
                  <CardDescription className="text-xs">
                    Distribution of products by status
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-[280px] flex items-center justify-center">
                  <div className="h-48 w-48 rounded-full bg-slate-100 animate-pulse" />
                </div>
              ) : stockHealthData.length === 0 ? (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                  No product data yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={stockHealthData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                    >
                      {stockHealthData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string) => [`${value} items`, name]}
                    />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Upcoming credit dues - right.
              Replaces the activity feed: what was just sold is already known,
              what is about to fall due is not. */}
          <Card className="shadow-sm border-slate-200">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-amber-50">
                  <CalendarClock className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Upcoming Credit Dues</CardTitle>
                  <CardDescription className="text-xs">
                    Unpaid credit falling due in the next 7 days, and anything already overdue
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-12 bg-slate-100 animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : creditDues.length === 0 ? (
                <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-center">
                  <div className="p-2.5 rounded-full bg-emerald-50">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  </div>
                  <p className="text-sm font-medium text-slate-700">Nothing due this week</p>
                  <p className="text-xs text-muted-foreground">
                    Credit sales with a due date inside 7 days appear here.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                  {creditDues.map((d) => (
                    <li
                      key={d.billId}
                      // Settlement lives where each sale type is already managed:
                      // wholesale invoices in Wholesale Reports, retail in the CRM.
                      onClick={() => navigate(d.isWholesale ? '/wholesale-reports' : '/customer-relation')}
                      className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        d.overdue
                          ? 'border-red-200 bg-red-50/60 hover:bg-red-50'
                          : 'border-amber-200 bg-amber-50/50 hover:bg-amber-50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {d.customer}
                          {d.isWholesale && (
                            <span className="ml-1.5 text-[10px] font-semibold uppercase text-violet-700">B2B</span>
                          )}
                        </p>
                        <p className={`text-xs truncate flex items-center gap-1 ${d.overdue ? 'text-red-700' : 'text-amber-700'}`}>
                          {d.overdue
                            ? <AlertTriangle className="h-3 w-3 shrink-0" />
                            : <Clock className="h-3 w-3 shrink-0" />}
                          {d.overdue ? 'Overdue since ' : 'Due '}
                          {new Date(d.dueDate).toLocaleDateString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric',
                          })}
                        </p>
                      </div>
                      <div className={`text-sm font-semibold whitespace-nowrap ${d.overdue ? 'text-red-700' : 'text-amber-800'}`}>
                        &#8377;{d.due.toFixed(2)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Inventory alerts */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Inventory Alerts</h2>
            <p className="text-sm text-muted-foreground">Items that need your attention</p>
          </div>
        </div>
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2">
          <DashboardStatCard
            title="Expiring Soon"
            value={loading ? '-' : stats.expiringSoon}
            icon={Clock}
            variant="danger"
            description="Within 30 days"
          />
          <DashboardStatCard
            title="Expired Items"
            value={loading ? '-' : stats.expired}
            icon={Trash2}
            variant="default"
            description="Remove or return stock"
          />
        </div>
      </section>

      {/* Customer care */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Customer Care</h2>
            <p className="text-sm text-muted-foreground">Prescriptions and follow-ups</p>
          </div>
        </div>
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2">
          <DashboardStatCard
            title="Active Prescriptions"
            value={loading ? '-' : stats.activePrescriptions}
            icon={FileText}
            variant="info"
            description="Ongoing courses"
          />
          <DashboardStatCard
            title="Due Refills"
            value={loading ? '-' : stats.dueRefills}
            icon={RefreshCw}
            variant="primary"
            description="Follow-ups required"
          />
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <Card className="shadow-lg border-0 bg-gradient-to-r from-blue-50 to-indigo-50">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center">Quick Actions</CardTitle>
            <CardDescription className="text-center">Manage your inventory efficiently</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
              <div onClick={() => navigate('/products')} className="group flex flex-col items-center p-6 bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer hover:-translate-y-1">
                <div className="bg-blue-50 p-4 rounded-full mb-4 group-hover:bg-blue-100 transition-colors">
                  <Plus className="h-8 w-8 text-blue-600" />
                </div>
                <h3 className="text-xl font-bold mb-2 text-slate-800">Add New Product</h3>
                <p className="text-muted-foreground text-center mb-3">Quickly add items to your inventory</p>
                <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100">Quick Setup</Badge>
              </div>

              <div onClick={() => navigate('/sales')} className="group flex flex-col items-center p-6 bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer hover:-translate-y-1">
                <div className="bg-emerald-50 p-4 rounded-full mb-4 group-hover:bg-emerald-100 transition-colors">
                  <ShoppingCart className="h-8 w-8 text-emerald-600" />
                </div>
                <h3 className="text-xl font-bold mb-2 text-slate-800">Record Sale</h3>
                <p className="text-muted-foreground text-center mb-3">Process sales transactions</p>
                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100">Fast Entry</Badge>
              </div>

              <div onClick={() => navigate('/inventory')} className="group flex flex-col items-center p-6 bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer hover:-translate-y-1">
                <div className="bg-amber-50 p-4 rounded-full mb-4 group-hover:bg-amber-100 transition-colors">
                  <Search className="h-8 w-8 text-amber-600" />
                </div>
                <h3 className="text-xl font-bold mb-2 text-slate-800">Check Stock</h3>
                <p className="text-muted-foreground text-center mb-3">Monitor inventory levels</p>
                <Badge variant="secondary" className="bg-amber-50 text-amber-700 hover:bg-amber-100">Instant</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
};

export default Index;
