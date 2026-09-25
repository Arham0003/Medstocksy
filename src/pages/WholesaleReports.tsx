import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/TableSkeleton';
import { DashboardStatCard } from '@/components/DashboardStatCard';
import {
  Download,
  CalendarRange,
  Building2,
  Receipt,
  TrendingUp,
  Percent,
  Search,
  Printer,
  FileStack,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/supabaseLoose';
import { useWholesaleAccess } from '@/hooks/useWholesaleAccess';

/** A raw wholesale sale line as it comes back from PostgREST. */
interface WholesaleSaleRow {
  bill_id: string | null;
  quantity: number | null;
  total_price: number | null;
  gst_amount: number | null;
  taxable_value: number | null;
  created_at: string | null;
  sale_date: string | null;
  payment_mode: string | null;
  customer_name: string | null;
  wholesale_customer_name: string | null;
  wholesale_customer_gstin: string | null;
  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;
  gst_rate?: number | null;
  buyer_state_code?: string | null;
  bill_serial?: string | null;
  return_type?: string | null;
}

/** One wholesale invoice, folded up from its sale lines. */
interface WholesaleBill {
  bill_id: string;
  date: string;
  customer: string;
  gstin: string;
  items: number;
  taxable: number;
  gst: number;
  total: number;
  payment_mode: string;
  /** Tax split, kept apart because GSTR-1 Table 4 wants the components. */
  cgst: number;
  sgst: number;
  igst: number;
  /** Highest rate on the invoice; GSTR-1 wants a rate per line. */
  rate: number;
  /** Two-digit buyer state code. */
  pos: string;
  /** Sequential number where one was allocated. */
  serial: string;
  /** A bill made entirely of reversal rows is a credit note, not an invoice. */
  isCreditNote: boolean;
}

export default function WholesaleReports() {
  const { isOwner } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isActive, loading: accessLoading } = useWholesaleAccess();

  const [bills, setBills] = useState<WholesaleBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('all');

  // Gate. `isActive` is false while the check runs, so the redirect waits on it.
  useEffect(() => {
    if (!accessLoading && !isActive) navigate('/pricing', { replace: true });
  }, [accessLoading, isActive, navigate]);

  const fetchWholesaleBills = useCallback(async () => {
    try {
      setLoading(true);

      // Same shape as Reports.tsx, with the one difference that defines this
      // page: only wholesale rows. Account scoping comes from RLS.
      let query = db
        .from('sales')
        .select(`
          bill_id,
          quantity,
          total_price,
          gst_amount,
          taxable_value,
          created_at,
          sale_date,
          payment_mode,
          customer_name,
          wholesale_customer_name,
          wholesale_customer_gstin,
          cgst_amount,
          sgst_amount,
          igst_amount,
          gst_rate,
          buyer_state_code,
          bill_serial,
          return_type
        `)
        .eq('sale_type', 'wholesale')
        .order('created_at', { ascending: false });

      const days = parseInt(dateRange) || 30;
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      const fromDateStr = fromDate.toISOString().split('T')[0];

      if (dateRange === 'custom' && startDate && endDate) {
        query = query.gte('sale_date', startDate).lte('sale_date', endDate);
      } else {
        query = query.gte('sale_date', fromDateStr);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fold the sale lines into one row per invoice.
      const grouped = new Map<string, WholesaleBill>();
      for (const row of (data || []) as WholesaleSaleRow[]) {
        const key = row.bill_id || row.created_at;
        if (!key) continue;

        const existing = grouped.get(key);
        const gst = Number(row.gst_amount) || 0;
        const total = Number(row.total_price) || 0;
        // Lines raised before the GST-split migration carry no taxable_value;
        // the value actually charged less its tax stands in.
        const taxable = row.taxable_value != null ? Number(row.taxable_value) : total - gst;

        if (existing) {
          existing.items += 1;
          existing.taxable += taxable;
          existing.gst += gst;
          existing.total += total;
          existing.cgst += Number(row.cgst_amount) || 0;
          existing.sgst += Number(row.sgst_amount) || 0;
          existing.igst += Number(row.igst_amount) || 0;
          existing.rate = Math.max(existing.rate, Number(row.gst_rate) || 0);
          if (!existing.pos && row.buyer_state_code) existing.pos = row.buyer_state_code;
          if (!existing.serial && row.bill_serial) existing.serial = row.bill_serial;
          // One priced line is enough to make the document an invoice.
          if (!row.return_type) existing.isCreditNote = false;
        } else {
          grouped.set(key, {
            bill_id: row.bill_id || '',
            date: row.sale_date || (row.created_at ? String(row.created_at).split('T')[0] : ''),
            customer: row.wholesale_customer_name || row.customer_name || 'Unknown',
            gstin: row.wholesale_customer_gstin || '',
            items: 1,
            taxable,
            gst,
            total,
            payment_mode: row.payment_mode || 'cash',
            cgst: Number(row.cgst_amount) || 0,
            sgst: Number(row.sgst_amount) || 0,
            igst: Number(row.igst_amount) || 0,
            rate: Number(row.gst_rate) || 0,
            pos: row.buyer_state_code || '',
            serial: row.bill_serial || '',
            isCreditNote: !!row.return_type,
          });
        }
      }

      setBills(Array.from(grouped.values()));
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error loading wholesale reports',
        description: err instanceof Error ? err.message : 'Please try again.',
      });
      setBills([]);
    } finally {
      setLoading(false);
    }
  }, [dateRange, startDate, endDate, toast]);

  useEffect(() => {
    if (accessLoading || !isActive) return;
    // A custom range only makes sense once both ends are picked.
    if (dateRange === 'custom' && !(startDate && endDate)) return;
    fetchWholesaleBills();
  }, [accessLoading, isActive, dateRange, startDate, endDate, fetchWholesaleBills]);

  // Customer / payment filtering is client-side: the rows are already grouped
  // per invoice here, and the set for a date range is small.
  const filteredBills = useMemo(() => {
    const needle = customerFilter.trim().toLowerCase();
    return bills.filter(b => {
      if (paymentFilter !== 'all' && b.payment_mode !== paymentFilter) return false;
      if (needle && !b.customer.toLowerCase().includes(needle) && !b.gstin.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [bills, customerFilter, paymentFilter]);

  const stats = useMemo(() => {
    const revenue = filteredBills.reduce((n, b) => n + b.total, 0);
    const gst = filteredBills.reduce((n, b) => n + b.gst, 0);
    const taxable = filteredBills.reduce((n, b) => n + b.taxable, 0);
    return { revenue, gst, taxable, count: filteredBills.length };
  }, [filteredBills]);

  // Same CSV helper as Reports.tsx.
  const exportToCSV = (data: Record<string, string | number>[], filename: string) => {
    const headers = Object.keys(data[0] || {});
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(header => `"${row[header] ?? ''}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (accessLoading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-64 bg-slate-100 animate-pulse rounded-lg" />
        <div className="h-64 w-full bg-slate-100 animate-pulse rounded-xl" />
      </div>
    );
  }

  if (!isActive) return null; // redirecting to /pricing

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
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
            Wholesale Reports
          </h1>
          <p className="text-muted-foreground text-lg mt-2">
            B2B invoices, taxable value and GST collected
          </p>
        </div>
        <Button
          variant="outline"
          className="flex gap-2 items-center text-base py-2.5 px-4"
          disabled={filteredBills.length === 0}
          onClick={() =>
            exportToCSV(
              filteredBills.map(b => ({
                Date: b.date,
                Invoice: b.serial || b.bill_id.slice(0, 8).toUpperCase(),
                Customer: b.customer,
                GSTIN: b.gstin,
                Items: b.items,
                Taxable: b.taxable.toFixed(2),
                GST: b.gst.toFixed(2),
                Total: b.total.toFixed(2),
                'Payment Mode': b.payment_mode,
              })),
              'wholesale-report'
            )
          }
        >
          <Download className="h-4 w-4" />
          Export
        </Button>
        {/* GSTR-1 Table 4: the B2B section, in the shape the return wants.
            Column names follow the GST portal's own offline-utility headings so
            a CA can map it without renaming anything. */}
        <Button
          variant="outline"
          className="flex gap-2 items-center text-base py-2.5 px-4"
          disabled={filteredBills.length === 0}
          title="One row per invoice, with the tax split separated, for GSTR-1 Table 4 (B2B)"
          onClick={() =>
            exportToCSV(
              filteredBills.map(b => ({
                'GSTIN/UIN of Recipient': b.gstin,
                'Receiver Name': b.customer,
                'Invoice Number': b.serial || b.bill_id.slice(0, 8).toUpperCase(),
                'Invoice date': b.date.split('-').reverse().join('-'),
                'Invoice Value': b.total.toFixed(2),
                'Place Of Supply': b.pos,
                'Reverse Charge': 'N',
                'Applicable % of Tax Rate': '',
                'Invoice Type': b.isCreditNote ? 'Credit Note' : 'Regular B2B',
                'E-Commerce GSTIN': '',
                Rate: b.rate ? b.rate.toFixed(2) : '',
                'Taxable Value': b.taxable.toFixed(2),
                'Integrated Tax Amount': b.igst.toFixed(2),
                'Central Tax Amount': b.cgst.toFixed(2),
                'State/UT Tax Amount': b.sgst.toFixed(2),
                'Cess Amount': '0.00',
              })),
              'gstr1-table4-b2b'
            )
          }
        >
          <Download className="h-4 w-4" />
          GSTR-1 B2B
        </Button>
      </div>

      {/* Filters: date range, customer, payment mode */}
      <Card className="border-slate-200">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
              <div className="p-1.5 rounded-lg bg-violet-50">
                <CalendarRange className="h-4 w-4 text-violet-600" />
              </div>
              <span className="font-medium text-slate-800">Filters</span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 flex-1">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-full sm:w-40">
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
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="wsStartDate" className="text-xs text-muted-foreground shrink-0 w-10">From</Label>
                    <Input
                      id="wsStartDate"
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="h-10"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="wsEndDate" className="text-xs text-muted-foreground shrink-0 w-10">To</Label>
                    <Input
                      id="wsEndDate"
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="h-10"
                    />
                  </div>
                </div>
              )}

              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={customerFilter}
                  onChange={e => setCustomerFilter(e.target.value)}
                  placeholder="Customer or GSTIN…"
                  className="h-10 pl-9"
                  aria-label="Filter by customer name or GSTIN"
                />
              </div>

              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger className="w-full sm:w-40" aria-label="Filter by payment mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All payments</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Badge variant="secondary" className="bg-violet-50 text-violet-700 border border-violet-100 shrink-0">
              {dateRangeLabel}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardStatCard
          title="Wholesale Revenue"
          value={loading ? '-' : `₹${stats.revenue.toFixed(2)}`}
          icon={TrendingUp}
          variant="primary"
          description="Total billed in range"
        />
        <DashboardStatCard
          title="Invoices"
          value={loading ? '-' : stats.count}
          icon={Receipt}
          variant="info"
          description="B2B bills raised"
        />
        <DashboardStatCard
          title="Taxable Value"
          value={loading ? '-' : `₹${stats.taxable.toFixed(2)}`}
          icon={Building2}
          variant="default"
          description="Before GST"
        />
        <DashboardStatCard
          title="GST Collected"
          value={loading ? '-' : `₹${stats.gst.toFixed(2)}`}
          icon={Percent}
          variant="success"
          description="Output tax in range"
        />
      </div>

      {/* Invoice table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Wholesale Invoices</CardTitle>
          <CardDescription>
            {loading ? 'Loading…' : `${filteredBills.length} invoice${filteredBills.length === 1 ? '' : 's'} in this range`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {loading ? (
            <TableSkeleton rows={6} cols={['w-24', 'w-20', 'w-32', 'w-28', 'w-10', 'w-20', 'w-16', 'w-20', 'w-16']} />
          ) : filteredBills.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-violet-50 grid place-items-center">
                <FileStack className="h-6 w-6 text-violet-500" />
              </div>
              <p className="font-medium text-slate-800">No wholesale invoices yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                {bills.length === 0
                  ? 'Raise a bill from Sales → Wholesale Sales and it will appear here.'
                  : 'No invoice matches the current filters.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden md:table-cell">GSTIN</TableHead>
                    <TableHead className="text-center">Items</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="hidden sm:table-cell">Payment</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBills.map(b => (
                    <TableRow key={b.bill_id || `${b.date}-${b.customer}`}>
                      <TableCell className="whitespace-nowrap">{b.date}</TableCell>
                      <TableCell className="font-mono text-xs uppercase">{b.bill_id.slice(0, 8) || '-'}</TableCell>
                      <TableCell className="font-medium max-w-[180px] truncate" title={b.customer}>
                        {b.customer}
                      </TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-xs">{b.gstin || '-'}</TableCell>
                      <TableCell className="text-center tabular-nums">{b.items}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{b.taxable.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{b.gst.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">₹{b.total.toFixed(2)}</TableCell>
                      <TableCell className="hidden sm:table-cell capitalize">{b.payment_mode}</TableCell>
                      <TableCell>
                        {b.bill_id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Open tax invoice"
                            aria-label={`Open invoice for ${b.customer}`}
                            onClick={() => navigate(`/print-bill/${b.bill_id}?format=A4`)}
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
