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
  Trash2
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

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
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [productsRes, salesRes, salesForCrmRes] = await Promise.all([
          supabase.from('products').select('quantity, low_stock_threshold, expiry_date'),
          supabase.from('sales').select('id, created_at'),
          supabase.from('sales').select('id, created_at, prescription_months, months_taken')
        ]);

        // Define types for the fetched data to avoid type errors
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
        const expired = products.filter(p => p.expiry_date && new Date(p.expiry_date) < now).length;
        const expiringSoon = products.filter(p => {
          if (!p.expiry_date) return false;
          const exp = new Date(p.expiry_date);
          const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          return diffDays >= 0 && diffDays <= 30;
        }).length;

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

        setStats({
          totalProducts: products.length,
          lowStock: products.filter(p => p.quantity <= (p.low_stock_threshold || 10)).length,
          todaySales: todaySales.length,
          expired,
          expiringSoon,
          activePrescriptions,
          dueRefills,
        });
      } catch (error) {
        console.error('Error fetching stats:', error);
      } finally {
        setLoading(false);
      }
    };

    if (profile?.account_id) fetchStats();
  }, [profile]);

  return (
    <div className="space-y-8">
      <div className="text-center py-6">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Store Dashboard
        </h1>
        <p className="text-muted-foreground text-lg mt-2">
          Manage your inventory and business performance
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
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
          title="Expired Items"
          value={loading ? '-' : stats.expired}
          icon={Trash2}
          variant="default"
          description="Remove or return stock"
        />

        <DashboardStatCard
          title="Expiring Soon"
          value={loading ? '-' : stats.expiringSoon}
          icon={Clock}
          variant="danger"
          description="Within 30 days"
        />

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

      <Card className="shadow-lg border-0 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">Quick Actions</CardTitle>
          <CardDescription className="text-center">Manage your inventory efficiently</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
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
    </div>
  );
};

export default Index;