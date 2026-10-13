import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  Wallet,
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
  is_free?: boolean | null;
  received_amount?: number | null;
  is_settled?: boolean | null;
  credit_due_date?: string | null;
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
  /** Units given away under a scheme. Invisible until sales.is_free existed. */
  freeUnits: number;
  /** Money actually received against this invoice, summed across its rows. */
  received: number;
  settled: boolean;
  dueDate: string;
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
  // Settlement: which invoice is being paid, and how much of it.
  const [settling, setSettling] = useState<WholesaleBill | null>(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [isSettling, setIsSettling] = useState(false);

  // Gate. `isActive` is false while the check runs, so the redirect waits on it.
  useEffect(() => {
    if (!accessLoading && !isActive) navigate('/pricing', { replace: true });
  }, [accessLoading, isActive, navigate]);

  const fetchWholesaleBills = useCallback(async () => {
    try {
      setLoading(true);

      // Same shape as Reports.tsx, with the one difference that defines this
      // page: only wholesale rows. Account scoping comes from RLS.
      // Same shape as Reports.tsx, with the one difference that defines this
      // page: only wholesale rows. Account scoping comes from RLS.
      //
      // Spelled as a cascade rather than one select. The compliance columns
      // arrive with 20260925000000, and asking for a column that does not exist
      // fails the whole query, which would leave this page blank on a database
      // that has not been migrated yet. Widest set first, narrowing on failure.
      const BASE_COLS = `
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
          return_type,
          received_amount,
          is_settled`;
      const GST_SPLIT_COLS = `,
          cgst_amount,
          sgst_amount,
          igst_amount,
          gst_rate`;
      const COMPLIANCE_COLS = `,
          buyer_state_code,
          bill_serial,
          is_free`;
      // credit_due_date arrives with 20261011000000. received_amount and
      // is_settled are long-standing, so they sit in the base set below.
      const CREDIT_COLS = `,
          credit_due_date`;

      const days = parseInt(dateRange) || 30;
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      const fromDateStr = fromDate.toISOString().split('T')[0];

      let data: unknown[] | null = null;
      let error: { message?: string } | null = null;

      for (const cols of [
        BASE_COLS + GST_SPLIT_COLS + COMPLIANCE_COLS + CREDIT_COLS,
        BASE_COLS + GST_SPLIT_COLS + COMPLIANCE_COLS,
        BASE_COLS + GST_SPLIT_COLS,
        BASE_COLS,
      ]) {
        let query = db
          .from('sales')
          .select(cols)
          .eq('sale_type', 'wholesale')
          .order('created_at', { ascending: false });

        if (dateRange === 'custom' && startDate && endDate) {
          query = query.gte('sale_date', startDate).lte('sale_date', endDate);
        } else {
          query = query.gte('sale_date', fromDateStr);
        }

        const res = await query;
        data = res.data;
        error = res.error;
        if (!error) break;
      }

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
          if (row.is_free) existing.freeUnits += Number(row.quantity) || 0;
          existing.received += Number(row.received_amount) || 0;
          // One unsettled row leaves the whole invoice outstanding.
          if (row.is_settled === false) existing.settled = false;
          if (!existing.dueDate && row.credit_due_date) existing.dueDate = row.credit_due_date;
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
            freeUnits: row.is_free ? Number(row.quantity) || 0 : 0,
            received: Number(row.received_amount) || 0,
            settled: row.is_settled !== false,
            dueDate: row.credit_due_date || '',
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
    // Receivables: what has been billed and not yet collected. Credit notes
    // carry negative totals, so they reduce the figure rather than inflate it.
    const receivables = filteredBills.reduce(
      (n, b) => n + (b.settled ? 0 : Math.max(0, b.total - b.received)), 0);
    const overdueCount = filteredBills.filter(
      b => !b.settled && b.dueDate && b.dueDate < new Date().toISOString().slice(0, 10)).length;
    return { revenue, gst, taxable, receivables, overdueCount, count: filteredBills.length };
  }, [filteredBills]);

  /**
   * Records a payment against every row of one invoice.
   *
   * The amount is spread across the bill's rows in proportion to what each one
   * is worth, because received_amount lives per row. Settling in full marks the
   * invoice closed; a part payment leaves it open with a smaller balance, which
   * is what keeps it in the dues alert until the rest arrives.
   */
  const settleBill = useCallback(async (bill: WholesaleBill, amount: number) => {
    if (!bill.bill_id || amount <= 0) return;
    setIsSettling(true);
    try {
      const { data: rows, error: readErr } = await db.from('sales')
        .select('id, total_price, received_amount')
        .eq('bill_id', bill.bill_id);
      if (readErr) throw readErr;

      const lines = (rows || []) as { id: string; total_price: number | null; received_amount: number | null }[];
      const billTotal = lines.reduce((n, r) => n + (Number(r.total_price) || 0), 0);
      if (billTotal <= 0) throw new Error('This invoice has no value to settle.');

      const outstanding = Math.max(0, billTotal - bill.received);
      const applied = Math.min(amount, outstanding);
      const closesBill = applied >= outstanding - 0.01;

      for (const r of lines) {
        const share = (Number(r.total_price) || 0) / billTotal;
        const next = (Number(r.received_amount) || 0) + applied * share;
        const { error } = await db.from('sales')
          .update({
            received_amount: Math.round(next * 100) / 100,
            is_settled: closesBill,
          })
          .eq('id', r.id);
        if (error) throw error;
      }

      toast({
        title: closesBill ? 'Invoice settled' : 'Payment recorded',
        description: closesBill
          ? `${bill.customer} is paid in full.`
          : `\u20B9${applied.toFixed(2)} recorded. \u20B9${(outstanding - applied).toFixed(2)} still outstanding.`,
      });
      setSettling(null);
      setSettleAmount('');
      fetchWholesaleBills();
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Could not record the payment',
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setIsSettling(false);
    }
  }, [toast, fetchWholesaleBills]);

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
                'Free Units': b.freeUnits,
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
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
        <DashboardStatCard
          title="Receivables"
          value={loading ? '-' : `\u20B9${stats.receivables.toFixed(2)}`}
          icon={Wallet}
          variant={stats.overdueCount > 0 ? 'warning' : 'default'}
          description={
            stats.overdueCount > 0
              ? `${stats.overdueCount} invoice(s) overdue`
              : 'Billed and not yet collected'
          }
        />
        <DashboardStatCard
          title="Wholesale Revenue"
          value={loading ? '-' : `\u20B9${stats.revenue.toFixed(2)}`}
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
          value={loading ? '-' : `\u20B9${stats.taxable.toFixed(2)}`}
          icon={Building2}
          variant="default"
          description="Before GST"
        />
        <DashboardStatCard
          title="GST Collected"
          value={loading ? '-' : `\u20B9${stats.gst.toFixed(2)}`}
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
                    <TableHead className="text-center hidden lg:table-cell" title="Units given away under a scheme">Free</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="hidden lg:table-cell">Due</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="hidden sm:table-cell">Payment</TableHead>
                    <TableHead className="w-20" />
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBills.map(b => (
                    <TableRow key={b.bill_id || `${b.date}-${b.customer}`}>
                      <TableCell className="whitespace-nowrap">{b.date}</TableCell>
                      <TableCell className="font-mono text-xs uppercase">
                        {/* The sequential number is the one that matters for
                            filing; older bills fall back to their UUID stub. */}
                        {b.serial || b.bill_id.slice(0, 8) || '-'}
                        {b.isCreditNote && (
                          <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800 normal-case">
                            Credit note
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium max-w-[180px] truncate" title={b.customer}>
                        {b.customer}
                      </TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-xs">{b.gstin || '-'}</TableCell>
                      <TableCell className="text-center tabular-nums">{b.items}</TableCell>
                      <TableCell className="text-center tabular-nums hidden lg:table-cell">
                        {b.freeUnits > 0
                          ? <span className="font-semibold text-violet-700">{b.freeUnits}</span>
                          : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">&#8377;{b.taxable.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">&#8377;{b.gst.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">&#8377;{b.total.toFixed(2)}</TableCell>
                      <TableCell className="hidden lg:table-cell whitespace-nowrap text-xs">
                        {b.dueDate ? (
                          <span className={
                            !b.settled && b.dueDate < new Date().toISOString().slice(0, 10)
                              ? 'font-semibold text-red-700'
                              : 'text-amber-700'
                          }>
                            {new Date(b.dueDate).toLocaleDateString('en-IN', {
                              day: '2-digit', month: 'short', year: '2-digit',
                            })}
                          </span>
                        ) : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.settled ? (
                          <span className="text-emerald-700 text-xs font-medium">Paid</span>
                        ) : (
                          <span className="font-semibold text-red-700">
                            &#8377;{Math.max(0, b.total - b.received).toFixed(2)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell capitalize">{b.payment_mode}</TableCell>
                      <TableCell>
                        {!b.settled && b.total - b.received > 0.01 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setSettling(b);
                              setSettleAmount((b.total - b.received).toFixed(2));
                            }}
                          >
                            Settle
                          </Button>
                        )}
                      </TableCell>
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

      {/* Settle an invoice. Part payment is allowed and is the common case:
          a distributor pays something on account, and the balance stays
          outstanding so it keeps appearing in the dues alert. */}
      <AlertDialog
        open={!!settling}
        onOpenChange={o => { if (!o) { setSettling(null); setSettleAmount(''); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record a payment</AlertDialogTitle>
            <AlertDialogDescription>
              {settling && (
                <>
                  <strong>{settling.customer}</strong>
                  {settling.serial ? ` · ${settling.serial}` : ''}
                  <br />
                  Outstanding: &#8377;{Math.max(0, settling.total - settling.received).toFixed(2)}
                  {settling.dueDate && (
                    <> · due {new Date(settling.dueDate).toLocaleDateString('en-IN', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}</>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="settle-amount">Amount received</Label>
            <Input
              id="settle-amount"
              type="number"
              min="0"
              step="0.01"
              autoFocus
              value={settleAmount}
              onChange={e => setSettleAmount(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && settling && Number(settleAmount) > 0) {
                  e.preventDefault();
                  settleBill(settling, Number(settleAmount));
                }
              }}
              className="text-lg font-semibold"
            />
            <p className="text-xs text-muted-foreground">
              Pre-filled with the full balance. Lower it to record a part payment;
              the invoice stays open until the rest arrives.
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSettling}>Cancel</AlertDialogCancel>
            <Button
              onClick={() => { if (settling) settleBill(settling, Number(settleAmount)); }}
              disabled={isSettling || !(Number(settleAmount) > 0)}
            >
              {isSettling ? 'Recording...' : 'Record payment'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
