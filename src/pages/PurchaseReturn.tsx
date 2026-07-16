import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { TableSkeleton } from '@/components/TableSkeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  RotateCcw, Search, Plus, Package, Truck, AlertTriangle,
  IndianRupee, CalendarDays, ClipboardList, CheckCircle2, ArrowLeft, Info,
  Upload, X, FileText, Pencil, Trash2, Printer, Download, Filter,
  ArrowUpDown, ArrowUp, ArrowDown, ArrowRight, History, Clock, AlertCircle, Wallet,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

const RETURN_REASONS = ['Damaged', 'Expired', 'Wrong item', 'Short shipped', 'Quality issue', 'Other'] as const;

function SortableHead({
  label, k, sortKey, sortDir, onSort, align = 'left',
}: {
  label: string;
  k: 'return_date' | 'return_amount' | 'quantity' | 'supplier' | 'product';
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (k: any) => void;
  align?: 'left' | 'center' | 'right';
}) {
  const active = sortKey === k;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  const alignClass = align === 'right' ? 'text-right justify-end' : align === 'center' ? 'text-center justify-center' : 'text-left';
  return (
    <TableHead className={align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${alignClass} ${active ? 'text-foreground font-semibold' : ''}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? 'opacity-100' : 'opacity-40'}`} />
      </button>
    </TableHead>
  );
}

// ─── Types ────────────────────────────────────────────────
interface Supplier {
  id: string;
  name: string;
  supplier_code: string;
  phone: string | null;
}

interface SupplierProduct {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  purchase_price: number | null;
  batch_number: string | null;
  expiry_date: string | null;
  supplier_id: string | null;
  supplier?: string | null;
}

interface PurchaseReturnRow {
  id: string;
  supplier_id: string;
  product_id: string;
  quantity: number;
  purchase_price: number;
  return_amount: number;
  reason: string | null;
  return_date: string;
  batch_number: string | null;
  original_invoice_no: string | null;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  suppliers: { name: string; supplier_code: string } | null;
  products: { name: string; category: string | null } | null;
}

type SortKey = 'return_date' | 'return_amount' | 'quantity' | 'supplier' | 'product';
type SortDir = 'asc' | 'desc';

interface SupplierContext {
  balance: number;
  recentReturns: { id: string; return_date: string; return_amount: number; product_name: string }[];
}

// ─── Component ─────────────────────────────────────────────
export default function PurchaseReturn() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [allProducts, setAllProducts] = useState<SupplierProduct[]>([]);
  const [returns, setReturns] = useState<PurchaseReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableExists, setTableExists] = useState(true);

  // filters
  const [searchTerm, setSearchTerm] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // sort
  const [sortKey, setSortKey] = useState<SortKey>('return_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // pagination
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 15;

  // detail drawer
  const [detailRow, setDetailRow] = useState<PurchaseReturnRow | null>(null);

  // expired-stock shortcut
  const [isExpiredOpen, setIsExpiredOpen] = useState(false);
  const [expiredSupplierId, setExpiredSupplierId] = useState('');
  const [expiredSelectedIds, setExpiredSelectedIds] = useState<Set<string>>(new Set());
  const [expiredReason, setExpiredReason] = useState('Expired');
  const [isExpiredProcessing, setIsExpiredProcessing] = useState(false);

  // dialog
  const [isOpen, setIsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingReturn, setEditingReturn] = useState<PurchaseReturnRow | null>(null);
  const [voidingReturn, setVoidingReturn] = useState<PurchaseReturnRow | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);
  const [accountName, setAccountName] = useState('');

  // form
  const [selSupplierId, setSelSupplierId] = useState('');
  const [selProductId, setSelProductId] = useState('');
  const [returnQty, setReturnQty] = useState(1);
  const [returnReasonType, setReturnReasonType] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [customPrice, setCustomPrice] = useState<number | ''>('');
  const [originalInvoiceNo, setOriginalInvoiceNo] = useState('');

  // supplier context (shown in dialog after supplier select)
  const [supplierContext, setSupplierContext] = useState<SupplierContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  // product search combobox
  const [productSearch, setProductSearch] = useState('');
  const [showProductList, setShowProductList] = useState(false);
  const productSearchRef = useRef<HTMLDivElement>(null);

  // bulk CSV mode
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [bulkSupplierId, setBulkSupplierId] = useState('');
  const [bulkCSVText, setBulkCSVText] = useState('');
  interface BulkRow {
    product: SupplierProduct | null;
    productName: string;
    qty: number;
    price: number;
    reason: string;
    error?: string;
    supplier_id?: string;
    supplier_name?: string;
    mapped_supplier_id?: string;
  }
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkParsed, setBulkParsed] = useState(false);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Conflict handling
  const [bulkHasConflicts, setBulkHasConflicts] = useState(false);
  const [conflictSuppliersList, setConflictSuppliersList] = useState<string[]>([]);
  const [bulkProcessMode, setBulkProcessMode] = useState<'selected_only' | 'all'>('selected_only');

  // ── fetch ────────────────────────────────────────────────
  const fetchData = async () => {
    if (!profile?.account_id) return;
    setLoading(true);
    try {
      const [suppRes, prodRes] = await Promise.all([
        supabase
          .from('suppliers')
          .select('id, name, supplier_code, phone')
          .eq('account_id', profile.account_id)
          .order('name'),
        (supabase as any)
          .from('products')
          .select('id, name, category, quantity, purchase_price, batch_number, expiry_date, supplier_id, supplier')
          .eq('account_id', profile.account_id),
      ]);

      if (suppRes.error) throw suppRes.error;
      if (prodRes.error) throw prodRes.error;

      setSuppliers((suppRes.data ?? []) as Supplier[]);
      setAllProducts((prodRes.data ?? []) as SupplierProduct[]);

      // Account name (for the printable credit note)
      const { data: acct } = await supabase
        .from('accounts')
        .select('name' as any)
        .eq('id', profile.account_id)
        .single();
      setAccountName(((acct as any)?.name ?? '') as string);

      // Fetch active (non-voided) returns. Falls back to legacy columns if the
      // audit/invoice migration hasn't been applied yet.
      const fullCols = 'id, supplier_id, product_id, quantity, purchase_price, return_amount, reason, return_date, batch_number, original_invoice_no, created_at, updated_at, created_by, updated_by, voided_at, voided_by, void_reason, suppliers(name, supplier_code), products(name, category)';
      const legacyCols = 'id, supplier_id, product_id, quantity, purchase_price, return_amount, reason, return_date, batch_number, created_at, suppliers(name, supplier_code), products(name, category)';

      let retRes = await (supabase as any)
        .from('purchase_returns')
        .select(fullCols)
        .eq('account_id', profile.account_id)
        .is('voided_at', null)
        .order('created_at', { ascending: false });

      // Migration not applied yet → retry without audit columns
      if (retRes.error && (retRes.error.message?.includes('column') || retRes.error.code === '42703')) {
        retRes = await (supabase as any)
          .from('purchase_returns')
          .select(legacyCols)
          .eq('account_id', profile.account_id)
          .order('created_at', { ascending: false });
      }

      if (!retRes.error) {
        setTableExists(true);
        setReturns((retRes.data ?? []) as PurchaseReturnRow[]);
      } else if (retRes.error.code === '42P01' || retRes.error.message?.includes('does not exist')) {
        setTableExists(false);
        setReturns([]);
      } else {
        throw retRes.error;
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error loading data', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [profile?.account_id]);

  // ── derived ──────────────────────────────────────────────
  const supplierProducts = useMemo(() => {
    const selectedSupplier = suppliers.find(s => s.id === selSupplierId);
    return allProducts.filter(p => {
      if (p.supplier_id === selSupplierId) return true;
      if (selectedSupplier && p.supplier && p.supplier.toLowerCase() === selectedSupplier.name.toLowerCase()) return true;
      return false;
    });
  }, [allProducts, selSupplierId, suppliers]);

  const selectedProduct = useMemo(
    () => allProducts.find(p => p.id === selProductId) ?? null,
    [allProducts, selProductId]
  );

  const effectivePrice = customPrice !== '' ? Number(customPrice) : (selectedProduct?.purchase_price ?? 0);
  const estimatedRefund = effectivePrice * returnQty;

  // Available stock to return = current stock + (qty already deducted by the return being edited, if same product)
  const maxReturnable = useMemo(() => {
    if (!selectedProduct) return 0;
    const editAddBack = editingReturn && editingReturn.product_id === selectedProduct.id ? editingReturn.quantity : 0;
    return (selectedProduct.quantity ?? 0) + editAddBack;
  }, [selectedProduct, editingReturn]);
  const overStock = !!selectedProduct && returnQty > maxReturnable;

  const filteredReturns = useMemo(() => {
    let list = returns;
    if (supplierFilter !== 'all') list = list.filter(r => r.supplier_id === supplierFilter);
    if (dateFrom) list = list.filter(r => r.return_date >= dateFrom);
    if (dateTo) list = list.filter(r => r.return_date <= dateTo);
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(r =>
        (r.products?.name ?? '').toLowerCase().includes(q) ||
        (r.suppliers?.name ?? '').toLowerCase().includes(q) ||
        (r.reason ?? '').toLowerCase().includes(q) ||
        (r.original_invoice_no ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [returns, supplierFilter, searchTerm, dateFrom, dateTo]);

  const sortedReturns = useMemo(() => {
    const arr = [...filteredReturns];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av: any; let bv: any;
      switch (sortKey) {
        case 'return_amount':  av = a.return_amount; bv = b.return_amount; break;
        case 'quantity':       av = a.quantity; bv = b.quantity; break;
        case 'supplier':       av = a.suppliers?.name ?? ''; bv = b.suppliers?.name ?? ''; break;
        case 'product':        av = a.products?.name ?? '';  bv = b.products?.name ?? ''; break;
        case 'return_date':
        default:               av = a.return_date; bv = b.return_date;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
    return arr;
  }, [filteredReturns, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedReturns.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedReturns = useMemo(
    () => sortedReturns.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sortedReturns, safePage]
  );

  // Reset to page 1 when filters/sort change
  useEffect(() => { setCurrentPage(1); }, [supplierFilter, searchTerm, dateFrom, dateTo, sortKey, sortDir]);

  // Stats — react to current filters (not all-time)
  const totalReturned = useMemo(() => filteredReturns.reduce((s, r) => s + r.return_amount, 0), [filteredReturns]);
  const totalUnits    = useMemo(() => filteredReturns.reduce((s, r) => s + r.quantity, 0), [filteredReturns]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'return_date' ? 'desc' : 'asc'); }
  };

  const exportCurrentView = () => {
    if (filteredReturns.length === 0) {
      toast({ variant: 'destructive', title: 'Nothing to export' });
      return;
    }
    const rows = filteredReturns.map(r => ({
      date: r.return_date,
      supplier: r.suppliers?.name ?? '',
      supplier_code: r.suppliers?.supplier_code ?? '',
      product: r.products?.name ?? '',
      category: r.products?.category ?? '',
      batch: r.batch_number ?? '',
      quantity: r.quantity,
      unit_price: r.purchase_price,
      return_amount: r.return_amount,
      reason: r.reason ?? '',
      original_invoice_no: r.original_invoice_no ?? '',
    }));
    downloadCSV(
      rows,
      ['date', 'supplier', 'supplier_code', 'product', 'category', 'batch', 'quantity', 'unit_price', 'return_amount', 'reason', 'original_invoice_no'],
      `purchase-returns-${new Date().toISOString().split('T')[0]}.csv`
    );
  };

  // filtered products for search combobox
  const filteredSupplierProducts = useMemo(() => {
    const selectedSupplier = suppliers.find(s => s.id === selSupplierId);
    const base = allProducts.filter(p => {
      if (p.supplier_id === selSupplierId) return true;
      if (selectedSupplier && p.supplier && p.supplier.toLowerCase() === selectedSupplier.name.toLowerCase()) return true;
      return false;
    });
    if (!productSearch.trim()) return base;
    const q = productSearch.toLowerCase();
    return base.filter(p => p.name.toLowerCase().includes(q));
  }, [allProducts, selSupplierId, productSearch, suppliers]);

  // close product dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (productSearchRef.current && !productSearchRef.current.contains(e.target as Node)) {
        setShowProductList(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── dialog helpers ───────────────────────────────────────
  const openDialog = () => {
    setEditingReturn(null);
    setSelSupplierId('');
    setSelProductId('');
    setProductSearch('');
    setShowProductList(false);
    setReturnQty(1);
    setReturnReasonType('');
    setReturnReason('');
    setReturnDate(new Date().toISOString().split('T')[0]);
    setCustomPrice('');
    setOriginalInvoiceNo('');
    setSupplierContext(null);
    setIsOpen(true);
  };

  const openEditDialog = (r: PurchaseReturnRow) => {
    setEditingReturn(r);
    setSelSupplierId(r.supplier_id);
    setSelProductId(r.product_id);
    setProductSearch(r.products?.name ?? '');
    setShowProductList(false);
    setReturnQty(r.quantity);
    if (r.reason && (RETURN_REASONS as readonly string[]).includes(r.reason)) {
      setReturnReasonType(r.reason);
      setReturnReason('');
    } else if (r.reason) {
      setReturnReasonType('Other');
      setReturnReason(r.reason);
    } else {
      setReturnReasonType('');
      setReturnReason('');
    }
    setReturnDate(r.return_date);
    setCustomPrice(r.purchase_price);
    setOriginalInvoiceNo(r.original_invoice_no ?? '');
    setSupplierContext(null);
    setIsOpen(true);
  };

  const handleVoid = async (r: PurchaseReturnRow) => {
    if (isVoiding) return;
    setIsVoiding(true);
    try {
      // Atomic: restores stock + removes supplier credit + soft-deletes the row.
      const { error } = await (supabase as any).rpc('void_purchase_return', {
        p_id: r.id,
        p_void_reason: null,
      });

      if (error) {
        // Fallback if the RPC isn't deployed yet — legacy hard delete + manual stock restore.
        if (error.code === '42883' || error.message?.includes('does not exist')) {
          const { error: delErr } = await (supabase as any).from('purchase_returns').delete().eq('id', r.id);
          if (delErr) throw delErr;
          const product = allProducts.find(p => p.id === r.product_id);
          const restored = (product?.quantity ?? 0) + r.quantity;
          await supabase.from('products').update({ quantity: restored } as any).eq('id', r.product_id);
        } else {
          throw error;
        }
      }

      toast({
        title: 'Return voided',
        description: `${r.quantity} unit(s) of "${r.products?.name ?? 'item'}" restored to stock.`,
      });
      setVoidingReturn(null);
      setDetailRow(null);
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not void return', description: err.message });
    } finally {
      setIsVoiding(false);
    }
  };

  // ── Supplier context (last 3 returns + outstanding balance) ─────
  const fetchSupplierContext = async (supplierId: string) => {
    if (!profile?.account_id || !supplierId) { setSupplierContext(null); return; }
    setLoadingContext(true);
    try {
      const [recentRes, prodRes, payRes] = await Promise.all([
        (supabase as any)
          .from('purchase_returns')
          .select('id, return_date, return_amount, products(name)')
          .eq('account_id', profile.account_id)
          .eq('supplier_id', supplierId)
          .is('voided_at', null)
          .order('return_date', { ascending: false })
          .limit(3),
        (supabase as any)
          .from('products')
          .select('purchase_price, quantity')
          .eq('account_id', profile.account_id)
          .eq('supplier_id', supplierId),
        (supabase as any)
          .from('supplier_payments')
          .select('amount')
          .eq('account_id', profile.account_id)
          .eq('supplier_id', supplierId),
      ]);

      const totalPurchaseValue = (prodRes.data ?? []).reduce(
        (s: number, p: any) => s + (Number(p.purchase_price) || 0) * (Number(p.quantity) || 0), 0
      );
      const totalPaid = (payRes.data ?? []).reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0);
      const balance = Math.max(0, totalPurchaseValue - totalPaid);

      setSupplierContext({
        balance,
        recentReturns: (recentRes.data ?? []).map((r: any) => ({
          id: r.id,
          return_date: r.return_date,
          return_amount: r.return_amount,
          product_name: r.products?.name ?? '—',
        })),
      });
    } catch {
      setSupplierContext(null);
    } finally {
      setLoadingContext(false);
    }
  };

  // Refetch supplier context whenever the dialog supplier changes
  useEffect(() => {
    if (isOpen && selSupplierId) fetchSupplierContext(selSupplierId);
    else setSupplierContext(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selSupplierId]);

  // ── Expired-stock shortcut: products from a supplier past expiry ─────
  const expiredCandidates = useMemo(() => {
    if (!expiredSupplierId) return [];
    const today = new Date().toISOString().split('T')[0];
    const supp = suppliers.find(s => s.id === expiredSupplierId);
    return allProducts.filter(p => {
      const supplierMatch = p.supplier_id === expiredSupplierId
        || (supp && p.supplier && p.supplier.toLowerCase() === supp.name.toLowerCase());
      return supplierMatch && p.expiry_date && p.expiry_date < today && (p.quantity ?? 0) > 0;
    });
  }, [allProducts, expiredSupplierId, suppliers]);

  const openExpiredDialog = () => {
    setExpiredSupplierId('');
    setExpiredSelectedIds(new Set());
    setExpiredReason('Expired');
    setIsExpiredOpen(true);
  };

  const toggleExpiredId = (id: string) => {
    setExpiredSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submitExpiredBatch = async () => {
    if (!profile?.account_id || isExpiredProcessing) return;
    if (!expiredSupplierId) {
      toast({ variant: 'destructive', title: 'Pick a supplier' });
      return;
    }
    const ids = Array.from(expiredSelectedIds);
    if (ids.length === 0) {
      toast({ variant: 'destructive', title: 'Select at least one product' });
      return;
    }
    setIsExpiredProcessing(true);
    const today = new Date().toISOString().split('T')[0];
    let ok = 0; let fail = 0;
    for (const pid of ids) {
      const p = allProducts.find(x => x.id === pid);
      if (!p || (p.quantity ?? 0) <= 0) { fail++; continue; }
      const amt = (p.purchase_price ?? 0) * p.quantity;
      const { error } = await (supabase as any).rpc('create_purchase_return', {
        p_account_id: profile.account_id,
        p_supplier_id: expiredSupplierId,
        p_product_id: p.id,
        p_quantity: p.quantity,
        p_purchase_price: p.purchase_price ?? 0,
        p_return_amount: amt,
        p_reason: expiredReason || 'Expired',
        p_return_date: today,
        p_batch_number: p.batch_number ?? null,
        p_original_invoice_no: null,
      });
      if (error) fail++; else ok++;
    }
    setIsExpiredProcessing(false);
    if (ok > 0) {
      toast({ title: 'Expired stock returned', description: `${ok} product(s) returned${fail ? `; ${fail} failed` : ''}.` });
      setIsExpiredOpen(false);
      fetchData();
    } else {
      toast({ variant: 'destructive', title: 'Nothing was returned', description: 'All selected items failed. Check the migration is applied.' });
    }
  };

  // ── CSV helpers ───────────────────────────────────────────
  const downloadCSV = (rows: any[], headers: string[], filename: string) => {
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => {
        const v = r[h] ?? '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      }).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const downloadCsvTemplate = () => {
    const sample = [
      { product_name: 'Paracetamol 500mg', quantity: 10, purchase_price: 12.50, reason: 'Damaged' },
      { product_name: 'Amoxicillin 250mg', quantity: 5, purchase_price: '', reason: 'Expired' },
    ];
    downloadCSV(sample, ['product_name', 'quantity', 'purchase_price', 'reason'], 'purchase-return-template.csv');
  };

  const handlePrint = (r: PurchaseReturnRow) => {
    const win = window.open('', '_blank', 'width=720,height=900');
    if (!win) {
      toast({ variant: 'destructive', title: 'Pop-up blocked', description: 'Allow pop-ups to print credit notes.' });
      return;
    }
    const fmt = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const note = `<!doctype html>
<html><head><meta charset="utf-8" /><title>Credit Note ${r.id.slice(0, 8).toUpperCase()}</title>
<style>
  *{box-sizing:border-box} body{font-family:ui-sans-serif,system-ui,'Segoe UI',Arial,sans-serif;color:#0f172a;margin:0;padding:32px;font-size:13px;line-height:1.45}
  h1{font-size:18px;margin:0;letter-spacing:.5px;text-transform:uppercase}
  .muted{color:#64748b;font-size:11px;letter-spacing:.5px;text-transform:uppercase}
  .row{display:flex;justify-content:space-between;gap:24px}
  .box{border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px}
  table{width:100%;border-collapse:collapse;margin-top:18px}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#475569;background:#f8fafc}
  .right{text-align:right}
  .total{margin-top:18px;display:flex;justify-content:flex-end}
  .total .box{min-width:240px}
  .sig{margin-top:64px;display:flex;justify-content:space-between}
  .sig div{border-top:1px solid #94a3b8;width:200px;padding-top:6px;font-size:11px;color:#64748b;text-align:center}
  @media print{body{padding:18px}}
</style></head><body>
  <div class="row" style="align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:14px">
    <div>
      <h1>${(accountName || 'Pharmacy').replace(/</g, '')}</h1>
      <div class="muted" style="margin-top:4px">Credit Note · Purchase Return</div>
    </div>
    <div style="text-align:right">
      <div class="muted">Note No.</div>
      <div style="font-weight:600;letter-spacing:.5px">CN-${r.id.slice(0, 8).toUpperCase()}</div>
      <div class="muted" style="margin-top:8px">Date</div>
      <div>${new Date(r.return_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
    </div>
  </div>

  <div class="row" style="margin-top:18px">
    <div class="box" style="flex:1">
      <div class="muted">Returned to</div>
      <div style="font-weight:600;font-size:14px;margin-top:4px">${(r.suppliers?.name ?? '—').replace(/</g, '')}</div>
      ${r.suppliers?.supplier_code ? `<div class="muted" style="margin-top:2px">Code: ${r.suppliers.supplier_code}</div>` : ''}
    </div>
    <div class="box" style="flex:1">
      <div class="muted">Reason</div>
      <div style="margin-top:4px">${(r.reason ?? '—').replace(/</g, '')}</div>
    </div>
  </div>

  <table>
    <thead><tr><th>Product</th><th>Batch</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Amount</th></tr></thead>
    <tbody>
      <tr>
        <td>${(r.products?.name ?? '—').replace(/</g, '')}${r.products?.category ? `<div class="muted" style="margin-top:2px">${r.products.category.replace(/</g, '')}</div>` : ''}</td>
        <td>${(r.batch_number ?? '—').replace(/</g, '')}</td>
        <td class="right">${r.quantity}</td>
        <td class="right">₹${fmt(r.purchase_price)}</td>
        <td class="right">₹${fmt(r.return_amount)}</td>
      </tr>
    </tbody>
  </table>

  <div class="total"><div class="box"><div class="row"><span class="muted">Total credit</span><strong style="font-size:15px">₹${fmt(r.return_amount)}</strong></div></div></div>

  <div class="sig"><div>Authorised signatory</div><div>Supplier acknowledgement</div></div>
</body></html>`;
    win.document.open();
    win.document.write(note);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  };

  const openBulkDialog = () => {
    setBulkSupplierId('');
    setBulkCSVText('');
    setBulkRows([]);
    setBulkParsed(false);
    setBulkHasConflicts(false);
    setConflictSuppliersList([]);
    setBulkProcessMode('selected_only');
    setIsBulkOpen(true);
  };

  // ── bulk CSV parse ────────────────────────────────────────
  const parseBulkCSV = () => {
    if (!bulkSupplierId) {
      toast({ variant: 'destructive', title: 'Select a supplier first' });
      return;
    }
    const lines = bulkCSVText.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      toast({ variant: 'destructive', title: 'CSV must have a header row + at least one data row' });
      return;
    }
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const nameIdx = header.findIndex(h => h.includes('product') || h.includes('name'));
    const qtyIdx = header.findIndex(h => h.includes('qty') || h.includes('quantity'));
    const priceIdx = header.findIndex(h => h.includes('price'));
    const reasonIdx = header.findIndex(h => h.includes('reason'));
    const suppIdx = header.findIndex(h => h.includes('supplier'));
    if (nameIdx === -1 || qtyIdx === -1) {
      toast({ variant: 'destructive', title: 'CSV must have "product_name" and "quantity" columns' });
      return;
    }
    let conflicts = new Set<string>();

    const parsed = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      const productName = cols[nameIdx] ?? '';
      const qty = Math.max(1, parseInt(cols[qtyIdx] ?? '1') || 1);
      const price = priceIdx !== -1 ? parseFloat(cols[priceIdx] ?? '0') || 0 : 0;
      const reason = reasonIdx !== -1 ? (cols[reasonIdx] ?? '') : '';
      const csvSupplierName = suppIdx !== -1 ? (cols[suppIdx] ?? '') : '';
      
      const product = allProducts.find(p => p.name.toLowerCase() === productName.toLowerCase()) ?? null;
      let error = undefined;
      let supplier_id = undefined;
      let supplier_name = undefined;

      // Determine supplier for this row
      if (csvSupplierName) {
         const suppInDb = suppliers.find(s => s.name.toLowerCase() === csvSupplierName.toLowerCase());
         if (suppInDb) {
            supplier_id = suppInDb.id;
            supplier_name = suppInDb.name;
         } else {
            // Unknown supplier name from CSV!
            supplier_id = undefined;
            supplier_name = csvSupplierName; 
         }
      } else if (product) {
         // Fallback to product's DB supplier
         supplier_id = product.supplier_id || undefined;
         const supp = suppliers.find(s => s.id === product.supplier_id || (product.supplier && s.name.toLowerCase() === product.supplier.toLowerCase()));
         supplier_id = supp?.id || supplier_id;
         supplier_name = supp?.name ?? product.supplier ?? 'Unknown';
      }

      if (!product) {
        error = `Product "${productName}" not found`;
      }

      // Check if it's a conflict
      if (supplier_id !== bulkSupplierId || (!supplier_id && csvSupplierName)) {
        conflicts.add(supplier_name || 'Unknown');
      }
      return { 
        product, 
        productName, 
        qty, 
        price: price || (product?.purchase_price ?? 0), 
        reason, 
        error, 
        supplier_id, 
        supplier_name,
        mapped_supplier_id: supplier_id || bulkSupplierId 
      };
    });
    setBulkRows(parsed);
    setBulkParsed(true);
    setBulkHasConflicts(conflicts.size > 0);
    setConflictSuppliersList(Array.from(conflicts));
    setBulkProcessMode('selected_only');
  };

  const handleBulkSubmit = async () => {
    if (!profile?.account_id || isBulkProcessing) return;
    const validRows = bulkRows.filter(r => r.product && !r.error && (bulkProcessMode === 'all' || r.supplier_id === bulkSupplierId));
    if (validRows.length === 0) {
      toast({ variant: 'destructive', title: 'No valid rows to process' });
      return;
    }
    setIsBulkProcessing(true);
    const today = new Date().toISOString().split('T')[0];
    try {
      for (const row of validRows) {
        const p = row.product!;
        const actualSupplierId = row.mapped_supplier_id || bulkSupplierId;
        const returnAmount = row.price * row.qty;

        const { error } = await (supabase as any).rpc('create_purchase_return', {
          p_account_id: profile.account_id,
          p_supplier_id: actualSupplierId,
          p_product_id: p.id,
          p_quantity: row.qty,
          p_purchase_price: row.price,
          p_return_amount: returnAmount,
          p_reason: row.reason || null,
          p_return_date: today,
          p_batch_number: p.batch_number ?? null,
          p_original_invoice_no: null,
        });

        if (error) {
          if (error.code === '42883' || error.message?.includes('function')) {
            // Legacy fallback path
            const { error: prErr } = await (supabase as any).from('purchase_returns').insert([{
              account_id: profile.account_id, supplier_id: actualSupplierId, product_id: p.id,
              quantity: row.qty, purchase_price: row.price, return_amount: returnAmount,
              reason: row.reason || null, return_date: today, batch_number: p.batch_number ?? null,
            }]);
            if (prErr) throw prErr;
            await supabase.from('products').update({ quantity: Math.max(0, p.quantity - row.qty) } as any).eq('id', p.id);
          } else {
            throw error;
          }
        }
      }
      toast({ title: 'Bulk return processed', description: `${validRows.length} product(s) returned successfully.` });
      setIsBulkOpen(false);
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Bulk return error', description: err.message });
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const updateBulkRowQty = (index: number, newQty: number) => {
    const updated = [...bulkRows];
    const row = updated[index];
    row.qty = Math.max(1, newQty);
    
    if (row.product) {
      row.error = undefined;
    }
    setBulkRows(updated);
  };

  // ── submit ───────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.account_id || isProcessing) return;

    if (!selSupplierId || !selProductId) {
      toast({ variant: 'destructive', title: 'Please select a supplier and product' });
      return;
    }
    if (returnQty <= 0) {
      toast({ variant: 'destructive', title: 'Quantity must be at least 1' });
      return;
    }
    if (!returnReasonType) {
      toast({ variant: 'destructive', title: 'Please select a reason' });
      return;
    }
    if (returnReasonType === 'Other' && !returnReason.trim()) {
      toast({ variant: 'destructive', title: 'Please describe the reason' });
      return;
    }
    if (overStock) {
      toast({ variant: 'destructive', title: 'Quantity exceeds stock', description: `Only ${maxReturnable} unit(s) available.` });
      return;
    }

    const finalReason = returnReasonType === 'Other' ? returnReason.trim() : returnReasonType;

    setIsProcessing(true);
    try {
      const returnAmount = effectivePrice * returnQty;

      if (editingReturn) {
        // ── EDIT path (atomic via RPC) ────────────────────
        const { error } = await (supabase as any).rpc('update_purchase_return', {
          p_id: editingReturn.id,
          p_quantity: returnQty,
          p_purchase_price: effectivePrice,
          p_return_amount: returnAmount,
          p_reason: finalReason || null,
          p_return_date: returnDate,
          p_original_invoice_no: originalInvoiceNo.trim() || null,
        });
        if (error) {
          if (error.code === '42883' || error.message?.includes('does not exist')) {
            // Legacy fallback: manual update + stock delta (no atomicity)
            await (supabase as any).from('purchase_returns').update({
              quantity: returnQty, purchase_price: effectivePrice, return_amount: returnAmount,
              reason: finalReason || null, return_date: returnDate,
            }).eq('id', editingReturn.id);
            const product = allProducts.find(p => p.id === editingReturn.product_id);
            const newStock = Math.max(0, (product?.quantity ?? 0) + editingReturn.quantity - returnQty);
            await supabase.from('products').update({ quantity: newStock } as any).eq('id', editingReturn.product_id);
          } else {
            throw error;
          }
        }

        toast({
          title: 'Return updated',
          description: `${returnQty} unit(s) of "${selectedProduct?.name}" — ₹${returnAmount.toLocaleString('en-IN')} credited.`,
        });
      } else {
        // ── CREATE path (atomic via RPC) ──────────────────
        const { error } = await (supabase as any).rpc('create_purchase_return', {
          p_account_id: profile.account_id,
          p_supplier_id: selSupplierId,
          p_product_id: selProductId,
          p_quantity: returnQty,
          p_purchase_price: effectivePrice,
          p_return_amount: returnAmount,
          p_reason: finalReason || null,
          p_return_date: returnDate,
          p_batch_number: selectedProduct?.batch_number ?? null,
          p_original_invoice_no: originalInvoiceNo.trim() || null,
        });

        if (error) {
          if (error.code === '42883' || error.message?.includes('function')) {
            // Legacy fallback: direct insert + stock decrement (no atomicity, no supplier credit)
            const { error: prErr } = await (supabase as any).from('purchase_returns').insert([{
              account_id: profile.account_id, supplier_id: selSupplierId, product_id: selProductId,
              quantity: returnQty, purchase_price: effectivePrice, return_amount: returnAmount,
              reason: finalReason || null, return_date: returnDate,
              batch_number: selectedProduct?.batch_number ?? null,
            }]);
            if (prErr) {
              if (prErr.code === '42P01' || prErr.message?.includes('does not exist')) {
                throw new Error(
                  'The purchase_returns table does not exist yet.\n' +
                  'Please run: supabase/migrations/20260423000000_create_purchase_returns.sql AND ' +
                  '20260429000000_purchase_returns_audit_and_atomic.sql in your Supabase SQL Editor.'
                );
              }
              throw prErr;
            }
            const newQty = Math.max(0, (selectedProduct?.quantity ?? 0) - returnQty);
            await supabase.from('products').update({ quantity: newQty } as any).eq('id', selProductId);
          } else {
            throw error;
          }
        }

        toast({
          title: 'Return processed',
          description: `${returnQty} unit(s) of "${selectedProduct?.name}" returned. ₹${returnAmount.toLocaleString('en-IN')} credited to supplier.`,
        });
      }

      setIsOpen(false);
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error processing return', description: err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  // ── render ───────────────────────────────────────────────
  return (
    <div className="space-y-8">

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Button
            variant="ghost" size="icon"
            onClick={() => navigate('/suppliers')}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <RotateCcw className="h-5 w-5 text-orange-600" />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Purchase Returns
          </h1>
        </div>
        <p className="text-sm text-muted-foreground ml-10">
          Return products to suppliers — stock is reduced and the credit is logged.
        </p>
      </div>

      {/* Action tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Primary — New return */}
        <button
          type="button"
          onClick={openDialog}
          disabled={!tableExists}
          className="group relative text-left rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-white
                     p-4 shadow-sm hover:shadow-md hover:border-orange-300 transition-all
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2
                     disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 shrink-0 rounded-lg bg-orange-600 text-white flex items-center justify-center shadow-sm">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-900">New return</span>
                <span className="text-[10px] uppercase tracking-wide font-semibold text-orange-700 bg-orange-100 rounded px-1.5 py-0.5">
                  Primary
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Record a single product return to one supplier.
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-orange-600 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </div>
        </button>

        {/* Secondary — Bulk import */}
        <button
          type="button"
          onClick={openBulkDialog}
          disabled={!tableExists}
          className="group text-left rounded-xl border border-slate-200 bg-white p-4 shadow-sm
                     hover:shadow-md hover:border-slate-300 hover:bg-slate-50/50 transition-all
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2
                     disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 shrink-0 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
              <Upload className="h-4 w-4" strokeWidth={2.25} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-900">Bulk import</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Upload a CSV with multiple returns at once.
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-500 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </div>
        </button>

        {/* Secondary — Expired stock */}
        <button
          type="button"
          onClick={openExpiredDialog}
          disabled={!tableExists}
          className="group text-left rounded-xl border border-slate-200 bg-white p-4 shadow-sm
                     hover:shadow-md hover:border-amber-300 hover:bg-amber-50/40 transition-all
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2
                     disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 shrink-0 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <AlertCircle className="h-4 w-4" strokeWidth={2.25} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-900">Expired stock</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Auto-list and return all expired items in one step.
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-amber-600 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </div>
        </button>
      </div>

      {/* Table missing banner */}
      {!tableExists && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-800">Database table not created yet</p>
            <p className="text-sm text-amber-700 mt-0.5">
              Run the SQL file{' '}
              <code className="bg-amber-100 px-1 rounded text-xs">
                supabase/migrations/20260423000000_create_purchase_returns.sql
              </code>{' '}
              in your{' '}
              <a
                href="https://app.supabase.com/project/yuqvtucvqivvvpcfflhq/sql"
                target="_blank" rel="noreferrer"
                className="underline font-medium text-amber-900"
              >
                Supabase SQL Editor
              </a>
              .
            </p>
          </div>
        </div>
      )}

      {/* Stats — inline strip */}
      <div className="flex flex-col sm:flex-row sm:items-stretch divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border border-slate-200 rounded-lg bg-white">
        {[
          { label: 'Total returns', value: returns.length.toLocaleString('en-IN'), icon: ClipboardList },
          { label: 'Units returned', value: totalUnits.toLocaleString('en-IN'), icon: Package },
          { label: 'Total credited', value: `₹${totalReturned.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, icon: IndianRupee },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 px-5 py-3 flex-1">
            <s.icon className="h-4 w-4 text-slate-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{s.label}</div>
              <div className="text-lg font-semibold text-slate-900 tabular-nums">{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* History table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
            <div>
              <CardTitle>Return history</CardTitle>
              <CardDescription>
                {filteredReturns.length === returns.length
                  ? `${returns.length} record(s)`
                  : `${filteredReturns.length} of ${returns.length} record(s)`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 w-full lg:w-auto">
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="All suppliers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All suppliers</SelectItem>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1 w-full sm:w-auto">
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="flex-1 min-w-0 sm:w-[140px] sm:flex-none" placeholder="From" />
                <span className="text-xs text-muted-foreground">→</span>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="flex-1 min-w-0 sm:w-[140px] sm:flex-none" placeholder="To" />
              </div>
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search product, supplier, reason, invoice..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-9 w-full"
                />
              </div>
              {(supplierFilter !== 'all' || dateFrom || dateTo || searchTerm) && (
                <Button
                  variant="ghost" size="sm"
                  onClick={() => { setSupplierFilter('all'); setDateFrom(''); setDateTo(''); setSearchTerm(''); }}
                  title="Clear filters"
                >
                  <X className="h-4 w-4 mr-1" /> Clear
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={exportCurrentView} title="Export this view to CSV">
                <Download className="h-4 w-4 mr-1" /> Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <TableSkeleton rows={5} cols={['w-32', 'w-28', 'w-12', 'w-20', 'w-24', 'w-20']} />
          ) : filteredReturns.length === 0 ? (
            <div className="text-center py-12 border border-dashed rounded-lg">
              <RotateCcw className="h-5 w-5 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {returns.length === 0 ? 'No purchase returns yet.' : 'No records match your filters.'}
              </p>
              {returns.length === 0 && (
                <button
                  type="button"
                  onClick={openDialog}
                  className="text-sm text-orange-700 hover:underline mt-1"
                >
                  Make your first return
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block rounded-md border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <SortableHead label="Product" k="product" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableHead label="Supplier" k="supplier" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableHead label="Qty" k="quantity" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
                      <TableHead className="text-right">Unit price</TableHead>
                      <SortableHead label="Credited" k="return_amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                      <TableHead>Reason</TableHead>
                      <SortableHead label="Date" k="return_date" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <TableHead className="w-[120px] text-right pr-4">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedReturns.map(r => (
                      <TableRow
                        key={r.id}
                        className="group hover:bg-slate-50 cursor-pointer"
                        onClick={() => setDetailRow(r)}
                      >
                        <TableCell>
                          <div className="font-medium">{r.products?.name ?? '—'}</div>
                          {r.products?.category && (
                            <div className="text-xs text-muted-foreground">{r.products.category}</div>
                          )}
                          {r.batch_number && (
                            <div className="text-xs text-muted-foreground">Batch: {r.batch_number}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{r.suppliers?.name ?? '—'}</div>
                          {r.suppliers?.supplier_code && (
                            <Badge variant="outline" className="text-xs font-mono mt-0.5">
                              {r.suppliers.supplier_code}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center font-medium tabular-nums">{r.quantity}</TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          ₹{Number(r.purchase_price).toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-slate-900 tabular-nums">
                          ₹{Number(r.return_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                          {r.reason ?? <span className="italic opacity-40">—</span>}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {new Date(r.return_date).toLocaleDateString('en-IN')}
                        </TableCell>
                        <TableCell className="text-right pr-2" onClick={e => e.stopPropagation()}>
                          <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <Button
                              type="button" variant="ghost" size="icon"
                              className="h-7 w-7 text-slate-600 hover:text-slate-900"
                              title="Edit"
                              onClick={() => openEditDialog(r)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button" variant="ghost" size="icon"
                              className="h-7 w-7 text-slate-600 hover:text-slate-900"
                              title="Print credit note"
                              onClick={() => handlePrint(r)}
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button" variant="ghost" size="icon"
                              className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Void return"
                              onClick={() => setVoidingReturn(r)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="sm:hidden space-y-2">
                {pagedReturns.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setDetailRow(r)}
                    className="w-full text-left border rounded-lg p-3 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.products?.name ?? '—'}</div>
                        <div className="text-xs text-muted-foreground truncate">{r.suppliers?.name ?? '—'}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold tabular-nums">
                          ₹{Number(r.return_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {new Date(r.return_date).toLocaleDateString('en-IN')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs">
                      <Badge variant="outline" className="font-mono">Qty {r.quantity}</Badge>
                      {r.reason && <span className="text-muted-foreground truncate">· {r.reason}</span>}
                    </div>
                  </button>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 text-sm">
                  <div className="text-muted-foreground tabular-nums">
                    Page {safePage} of {totalPages} · {sortedReturns.length} record(s)
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="outline" size="sm"
                      disabled={safePage === 1}
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      disabled={safePage === totalPages}
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── New Return Dialog (responsive: full-screen on mobile, 2-col on desktop) ── */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent
          className="p-0 gap-0 flex flex-col overflow-hidden
                     w-screen h-[100dvh] max-w-none rounded-none
                     sm:w-[min(96vw,940px)] sm:max-w-none sm:h-auto sm:max-h-[92vh] sm:rounded-lg"
        >
          {/* ── Header ─────────────────────────────────────────── */}
          <div className="px-4 sm:px-5 py-2 sm:py-3 border-b bg-gradient-to-br from-orange-50/50 to-white shrink-0">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 rounded-lg bg-orange-600 text-white flex items-center justify-center shadow-sm">
                {editingReturn ? <Pencil className="h-4 w-4" strokeWidth={2.5} /> : <RotateCcw className="h-4 w-4" strokeWidth={2.5} />}
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-sm sm:text-lg font-semibold tracking-tight leading-tight">
                  {editingReturn ? 'Edit purchase return' : 'New purchase return'}
                </DialogTitle>
                {/* Description — hidden on mobile to save vertical space */}
                <DialogDescription className="hidden sm:block text-xs leading-tight mt-0.5 truncate">
                  {editingReturn ? 'Stock & supplier credit re-balance automatically.' : 'Stock reduces and supplier balance is credited on save.'}
                </DialogDescription>
              </div>
              {editingReturn && (
                <Badge variant="outline" className="font-mono text-[10px] shrink-0 hidden sm:inline-flex">
                  CN-{editingReturn.id.slice(0, 8).toUpperCase()}
                </Badge>
              )}
            </div>
          </div>

          {/* ── Body ───────────────────────────────────────────── */}
          <form
            id="purchase-return-form"
            onSubmit={handleSubmit}
            className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-2.5 sm:py-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-5 content-start"
          >
            {/* ─── Column A: Supplier & Product ─── */}
            <div className="space-y-2 sm:space-y-3">
              {/* Section label — hidden on mobile to save space */}
              <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold pb-1 border-b border-slate-100">
                <Truck className="h-3 w-3" />
                Supplier &amp; product
              </div>

              {/* Supplier select */}
              <div className="space-y-1">
                <Label className="text-[10px] sm:text-[11px] font-semibold text-slate-700">Supplier *</Label>
                <Select
                  value={selSupplierId}
                  onValueChange={v => { setSelSupplierId(v); setSelProductId(''); setCustomPrice(''); }}
                  disabled={!!editingReturn}
                >
                  <SelectTrigger className="h-8 sm:h-9 text-sm">
                    <SelectValue placeholder="Select supplier..." />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-muted-foreground text-center">No suppliers registered</div>
                    ) : (
                      suppliers.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                          <span className="text-xs text-muted-foreground ml-2">({s.supplier_code})</span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>

                {/* Compact supplier-context pill row */}
                {selSupplierId && (
                  loadingContext ? (
                    <Skeleton className="h-4 w-full" />
                  ) : supplierContext ? (
                    <div className="flex flex-wrap items-center gap-1 text-[10px] sm:text-[11px]">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-1.5 sm:px-2 py-0.5 font-medium ${
                          supplierContext.balance > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                        }`}
                        title="Outstanding balance"
                      >
                        <Wallet className="h-3 w-3" />
                        ₹{supplierContext.balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </span>
                      {supplierContext.recentReturns[0] && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 px-1.5 sm:px-2 py-0.5 max-w-full truncate" title="Most recent return">
                          <Clock className="h-3 w-3 shrink-0" />
                          <span className="truncate">{supplierContext.recentReturns[0].product_name}</span>
                          <span className="text-slate-500 tabular-nums shrink-0">
                            ₹{Number(supplierContext.recentReturns[0].return_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </span>
                        </span>
                      )}
                    </div>
                  ) : null
                )}
              </div>

              {/* Product picker */}
              <div className="space-y-1">
                <Label className="text-[10px] sm:text-[11px] font-semibold text-slate-700">Product *</Label>
                {editingReturn ? (
                  <div className="border rounded-md px-2.5 sm:px-3 bg-muted/40 text-sm font-medium flex items-center justify-between h-8 sm:h-9">
                    <span className="truncate">{selectedProduct?.name ?? editingReturn.products?.name ?? '—'}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">locked</span>
                  </div>
                ) : !selSupplierId ? (
                  <div className="text-[11px] text-muted-foreground border border-dashed rounded-md px-3 text-center bg-slate-50/40 h-8 sm:h-9 flex items-center justify-center">
                    Select a supplier first
                  </div>
                ) : filteredSupplierProducts.length === 0 && !productSearch ? (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 flex items-center gap-1.5 h-8 sm:h-9">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    No products linked to this supplier.
                  </div>
                ) : (
                  <div className="relative" ref={productSearchRef}>
                    <div className="relative">
                      <Search className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        className="pl-8 sm:pl-9 pr-8 h-8 sm:h-9 text-sm"
                        placeholder="Search product..."
                        value={productSearch}
                        onChange={e => { setProductSearch(e.target.value); setShowProductList(true); setSelProductId(''); }}
                        onFocus={() => setShowProductList(true)}
                      />
                      {productSearch && (
                        <button type="button" onClick={() => { setProductSearch(''); setSelProductId(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {showProductList && filteredSupplierProducts.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-lg shadow-lg max-h-56 overflow-y-auto">
                        {filteredSupplierProducts.map(p => {
                          const today = new Date().toISOString().split('T')[0];
                          const expired = p.expiry_date && p.expiry_date < today;
                          const near = !!p.expiry_date && !expired && (() => {
                            const diff = (new Date(p.expiry_date).getTime() - new Date(today).getTime()) / 86400000;
                            return diff <= 30;
                          })();
                          return (
                            <button
                              key={p.id}
                              type="button"
                              className={`w-full text-left px-3 py-2 hover:bg-orange-50 text-sm border-b last:border-b-0 ${
                                selProductId === p.id ? 'bg-orange-50' : ''
                              }`}
                              onClick={() => {
                                setSelProductId(p.id);
                                setProductSearch(p.name);
                                setCustomPrice(p.purchase_price ?? '');
                                setReturnQty(1);
                                setShowProductList(false);
                              }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className={`truncate ${selProductId === p.id ? 'font-semibold' : 'font-medium'}`}>{p.name}</span>
                                <span className="text-xs text-muted-foreground tabular-nums shrink-0">Stock: {p.quantity}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                {p.batch_number && (
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                                    Batch {p.batch_number}
                                  </span>
                                )}
                                {p.expiry_date && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                    expired ? 'bg-red-100 text-red-700' :
                                    near    ? 'bg-amber-100 text-amber-700' :
                                              'bg-slate-100 text-slate-600'
                                  }`}>
                                    {expired ? 'Expired' : near ? 'Soon' : 'Exp'} · {new Date(p.expiry_date).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {showProductList && productSearch && filteredSupplierProducts.length === 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-lg shadow-lg px-3 py-3 text-sm text-muted-foreground">
                        No products match "{productSearch}"
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Reason — kept in column A so column B can hold the summary card cleanly */}
              <div className="space-y-1">
                <Label className="text-[10px] sm:text-[11px] font-semibold text-slate-700">Reason *</Label>
                <Select value={returnReasonType} onValueChange={setReturnReasonType}>
                  <SelectTrigger className="h-8 sm:h-9 text-sm">
                    <SelectValue placeholder="Select a reason..." />
                  </SelectTrigger>
                  <SelectContent>
                    {RETURN_REASONS.map(r => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {returnReasonType === 'Other' && (
                  <Textarea
                    value={returnReason}
                    onChange={e => setReturnReason(e.target.value)}
                    placeholder="Describe the reason..."
                    rows={2}
                    className="resize-none mt-1.5 text-sm"
                  />
                )}
              </div>
            </div>

            {/* ─── Column B: Details + Summary ─── */}
            <div className="space-y-2 sm:space-y-3">
              <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold pb-1 border-b border-slate-100">
                <ClipboardList className="h-3 w-3" />
                Return details
              </div>

              <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
                <div className="space-y-1">
                  <Label className="text-[10px] sm:text-[11px] font-semibold text-slate-700 flex items-baseline gap-1">
                    Qty *
                    {selectedProduct && (
                      <span className="text-[10px] font-normal text-muted-foreground tabular-nums">/{maxReturnable}</span>
                    )}
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={returnQty}
                    onChange={e => setReturnQty(Math.max(1, parseInt(e.target.value) || 1))}
                    required
                    aria-invalid={overStock || undefined}
                    className={`font-medium tabular-nums h-8 sm:h-9 text-sm ${overStock ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                  />
                  {overStock && (
                    <p className="text-[10px] text-red-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Max {maxReturnable}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] sm:text-[11px] font-semibold text-slate-700">Unit price (₹)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={customPrice}
                    onChange={e => setCustomPrice(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    placeholder="Auto"
                    className="font-medium tabular-nums h-8 sm:h-9 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
                <div className="space-y-1">
                  <Label className="text-[10px] sm:text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                    <CalendarDays className="h-3 w-3 text-muted-foreground" /> Date
                  </Label>
                  <Input
                    type="date"
                    value={returnDate}
                    onChange={e => setReturnDate(e.target.value)}
                    className="h-8 sm:h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] sm:text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                    <FileText className="h-3 w-3 text-muted-foreground" /> Invoice #
                  </Label>
                  <Input
                    type="text"
                    value={originalInvoiceNo}
                    onChange={e => setOriginalInvoiceNo(e.target.value)}
                    placeholder="Optional"
                    className="h-8 sm:h-9 text-sm"
                  />
                </div>
              </div>

              {/* Summary card — extra-compact on mobile */}
              <div
                className={`rounded-lg border-2 transition-all mt-0.5 sm:mt-1 ${
                  selectedProduct
                    ? 'border-orange-200 bg-gradient-to-br from-orange-50/80 to-orange-50/30'
                    : 'border-dashed border-slate-200 bg-slate-50/30'
                }`}
              >
                <div className="px-2.5 sm:px-3 py-1.5 sm:py-2.5 flex items-center justify-between gap-2 sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[9px] sm:text-[10px] uppercase tracking-wider font-semibold text-orange-700/80">
                      Summary
                    </div>
                    {selectedProduct ? (
                      <p className="text-xs sm:text-sm text-slate-900 mt-0 sm:mt-0.5 leading-snug line-clamp-1 sm:line-clamp-2">
                        <span className="font-bold tabular-nums text-orange-700">{returnQty}×</span>{' '}
                        <span className="font-semibold">{selectedProduct.name}</span>
                        {(() => {
                          const supp = suppliers.find(s => s.id === selSupplierId);
                          return supp ? <> → <span className="font-semibold">{supp.name}</span></> : null;
                        })()}
                      </p>
                    ) : (
                      <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0 sm:mt-0.5">Pick supplier &amp; product…</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 border-l border-orange-200/70 pl-2 sm:pl-3">
                    <div className="text-[9px] sm:text-[10px] uppercase tracking-wider font-semibold text-orange-700/80">
                      Credit
                    </div>
                    <div className={`text-base sm:text-xl font-bold tabular-nums leading-tight ${selectedProduct ? 'text-orange-700' : 'text-slate-300'}`}>
                      ₹{estimatedRefund.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </form>

          {/* ── Footer ─────────────────────────────────────────── */}
          <div
            className="shrink-0 border-t bg-white px-3 sm:px-5 py-2 sm:py-3 flex items-center justify-end gap-2"
            style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
          >
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)} className="h-8 sm:h-9 flex-1 sm:flex-none">
              Cancel
            </Button>
            <Button
              type="submit"
              form="purchase-return-form"
              disabled={isProcessing || !selSupplierId || !selProductId || !tableExists || overStock}
              className="bg-orange-600 hover:bg-orange-700 text-white h-8 sm:h-9 flex-1 sm:flex-none sm:min-w-[140px]"
            >
              {isProcessing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  {editingReturn ? 'Saving...' : 'Processing...'}
                </>
              ) : (
                <>
                  {editingReturn ? <Pencil className="h-4 w-4 mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                  {editingReturn ? 'Save' : 'Process return'}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Bulk CSV Return Dialog ── */}
      <Dialog open={isBulkOpen} onOpenChange={setIsBulkOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-orange-500" /> Bulk Purchase Return (CSV)
            </DialogTitle>
            <DialogDescription>
              Upload a CSV or paste data below. Required columns: <code className="text-xs bg-muted px-1 rounded">product_name, quantity</code>. Optional: <code className="text-xs bg-muted px-1 rounded">purchase_price, reason</code>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Supplier */}
            <div className="space-y-2">
              <Label className="font-semibold flex items-center gap-1"><Truck className="h-4 w-4 text-muted-foreground" /> Supplier *</Label>
              <Select value={bulkSupplierId} onValueChange={v => { setBulkSupplierId(v); setBulkRows([]); setBulkParsed(false); }}>
                <SelectTrigger><SelectValue placeholder="Select supplier..." /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name} <span className="text-xs text-muted-foreground ml-1">({s.supplier_code})</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* CSV template download hint */}
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">CSV format: <code>product_name,quantity,purchase_price,reason</code></span>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={downloadCsvTemplate} className="h-7">
                <Download className="h-3.5 w-3.5 mr-1" /> Template
              </Button>
            </div>

            {/* File upload */}
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = ev => setBulkCSVText(ev.target?.result as string ?? '');
                  reader.readAsText(file);
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" /> Upload CSV
              </Button>
              {bulkCSVText && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setBulkCSVText(''); setBulkRows([]); setBulkParsed(false); }}>
                  <X className="h-4 w-4 mr-1" /> Clear
                </Button>
              )}
            </div>

            {/* Paste area */}
            <Textarea
              placeholder={`product_name,quantity,purchase_price,reason\nParacetamol 500mg,10,12.50,Damaged\nAmoxycilin,5,,Expired`}
              rows={5}
              className="font-mono text-xs resize-none"
              value={bulkCSVText}
              onChange={e => { setBulkCSVText(e.target.value); setBulkRows([]); setBulkParsed(false); }}
            />

            <Button type="button" onClick={parseBulkCSV} variant="outline" disabled={!bulkCSVText.trim() || !bulkSupplierId}>
              <Search className="h-4 w-4 mr-2" /> Parse &amp; Preview
            </Button>

            {/* Preview table */}
            {bulkParsed && bulkRows.length > 0 && (
              <div className="space-y-4">
                {/* Conflict banner */}
                {bulkHasConflicts && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-bold text-amber-800">Multiple Suppliers Found</h4>
                        <p className="text-sm text-amber-700 mt-1">
                          This file contains products linked to other suppliers ({conflictSuppliersList.join(', ')}). How would you like to proceed?
                        </p>
                        <div className="mt-4 space-y-3">
                          <label className="flex items-start gap-3 text-sm text-amber-900 cursor-pointer p-2 rounded-lg hover:bg-amber-100/50 border border-transparent hover:border-amber-200 transition-colors">
                            <input 
                              type="radio" 
                              name="bulkMode" 
                              checked={bulkProcessMode === 'all'} 
                              onChange={() => setBulkProcessMode('all')} 
                              className="accent-amber-600 mt-0.5"
                            />
                            <span>
                              <strong className="block mb-0.5">Proceed with multiple suppliers</strong>
                              <span className="text-amber-700/90 block leading-relaxed">
                                Returns will be mapped to their respective suppliers. You can manually adjust the supplier for each product below. 
                                If a supplier is missing from the database, <a href="/suppliers" target="_blank" className="underline font-semibold hover:text-amber-800 text-amber-800">create a new supplier here</a>.
                              </span>
                            </span>
                          </label>
                          <label className="flex items-start gap-3 text-sm text-amber-900 cursor-pointer p-2 rounded-lg hover:bg-amber-100/50 border border-transparent hover:border-amber-200 transition-colors">
                            <input 
                              type="radio" 
                              name="bulkMode" 
                              checked={bulkProcessMode === 'selected_only'} 
                              onChange={() => setBulkProcessMode('selected_only')} 
                              className="accent-amber-600 mt-0.5"
                            />
                            <span>
                              <strong className="block mb-0.5">Proceed with selected supplier only</strong>
                              <span className="text-amber-700/90 block leading-relaxed">
                                Extra supplier records will be completely ignored. Only the products linked to the primary supplier will be returned.
                              </span>
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-center">Qty</TableHead>
                        <TableHead className="text-right">Price (₹)</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bulkRows.map((row, i) => {
                        const isExcluded = bulkProcessMode === 'selected_only' && row.supplier_id && row.supplier_id !== bulkSupplierId;
                        const hasErr = !!row.error;
                        return (
                          <TableRow key={i} className={hasErr ? 'bg-red-50' : isExcluded ? 'bg-muted/50 opacity-60' : 'bg-green-50/30'}>
                            <TableCell className="font-medium text-sm">{row.productName}</TableCell>
                            <TableCell className="text-center p-2">
                              <Input
                                type="number"
                                min={1}
                                value={row.qty}
                                onChange={e => updateBulkRowQty(i, parseInt(e.target.value) || 1)}
                                className="w-16 h-7 text-center mx-auto text-sm border-muted-foreground/20 focus-visible:ring-1 focus-visible:ring-orange-500 px-1 shadow-none"
                              />
                            </TableCell>
                            <TableCell className="text-right">₹{row.price.toLocaleString('en-IN')}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{row.reason || '—'}</TableCell>
                            <TableCell>
                              {hasErr ? (
                                <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" />{row.error}
                                </span>
                              ) : isExcluded ? (
                                <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                                  <Info className="h-3 w-3" />Ignored
                                </span>
                              ) : bulkProcessMode === 'all' && row.supplier_id !== bulkSupplierId ? (
                                <div className="min-w-[140px]">
                                  <Select 
                                    value={row.mapped_supplier_id} 
                                    onValueChange={v => {
                                      const updated = [...bulkRows];
                                      updated[i].mapped_supplier_id = v;
                                      setBulkRows(updated);
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs bg-amber-50 border-amber-200 text-amber-900 focus:ring-amber-500">
                                      <SelectValue placeholder="Map Supplier..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                              ) : (
                                <span className="text-xs text-green-700 font-medium flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" />Ready
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <div className="px-4 py-3 bg-muted/30 text-xs text-muted-foreground flex justify-between items-center border-t">
                    <span>
                      <strong className="text-foreground">{bulkRows.filter(r => !r.error && (bulkProcessMode === 'all' || r.supplier_id === bulkSupplierId)).length}</strong> valid /{' '}
                      {bulkRows.filter(r => r.error).length} errors{' '}
                      {bulkProcessMode === 'selected_only' && bulkRows.filter(r => r.supplier_id && r.supplier_id !== bulkSupplierId).length > 0 && (
                        <span>/ {bulkRows.filter(r => r.supplier_id && r.supplier_id !== bulkSupplierId).length} skipped</span>
                      )}
                    </span>
                    <span className="font-semibold text-sm">
                      Total Credit: ₹{bulkRows.filter(r => !r.error && (bulkProcessMode === 'all' || r.supplier_id === bulkSupplierId)).reduce((s, r) => s + r.price * r.qty, 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsBulkOpen(false)}>Cancel</Button>
            <Button
              onClick={handleBulkSubmit}
              disabled={!bulkParsed || isBulkProcessing || bulkRows.filter(r => !r.error && (bulkProcessMode === 'all' || r.supplier_id === bulkSupplierId)).length === 0}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {isBulkProcessing
                ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Processing...</>
                : <><RotateCcw className="h-4 w-4 mr-2" />Process {bulkRows.filter(r => !r.error && (bulkProcessMode === 'all' || r.supplier_id === bulkSupplierId)).length} return(s)</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Expired Stock Dialog ── */}
      <Dialog open={isExpiredOpen} onOpenChange={setIsExpiredOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              Return expired stock
            </DialogTitle>
            <DialogDescription>
              Pick a supplier and select which expired products to return. Stock and supplier balance update automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-1">
            <div className="space-y-2">
              <Label className="font-semibold flex items-center gap-1">
                <Truck className="h-4 w-4 text-muted-foreground" /> Supplier *
              </Label>
              <Select
                value={expiredSupplierId}
                onValueChange={v => { setExpiredSupplierId(v); setExpiredSelectedIds(new Set()); }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier..." />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {expiredSupplierId && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {expiredCandidates.length === 0
                      ? 'No expired products found for this supplier.'
                      : `${expiredCandidates.length} expired product(s) in stock`}
                  </span>
                  {expiredCandidates.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpiredSelectedIds(
                        expiredSelectedIds.size === expiredCandidates.length
                          ? new Set()
                          : new Set(expiredCandidates.map(p => p.id))
                      )}
                      className="text-xs text-orange-700 hover:underline"
                    >
                      {expiredSelectedIds.size === expiredCandidates.length ? 'Deselect all' : 'Select all'}
                    </button>
                  )}
                </div>

                {expiredCandidates.length > 0 && (
                  <div className="rounded-md border max-h-[40vh] overflow-y-auto">
                    {expiredCandidates.map(p => {
                      const checked = expiredSelectedIds.has(p.id);
                      const amt = (p.purchase_price ?? 0) * p.quantity;
                      return (
                        <label
                          key={p.id}
                          className="flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0 hover:bg-slate-50 cursor-pointer"
                        >
                          <Checkbox checked={checked} onCheckedChange={() => toggleExpiredId(p.id)} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{p.name}</div>
                            <div className="flex flex-wrap items-center gap-2 mt-0.5">
                              {p.batch_number && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                                  Batch {p.batch_number}
                                </span>
                              )}
                              {p.expiry_date && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">
                                  Expired · {new Date(p.expiry_date).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground tabular-nums">Stock: {p.quantity}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0 tabular-nums">
                            <div className="text-sm font-semibold">₹{amt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                            <div className="text-[10px] text-muted-foreground">@ ₹{(p.purchase_price ?? 0).toLocaleString('en-IN')}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="font-semibold text-muted-foreground">Reason</Label>
                  <Select value={expiredReason} onValueChange={setExpiredReason}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RETURN_REASONS.filter(r => r !== 'Other').map(r => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {expiredSelectedIds.size > 0 && (
                  <div className="flex justify-between items-center bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-sm">
                    <span className="text-amber-900">
                      {expiredSelectedIds.size} item(s) selected
                    </span>
                    <span className="font-semibold tabular-nums text-amber-900">
                      Total credit: ₹{Array.from(expiredSelectedIds).reduce((s, id) => {
                        const p = expiredCandidates.find(x => x.id === id);
                        return s + (p ? (p.purchase_price ?? 0) * p.quantity : 0);
                      }, 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsExpiredOpen(false)}>Cancel</Button>
            <Button
              onClick={submitExpiredBatch}
              disabled={!expiredSupplierId || expiredSelectedIds.size === 0 || isExpiredProcessing}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {isExpiredProcessing ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Processing...</>
              ) : (
                <><RotateCcw className="h-4 w-4 mr-2" />Return {expiredSelectedIds.size} item(s)</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Detail Drawer (row click) ── */}
      <Sheet open={!!detailRow} onOpenChange={(o) => { if (!o) setDetailRow(null); }}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          {detailRow && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <RotateCcw className="h-5 w-5 text-orange-600" />
                  Return details
                </SheetTitle>
                <SheetDescription className="font-mono text-xs">
                  CN-{detailRow.id.slice(0, 8).toUpperCase()}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-5">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Product</div>
                  <div className="font-semibold">{detailRow.products?.name ?? '—'}</div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {detailRow.batch_number && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        Batch {detailRow.batch_number}
                      </span>
                    )}
                    {detailRow.products?.category && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {detailRow.products.category}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Supplier</div>
                  <div className="font-semibold">{detailRow.suppliers?.name ?? '—'}</div>
                  {detailRow.suppliers?.supplier_code && (
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">{detailRow.suppliers.supplier_code}</div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 border rounded-md p-3 bg-slate-50/40">
                  <div>
                    <div className="text-[11px] uppercase text-muted-foreground">Qty</div>
                    <div className="font-semibold tabular-nums">{detailRow.quantity}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-muted-foreground">Unit price</div>
                    <div className="font-semibold tabular-nums">₹{Number(detailRow.purchase_price).toLocaleString('en-IN')}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-muted-foreground">Credited</div>
                    <div className="font-semibold tabular-nums text-orange-700">
                      ₹{Number(detailRow.return_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Return date</div>
                    <div className="tabular-nums">{new Date(detailRow.return_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Original invoice #</div>
                    <div>{detailRow.original_invoice_no || <span className="text-muted-foreground">—</span>}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Reason</div>
                  <div className="text-sm">{detailRow.reason || <span className="text-muted-foreground italic">—</span>}</div>
                </div>

                {/* Activity log */}
                <div className="border-t pt-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                    <History className="h-3 w-3" /> Activity
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <Clock className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div>Created</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {new Date(detailRow.created_at).toLocaleString('en-IN')}
                          {detailRow.created_by && <span className="font-mono ml-1">· by {detailRow.created_by.slice(0, 8)}</span>}
                        </div>
                      </div>
                    </div>
                    {detailRow.updated_at && detailRow.updated_at !== detailRow.created_at && (
                      <div className="flex items-start gap-2">
                        <Pencil className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <div>Last edited</div>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {new Date(detailRow.updated_at).toLocaleString('en-IN')}
                            {detailRow.updated_by && <span className="font-mono ml-1">· by {detailRow.updated_by.slice(0, 8)}</span>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 border-t pt-4">
                  <Button variant="outline" size="sm" onClick={() => { handlePrint(detailRow); }}>
                    <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setDetailRow(null); openEditDialog(detailRow); }}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 ml-auto"
                    onClick={() => { setVoidingReturn(detailRow); }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Void
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Void Return Confirmation ── */}
      <AlertDialog open={!!voidingReturn} onOpenChange={(o) => { if (!o) setVoidingReturn(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this return?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the return record
              {voidingReturn && (
                <>
                  {' '}for <span className="font-medium text-foreground">{voidingReturn.products?.name ?? 'this product'}</span>
                  {' '}and restore <span className="font-medium text-foreground tabular-nums">{voidingReturn.quantity}</span> unit(s) back to stock.
                </>
              )}
              {' '}This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isVoiding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (voidingReturn) handleVoid(voidingReturn); }}
              disabled={isVoiding}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isVoiding ? 'Voiding...' : 'Void return'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
