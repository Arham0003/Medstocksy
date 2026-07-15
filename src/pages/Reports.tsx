import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { TableSkeleton } from '@/components/TableSkeleton';
import {
  Download,
  TrendingUp,
  Package,
  ShoppingCart,
  Eye,
  EyeOff,
  CalendarRange,
  Wallet,
  BarChart3,
  LineChart as LineChartIcon,
  Trophy,
  Receipt,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DashboardStatCard } from '@/components/DashboardStatCard';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface SalesReport {
  date: string;
  total_sales: number;
  total_quantity: number;
  total_gst: number;
  total_profit: number;
  transaction_count: number;
  sales_details: Array<{
    id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    received_amount: number;
    is_settled: boolean;
    created_at: string;
    sale_date?: string | null;
    payment_mode?: string | null;
  }>;
}

interface ProductSales {
  product_name: string;
  total_quantity: number;
  total_revenue: number;
}

interface PurchaseReturnReport {
  id: string;
  return_date: string;
  quantity: number;
  return_amount: number;
  reason: string | null;
  batch_number: string | null;
  suppliers: { name: string; supplier_code: string } | null;
  products: { name: string; category: string | null } | null;
}

export default function Reports() {
  const { isOwner } = useAuth();
  const { toast } = useToast();
  const [salesData, setSalesData] = useState<SalesReport[]>([]);
  const [productSales, setProductSales] = useState<ProductSales[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturnReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('7');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isProfitVisible, setIsProfitVisible] = useState(false);
  const [globalOutstandingCredit, setGlobalOutstandingCredit] = useState(0);
  // Pagination states for sales data
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  // Memoize filtered and paginated sales data
  const paginatedSalesData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return salesData.slice(startIndex, startIndex + itemsPerPage);
  }, [salesData, currentPage]);

  const fetchReports = async () => {
    try {
      setLoading(true);
      
      // --- STEP 1: Fetch Sales Data ---
      // Use 'as any' to avoid deep type instantiation errors in complex queries
      let salesQuery = (supabase as any)
        .from('sales')
        .select(`
          id,
          quantity,
          unit_price,
          total_price,
          gst_amount,
          created_at,
          sale_date,
          payment_mode,
          received_amount,
          is_settled,
          products(name, purchase_price)
        `)
        .order('created_at', { ascending: false });
      
      const days = parseInt(dateRange) || 7;
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      const fromDateStr = fromDate.toISOString().split('T')[0];

      if (dateRange === 'custom' && startDate && endDate) {
        salesQuery = salesQuery.gte('sale_date', startDate).lte('sale_date', endDate);
      } else {
        salesQuery = salesQuery.gte('sale_date', fromDateStr);
      }

      let { data: rawSales, error: salesError } = await salesQuery;

      // Fallback: If newer columns are missing, try a simpler query
      if (salesError && (salesError.message.includes('column') || salesError.message.includes('sale_date'))) {
        console.log("Reports: 'sale_date' or other columns missing, falling back to basic query");
        let fallbackQuery = (supabase as any)
          .from('sales')
          .select(`
            id,
            quantity,
            unit_price,
            total_price,
            gst_amount,
            created_at,
            products(name, purchase_price)
          `)
          .order('created_at', { ascending: false });

        if (dateRange === 'custom' && startDate && endDate) {
          fallbackQuery = fallbackQuery.gte('created_at', startDate).lte('created_at', endDate + 'T23:59:59');
        } else {
          fallbackQuery = fallbackQuery.gte('created_at', fromDateStr);
        }

        const res = await fallbackQuery;
        rawSales = res.data;
        salesError = res.error;
      }
      
      if (salesError) throw salesError;
      
      // Group by date
      const grouped = (rawSales || []).reduce((acc: any, sale: any) => {
        // Fallback: use sale_date or YYYY-MM-DD from created_at
        const date = sale.sale_date || (sale.created_at ? sale.created_at.split('T')[0] : 'Unknown');
        
        if (!acc[date]) {
          acc[date] = {
            date,
            total_sales: 0,
            total_quantity: 0,
            total_gst: 0,
            total_profit: 0,
            transaction_count: 0,
            sales_details: []
          };
        }
        acc[date].total_sales += (sale.total_price || 0);
        acc[date].total_quantity += (sale.quantity || 0);
        acc[date].total_gst += (sale.gst_amount || 0);
        
        const purchasePrice = sale.products?.purchase_price || 0;
        const profit = ((sale.unit_price || 0) - purchasePrice) * (sale.quantity || 0);
        acc[date].total_profit += profit;
        acc[date].transaction_count += 1;
        
        acc[date].sales_details.push({
          id: sale.id,
          product_name: sale.products?.name || 'Unknown Product',
          quantity: sale.quantity || 0,
          unit_price: sale.unit_price || 0,
          total_price: sale.total_price || 0,
          received_amount: sale.received_amount ?? sale.total_price ?? 0,
          is_settled: sale.is_settled ?? true,
          created_at: sale.created_at,
          sale_date: sale.sale_date,
          payment_mode: sale.payment_mode || 'cash'
        });
        
        return acc;
      }, {});
      
      setSalesData(Object.values(grouped) as SalesReport[]);

      // --- STEP 2: Fetch Product Sales Summary ---
      let productSalesQuery = (supabase as any)
        .from('sales')
        .select(`
          quantity,
          total_price,
          sale_date,
          created_at,
          products(name)
        `)
        .order('created_at', { ascending: false });

      if (dateRange === 'custom' && startDate && endDate) {
        productSalesQuery = productSalesQuery.gte('sale_date', startDate).lte('sale_date', endDate);
      } else {
        productSalesQuery = productSalesQuery.gte('sale_date', fromDateStr);
      }

      let { data: productData, error: productError } = await productSalesQuery;

      if (productError && productError.message.includes('column')) {
        let fallbackPQ = (supabase as any)
          .from('sales')
          .select(`quantity, total_price, created_at, products(name)`)
          .order('created_at', { ascending: false });

        if (dateRange === 'custom' && startDate && endDate) {
          fallbackPQ = fallbackPQ.gte('created_at', startDate).lte('created_at', endDate + 'T23:59:59');
        } else {
          fallbackPQ = fallbackPQ.gte('created_at', fromDateStr);
        }
        const res = await fallbackPQ;
        productData = res.data;
        productError = res.error;
      }

      if (productError) throw productError;

      const productSummary = (productData || []).reduce((acc: any, sale: any) => {
        const productName = sale.products?.name || 'Unknown Product';
        if (!acc[productName]) {
          acc[productName] = { product_name: productName, total_quantity: 0, total_revenue: 0 };
        }
        acc[productName].total_quantity += (sale.quantity || 0);
        acc[productName].total_revenue += (sale.total_price || 0);
        return acc;
      }, {});

      setProductSales(Object.values(productSummary));

      // --- STEP 3: Outstanding Credit ---
      try {
        const { data: allUnsettled, error: unsettledError } = await (supabase as any)
          .from('sales')
          .select('total_price, received_amount')
          .eq('is_settled', false);

        if (!unsettledError && allUnsettled) {
          const total = allUnsettled.reduce((sum: number, s: any) => {
            const balance = (s.total_price || 0) - (s.received_amount || 0);
            return sum + (balance > 0.01 ? balance : 0);
          }, 0);
          setGlobalOutstandingCredit(total);
        }
      } catch (err) {
        console.log("Outstanding credit fetch failed:", err);
        setGlobalOutstandingCredit(0);
      }

      // --- STEP 4: Purchase Returns (excludes voided) ---
      try {
        const buildQuery = (withVoidFilter: boolean) => {
          let q = (supabase as any)
            .from('purchase_returns')
            .select('id, return_date, quantity, return_amount, reason, batch_number, suppliers(name, supplier_code), products(name, category)')
            .order('return_date', { ascending: false });
          if (withVoidFilter) q = q.is('voided_at', null);
          if (dateRange === 'custom' && startDate && endDate) {
            q = q.gte('return_date', startDate).lte('return_date', endDate);
          } else {
            q = q.gte('return_date', fromDateStr);
          }
          return q;
        };

        let { data: prData, error: prError } = await buildQuery(true);
        // Migration not applied yet → retry without the voided_at filter
        if (prError && (prError.message?.includes('column') || prError.code === '42703')) {
          const fallback = await buildQuery(false);
          prData = fallback.data; prError = fallback.error;
        }

        if (!prError) {
          setPurchaseReturns((prData ?? []) as PurchaseReturnReport[]);
        } else if (prError.code === '42P01' || prError.message?.includes('does not exist')) {
          setPurchaseReturns([]);
        } else {
          console.warn('Purchase returns fetch error:', prError.message);
          setPurchaseReturns([]);
        }
      } catch (err) {
        setPurchaseReturns([]);
      }

    } catch (error: any) {
      console.error("Reports Fetch Error:", error);
      toast({
        variant: "destructive",
        title: "Error fetching reports",
        description: error.message?.includes('column') 
          ? "Some report data is unavailable. The database needs a migration." 
          : error.message,
      });
    } finally {
      setLoading(false);
    }

  };

  useEffect(() => {
    fetchReports();
  }, [dateRange, startDate, endDate]);

  const exportToCSV = (data: any[], filename: string) => {
    const headers = Object.keys(data[0] || {});
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(header => `"${row[header] || ''}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Memoize calculated totals
  const totalRevenue = useMemo(() => 
    salesData.reduce((sum, day) => sum + (day.total_sales || 0), 0), 
    [salesData]
  );
  
  const totalTransactions = useMemo(() => 
    salesData.reduce((sum, day) => sum + (day.transaction_count || 0), 0), 
    [salesData]
  );
  
  const totalQuantity = useMemo(() => 
    salesData.reduce((sum, day) => sum + (day.total_quantity || 0), 0), 
    [salesData]
  );
  
  const totalProfit = useMemo(() =>
    salesData.reduce((sum, day) => sum + (day.total_profit || 0), 0),
    [salesData]
  );

  const totalPurchaseReturns = useMemo(() =>
    purchaseReturns.reduce((sum, r) => sum + r.return_amount, 0),
    [purchaseReturns]
  );

  // Outstanding credit = sum of (total_price - received_amount) for ALL unsettled rows
  // This correctly accounts for:
  //   - Pure credit sales (received=0 → full amount is outstanding)
  //   - Partial upfront payments (e.g. ₹200 paid on ₹500 → ₹300 outstanding)
  //   - Settled sales (is_settled=true → ₹0 outstanding, not counted)
  //   - Old rows without these fields (fallback: treated as fully paid)
  const totalCredit = useMemo(() =>
    salesData.reduce((sum, day) => {
      return sum + day.sales_details.reduce((sSum, s: any) => {
        if (s.is_settled) return sSum; // fully settled — no balance owed
        const balance = Number(s.total_price || 0) - Number(s.received_amount || 0);
        return sSum + (balance > 0.01 ? balance : 0); // ignore floating-point dust
      }, 0);
    }, 0),
    [salesData]
  );

  // Chart-friendly daily revenue data (ascending by date)
  const dailyChartData = useMemo(() => {
    return [...salesData]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(d => ({
        date: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        rawDate: d.date,
        revenue: Number((d.total_sales || 0).toFixed(2)),
        profit: Number((d.total_profit || 0).toFixed(2)),
        transactions: d.transaction_count || 0,
      }));
  }, [salesData]);

  // Top 5 products by revenue (for the mini chart)
  const topProductsChart = useMemo(() => {
    return [...productSales]
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 5)
      .map(p => ({
        name: p.product_name.length > 16 ? p.product_name.slice(0, 15) + '…' : p.product_name,
        fullName: p.product_name,
        revenue: Number(p.total_revenue.toFixed(2)),
        units: p.total_quantity,
      }));
  }, [productSales]);

  // Handle page change
  const totalPages = Math.ceil(salesData.length / itemsPerPage);
  
  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  if (!isOwner) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">You don't have permission to access this page.</p>
      </div>
    );
  }

  const dateRangeLabel =
    dateRange === 'custom'
      ? (startDate && endDate ? `${startDate} → ${endDate}` : 'Custom range')
      : `Last ${dateRange} days`;

  return (
    <div className="space-y-8">
      {/* Header with gradient title + export dropdown */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Reports
          </h1>
          <p className="text-muted-foreground text-lg mt-2">
            Sales analytics and business insights
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="flex gap-2 items-center text-base py-2.5 px-4"
              disabled={salesData.length === 0 && productSales.length === 0}
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Download CSV</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={salesData.length === 0}
              onClick={() => exportToCSV(salesData, 'sales-report')}
              className="cursor-pointer"
            >
              <Receipt className="h-4 w-4 mr-2" />
              Sales Report
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={productSales.length === 0}
              onClick={() => exportToCSV(productSales, 'product-sales-report')}
              className="cursor-pointer"
            >
              <Package className="h-4 w-4 mr-2" />
              Product Sales
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Filter bar — date range */}
      <Card className="border-slate-200">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
              <div className="p-1.5 rounded-lg bg-blue-50">
                <CalendarRange className="h-4 w-4 text-blue-600" />
              </div>
              <span className="font-medium text-slate-800">Date range</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 flex-1">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
              {dateRange === 'custom' && (
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 flex-1">
                  <div className="flex items-center gap-2 flex-1">
                    <Label htmlFor="startDate" className="text-xs text-muted-foreground shrink-0 w-10">From</Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="h-10"
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-1">
                    <Label htmlFor="endDate" className="text-xs text-muted-foreground shrink-0 w-10">To</Label>
                    <Input
                      id="endDate"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="h-10"
                    />
                  </div>
                </div>
              )}
            </div>
            <Badge variant="secondary" className="bg-blue-50 text-blue-700 border border-blue-100 shrink-0">
              {dateRangeLabel}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* ═══ Section: At a glance — KPI cards ═══ */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">At a glance</h2>
            <p className="text-sm text-muted-foreground">Key metrics for the selected period</p>
          </div>
        </div>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <DashboardStatCard
            title="Total Revenue"
            value={loading ? '-' : `₹${totalRevenue.toFixed(2)}`}
            icon={TrendingUp}
            variant="success"
            description="Gross sales in range"
          />
          <DashboardStatCard
            title="Transactions"
            value={loading ? '-' : totalTransactions}
            icon={ShoppingCart}
            variant="info"
            description="Bills processed"
          />
          <DashboardStatCard
            title="Units Sold"
            value={loading ? '-' : totalQuantity}
            icon={Package}
            variant="primary"
            description="Total quantity moved"
          />
          {/* Profit card — keeps show/hide toggle */}
          <Card className="relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 border border-emerald-200">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 to-white opacity-50" />
            <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="space-y-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Profit
                </CardTitle>
                <CardDescription className="text-xs">Estimated margin</CardDescription>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-100">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
              </div>
            </CardHeader>
            <CardContent className="relative flex items-center justify-between">
              <div className="text-2xl font-bold tracking-tight text-emerald-700">
                {loading ? '-' : isProfitVisible ? `₹${totalProfit.toFixed(2)}` : '•••••'}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsProfitVisible(v => !v)}
                className="h-8 w-8 p-0 hover:bg-emerald-100"
                title={isProfitVisible ? 'Hide profit' : 'Show profit'}
              >
                {isProfitVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </CardContent>
          </Card>
          <DashboardStatCard
            title="Outstanding Credit"
            value={loading ? '-' : `₹${globalOutstandingCredit.toFixed(2)}`}
            icon={Wallet}
            variant="warning"
            description="All-time unpaid dues"
          />
          <DashboardStatCard
            title="Purchase Returns"
            value={loading ? '-' : `₹${totalPurchaseReturns.toFixed(2)}`}
            icon={RotateCcw}
            variant="warning"
            description={`${purchaseReturns.length} return(s) in period`}
          />
        </div>
      </section>

      {/* ═══ Section: Trends ═══ */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Trends</h2>
            <p className="text-sm text-muted-foreground">Revenue movement and top performers</p>
          </div>
        </div>
        <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-3">
          {/* Daily revenue area chart (wider) */}
          <Card className="lg:col-span-2 shadow-sm border-slate-200">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-50">
                  <LineChartIcon className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Daily Revenue</CardTitle>
                  <CardDescription className="text-xs">
                    Sales and estimated profit per day
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-[280px] flex items-center justify-center">
                  <div className="h-full w-full rounded-lg bg-slate-100 animate-pulse" />
                </div>
              ) : dailyChartData.length === 0 ? (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                  No sales in this range yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={dailyChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip
                      contentStyle={{
                        background: 'white',
                        border: '1px solid #e2e8f0',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value: number, name: string) => [`₹${value.toFixed(2)}`, name === 'revenue' ? 'Revenue' : 'Profit']}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#revenueGrad)"
                    />
                    {isProfitVisible && (
                      <Area
                        type="monotone"
                        dataKey="profit"
                        name="Profit"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#profitGrad)"
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Top products bar chart */}
          <Card className="shadow-sm border-slate-200">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-amber-50">
                  <Trophy className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Top 5 Products</CardTitle>
                  <CardDescription className="text-xs">
                    Best sellers by revenue
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-[280px] flex items-center justify-center">
                  <div className="h-full w-full rounded-lg bg-slate-100 animate-pulse" />
                </div>
              ) : topProductsChart.length === 0 ? (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                  No product sales yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={topProductsChart} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={false}
                      width={88}
                    />
                    <Tooltip
                      contentStyle={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}
                      formatter={(value: number, _name, entry) => [
                        `₹${value.toFixed(2)} · ${entry.payload.units} units`,
                        entry.payload.fullName,
                      ]}
                    />
                    <Bar dataKey="revenue" fill="#6366f1" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ═══ Section: Breakdown (tables) ═══ */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Breakdown</h2>
            <p className="text-sm text-muted-foreground">Row-level details for the period</p>
          </div>
        </div>
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
          <Card className="shadow-sm border-slate-200">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-emerald-50">
                    <BarChart3 className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-semibold">Daily Sales</CardTitle>
                    <CardDescription className="text-xs">
                      {totalPages > 1 ? `Page ${currentPage} of ${totalPages}` : `${salesData.length} days`}
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />
                ))}
              </div>
            ) : salesData.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No sales recorded for this period.
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead className="text-xs font-semibold text-slate-600">Date</TableHead>
                      <TableHead className="text-xs font-semibold text-slate-600 text-right">Revenue</TableHead>
                      <TableHead className="hidden md:table-cell text-xs font-semibold text-slate-600 text-right">Txns</TableHead>
                      <TableHead className="hidden sm:table-cell text-xs font-semibold text-slate-600 text-right">Units</TableHead>
                      <TableHead className="text-xs font-semibold text-slate-600 text-right">View</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedSalesData.map((day, index) => (
                      <TableRow key={index} className="hover:bg-emerald-50/40">
                        <TableCell className="font-medium">{new Date(day.date).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-emerald-700">
                          ₹{day.total_sales?.toFixed(2) || '0.00'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-right tabular-nums">{day.transaction_count || 0}</TableCell>
                        <TableCell className="hidden sm:table-cell text-right tabular-nums">{day.total_quantity || 0}</TableCell>
                        <TableCell className="text-right">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>Sales Details for {new Date(day.date).toLocaleDateString()}</DialogTitle>
                                <DialogDescription>
                                  Products sold on this date
                                </DialogDescription>
                              </DialogHeader>
                              <div className="mt-4">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Product</TableHead>
                                      <TableHead>Qty</TableHead>
                                      <TableHead className="hidden md:table-cell">Rate</TableHead>
                                      <TableHead>Total</TableHead>
                                      <TableHead className="hidden sm:table-cell">Mode</TableHead>
                                      <TableHead className="hidden md:table-cell">Balance Due</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {day.sales_details?.map((sale, saleIndex) => {
                                      const balance = Number(sale.total_price || 0) - Number(sale.received_amount || 0);
                                      const hasDue = !sale.is_settled && balance > 0.01;
                                      return (
                                        <TableRow key={saleIndex} className={hasDue ? 'bg-orange-50/40' : ''}>
                                          <TableCell className="font-medium">{sale.product_name}</TableCell>
                                          <TableCell>{sale.quantity}</TableCell>
                                          <TableCell className="hidden md:table-cell">₹{sale.unit_price.toFixed(2)}</TableCell>
                                          <TableCell>₹{sale.total_price.toFixed(2)}</TableCell>
                                          <TableCell className="hidden sm:table-cell">
                                            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                                              sale.payment_mode === 'credit'
                                                ? 'bg-orange-100 text-orange-700'
                                                : 'bg-green-100 text-green-700'
                                            }`}>
                                              {sale.payment_mode || 'cash'}
                                            </span>
                                          </TableCell>
                                          <TableCell className={`hidden md:table-cell font-bold ${hasDue ? 'text-orange-600' : 'text-green-600'}`}>
                                            {hasDue ? `₹${balance.toFixed(2)}` : '—'}
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                
                {/* Pagination controls */}
                {totalPages > 1 && (
                  <div className="mt-6">
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious 
                            onClick={() => handlePageChange(currentPage - 1)}
                            className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                          />
                        </PaginationItem>
                        
                        {/* First page */}
                        <PaginationItem>
                          <PaginationLink 
                            onClick={() => handlePageChange(1)}
                            isActive={currentPage === 1}
                          >
                            1
                          </PaginationLink>
                        </PaginationItem>
                        
                        {/* Ellipsis for skipped pages at the start */}
                        {currentPage > 3 && (
                          <PaginationItem>
                            <PaginationEllipsis />
                          </PaginationItem>
                        )}
                        
                        {/* Pages around current page */}
                        {Array.from({ length: Math.min(3, totalPages - 2) }, (_, i) => {
                          const page = currentPage - 1 + i;
                          if (page > 1 && page < totalPages) {
                            return (
                              <PaginationItem key={page}>
                                <PaginationLink 
                                  onClick={() => handlePageChange(page)}
                                  isActive={currentPage === page}
                                >
                                  {page}
                                </PaginationLink>
                              </PaginationItem>
                            );
                          }
                          return null;
                        })}
                        
                        {/* Ellipsis for skipped pages at the end */}
                        {currentPage < totalPages - 2 && (
                          <PaginationItem>
                            <PaginationEllipsis />
                          </PaginationItem>
                        )}
                        
                        {/* Last page */}
                        {totalPages > 1 && (
                          <PaginationItem>
                            <PaginationLink 
                              onClick={() => handlePageChange(totalPages)}
                              isActive={currentPage === totalPages}
                            >
                              {totalPages}
                            </PaginationLink>
                          </PaginationItem>
                        )}
                        
                        <PaginationItem>
                          <PaginationNext 
                            onClick={() => handlePageChange(currentPage + 1)}
                            className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm border-slate-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-indigo-50">
                <Trophy className="h-4 w-4 text-indigo-600" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">Product Performance</CardTitle>
                <CardDescription className="text-xs">
                  Top 10 products by revenue
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />
                ))}
              </div>
            ) : productSales.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No product sales data in this period.
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-semibold text-slate-600">Product</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 text-right">Units</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productSales
                    .sort((a, b) => b.total_revenue - a.total_revenue)
                    .slice(0, 10)
                    .map((product, index) => (
                      <TableRow key={index} className="hover:bg-indigo-50/40">
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 h-6 w-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[11px] font-bold">
                              {index + 1}
                            </span>
                            <span className="truncate">{product.product_name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{product.total_quantity}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-emerald-700">
                          ₹{product.total_revenue.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        </div>
      </section>

      {/* ═══ Section: Purchase Returns ═══ */}
      <section>
        <Card className="shadow-sm border-slate-200">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <RotateCcw className="h-5 w-5 text-red-500" />
                  Purchase Returns
                </CardTitle>
                <CardDescription>
                  Products returned to suppliers in this period — {purchaseReturns.length} return(s)
                </CardDescription>
              </div>
              <Button
                variant="outline"
                onClick={() => exportToCSV(purchaseReturns.map(r => ({
                  Date: r.return_date,
                  Supplier: r.suppliers?.name ?? '—',
                  Product: r.products?.name ?? '—',
                  Category: r.products?.category ?? '—',
                  Quantity: r.quantity,
                  'Return Amount': r.return_amount,
                  Reason: r.reason ?? '—',
                  Batch: r.batch_number ?? '—',
                })), 'purchase-returns-report')}
                disabled={purchaseReturns.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                Export Returns
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <TableSkeleton rows={4} cols={['w-24', 'w-32', 'w-32', 'w-12', 'w-20', 'w-24']} />
            ) : purchaseReturns.length === 0 ? (
              <div className="text-center py-10 border border-dashed rounded-lg text-muted-foreground">
                No purchase returns in this period.
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-right">Credited (₹)</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchaseReturns.map((r) => (
                    <TableRow key={r.id} className="hover:bg-red-50/30">
                      <TableCell className="text-sm">
                        {new Date(r.return_date).toLocaleDateString('en-IN')}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.suppliers?.name ?? '—'}</div>
                        {r.suppliers?.supplier_code && (
                          <div className="text-xs text-muted-foreground font-mono">{r.suppliers.supplier_code}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.products?.name ?? '—'}</div>
                        {r.products?.category && (
                          <div className="text-xs text-muted-foreground">{r.products.category}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-medium">{r.quantity}</TableCell>
                      <TableCell className="text-right font-semibold text-red-600">
                        ₹{Number(r.return_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                        {r.reason ?? <span className="italic opacity-40">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
