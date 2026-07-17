import { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/TableSkeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Truck, Plus, Search, Eye, CreditCard, Package, IndianRupee,
  Phone, Mail, MapPin, FileText, User, AlertTriangle, CheckCircle2, Clock,
  Wallet, TrendingUp, ChevronRight, Building2, Receipt, Download, Trash2,
  MessageCircle, Pencil, Copy, Check, ExternalLink, X, MoreVertical
} from 'lucide-react';
import { ToastAction } from '@/components/ui/toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { cn, formatINR } from '@/lib/utils';

interface Supplier {
  id: string;
  account_id: string;
  supplier_code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gst_number: string | null;
  created_at: string | null;
}

interface SupplierPayment {
  id: string;
  supplier_id: string;
  amount: number;
  payment_type: string;
  payment_date: string;
  notes: string | null;
  created_at: string | null;
}

interface SupplierProduct {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  purchase_price: number | null;
  selling_price: number;
  created_at: string | null;
}

interface SupplierWithStats extends Supplier {
  totalProducts: number;
  totalPurchaseValue: number;
  totalPaid: number;
  balance: number;
  paymentStatus: 'paid' | 'partial' | 'pending';
}

export default function Suppliers() {
  const { profile } = useAuth();
  const { toast } = useToast();

  // URL-persisted view state
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // Set when the user came here mid product-entry to register a supplier.
  const returnToProducts = searchParams.get('from') === 'add-products' || searchParams.get('from') === 'bulk-import';

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [productsBySupplier, setProductsBySupplier] = useState<Record<string, SupplierProduct[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') ?? '');
  const [sortKey, setSortKey] = useState<'name' | 'balance_desc' | 'balance_asc' | 'recent_payment'>(
    () => {
      const v = searchParams.get('sort');
      if (v === 'balance_desc' || v === 'balance_asc' || v === 'recent_payment' || v === 'name') return v;
      return 'name';
    }
  );
  const [outstandingOnly, setOutstandingOnly] = useState<boolean>(() => searchParams.get('outstanding') === '1');
  // Pagination
  const PAGE_SIZE = 50;
  const [page, setPage] = useState<number>(() => Math.max(1, Number(searchParams.get('page')) || 1));

  // Register dialog
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Detail dialog
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierWithStats | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  // Confirm-delete state — when set, the AlertDialog is open and points at this supplier id
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Edit-mode: when truthy, the register dialog acts as an "edit" form pre-filled from this supplier
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  // Detail-dialog UI state
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [gstCopied, setGstCopied] = useState(false);
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Payment dialog
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentType, setPaymentType] = useState('partial');
  const [isSavingPayment, setIsSavingPayment] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '', contact_person: '', phone: '', email: '', address: '', gst_number: ''
  });

  const fetchData = async () => {
    if (!profile?.account_id) return;
    setLoading(true);
    try {
      const [suppliersRes, productsRes, paymentsRes] = await Promise.all([
        supabase.from('suppliers').select('*').eq('account_id', profile.account_id).order('created_at', { ascending: false }),
        supabase.from('products').select('id, name, category, quantity, purchase_price, selling_price, supplier_id, created_at').eq('account_id', profile.account_id).not('supplier_id', 'is', null),
        supabase.from('supplier_payments').select('*').eq('account_id', profile.account_id).order('payment_date', { ascending: false }),
      ]);

      if (suppliersRes.error) throw suppliersRes.error;
      if (paymentsRes.error) throw paymentsRes.error;

      const suppData = suppliersRes.data || [];
      const payData = paymentsRes.data || [];
      const prodData = (productsRes.data || []) as any[];

      // Group products by supplier_id
      const grouped: Record<string, SupplierProduct[]> = {};
      prodData.forEach((p: any) => {
        if (!p.supplier_id) return;
        if (!grouped[p.supplier_id]) grouped[p.supplier_id] = [];
        grouped[p.supplier_id].push(p);
      });

      setSuppliers(suppData as unknown as Supplier[]);
      setPayments(payData as unknown as SupplierPayment[]);
      setProductsBySupplier(grouped);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error fetching suppliers', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile?.account_id]);

  // Generate next supplier code
  const generateSupplierCode = (existingSuppliers: Supplier[]) => {
    const nums = existingSuppliers
      .map(s => parseInt(s.supplier_code.replace('SUP-', '')) || 0)
      .filter(n => !isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `SUP-${String(next).padStart(4, '0')}`;
  };

  // Compute supplier stats
  const suppliersWithStats: SupplierWithStats[] = useMemo(() => {
    return suppliers.map(s => {
      const prods = productsBySupplier[s.id] || [];
      const totalPurchaseValue = prods.reduce((sum, p) => sum + ((p.purchase_price ?? 0) * p.quantity), 0);
      const totalPaid = payments.filter(p => p.supplier_id === s.id).reduce((sum, p) => sum + p.amount, 0);
      const balance = Math.max(0, totalPurchaseValue - totalPaid);
      let paymentStatus: 'paid' | 'partial' | 'pending' = 'pending';
      if (totalPurchaseValue > 0) {
        if (totalPaid >= totalPurchaseValue) paymentStatus = 'paid';
        else if (totalPaid > 0) paymentStatus = 'partial';
        else paymentStatus = 'pending';
      } else {
        paymentStatus = totalPaid > 0 ? 'paid' : 'pending';
      }
      return { ...s, totalProducts: prods.length, totalPurchaseValue, totalPaid, balance, paymentStatus };
    });
  }, [suppliers, productsBySupplier, payments]);

  const deferredSearchTerm = useDeferredValue(searchTerm);

  // Most-recent payment per supplier (used for sort + balance-aging displays)
  const lastPaymentBySupplier = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      const ts = new Date(p.payment_date).getTime();
      const prev = map.get(p.supplier_id) ?? 0;
      if (ts > prev) map.set(p.supplier_id, ts);
    }
    return map;
  }, [payments]);

  const filteredSuppliers = useMemo(() => {
    const q = deferredSearchTerm.trim().toLowerCase();
    let list = suppliersWithStats;

    if (q) {
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.supplier_code.toLowerCase().includes(q) ||
        (s.phone || '').includes(q) ||
        (s.contact_person || '').toLowerCase().includes(q) ||
        (s.gst_number || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q)
      );
    }

    if (outstandingOnly) {
      list = list.filter(s => s.balance > 0);
    }

    // Sorting (default: name A→Z)
    const sorted = [...list];
    if (sortKey === 'balance_desc') {
      sorted.sort((a, b) => b.balance - a.balance);
    } else if (sortKey === 'balance_asc') {
      sorted.sort((a, b) => a.balance - b.balance);
    } else if (sortKey === 'recent_payment') {
      sorted.sort((a, b) => (lastPaymentBySupplier.get(b.id) ?? 0) - (lastPaymentBySupplier.get(a.id) ?? 0));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [suppliersWithStats, deferredSearchTerm, outstandingOnly, sortKey, lastPaymentBySupplier]);

  // Pagination derivations
  const totalPages = Math.max(1, Math.ceil(filteredSuppliers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedSuppliers = useMemo(
    () => filteredSuppliers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredSuppliers, currentPage]
  );

  // Reset page when filters/search/sort change
  useEffect(() => {
    setPage(1);
  }, [deferredSearchTerm, outstandingOnly, sortKey]);

  // Sync state -> URL so views are shareable
  useEffect(() => {
    const next = new URLSearchParams();
    if (searchTerm) next.set('q', searchTerm);
    if (sortKey !== 'name') next.set('sort', sortKey);
    if (outstandingOnly) next.set('outstanding', '1');
    if (page > 1) next.set('page', String(page));
    setSearchParams(next, { replace: true });
  }, [searchTerm, sortKey, outstandingOnly, page, setSearchParams]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.account_id || isSaving) return;
    if (!formData.name.trim()) {
      toast({ variant: 'destructive', title: 'Name is required' });
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        contact_person: formData.contact_person.trim() || null,
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        address: formData.address.trim() || null,
        gst_number: formData.gst_number.trim() || null,
      };
      if (editingSupplierId) {
        // UPDATE path
        const { error } = await supabase
          .from('suppliers')
          .update(payload)
          .eq('id', editingSupplierId);
        if (error) throw error;
        toast({ title: 'Supplier updated' });
      } else {
        // INSERT path
        const supplier_code = generateSupplierCode(suppliers);
        const { error } = await supabase.from('suppliers').insert([{
          account_id: profile.account_id,
          supplier_code,
          ...payload,
        }]);
        if (error) throw error;
        toast({ title: 'Supplier registered!', description: `ID: ${supplier_code} assigned` });
      }
      setIsRegisterOpen(false);
      setEditingSupplierId(null);
      setFormData({ name: '', contact_person: '', phone: '', email: '', address: '', gst_number: '' });
      // Keep the detail dialog showing the updated row
      if (editingSupplierId && selectedSupplier?.id === editingSupplierId) {
        // Local optimistic — fetchData will overwrite with truth
        setSelectedSupplier(prev => prev ? ({ ...prev, ...payload } as SupplierWithStats) : prev);
      }
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: editingSupplierId ? 'Error updating supplier' : 'Error registering supplier', description: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  // Open the register dialog in edit mode pre-filled from the given supplier
  const openEditSupplier = (s: SupplierWithStats) => {
    setEditingSupplierId(s.id);
    setFormData({
      name: s.name || '',
      contact_person: s.contact_person || '',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      gst_number: s.gst_number || '',
    });
    setIsRegisterOpen(true);
  };

  // Per-payment delete with undo (parity with supplier-level delete)
  const handleDeletePayment = async (paymentId: string) => {
    const target = supplierPayments.find(p => p.id === paymentId);
    if (!target) return;
    try {
      const { error } = await supabase.from('supplier_payments').delete().eq('id', paymentId);
      if (error) throw error;
      // Optimistic local update on both lists
      setSupplierPayments(prev => prev.filter(p => p.id !== paymentId));
      setPayments(prev => prev.filter(p => p.id !== paymentId));
      toast({
        title: 'Payment removed',
        description: `${formatINR(target.amount)} on ${new Date(target.payment_date).toLocaleDateString('en-IN')}`,
        action: (
          <ToastAction
            altText="Undo payment delete"
            onClick={async () => {
              const { error: undoErr } = await supabase.from('supplier_payments').insert([target as any]);
              if (undoErr) {
                toast({ variant: 'destructive', title: 'Could not undo', description: undoErr.message });
                return;
              }
              const restored = toast({ title: 'Restored', description: 'Payment is back.' });
              setTimeout(() => restored.dismiss(), 5000);
              if (selectedSupplier) await openDetail(selectedSupplier);
              fetchData();
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error deleting payment', description: err.message });
    }
  };

  // GSTIN format check (strict 15-char Indian GSTIN pattern)
  const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  const isValidGSTIN = (g: string | null | undefined) => !!g && GSTIN_RE.test(g.trim().toUpperCase());

  const copyGST = async (gst: string) => {
    try {
      await navigator.clipboard.writeText(gst);
      setGstCopied(true);
      setTimeout(() => setGstCopied(false), 1500);
    } catch {
      toast({ variant: 'destructive', title: 'Copy failed', description: 'Clipboard not available.' });
    }
  };

  const openDetail = async (supplier: SupplierWithStats) => {
    setSelectedSupplier(supplier);
    setIsDetailOpen(true);
    setLoadingDetail(true);
    setShowAllProducts(false);
    try {
      const [prodsRes, paysRes] = await Promise.all([
        supabase.from('products').select('id, name, category, quantity, purchase_price, selling_price, created_at').eq('supplier_id', supplier.id),
        supabase.from('supplier_payments').select('*').eq('supplier_id', supplier.id).order('payment_date', { ascending: false }),
      ]);
      setSupplierProducts((prodsRes.data || []) as SupplierProduct[]);
      setSupplierPayments(paysRes.data || []);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error loading details', description: err.message });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleAddPayment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedSupplier || !profile?.account_id || isSavingPayment) return;
    const fd = new FormData(e.currentTarget);
    const amount = parseFloat(fd.get('amount') as string);
    if (!amount || amount <= 0) {
      toast({ variant: 'destructive', title: 'Invalid amount' });
      return;
    }

    // Validate against current balance unless explicitly acknowledged as advance/over-payment
    const ackOverpay = fd.get('overpay_ack') === 'on';
    const balance = selectedSupplier.balance;
    if (amount > balance && !ackOverpay && paymentType !== 'advance') {
      toast({
        variant: 'destructive',
        title: 'Amount exceeds balance',
        description: `Balance due is ${formatINR(balance)}. Tick "Record as advance/over-payment" or set Payment Type = Advance to proceed.`,
      });
      return;
    }

    setIsSavingPayment(true);
    try {
      const { error } = await supabase.from('supplier_payments').insert([{
        account_id: profile.account_id,
        supplier_id: selectedSupplier.id,
        amount,
        payment_type: paymentType,
        payment_date: fd.get('payment_date') as string || new Date().toISOString().split('T')[0],
        notes: (fd.get('notes') as string) || null,
      }]);
      if (error) throw error;
      toast({ title: 'Payment recorded!', description: `${formatINR(amount)} added successfully` });
      setIsPaymentOpen(false);
      setPaymentType('partial');
      // Refresh detail + list
      await openDetail(selectedSupplier);
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error recording payment', description: err.message });
    } finally {
      setIsSavingPayment(false);
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    // Capture full state for undo: supplier row + their payments. Products are NOT cascade-deleted because
    // they reference supplier_id; on undo we re-insert with the original id so the FK survives.
    const deletedSupplier = suppliers.find(s => s.id === id);
    const deletedPayments = payments.filter(p => p.supplier_id === id);
    if (!deletedSupplier) return;

    try {
      // Delete payments first (FK), then the supplier
      const { error: payErr } = await supabase.from('supplier_payments').delete().eq('supplier_id', id);
      if (payErr) throw payErr;
      const { error } = await supabase.from('suppliers').delete().eq('id', id);
      if (error) throw error;

      // Optimistic local update
      setSuppliers(prev => prev.filter(s => s.id !== id));
      setPayments(prev => prev.filter(p => p.supplier_id !== id));
      setIsDetailOpen(false);

      toast({
        title: 'Supplier deleted',
        description: `"${deletedSupplier.name}" removed${deletedPayments.length ? ` (${deletedPayments.length} payment${deletedPayments.length === 1 ? '' : 's'} also archived)` : ''}.`,
        action: (
          <ToastAction
            altText="Undo delete"
            onClick={async () => {
              // Restore supplier with same id so any product.supplier_id FK still resolves
              const { error: restoreErr } = await supabase.from('suppliers').insert([deletedSupplier as Supplier]);
              if (restoreErr) {
                toast({ variant: 'destructive', title: 'Could not undo', description: restoreErr.message });
                return;
              }
              if (deletedPayments.length > 0) {
                const { error: payRestoreErr } = await supabase.from('supplier_payments').insert(deletedPayments as any);
                if (payRestoreErr) {
                  toast({ variant: 'destructive', title: 'Supplier restored, but payments could not be re-added', description: payRestoreErr.message });
                  fetchData();
                  return;
                }
              }
              const restored = toast({ title: 'Restored', description: `"${deletedSupplier.name}" is back.` });
              setTimeout(() => restored.dismiss(), 5000);
              fetchData();
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error deleting supplier', description: err.message });
    }
  };

  const paymentStatusBadge = (status: string) => {
    if (status === 'paid') return <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Paid</Badge>;
    if (status === 'partial') return <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100"><Clock className="h-3.5 w-3.5 mr-1" />Partial</Badge>;
    return <Badge variant="secondary" className="bg-red-100 text-red-700 hover:bg-red-100"><AlertTriangle className="h-3.5 w-3.5 mr-1" />Pending</Badge>;
  };

  const handleDownloadProducts = () => {
    if (!selectedSupplier || supplierProducts.length === 0) return;

    const headers = ['Product Name', 'Category', 'Current Stock Quantity', 'Purchase Price', 'Total Value'];
    // CSV-escape any cell that contains a quote, comma, or newline
    const escape = (cell: unknown) => {
      const s = String(cell ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = supplierProducts.map(p => [
      p.name,
      p.category || '',
      p.quantity,
      p.purchase_price ?? 0,
      (p.purchase_price ?? 0) * p.quantity,
    ]);
    const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\r\n');

    // Prepend UTF-8 BOM so Excel/Numbers correctly detect non-ASCII (Devanagari etc.)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedSupplier.name.replace(/[\\/:*?"<>|]/g, '_')}_Products.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const totalStats = useMemo(() => ({
    totalSuppliers: suppliers.length,
    totalProducts: Object.values(productsBySupplier).flat().length,
    totalPaid: payments.reduce((s, p) => s + p.amount, 0),
    totalBalance: suppliersWithStats.reduce((s, sup) => s + sup.balance, 0),
  }), [suppliers, productsBySupplier, payments, suppliersWithStats]);

  return (
    <div className="space-y-8">
      {returnToProducts && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-sm text-blue-800">
            Add the new supplier here, then head back — your product entry was saved and will be restored.
          </p>
          <Button
            size="sm"
            onClick={() => navigate('/products')}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
          >
            ← Back to products
          </Button>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Supplier Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage suppliers, track product sources and payment accounts
          </p>
        </div>
        <Dialog
          open={isRegisterOpen}
          onOpenChange={(open) => {
            setIsRegisterOpen(open);
            if (!open) {
              setEditingSupplierId(null);
              setFormData({ name: '', contact_person: '', phone: '', email: '', address: '', gst_number: '' });
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              className="w-full sm:w-auto h-10 sm:h-11 gap-2 rounded-full px-5 font-medium shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/30 hover:-translate-y-px transition-all"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Register Supplier
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto p-5 sm:p-7">
            <DialogHeader className="space-y-1.5">
              <DialogTitle className="text-xl">
                {editingSupplierId ? 'Edit Supplier' : 'Register New Supplier'}
              </DialogTitle>
              <DialogDescription className="text-sm">
                {editingSupplierId
                  ? 'Update the supplier details below. Supplier ID and account history are preserved.'
                  : 'A unique Supplier ID will be auto-generated on registration.'}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleRegister} className="mt-4 space-y-6">
              {/* === Section: Business identity === */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business identity</h3>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="supplier-name" className="text-sm font-medium">
                    Business / Supplier Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="supplier-name"
                    value={formData.name}
                    onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Sun Pharma Distributors"
                    required
                    autoFocus
                  />
                </div>
              </section>

              <Separator />

              {/* === Section: Primary contact === */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Primary contact</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-contact" className="text-sm font-medium">Contact Person</Label>
                    <Input
                      id="supplier-contact"
                      value={formData.contact_person}
                      onChange={e => setFormData(p => ({ ...p, contact_person: e.target.value }))}
                      placeholder="Person's name"
                      autoComplete="name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-phone" className="text-sm font-medium">Mobile Number</Label>
                    <Input
                      id="supplier-phone"
                      type="tel"
                      value={formData.phone}
                      onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                      placeholder="9876543210"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={15}
                    />
                    <p className="text-[11px] text-muted-foreground">10 digits, no country code prefix</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="supplier-email" className="text-sm font-medium">Email</Label>
                  <Input
                    id="supplier-email"
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                    placeholder="supplier@example.com"
                    autoComplete="email"
                  />
                </div>
              </section>

              <Separator />

              {/* === Section: Tax & location === */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tax & location</h3>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="supplier-gst" className="text-sm font-medium">GST Number</Label>
                  <div className="relative">
                    <Input
                      id="supplier-gst"
                      value={formData.gst_number}
                      onChange={e => setFormData(p => ({ ...p, gst_number: e.target.value.toUpperCase() }))}
                      placeholder="27AAAPZ0121A1Z3"
                      maxLength={15}
                      className="font-mono pr-9 uppercase"
                    />
                    {formData.gst_number.length > 0 && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2">
                        {isValidGSTIN(formData.gst_number) ? (
                          <Check className="h-4 w-4 text-emerald-600" aria-label="Valid GSTIN" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-500" aria-label="Doesn't match GSTIN format" />
                        )}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {formData.gst_number.length === 0
                      ? '15-character Indian GSTIN. Optional but recommended for B2B invoicing.'
                      : isValidGSTIN(formData.gst_number)
                      ? 'Format looks correct.'
                      : "Doesn't match the standard 15-char GSTIN pattern. You can still save it."}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="supplier-address" className="text-sm font-medium">Address</Label>
                  <Textarea
                    id="supplier-address"
                    value={formData.address}
                    onChange={e => setFormData(p => ({ ...p, address: e.target.value }))}
                    placeholder="Building / street, area, city, state, PIN"
                    rows={2}
                    className="resize-none"
                  />
                </div>
              </section>

              {/* === Footer actions === */}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsRegisterOpen(false)}
                  className="sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving}
                  className="sm:w-auto sm:min-w-[180px] gap-2"
                >
                  {isSaving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                      Saving...
                    </>
                  ) : editingSupplierId ? (
                    <>
                      <Check className="h-4 w-4" strokeWidth={2.5} />
                      Save Changes
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" strokeWidth={2.5} />
                      Register Supplier
                    </>
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Suppliers', value: totalStats.totalSuppliers, icon: Truck, color: 'text-blue-600 bg-blue-100' },
          { label: 'Products Sourced', value: totalStats.totalProducts, icon: Package, color: 'text-violet-600 bg-violet-100' },
          { label: 'Total Paid', value: formatINR(totalStats.totalPaid), icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-100' },
          { label: 'Balance Due', value: formatINR(totalStats.totalBalance), icon: Wallet, color: 'text-red-600 bg-red-100' },
        ].map((stat, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                </div>
                <div className={`p-3 rounded-lg ${stat.color}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Outstanding-balance banner */}
      {(() => {
        const outstandingCount = suppliersWithStats.filter(s => s.balance > 0).length;
        if (outstandingCount === 0 || outstandingOnly) return null;
        return (
          <button
            type="button"
            onClick={() => setOutstandingOnly(true)}
            className="w-full flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-left hover:bg-red-100 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Wallet className="h-4 w-4 text-red-600 shrink-0" />
              <span className="text-sm text-red-900">
                You owe <strong>{formatINR(totalStats.totalBalance)}</strong> across <strong>{outstandingCount}</strong> {outstandingCount === 1 ? 'supplier' : 'suppliers'}
              </span>
            </div>
            <span className="text-xs font-medium text-red-700 shrink-0">View →</span>
          </button>
        );
      })()}

      {/* Suppliers Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <CardTitle>All Suppliers</CardTitle>
                <CardDescription>
                  {loading ? 'Loading...' : `${filteredSuppliers.length} supplier${filteredSuppliers.length !== 1 ? 's' : ''}`}
                </CardDescription>
              </div>
              <div className="relative w-full md:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4 pointer-events-none" />
                <Input
                  placeholder="Search by name, ID, phone, GSTIN..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="supplier-sort" className="text-xs text-muted-foreground">Sort:</Label>
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
                  <SelectTrigger id="supplier-sort" className="h-8 w-auto gap-2 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="name">Name A→Z</SelectItem>
                    <SelectItem value="balance_desc">Balance high→low</SelectItem>
                    <SelectItem value="balance_asc">Balance low→high</SelectItem>
                    <SelectItem value="recent_payment">Recent payment first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox
                  checked={outstandingOnly}
                  onCheckedChange={(c) => setOutstandingOnly(c === true)}
                />
                Outstanding only
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <TableSkeleton rows={6} cols={['w-20', 'w-44', 'w-28', 'w-24', 'w-24', 'w-12']} />
          ) : filteredSuppliers.length === 0 ? (
            (() => {
              const isFiltered = searchTerm !== '' || outstandingOnly;
              if (isFiltered) {
                return (
                  <div className="text-center py-12">
                    <div className="bg-muted/50 p-4 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-4">
                      <Search className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="text-base font-semibold mb-1">No matches found</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Try adjusting your search or clearing the outstanding filter.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setSearchTerm(''); setOutstandingOnly(false); }}
                    >
                      Clear filters
                    </Button>
                  </div>
                );
              }
              return (
                <div className="text-center py-12 border rounded-md border-dashed">
                  <div className="bg-muted p-4 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-4">
                    <Truck className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="text-base font-semibold mb-1">No suppliers yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Register your first supplier to start tracking purchases and payments.
                  </p>
                  <Button
                    onClick={() => setIsRegisterOpen(true)}
                    className="h-10 gap-2 rounded-full px-5 font-medium shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/30 hover:-translate-y-px transition-all"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.5} />
                    Register Supplier
                  </Button>
                </div>
              );
            })()
          ) : (
            <>
              {/* Mobile: card list */}
              <div className="md:hidden space-y-2">
                {paginatedSuppliers.map(s => {
                  const phoneDigits = (s.phone || '').replace(/\D/g, '');
                  return (
                    <div key={s.id} className="rounded-md border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-sm truncate">{s.name}</p>
                            <Badge variant="outline" className="font-mono text-[10px] h-5">{s.supplier_code}</Badge>
                          </div>
                          {s.contact_person && <p className="text-xs text-muted-foreground mt-0.5">{s.contact_person}</p>}
                          {s.gst_number && <p className="text-[10px] text-muted-foreground mt-0.5">GST: {s.gst_number}</p>}
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 -mr-1 -mt-1 shrink-0" onClick={() => openDetail(s)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Quick actions */}
                      {(s.phone || s.email) && (
                        <div className="flex items-center gap-1 mt-2">
                          {s.phone && (
                            <a
                              href={`tel:${s.phone}`}
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-muted hover:bg-muted/70 text-muted-foreground"
                              aria-label={`Call ${s.name}`}
                              title={s.phone}
                            >
                              <Phone className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {phoneDigits && (
                            <a
                              href={`https://wa.me/${phoneDigits.length === 10 ? '91' + phoneDigits : phoneDigits}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-600"
                              aria-label={`WhatsApp ${s.name}`}
                              title={`WhatsApp ${s.phone}`}
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {s.email && (
                            <a
                              href={`mailto:${s.email}`}
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-muted hover:bg-muted/70 text-muted-foreground"
                              aria-label={`Email ${s.name}`}
                              title={s.email}
                            >
                              <Mail className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      )}

                      <div className="flex items-end justify-between gap-2 mt-2 pt-2 border-t">
                        <div className="flex flex-col gap-0.5">
                          {paymentStatusBadge(s.paymentStatus)}
                          <span className="text-[10px] text-muted-foreground">{s.totalProducts} {s.totalProducts === 1 ? 'product' : 'products'}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Balance</p>
                          <p className={cn("text-base font-semibold", s.balance > 0 ? "text-red-600" : "text-emerald-600")}>{formatINR(s.balance)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block rounded-md border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="hidden md:table-cell font-semibold text-foreground">ID</TableHead>
                      <TableHead className="font-semibold text-foreground">Name</TableHead>
                      <TableHead className="hidden lg:table-cell font-semibold text-foreground">Contact</TableHead>
                      <TableHead className="hidden lg:table-cell font-semibold text-foreground text-center">Products</TableHead>
                      <TableHead className="hidden xl:table-cell font-semibold text-foreground text-right">Purchase Value</TableHead>
                      <TableHead className="hidden xl:table-cell font-semibold text-foreground text-right">Paid</TableHead>
                      <TableHead className="font-semibold text-foreground text-right">Balance</TableHead>
                      <TableHead className="hidden sm:table-cell font-semibold text-foreground text-center">Status</TableHead>
                      <TableHead className="font-semibold text-foreground text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedSuppliers.map(s => {
                      const phoneDigits = (s.phone || '').replace(/\D/g, '');
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="hidden md:table-cell">
                            <Badge variant="outline" className="font-mono bg-muted/50">{s.supplier_code}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="font-semibold">{s.name}</div>
                            {s.gst_number && <div className="text-xs text-muted-foreground mt-0.5">GST: {s.gst_number}</div>}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            {s.contact_person && <div className="text-sm font-medium">{s.contact_person}</div>}
                            {s.phone && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Phone className="h-3 w-3" />{s.phone}</div>}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-center font-medium">
                            {s.totalProducts}
                          </TableCell>
                          <TableCell className="hidden xl:table-cell text-right font-medium">
                            {formatINR(s.totalPurchaseValue)}
                          </TableCell>
                          <TableCell className="hidden xl:table-cell text-right text-emerald-600 font-medium">
                            {formatINR(s.totalPaid)}
                          </TableCell>
                          <TableCell className="text-right text-red-600 font-medium">
                            {formatINR(s.balance)}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-center">
                            {paymentStatusBadge(s.paymentStatus)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {s.phone && (
                                <a
                                  href={`tel:${s.phone}`}
                                  className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted"
                                  aria-label={`Call ${s.name}`}
                                  title={`Call ${s.phone}`}
                                >
                                  <Phone className="h-4 w-4" />
                                </a>
                              )}
                              {phoneDigits && (
                                <a
                                  href={`https://wa.me/${phoneDigits.length === 10 ? '91' + phoneDigits : phoneDigits}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center justify-center h-8 w-8 rounded-md text-emerald-600 hover:bg-emerald-50"
                                  aria-label={`WhatsApp ${s.name}`}
                                  title={`WhatsApp ${s.phone}`}
                                >
                                  <MessageCircle className="h-4 w-4" />
                                </a>
                              )}
                              {s.email && (
                                <a
                                  href={`mailto:${s.email}`}
                                  className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted"
                                  aria-label={`Email ${s.name}`}
                                  title={s.email}
                                >
                                  <Mail className="h-4 w-4" />
                                </a>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openDetail(s)}
                                className="ml-1"
                              >
                                <Eye className="h-4 w-4 mr-2" />View
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination footer */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredSuppliers.length)} of {filteredSuppliers.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                      Prev
                    </Button>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Supplier Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto p-5 sm:p-7">
          {selectedSupplier && (() => {
            const phoneDigits = (selectedSupplier.phone || '').replace(/\D/g, '');
            const waNumber = phoneDigits ? (phoneDigits.length === 10 ? '91' + phoneDigits : phoneDigits) : null;
            const lastPaidTs = lastPaymentBySupplier.get(selectedSupplier.id);
            const daysSincePaid = lastPaidTs
              ? Math.max(0, Math.floor((Date.now() - lastPaidTs) / (1000 * 60 * 60 * 24)))
              : null;
            const gstValid = isValidGSTIN(selectedSupplier.gst_number);
            const hasAnyActivity = supplierProducts.length > 0 || supplierPayments.length > 0;
            const balanceDue = selectedSupplier.balance > 0;
            const actionCount =
              (selectedSupplier.phone ? 1 : 0) +
              (waNumber ? 1 : 0) +
              (selectedSupplier.email ? 1 : 0) +
              (selectedSupplier.address ? 1 : 0);

            return (
              <div className="space-y-6">
                {/* === Band 1: Identity === */}
                {/* pr-8 reserves room on the title row so a long name + the shadcn close X never overlap */}
                <DialogHeader className="space-y-1.5 pr-8">
                  <div className="flex items-start gap-3">
                    <div className="bg-primary/10 p-2.5 rounded-md shrink-0">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <DialogTitle className="text-lg sm:text-xl truncate">
                        {selectedSupplier.name}
                      </DialogTitle>
                      <DialogDescription asChild>
                        <div className="mt-1 flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground min-w-0 flex-1">
                            <span className="font-mono">{selectedSupplier.supplier_code}</span>
                            {selectedSupplier.gst_number && (
                              <>
                                <span aria-hidden>·</span>
                                <button
                                  type="button"
                                  onClick={() => copyGST(selectedSupplier.gst_number!)}
                                  className="inline-flex items-center gap-1 font-mono hover:text-foreground transition-colors"
                                  title="Copy GSTIN"
                                >
                                  <span>GST: {selectedSupplier.gst_number}</span>
                                  {gstCopied
                                    ? <Check className="h-3 w-3 text-emerald-600" />
                                    : <Copy className="h-3 w-3 opacity-50" />}
                                  {!gstValid && (
                                    <AlertTriangle
                                      className="h-3 w-3 text-amber-500"
                                      aria-label="Doesn't match standard GSTIN format"
                                    />
                                  )}
                                </button>
                              </>
                            )}
                            {selectedSupplier.contact_person && (
                              <>
                                <span aria-hidden>·</span>
                                <span className="inline-flex items-center gap-1">
                                  <User className="h-3 w-3" />
                                  {selectedSupplier.contact_person}
                                </span>
                              </>
                            )}
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 -mt-1">
                                <MoreVertical className="h-4 w-4" />
                                <span className="sr-only">More options</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => openEditSupplier(selectedSupplier)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit details
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setPendingDeleteId(selectedSupplier.id)}
                                className="text-red-600 focus:text-red-700 focus:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete supplier
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                {/* === Band 2: Quick actions === */}
                {actionCount > 0 && (
                  <div
                    className="grid gap-2 grid-cols-2 sm:[grid-template-columns:var(--action-cols)]"
                    style={{ ['--action-cols' as string]: `repeat(${Math.min(actionCount, 4)}, minmax(0, 1fr))` }}
                  >
                    {selectedSupplier.phone && (
                      <a
                        href={`tel:${selectedSupplier.phone}`}
                        className="flex flex-col items-center justify-center gap-1 h-16 rounded-md border bg-card hover:bg-muted transition-colors"
                        title={`Call ${selectedSupplier.phone}`}
                      >
                        <Phone className="h-4 w-4" />
                        <span className="text-xs font-medium">Call</span>
                      </a>
                    )}
                    {waNumber && (
                      <a
                        href={`https://wa.me/${waNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center justify-center gap-1 h-16 rounded-md border border-emerald-200 bg-emerald-50/40 text-emerald-700 hover:bg-emerald-50 transition-colors"
                        title={`WhatsApp ${selectedSupplier.phone}`}
                      >
                        <MessageCircle className="h-4 w-4" />
                        <span className="text-xs font-medium">WhatsApp</span>
                      </a>
                    )}
                    {selectedSupplier.email && (
                      <a
                        href={`mailto:${selectedSupplier.email}`}
                        className="flex flex-col items-center justify-center gap-1 h-16 rounded-md border bg-card hover:bg-muted transition-colors"
                        title={selectedSupplier.email}
                      >
                        <Mail className="h-4 w-4" />
                        <span className="text-xs font-medium">Email</span>
                      </a>
                    )}
                    {selectedSupplier.address && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedSupplier.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center justify-center gap-1 h-16 rounded-md border bg-card hover:bg-muted transition-colors"
                        title={selectedSupplier.address}
                      >
                        <MapPin className="h-4 w-4" />
                        <span className="text-xs font-medium">Maps</span>
                      </a>
                    )}
                  </div>
                )}

                {/* === Band 3: Account summary === */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-md border p-4">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Purchase Value</p>
                    <p className="text-lg font-semibold mt-1 truncate">{formatINR(selectedSupplier.totalPurchaseValue)}</p>
                  </div>
                  <div className="rounded-md border p-4">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Paid</p>
                    <p className="text-lg font-semibold text-emerald-700 mt-1 truncate">{formatINR(selectedSupplier.totalPaid)}</p>
                  </div>
                  <div className={cn(
                    "rounded-md border p-4",
                    balanceDue && "border-red-200 bg-red-50/40"
                  )}>
                    <p className={cn(
                      "text-[11px] uppercase tracking-wide",
                      balanceDue ? "text-red-700" : "text-muted-foreground"
                    )}>
                      {balanceDue ? 'Balance Due' : 'Settled'}
                    </p>
                    <p className={cn(
                      "text-lg font-semibold mt-1 truncate",
                      balanceDue ? "text-red-700" : "text-emerald-700"
                    )}>
                      {formatINR(selectedSupplier.balance)}
                    </p>
                    {daysSincePaid !== null ? (
                      <p className="text-[11px] text-muted-foreground mt-1.5">
                        Last paid {daysSincePaid === 0 ? 'today' : `${daysSincePaid} day${daysSincePaid === 1 ? '' : 's'} ago`}
                      </p>
                    ) : !loadingDetail && supplierPayments.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground mt-1.5">No payments yet</p>
                    ) : null}
                  </div>
                </div>

                {/* === Band 4: Activity (Tabs) === */}
                {loadingDetail ? (
                  <TableSkeleton rows={5} cols={['w-24', 'w-44', 'w-20', 'w-16']} />
                ) : !hasAnyActivity ? (
                  <div className="text-center py-12 border border-dashed rounded-md">
                    <div className="bg-muted/50 p-4 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-3">
                      <Package className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="text-base font-semibold mb-1">No activity yet</h3>
                    <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
                      Link products to this supplier or record a payment to start tracking purchases and balances.
                    </p>
                    <Button size="sm" onClick={() => setIsPaymentOpen(true)}>
                      <CreditCard className="h-4 w-4 mr-2" />Record First Payment
                    </Button>
                  </div>
                ) : (
                  <Tabs defaultValue={supplierProducts.length === 0 ? 'payments' : 'products'} className="w-full">
                    <TabsList className="grid grid-cols-2 w-full sm:w-auto sm:inline-grid">
                      <TabsTrigger value="products" className="gap-2">
                        <Package className="h-3.5 w-3.5" />
                        Products
                        <span className="text-muted-foreground">({supplierProducts.length})</span>
                      </TabsTrigger>
                      <TabsTrigger value="payments" className="gap-2">
                        <Receipt className="h-3.5 w-3.5" />
                        Payments
                        <span className="text-muted-foreground">({supplierPayments.length})</span>
                      </TabsTrigger>
                    </TabsList>

                    {/* Products tab */}
                    <TabsContent value="products" className="mt-4 space-y-3">
                      {supplierProducts.length === 0 ? (
                        <div className="text-center py-10 border border-dashed rounded-md">
                          <Package className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">No products linked to this supplier yet.</p>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-end gap-2">
                            {supplierProducts.length > 5 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowAllProducts(s => !s)}
                                className="h-8 text-xs"
                              >
                                {showAllProducts ? 'Show less' : `Show all ${supplierProducts.length}`}
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleDownloadProducts}
                              className="h-8 text-xs"
                            >
                              <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
                            </Button>
                          </div>
                          <div className="rounded-md border overflow-hidden">
                            <Table>
                              <TableHeader className="bg-muted/40">
                                <TableRow className="hover:bg-transparent">
                                  <TableHead className="font-medium text-xs">Product</TableHead>
                                  <TableHead className="hidden md:table-cell font-medium text-xs">Category</TableHead>
                                  <TableHead className="font-medium text-xs text-center">Stock</TableHead>
                                  <TableHead className="hidden sm:table-cell font-medium text-xs text-right">Unit Cost</TableHead>
                                  <TableHead className="font-medium text-xs text-right">Value</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(showAllProducts ? supplierProducts : supplierProducts.slice(0, 5)).map(p => (
                                  <TableRow key={p.id}>
                                    <TableCell className="font-medium text-sm py-2.5">{p.name}</TableCell>
                                    <TableCell className="hidden md:table-cell text-sm py-2.5 text-muted-foreground">{p.category || '—'}</TableCell>
                                    <TableCell className="text-center text-sm py-2.5">{p.quantity}</TableCell>
                                    <TableCell className="hidden sm:table-cell text-right text-sm py-2.5">{formatINR(p.purchase_price ?? 0)}</TableCell>
                                    <TableCell className="text-right text-sm py-2.5 font-medium">{formatINR((p.purchase_price ?? 0) * p.quantity)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            {!showAllProducts && supplierProducts.length > 5 && (
                              <button
                                type="button"
                                onClick={() => setShowAllProducts(true)}
                                className="w-full py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 border-t transition-colors"
                              >
                                + Show {supplierProducts.length - 5} more
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </TabsContent>

                    {/* Payments tab */}
                    <TabsContent value="payments" className="mt-4 space-y-3">
                      <div className="flex items-center justify-end">
                        <Button size="sm" onClick={() => setIsPaymentOpen(true)} className="h-8 text-xs">
                          <Plus className="h-3.5 w-3.5 mr-1.5" />Add Payment
                        </Button>
                      </div>
                      {supplierPayments.length === 0 ? (
                        <div className="text-center py-10 border border-dashed rounded-md">
                          <Receipt className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground mb-3">No payments recorded yet.</p>
                          <Button variant="secondary" size="sm" onClick={() => setIsPaymentOpen(true)}>
                            <CreditCard className="h-4 w-4 mr-2" />Record First Payment
                          </Button>
                        </div>
                      ) : (
                        <div className="rounded-md border overflow-hidden">
                          <Table>
                            <TableHeader className="bg-muted/40">
                              <TableRow className="hover:bg-transparent">
                                <TableHead className="font-medium text-xs">Date</TableHead>
                                <TableHead className="hidden sm:table-cell font-medium text-xs">Type</TableHead>
                                <TableHead className="font-medium text-xs text-right">Amount</TableHead>
                                <TableHead className="hidden md:table-cell font-medium text-xs">Notes</TableHead>
                                <TableHead className="font-medium text-xs text-right w-12"><span className="sr-only">Actions</span></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {supplierPayments.map(p => (
                                <TableRow key={p.id}>
                                  <TableCell className="text-sm py-2.5">{new Date(p.payment_date).toLocaleDateString('en-IN')}</TableCell>
                                  <TableCell className="hidden sm:table-cell py-2.5">
                                    <Badge variant="outline" className={cn(
                                      "text-[10px] font-normal",
                                      p.payment_type === 'full' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' :
                                        p.payment_type === 'advance' ? 'border-blue-300 text-blue-700 bg-blue-50' :
                                          'border-amber-300 text-amber-700 bg-amber-50'
                                    )}>
                                      {p.payment_type.charAt(0).toUpperCase() + p.payment_type.slice(1)}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-sm py-2.5 text-right font-semibold text-emerald-700">
                                    {formatINR(p.amount)}
                                  </TableCell>
                                  <TableCell className="hidden md:table-cell text-sm py-2.5 text-muted-foreground">{p.notes || '—'}</TableCell>
                                  <TableCell className="text-right py-2.5">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                      onClick={() => handleDeletePayment(p.id)}
                                      title="Delete payment"
                                      aria-label="Delete payment"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Add Payment Dialog */}
      <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <DialogContent className="w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">Record Payment</DialogTitle>
            <DialogDescription className="text-base">
              {selectedSupplier && <>Payment to <strong>{selectedSupplier.name}</strong> — Balance due: <strong className="text-red-600">{formatINR(selectedSupplier.balance)}</strong></>}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddPayment} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-base font-semibold">Amount (₹) *</Label>
              <Input name="amount" type="number" step="0.01" min="0.01" placeholder="0.00" className="text-base" required />
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">Payment Type</Label>
              <Select value={paymentType} onValueChange={setPaymentType}>
                <SelectTrigger className="text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full Payment</SelectItem>
                  <SelectItem value="partial">Partial Payment</SelectItem>
                  <SelectItem value="advance">Advance Payment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">Payment Date</Label>
              <Input name="payment_date" type="date" defaultValue={new Date().toISOString().split('T')[0]} className="text-base" />
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">Notes (optional)</Label>
              <Input name="notes" placeholder="Cheque no., bank transfer ref, etc." className="text-base" />
            </div>
            <label className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                name="overpay_ack"
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span>Record as advance / over-payment (allows amount to exceed current balance due).</span>
            </label>
            <DialogFooter className="gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setIsPaymentOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSavingPayment}>
                {isSavingPayment ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2" />Saving...</> : <><CreditCard className="h-4 w-4 mr-2" />Record Payment</>}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirm-delete dialog */}
      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this supplier?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const target = suppliers.find(s => s.id === pendingDeleteId);
                const paymentCount = pendingDeleteId
                  ? payments.filter(p => p.supplier_id === pendingDeleteId).length
                  : 0;
                return (
                  <>
                    This will remove <strong>{target?.name || 'this supplier'}</strong>
                    {paymentCount > 0 && <> along with <strong>{paymentCount}</strong> payment record{paymentCount === 1 ? '' : 's'}</>}
                    . You'll have a few seconds to undo afterwards.
                  </>
                );
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteId) {
                  const id = pendingDeleteId;
                  setPendingDeleteId(null);
                  handleDeleteSupplier(id);
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
