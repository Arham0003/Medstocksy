import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Download, TrendingUp, Package, ShoppingCart, Eye, EyeOff, RotateCcw } from 'lucide-react';
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

      // --- STEP 4: Purchase Returns ---
      try {
        let prQuery = (supabase as any)
          .from('purchase_returns')
          .select('id, return_date, quantity, return_amount, reason, batch_number, suppliers(name, supplier_code), products(name, category)')
          .order('return_date', { ascending: false });

        if (dateRange === 'custom' && startDate && endDate) {
          prQuery = prQuery.gte('return_date', startDate).lte('return_date', endDate);
        } else {
          prQuery = prQuery.gte('return_date', fromDateStr);
        }

        const { data: prData, error: prError } = await prQuery;
        if (!prError) {
          setPurchaseReturns((prData ?? []) as PurchaseReturnReport[]);
        } else if (prError.code === '42P01' || prError.message?.includes('does not exist')) {
          setPurchaseReturns([]);  // table not created yet
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">Sales analytics and business insights</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => exportToCSV(salesData, 'sales-report')}
            disabled={salesData.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export Sales
          </Button>
          <Button 
            variant="outline" 
            onClick={() => exportToCSV(productSales, 'product-sales-report')}
            disabled={productSales.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export Products
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalRevenue.toFixed(2)}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalTransactions}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Units Sold</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalQuantity}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Profit Generated</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              {isProfitVisible ? (
                <>
                  <div className="text-2xl font-bold">₹{totalProfit.toFixed(2)}</div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setIsProfitVisible(false)}
                    className="h-8 w-8 p-0"
                  >
                    <EyeOff className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold">*****</div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setIsProfitVisible(true)}
                    className="h-8 w-8 p-0"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-orange-50/20 border-orange-100/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-orange-800">Outstanding Credit</CardTitle>
            <TrendingUp className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-700">₹{globalOutstandingCredit.toFixed(2)}</div>
            <p className="text-[10px] text-orange-600 font-medium">Unpaid customer dues (All time)</p>
          </CardContent>
        </Card>

        <Card className="bg-red-50/20 border-red-100/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-red-800">Purchase Returns</CardTitle>
            <RotateCcw className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700">₹{totalPurchaseReturns.toFixed(2)}</div>
            <p className="text-[10px] text-red-600 font-medium">{purchaseReturns.length} return(s) in period</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-4 items-end">
        <div className="space-y-2">
          <Label htmlFor="dateRange">Date Range</Label>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {dateRange === 'custom' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Daily Sales</CardTitle>
            <CardDescription>Revenue breakdown by day (Page {currentPage} of {totalPages})</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Loading...</div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Revenue</TableHead>
                      <TableHead>Transactions</TableHead>
                      <TableHead>Units</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedSalesData.map((day, index) => (
                      <TableRow key={index}>
                        <TableCell>{new Date(day.date).toLocaleDateString()}</TableCell>
                        <TableCell>₹{day.total_sales?.toFixed(2) || '0.00'}</TableCell>
                        <TableCell>{day.transaction_count || 0}</TableCell>
                        <TableCell>{day.total_quantity || 0}</TableCell>
                        <TableCell>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
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
                                      <TableHead>Rate</TableHead>
                                      <TableHead>Total</TableHead>
                                      <TableHead>Mode</TableHead>
                                      <TableHead>Balance Due</TableHead>
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
                                          <TableCell>₹{sale.unit_price.toFixed(2)}</TableCell>
                                          <TableCell>₹{sale.total_price.toFixed(2)}</TableCell>
                                          <TableCell>
                                            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                                              sale.payment_mode === 'credit'
                                                ? 'bg-orange-100 text-orange-700'
                                                : 'bg-green-100 text-green-700'
                                            }`}>
                                              {sale.payment_mode || 'cash'}
                                            </span>
                                          </TableCell>
                                          <TableCell className={`font-bold ${hasDue ? 'text-orange-600' : 'text-green-600'}`}>
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

        <Card>
          <CardHeader>
            <CardTitle>Product Performance</CardTitle>
            <CardDescription>Top selling products</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Loading...</div>
            ) : productSales.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No product sales data available.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Units Sold</TableHead>
                    <TableHead>Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productSales
                    .sort((a, b) => b.total_revenue - a.total_revenue)
                    .slice(0, 10)
                    .map((product, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{product.product_name}</TableCell>
                        <TableCell>{product.total_quantity}</TableCell>
                        <TableCell>₹{product.total_revenue.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Purchase Returns Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
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
            <div className="text-center py-8">Loading...</div>
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
    </div>
  );
}
