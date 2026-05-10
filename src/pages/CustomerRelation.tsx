import { useEffect, useMemo, useState, useDeferredValue } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/TableSkeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import {
  AlertTriangle, MessageCircle, Search, ChevronDown, ChevronUp, Stethoscope, CalendarDays,
  FileText, MoreVertical, Trash2, UserMinus, Users, Phone, Wallet, X, ImagePlus
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn, formatINR } from '@/lib/utils';

type CrmSale = {
  id: string;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  doctor_name: string | null;
  sale_date: string | null;
  prescription_months: number | null;
  months_taken: number | null;
  bill_id?: string | null;
  account_id?: string | null;
  total_price?: number;
  payment_mode?: string;
  received_amount?: number;
  is_settled?: boolean;
};

type CustomerSummary = {
  key: string; // phone or name fallback
  name: string;
  phone: string | null;
  address: string | null;
  doctorName: string | null;
  lastPurchase: string | null;
  prescriptionMonths: number | null;
  monthsTaken: number | null;
  nextDueDate: Date | null;
  status: 'due' | 'active' | 'completed' | 'unknown';
  totalBalance: number;
  allBills: CrmSale[]; // all sales for this customer
};

export default function CustomerRelation() {
  const { profile } = useAuth();
  const [sales, setSales] = useState<CrmSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [customNote, setCustomNote] = useState<string>('');
  const [customImageFile, setCustomImageFile] = useState<File | null>(null);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'smart' | 'newest'>('smart');
  const [statusFilter, setStatusFilter] = useState<'all' | 'due' | 'active' | 'completed'>('all');
  
  // Settlement states
  const [isSettleDialogOpen, setIsSettleDialogOpen] = useState(false);
  const [settlementCustomer, setSettlementCustomer] = useState<CustomerSummary | null>(null);
  const [settlementAmount, setSettlementAmount] = useState<number>(0);
  const [isSettling, setIsSettling] = useState(false);

  // Deletion states
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<CustomerSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchCrm = async () => {
    if (!profile?.account_id) return;
      try {
        const { data, error } = await supabase
          .from('sales')
          .select('id, created_at, bill_id, customer_name, customer_phone, customer_address, doctor_name, sale_date, prescription_months, months_taken, account_id, total_price, payment_mode, received_amount, is_settled')
          .eq('account_id', profile?.account_id)
          .not('customer_phone', 'is', null)
          .neq('customer_phone', '')
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching regular CRM data:', error);
          if (error.message?.includes('column')) {
            console.log('Falling back to basic CRM query');
            const { data: fallbackData, error: fallbackError } = await supabase
              .from('sales')
              .select('id, created_at, bill_id, customer_name, customer_phone, customer_address, doctor_name, sale_date, prescription_months, months_taken, prescription_notes, account_id, total_price, payment_mode, received_amount, is_settled')
              .eq('account_id', profile?.account_id)
              .not('customer_phone', 'is', null)
              .neq('customer_phone', '')
              .order('created_at', { ascending: false });
            
            if (fallbackError) throw fallbackError;
            console.log('Fallback data count:', fallbackData?.length);
            setSales((fallbackData as any[]) || []);
          } else {
            throw error;
          }
        } else {
          console.log('CRM Data fetched:', data?.length, 'rows');
          if (data && data.length > 0) {
            console.log('Sample sale:', data[0]);
          }
          setSales((data as any[]) || []);
        }

        // fetch custom note from settings
        const settingsRes = await supabase
          .from('settings')
          .select('whatsapp_custom_note')
          .eq('account_id', profile?.account_id)
          .single();
        if (!settingsRes.error) {
          setCustomNote((settingsRes.data as any)?.whatsapp_custom_note || '');
        }
      } catch (e) {
        console.error('Error fetching CRM data:', e);
      } finally {
        setLoading(false);
      }
    };

  useEffect(() => {
    fetchCrm();
  }, [profile?.account_id]);

  const handleDeleteCustomer = async () => {
    if (!customerToDelete || !profile?.account_id) return;
    setIsDeleting(true);
    try {
      // In this app, customers are derived from the sales table.
      // Deleting a customer means deleting all sales associated with their phone number.
      const { error } = await supabase
        .from('sales')
        .delete()
        .eq('account_id', profile.account_id)
        .eq('customer_phone', customerToDelete.phone);

      if (error) throw error;

      toast({
        title: "Customer Deleted",
        description: `Successfully removed all records for ${customerToDelete.name}`,
      });
      setIsDeleteDialogOpen(false);
      setCustomerToDelete(null);
      fetchCrm();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: e.message,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSettlePayments = async () => {
    if (!settlementCustomer || settlementAmount <= 0) return;
    setIsSettling(true);
    try {
      // Find all unpaid sales for this customer, oldest first
      const unpaidSales = settlementCustomer.allBills
        .filter(s => !s.is_settled && (s.total_price || 0) > (s.received_amount || 0))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      let remaining = settlementAmount;
      const updates = [];

      for (const sale of unpaidSales) {
        if (remaining <= 0) break;
        
        const due = (sale.total_price || 0) - (sale.received_amount || 0);
        const paymentForThis = Math.min(remaining, due);
        const newReceived = (sale.received_amount || 0) + paymentForThis;
        
        updates.push(
          supabase
            .from('sales')
            .update({
              received_amount: newReceived,
              is_settled: newReceived >= (sale.total_price || 0)
            } as any)
            .eq('id', sale.id)
        );
        
        remaining -= paymentForThis;
      }

      await Promise.all(updates);
      
      toast({
        title: "Payment Recorded",
        description: `Successfully recorded ₹${settlementAmount.toFixed(2)} for ${settlementCustomer.name}`,
      });
      
      setIsSettleDialogOpen(false);
      setSettlementAmount(0);
      // Wait a bit for DB to catch up then refresh
      setTimeout(fetchCrm, 500);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Settlement Failed",
        description: e.message,
      });
    } finally {
      setIsSettling(false);
    }
  };

  const customers: CustomerSummary[] = useMemo(() => {
    const byKey = new Map<string, CustomerSummary>();

    sales.forEach((s) => {
      const key = (s.customer_phone || s.customer_name || `anonymous-${s.id}`).trim();
      if (!s.customer_phone) return; // only include with phone
      const existing = byKey.get(key);
      const name = s.customer_name || 'Walk-in Customer';
      const phone = s.customer_phone || null;
      const address = s.customer_address || null;
      const lastDate = new Date(s.created_at);
      const prescriptionMonths = s.prescription_months;
      const monthsTaken = s.months_taken;

      let nextDueDate: Date | null = null;
      let status: CustomerSummary['status'] = 'unknown';
      if (prescriptionMonths != null && monthsTaken != null) {
        // approximate months to 30 days windows from purchase
        const start = lastDate; // last purchase as baseline
        const elapsedWindows = monthsTaken; // completed windows
        const nextWindowStart = new Date(start.getTime() + elapsedWindows * 30 * 24 * 60 * 60 * 1000);
        nextDueDate = nextWindowStart;

        if (monthsTaken >= prescriptionMonths) {
          status = 'completed';
        } else {
          const today = new Date();
          status = today >= nextWindowStart ? 'due' : 'active';
        }
      }

      const candidate: CustomerSummary = {
        key,
        name,
        phone,
        address,
        doctorName: s.doctor_name || null,
        lastPurchase: lastDate.toISOString(),
        prescriptionMonths: prescriptionMonths ?? existing?.prescriptionMonths ?? null,
        monthsTaken: monthsTaken ?? existing?.monthsTaken ?? null,
        nextDueDate: nextDueDate ?? existing?.nextDueDate ?? null,
        status,
        totalBalance: 0, // Will be recomputed from allBills after collection
        allBills: [],
      };

      // keep the most recent sale info; accumulate all bills
      if (!existing || new Date(existing.lastPurchase || 0) < lastDate) {
        byKey.set(key, { 
          ...candidate, 
          totalBalance: 0, // placeholder — recalculated after loop
          allBills: [...(existing?.allBills || []), s] 
        });
      } else {
        existing.allBills.push(s);
      }
    });

    let list = Array.from(byKey.values());

    // Recompute totalBalance from allBills to avoid incremental accumulation bugs
    list.forEach(c => {
      const rawBalance = c.allBills.reduce((sum, bill) => {
        return sum + Number(bill.total_price || 0) - Number(bill.received_amount || 0);
      }, 0);
      // Use tolerance: treat anything < 0.01 as fully settled (floating point dust)
      c.totalBalance = rawBalance > 0.01 ? Math.round(rawBalance * 100) / 100 : 0;
    });

    // Apply Sorting
    if (sortBy === 'smart') {
      list.sort((a, b) => {
        // 1. Status priority: due > active > others
        const statusPriority = { due: 0, active: 1, completed: 2, unknown: 3 };
        const pA = statusPriority[a.status] ?? 3;
        const pB = statusPriority[b.status] ?? 3;
        if (pA !== pB) return pA - pB;

        // 2. Proximity of nextDueDate
        if (a.nextDueDate && b.nextDueDate) {
          return a.nextDueDate.getTime() - b.nextDueDate.getTime();
        }
        if (a.nextDueDate) return -1;
        if (b.nextDueDate) return 1;

        // 3. Fallback to months left (course remaining)
        const aLeft = (a.prescriptionMonths || 0) - (a.monthsTaken || 0);
        const bLeft = (b.prescriptionMonths || 0) - (b.monthsTaken || 0);
        return aLeft - bLeft;
      });
    } else if (sortBy === 'newest') {
      list.sort((a, b) => {
        const dateA = new Date(a.lastPurchase || 0).getTime();
        const dateB = new Date(b.lastPurchase || 0).getTime();
        return dateB - dateA; // Newest first
      });
    }

    return list;
  }, [sales, sortBy]);

  const deferredSearch = useDeferredValue(searchTerm);

  // Apply search + status-tab filter on top of the sorted base list
  const filteredCustomers = useMemo(() => {
    let list = customers;
    const q = deferredSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q) ||
        (c.doctorName || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      list = list.filter(c => c.status === statusFilter);
    }
    return list;
  }, [customers, deferredSearch, statusFilter]);

  // KPI strip + tab counts
  const statusCounts = useMemo(() => ({
    all: customers.length,
    due: customers.filter(c => c.status === 'due').length,
    active: customers.filter(c => c.status === 'active').length,
    completed: customers.filter(c => c.status === 'completed').length,
  }), [customers]);

  const totalReceivables = useMemo(
    () => customers.reduce((s, c) => s + (c.totalBalance || 0), 0),
    [customers]
  );
  const customersWithDues = useMemo(
    () => customers.filter(c => c.totalBalance > 0).length,
    [customers]
  );

  // WhatsApp note presets (chip-style quick selects)
  const NOTE_PRESETS = [
    'Refill reminder',
    'Pickup ready at counter',
    'Payment reminder',
    'Doctor follow-up due',
  ];

  // Memoised object URL for the attached-image preview; revoked on change/unmount
  const customImagePreview = useMemo(() => {
    if (!customImageFile) return null;
    return URL.createObjectURL(customImageFile);
  }, [customImageFile]);

  useEffect(() => {
    return () => {
      if (customImagePreview) URL.revokeObjectURL(customImagePreview);
    };
  }, [customImagePreview]);

  // Helper: phone number with country-code for tel: / wa.me
  const normalizePhone = (raw: string | null) => {
    if (!raw) return '';
    let phone = raw.replace(/\D/g, '');
    if (phone.length === 10) phone = '91' + phone;
    return phone;
  };

  const shareWhatsapp = async (customer: CustomerSummary) => {
    let phone = customer.phone ? customer.phone.replace(/\D/g, '') : '';

    // Ensure phone number has country code for WhatsApp
    if (phone) {
      if (phone.length === 10) {
        // Indian 10-digit number, add 91
        phone = '91' + phone;
      } else if (phone.length === 12 && phone.startsWith('91')) {
        // Already has 91 prefix
        phone = phone;
      } else if (!phone.startsWith('91') && phone.length > 10) {
        // Other country codes, keep as is
        phone = phone;
      }
    }

    const due = customer.nextDueDate ? customer.nextDueDate.toLocaleDateString() : 'N/A';

    // Build the plain-text message (used for both navigator.share and the wa.me URL fallback)
    const plainText =
      (customNote ? `${customNote}\n\n` : '') +
      `Hello ${customer.name || ''}\n` +
      `This is a friendly reminder regarding your prescription.\n` +
      `Prescribed months: ${customer.prescriptionMonths ?? 'N/A'}\n` +
      `Months taken: ${customer.monthsTaken ?? 'N/A'}\n` +
      `Next due date: ${due}\n` +
      `- ${window.location.host}`;

    // Path 1: image attached + browser supports Web Share API for files (Android Chrome, iOS Safari)
    // → opens OS share sheet, user picks WhatsApp, image + text go in together natively
    if (customImageFile && typeof navigator !== 'undefined' && (navigator as any).canShare) {
      const shareData: { text: string; files: File[]; title?: string } = {
        title: 'Customer reminder',
        text: plainText,
        files: [customImageFile],
      };
      try {
        if ((navigator as any).canShare(shareData)) {
          await (navigator as any).share(shareData);
          return; // success — bail out before falling through to wa.me
        }
      } catch (err: any) {
        // User cancelled the share sheet — that's fine, don't fall through
        if (err?.name === 'AbortError') return;
        // Other share errors fall through to the URL-based fallback below
      }
    }

    // Path 2: image attached but Web Share API unavailable (typical desktop)
    // → save the image so the user can drag it into WhatsApp Web after it opens
    if (customImageFile) {
      const dl = URL.createObjectURL(customImageFile);
      const a = document.createElement('a');
      a.href = dl;
      a.download = customImageFile.name || 'reminder.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(dl);
      toast({
        title: 'Image saved',
        description: 'Drag it into the WhatsApp window after it opens (text is pre-filled).',
      });
    }

    // Path 3 (and tail of Path 2): open wa.me with text only
    const encoded = encodeURIComponent(plainText);
    const url = `https://wa.me/${phone}?text=${encoded}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* === Header === */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customer Relations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track prescriptions, send refill reminders, and settle dues.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search name, phone, doctor…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
            <SelectTrigger className="w-full sm:w-auto sm:min-w-[180px] h-9 text-sm">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="smart">Smart (due first)</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* === Stats strip === */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-md border bg-card p-3 flex items-center gap-3">
          <div className="p-2 rounded-md bg-blue-50 text-blue-600 shrink-0">
            <Users className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Total Customers</p>
            <p className="text-base font-semibold mt-0.5">{loading ? '—' : customers.length}</p>
          </div>
        </div>
        <div className="rounded-md border bg-card p-3 flex items-center gap-3">
          <div className="p-2 rounded-md bg-red-50 text-red-600 shrink-0">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Refill Due</p>
            <p className="text-base font-semibold mt-0.5">{loading ? '—' : statusCounts.due}</p>
          </div>
        </div>
        <div className="rounded-md border bg-card p-3 flex items-center gap-3">
          <div className="p-2 rounded-md bg-emerald-50 text-emerald-600 shrink-0">
            <CalendarDays className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Active Course</p>
            <p className="text-base font-semibold mt-0.5">{loading ? '—' : statusCounts.active}</p>
          </div>
        </div>
        <div className="rounded-md border bg-card p-3 flex items-center gap-3">
          <div className="p-2 rounded-md bg-orange-50 text-orange-600 shrink-0">
            <Wallet className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Receivables</p>
            <p className="text-base font-semibold text-orange-700 mt-0.5 truncate">{loading ? '—' : formatINR(totalReceivables)}</p>
            {customersWithDues > 0 && (
              <p className="text-[10px] text-muted-foreground leading-none">{customersWithDues} customer{customersWithDues === 1 ? '' : 's'}</p>
            )}
          </div>
        </div>
      </div>

      {/* === Reminder note customizer === */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-emerald-600" />
            Reminder note
            <span className="text-xs font-normal text-muted-foreground">— prepended to WhatsApp messages</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {NOTE_PRESETS.map(preset => (
              <button
                key={preset}
                type="button"
                onClick={() => setCustomNote(customNote === preset ? '' : preset)}
                className={cn(
                  'h-7 px-2.5 text-xs rounded-full border transition-colors',
                  customNote === preset
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700 font-medium'
                    : 'bg-card border-border hover:bg-muted'
                )}
              >
                {preset}
              </button>
            ))}
            {customNote && !NOTE_PRESETS.includes(customNote) && (
              <button
                type="button"
                onClick={() => setCustomNote('')}
                className="h-7 px-2 text-xs rounded-full border bg-muted hover:bg-muted/70 inline-flex items-center gap-1"
                title="Clear custom note"
              >
                Clear <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Textarea
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
            placeholder="Or type a custom note…"
            rows={2}
            className="resize-none"
          />

          {/* Optional image attachment for WhatsApp */}
          <div className="flex items-start gap-3 pt-1">
            {customImageFile && customImagePreview ? (
              <div className="relative shrink-0">
                <img
                  src={customImagePreview}
                  alt="Attachment preview"
                  className="h-16 w-16 rounded-md border object-cover"
                />
                <button
                  type="button"
                  onClick={() => setCustomImageFile(null)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white inline-flex items-center justify-center hover:bg-red-600 shadow"
                  title="Remove image"
                  aria-label="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <label className="cursor-pointer inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-card hover:bg-muted text-xs whitespace-nowrap shrink-0">
                <ImagePlus className="h-3.5 w-3.5" />
                Attach image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 5 * 1024 * 1024) {
                      toast({
                        variant: 'destructive',
                        title: 'Image too large',
                        description: 'Please pick an image under 5 MB.',
                      });
                      e.target.value = '';
                      return;
                    }
                    setCustomImageFile(f);
                    e.target.value = ''; // allow re-selecting the same file later
                  }}
                />
              </label>
            )}
            <p className="text-[11px] text-muted-foreground leading-snug">
              {customImageFile ? (
                <>
                  <span className="font-medium text-foreground">{customImageFile.name}</span> attaches with the reminder.
                  On phone WhatsApp opens directly with image + text. On desktop the image is saved for you to drag into WhatsApp Web.
                </>
              ) : (
                'Optional. On phone the image goes through WhatsApp natively; on desktop it downloads and you drag it into WhatsApp Web.'
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* === Customers card === */}
      <Card>
        <CardHeader className="pb-3 space-y-3">
          <div>
            <CardTitle className="text-lg font-semibold">Customers</CardTitle>
            <CardDescription className="text-sm">
              {loading
                ? 'Loading…'
                : `${filteredCustomers.length} customer${filteredCustomers.length === 1 ? '' : 's'}${statusFilter !== 'all' ? ` · ${statusFilter}` : ''}${deferredSearch ? ` · matching "${deferredSearch}"` : ''}`}
            </CardDescription>
          </div>
          {/* Filter tabs */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: 'all', label: 'All', count: statusCounts.all },
              { key: 'due', label: 'Due', count: statusCounts.due },
              { key: 'active', label: 'Active', count: statusCounts.active },
              { key: 'completed', label: 'Completed', count: statusCounts.completed },
            ] as const).map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                className={cn(
                  'h-7 px-3 text-xs font-medium rounded-full border transition-colors inline-flex items-center gap-1.5',
                  statusFilter === tab.key
                    ? tab.key === 'due'
                      ? 'bg-red-50 border-red-300 text-red-700'
                      : tab.key === 'active'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : tab.key === 'completed'
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-foreground text-background border-foreground'
                    : 'bg-card border-border hover:bg-muted'
                )}
              >
                {tab.label}
                <span className={cn(
                  'h-4 min-w-[16px] px-1 rounded-full text-[10px] flex items-center justify-center',
                  statusFilter === tab.key && tab.key === 'all'
                    ? 'bg-background/20 text-background'
                    : 'bg-muted text-muted-foreground'
                )}>{tab.count}</span>
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <TableSkeleton rows={6} cols={['w-40', 'w-28', 'w-24', 'w-20', 'w-24']} />
          ) : customers.length === 0 ? (
            <div className="text-center py-12 border border-dashed rounded-md">
              <div className="bg-muted/50 p-4 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-3">
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold mb-1">No customer records yet</h3>
              <p className="text-sm text-muted-foreground">
                Customers appear automatically when you record sales with phone numbers.
              </p>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="text-center py-12 border border-dashed rounded-md">
              <div className="bg-muted/50 p-4 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-3">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold mb-1">No matches</h3>
              <p className="text-sm text-muted-foreground mb-4">Adjust your search or filter tab.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setSearchTerm(''); setStatusFilter('all'); }}
              >
                Clear search & filter
              </Button>
            </div>
          ) : (
            <>
              {/* Mobile: card list */}
              <div className="md:hidden space-y-2">
                {filteredCustomers.map((c) => {
                  const isExpanded = expandedCustomer === c.key;
                  const phoneDigits = normalizePhone(c.phone);
                  const dueLabel = c.nextDueDate ? c.nextDueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : null;
                  const statusClass =
                    c.status === 'due' ? 'bg-red-50 text-red-700 border-red-200'
                    : c.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : c.status === 'completed' ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-muted text-muted-foreground border-border';
                  return (
                    <div key={c.key} className={cn('rounded-md border bg-card overflow-hidden', c.totalBalance > 0 && 'border-orange-200')}>
                      <button
                        type="button"
                        className="w-full flex items-start gap-2 p-3 text-left hover:bg-muted/40 transition-colors"
                        onClick={() => setExpandedCustomer(isExpanded ? null : c.key)}
                      >
                        <div className="shrink-0 mt-0.5">
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium truncate">{c.name}</p>
                            <Badge variant="outline" className={cn('h-5 text-[10px] capitalize shrink-0', statusClass)}>
                              {c.status}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-muted-foreground">
                            {c.phone && <span>{c.phone}</span>}
                            {c.doctorName && <span>· Dr. {c.doctorName}</span>}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px]">
                            <span className="text-muted-foreground">
                              Course {Math.max(1, c.monthsTaken ?? 1)}/{c.prescriptionMonths ?? 0}m
                            </span>
                            {dueLabel && <span className={c.status === 'due' ? 'text-red-600 font-medium' : 'text-muted-foreground'}>· Due {dueLabel}</span>}
                          </div>
                        </div>
                        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreVertical className="h-4 w-4" />
                                <span className="sr-only">Actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem
                                onClick={() => { setCustomerToDelete(c); setIsDeleteDialogOpen(true); }}
                                className="text-red-600 focus:text-red-700 focus:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4 mr-2" /> Delete customer
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </button>
                      <div className="flex flex-wrap items-center gap-2 px-3 pb-3 -mt-1">
                        {c.phone && (
                          <a
                            href={`tel:${c.phone}`}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs border hover:bg-muted"
                            title={`Call ${c.phone}`}
                          >
                            <Phone className="h-3.5 w-3.5" /> Call
                          </a>
                        )}
                        {phoneDigits && (
                          <button
                            type="button"
                            onClick={() => shareWhatsapp(c)}
                            className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-medium border border-emerald-200 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-50"
                          >
                            <MessageCircle className="h-3 w-3" /> WhatsApp
                          </button>
                        )}
                        {c.totalBalance > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSettlementCustomer(c);
                              setSettlementAmount(c.totalBalance);
                              setIsSettleDialogOpen(true);
                            }}
                            className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 font-medium"
                          >
                            <Wallet className="h-3.5 w-3.5" /> Pay {formatINR(c.totalBalance)}
                          </button>
                        )}
                      </div>

                      {isExpanded && (
                        <div className="border-t bg-muted/20 px-3 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                            Prescription history
                          </p>
                          {(() => {
                            const grouped = new Map<string, CrmSale>();
                            c.allBills.forEach(b => {
                              const bid = b.bill_id || b.created_at;
                              if (!grouped.has(bid)) grouped.set(bid, b);
                            });
                            const visits = Array.from(grouped.values()).sort((a, b) =>
                              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                            );
                            return (
                              <div className="space-y-1.5">
                                {visits.map(bill => {
                                  const billItems = c.allBills.filter(b => (b.bill_id || b.created_at) === (bill.bill_id || bill.created_at));
                                  const billTotal = billItems.reduce((s, item) => s + Number(item.total_price || 0), 0);
                                  const billReceived = billItems.reduce((s, item) => s + Number(item.received_amount || 0), 0);
                                  const billBalance = billTotal - billReceived;
                                  return (
                                    <div key={bill.id} className="flex items-baseline justify-between gap-2 text-xs bg-card rounded p-2 border">
                                      <div className="min-w-0 flex-1">
                                        <span className="font-medium">{new Date(bill.sale_date || bill.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                                        {bill.doctor_name && <span className="text-muted-foreground ml-2">Dr. {bill.doctor_name}</span>}
                                      </div>
                                      <span className="text-muted-foreground whitespace-nowrap">{formatINR(billTotal)}</span>
                                      <span className={cn('font-medium whitespace-nowrap', billBalance > 0 ? 'text-orange-600' : 'text-emerald-600')}>
                                        {billBalance > 0 ? formatINR(billBalance) + ' due' : 'paid'}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block rounded-md border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-medium">Customer</TableHead>
                      <TableHead className="hidden lg:table-cell font-medium">Doctor / last visit</TableHead>
                      <TableHead className="font-medium text-center">Course</TableHead>
                      <TableHead className="hidden lg:table-cell font-medium">Next due</TableHead>
                      <TableHead className="font-medium text-center">Status</TableHead>
                      <TableHead className="font-medium text-right">Balance</TableHead>
                      <TableHead className="font-medium text-right whitespace-nowrap w-[200px]"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCustomers.map((c) => {
                      const isExpanded = expandedCustomer === c.key;
                      const phoneDigits = normalizePhone(c.phone);
                      const dueStr = c.nextDueDate ? c.nextDueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
                      const statusClass =
                        c.status === 'due' ? 'bg-red-50 text-red-700 border-red-200'
                        : c.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : c.status === 'completed' ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-muted text-muted-foreground border-border';
                      return (
                        <>
                          <TableRow
                            key={c.key}
                            className="cursor-pointer"
                            onClick={() => setExpandedCustomer(isExpanded ? null : c.key)}
                          >
                            <TableCell className="py-2.5">
                              <div className="flex items-center gap-1.5">
                                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{c.name}</p>
                                  <p className="text-xs text-muted-foreground">{c.phone || '—'}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="hidden lg:table-cell py-2.5 text-sm">
                              {c.doctorName && (
                                <div className="flex items-center gap-1 text-emerald-700 text-xs">
                                  <Stethoscope className="h-3 w-3" /> {c.doctorName}
                                </div>
                              )}
                              <p className="text-xs text-muted-foreground">
                                {c.lastPurchase ? new Date(c.lastPurchase).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                              </p>
                            </TableCell>
                            <TableCell className="py-2.5 text-center text-sm">
                              {c.prescriptionMonths != null || c.monthsTaken != null
                                ? `${Math.max(1, c.monthsTaken ?? 1)}/${c.prescriptionMonths ?? 0}m`
                                : '—'}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell py-2.5 text-sm">{dueStr}</TableCell>
                            <TableCell className="py-2.5 text-center">
                              <Badge variant="outline" className={cn('h-5 text-[10px] capitalize', statusClass)}>
                                {c.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-2.5 text-right">
                              {c.totalBalance > 0
                                ? <span className="font-semibold text-orange-600">{formatINR(c.totalBalance)}</span>
                                : <span className="text-muted-foreground text-sm">—</span>}
                            </TableCell>
                            <TableCell className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                {c.phone && (
                                  <a
                                    href={`tel:${c.phone}`}
                                    className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted"
                                    title={`Call ${c.phone}`}
                                  >
                                    <Phone className="h-4 w-4" />
                                  </a>
                                )}
                                {phoneDigits && (
                                  <button
                                    type="button"
                                    onClick={() => shareWhatsapp(c)}
                                    className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium border border-emerald-200 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-50"
                                    title="WhatsApp reminder"
                                  >
                                    <MessageCircle className="h-3 w-3" /> WhatsApp
                                  </button>
                                )}
                                {c.totalBalance > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSettlementCustomer(c);
                                      setSettlementAmount(c.totalBalance);
                                      setIsSettleDialogOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 font-medium"
                                    title={`Pay dues — ${formatINR(c.totalBalance)} outstanding`}
                                  >
                                    <Wallet className="h-4 w-4" /> Pay dues
                                  </button>
                                )}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                      <MoreVertical className="h-4 w-4 text-muted-foreground" />
                                      <span className="sr-only">More actions</span>
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-44">
                                    <DropdownMenuItem
                                      onClick={() => { setCustomerToDelete(c); setIsDeleteDialogOpen(true); }}
                                      className="text-red-600 focus:text-red-700 focus:bg-red-50"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" /> Delete customer
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          </TableRow>

                          {isExpanded && (
                            <TableRow key={`${c.key}-expanded`} className="bg-muted/20 hover:bg-muted/20">
                              <TableCell colSpan={7} className="p-0 border-t">
                                <div className="px-4 py-3">
                                  <div className="flex items-center gap-2 mb-2">
                                    <FileText className="h-4 w-4 text-emerald-600" />
                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                                      Prescription history
                                    </p>
                                  </div>
                                  {(() => {
                                    const grouped = new Map<string, CrmSale>();
                                    c.allBills.forEach(b => {
                                      const bid = b.bill_id || b.created_at;
                                      if (!grouped.has(bid)) grouped.set(bid, b);
                                    });
                                    const visits = Array.from(grouped.values()).sort((a, b) =>
                                      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                                    );
                                    return (
                                      <div className="rounded-md border bg-card overflow-hidden">
                                        <Table>
                                          <TableHeader className="bg-muted/30">
                                            <TableRow className="hover:bg-transparent">
                                              <TableHead className="font-medium text-xs">Date</TableHead>
                                              <TableHead className="font-medium text-xs">Doctor</TableHead>
                                              <TableHead className="font-medium text-xs text-center">Mode</TableHead>
                                              <TableHead className="font-medium text-xs text-center">Refill</TableHead>
                                              <TableHead className="font-medium text-xs text-right">Bill</TableHead>
                                              <TableHead className="font-medium text-xs text-right">Balance</TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {visits.map((bill) => {
                                              const billItems = c.allBills.filter(b => (b.bill_id || b.created_at) === (bill.bill_id || bill.created_at));
                                              const billTotal = billItems.reduce((s, i) => s + Number(i.total_price || 0), 0);
                                              const billReceived = billItems.reduce((s, i) => s + Number(i.received_amount || 0), 0);
                                              const billBalance = billTotal - billReceived;
                                              return (
                                                <TableRow key={bill.id}>
                                                  <TableCell className="py-2 text-sm">
                                                    {new Date(bill.sale_date || bill.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                  </TableCell>
                                                  <TableCell className="py-2 text-sm">
                                                    {bill.doctor_name
                                                      ? <span className="inline-flex items-center gap-1"><Stethoscope className="h-3 w-3 text-emerald-600" /> {bill.doctor_name}</span>
                                                      : <span className="text-muted-foreground">—</span>}
                                                  </TableCell>
                                                  <TableCell className="py-2 text-center">
                                                    <Badge
                                                      variant="outline"
                                                      className={cn(
                                                        'text-[10px] capitalize h-5',
                                                        bill.payment_mode === 'credit'
                                                          ? 'bg-orange-50 text-orange-700 border-orange-200'
                                                          : 'bg-card text-muted-foreground border-border'
                                                      )}
                                                    >
                                                      {bill.payment_mode || 'cash'}
                                                    </Badge>
                                                  </TableCell>
                                                  <TableCell className="py-2 text-center text-xs text-muted-foreground">
                                                    {Math.max(1, bill.months_taken ?? 1)}/{bill.prescription_months || 0}m
                                                  </TableCell>
                                                  <TableCell className="py-2 text-right text-sm font-medium">{formatINR(billTotal)}</TableCell>
                                                  <TableCell className={cn('py-2 text-right text-sm font-semibold', billBalance > 0 ? 'text-orange-600' : 'text-emerald-600')}>
                                                    {billBalance > 0 ? formatINR(billBalance) : 'paid'}
                                                  </TableCell>
                                                </TableRow>
                                              );
                                            })}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* === Settlement Dialog === */}
      <Dialog open={isSettleDialogOpen} onOpenChange={setIsSettleDialogOpen}>
        <DialogContent className="w-[95vw] sm:max-w-md p-4 sm:p-6">
          <DialogHeader className="pr-8 space-y-1">
            <DialogTitle className="text-lg flex items-center gap-2">
              <Wallet className="h-4 w-4 text-orange-600" />
              Settle dues
            </DialogTitle>
            <DialogDescription className="text-sm">
              {settlementCustomer ? `Record a payment from ${settlementCustomer.name}.` : null}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-3">
            {/* Outstanding band */}
            <div className="rounded-md border border-orange-200 bg-orange-50/40 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-orange-700 font-semibold">Outstanding</span>
                <span className="text-xl font-bold text-orange-700">{formatINR(settlementCustomer?.totalBalance || 0)}</span>
              </div>
              {settlementCustomer?.phone && (
                <p className="text-[11px] text-muted-foreground mt-1">{settlementCustomer.phone}</p>
              )}
            </div>

            {/* Payment amount */}
            <div className="space-y-1.5">
              <Label htmlFor="paymentAmount" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Payment amount (₹)
              </Label>
              <Input
                id="paymentAmount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={settlementAmount || ''}
                onChange={(e) => setSettlementAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                placeholder="0.00"
                className="h-10 text-base font-semibold"
                autoFocus
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setSettlementAmount(settlementCustomer?.totalBalance || 0)}
                  className="h-7 px-2.5 text-xs rounded-full border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100"
                >
                  Pay full
                </button>
                <button
                  type="button"
                  onClick={() => setSettlementAmount((settlementCustomer?.totalBalance || 0) / 2)}
                  className="h-7 px-2.5 text-xs rounded-full border bg-card hover:bg-muted"
                >
                  Pay half
                </button>
                <button
                  type="button"
                  onClick={() => setSettlementAmount(0)}
                  className="h-7 px-2.5 text-xs rounded-full border bg-card hover:bg-muted"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Remaining balance preview */}
            <div className="rounded-md border bg-muted/30 p-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">After this payment</span>
              <span className={cn(
                'text-sm font-semibold',
                ((settlementCustomer?.totalBalance || 0) - settlementAmount) > 0.01 ? 'text-orange-600' : 'text-emerald-700'
              )}>
                {formatINR(Math.max(0, (settlementCustomer?.totalBalance || 0) - settlementAmount))} {((settlementCustomer?.totalBalance || 0) - settlementAmount) <= 0.01 ? '· settled' : 'remaining'}
              </span>
            </div>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3">
            <Button variant="outline" onClick={() => setIsSettleDialogOpen(false)} className="sm:w-auto">
              Cancel
            </Button>
            <Button
              onClick={handleSettlePayments}
              className="sm:w-auto sm:min-w-[160px] gap-2 bg-orange-600 hover:bg-orange-700 text-white"
              disabled={isSettling || settlementAmount <= 0}
            >
              {isSettling ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  Processing…
                </>
              ) : (
                <>Confirm payment</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === Delete confirmation === */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <UserMinus className="h-4 w-4 text-red-600" />
              Delete {customerToDelete?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you absolutely sure? This will delete <strong>all sales history</strong> and <strong>outstanding balances</strong> linked to this customer. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCustomer}
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting…' : 'Delete everything'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}



