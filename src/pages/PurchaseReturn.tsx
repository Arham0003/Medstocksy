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
  RotateCcw, Search, Plus, Package, Truck, AlertTriangle,
  IndianRupee, CalendarDays, ClipboardList, CheckCircle2, ArrowLeft, Info,
  Upload, X, FileText
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

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
  created_at: string;
  suppliers: { name: string; supplier_code: string } | null;
  products: { name: string; category: string | null } | null;
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

  // dialog
  const [isOpen, setIsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // form
  const [selSupplierId, setSelSupplierId] = useState('');
  const [selProductId, setSelProductId] = useState('');
  const [returnQty, setReturnQty] = useState(1);
  const [returnReason, setReturnReason] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [customPrice, setCustomPrice] = useState<number | ''>('');

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
        supabase
          .from('products')
          .select('id, name, category, quantity, purchase_price, batch_number, supplier_id, supplier')
          .eq('account_id', profile.account_id),
      ]);

      if (suppRes.error) throw suppRes.error;
      if (prodRes.error) throw prodRes.error;

      setSuppliers((suppRes.data ?? []) as Supplier[]);
      setAllProducts((prodRes.data ?? []) as SupplierProduct[]);

      // Fetch returns with graceful "table not found" handling
      const retRes = await (supabase as any)
        .from('purchase_returns')
        .select('id, supplier_id, product_id, quantity, purchase_price, return_amount, reason, return_date, batch_number, created_at, suppliers(name, supplier_code), products(name, category)')
        .eq('account_id', profile.account_id)
        .order('created_at', { ascending: false });

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

  const filteredReturns = useMemo(() => {
    let list = returns;
    if (supplierFilter !== 'all') list = list.filter(r => r.supplier_id === supplierFilter);
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(r =>
        (r.products?.name ?? '').toLowerCase().includes(q) ||
        (r.suppliers?.name ?? '').toLowerCase().includes(q) ||
        (r.reason ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [returns, supplierFilter, searchTerm]);

  const totalReturned = useMemo(() => returns.reduce((s, r) => s + r.return_amount, 0), [returns]);
  const totalUnits = useMemo(() => returns.reduce((s, r) => s + r.quantity, 0), [returns]);

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
    setSelSupplierId('');
    setSelProductId('');
    setProductSearch('');
    setShowProductList(false);
    setReturnQty(1);
    setReturnReason('');
    setReturnDate(new Date().toISOString().split('T')[0]);
    setCustomPrice('');
    setIsOpen(true);
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
        const { error: prErr } = await (supabase as any).from('purchase_returns').insert([{
          account_id: profile.account_id,
          supplier_id: actualSupplierId,
          product_id: p.id,
          quantity: row.qty,
          purchase_price: row.price,
          return_amount: returnAmount,
          reason: row.reason || null,
          return_date: today,
          batch_number: p.batch_number ?? null,
        }]);
        if (prErr) throw prErr;
        await supabase.from('products').update({ quantity: Math.max(0, p.quantity - row.qty) } as any).eq('id', p.id);
      }
      toast({ title: `✅ Bulk Return Done`, description: `${validRows.length} product(s) returned successfully.` });
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

    setIsProcessing(true);
    try {
      const returnAmount = effectivePrice * returnQty;

      // 1 ▸ Insert into purchase_returns
      const { error: prErr } = await (supabase as any)
        .from('purchase_returns')
        .insert([{
          account_id: profile.account_id,
          supplier_id: selSupplierId,
          product_id: selProductId,
          quantity: returnQty,
          purchase_price: effectivePrice,
          return_amount: returnAmount,
          reason: returnReason.trim() || null,
          return_date: returnDate,
          batch_number: selectedProduct?.batch_number ?? null,
        }]);

      if (prErr) {
        if (prErr.code === '42P01' || prErr.message?.includes('does not exist')) {
          throw new Error(
            'The purchase_returns table does not exist yet.\n' +
            'Please run the SQL file: supabase/migrations/20260423000000_create_purchase_returns.sql\n' +
            'in your Supabase Dashboard → SQL Editor.'
          );
        }
        throw prErr;
      }

      // 2 ▸ Reduce stock (items sent back to supplier)
      const newQty = Math.max(0, (selectedProduct?.quantity ?? 0) - returnQty);
      const { error: stockErr } = await supabase
        .from('products')
        .update({ quantity: newQty } as any)
        .eq('id', selProductId);
      if (stockErr) throw stockErr;

      toast({
        title: '✅ Return processed!',
        description: `${returnQty} unit(s) of "${selectedProduct?.name}" returned. ₹${returnAmount.toLocaleString('en-IN')} credited.`,
      });
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Button
              variant="ghost" size="icon"
              onClick={() => navigate('/suppliers')}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
              Purchase Returns
            </h1>
          </div>
          <p className="text-muted-foreground ml-11">
            Return products to suppliers — stock auto-reduces &amp; supplier balance is credited
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={openBulkDialog}
            variant="outline"
            className="border-orange-300 text-orange-700 hover:bg-orange-50"
          >
            <Upload className="h-4 w-4 mr-2" />
            Bulk Return (CSV)
          </Button>
          <Button
            onClick={openDialog}
            className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white shadow-lg"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Return
          </Button>
        </div>
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

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: 'Total Returns', value: returns.length, icon: ClipboardList, color: 'text-orange-600 bg-orange-100' },
          { label: 'Units Returned', value: totalUnits, icon: Package, color: 'text-violet-600 bg-violet-100' },
          {
            label: 'Total Credited',
            value: `₹${totalReturned.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
            icon: IndianRupee,
            color: 'text-emerald-600 bg-emerald-100',
          },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold mt-1">{s.value}</p>
                </div>
                <div className={`p-3 rounded-lg ${s.color}`}>
                  <s.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* History table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <CardTitle>Return History</CardTitle>
              <CardDescription>{filteredReturns.length} record(s)</CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="All Suppliers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Suppliers</SelectItem>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search returns..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-9 w-full sm:w-60"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto" />
              <p className="mt-3 text-muted-foreground">Loading...</p>
            </div>
          ) : filteredReturns.length === 0 ? (
            <div className="text-center py-14 border border-dashed rounded-xl">
              <div className="bg-orange-50 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <RotateCcw className="h-8 w-8 text-orange-400" />
              </div>
              <h3 className="text-lg font-bold mb-1">No Purchase Returns Yet</h3>
              <p className="text-muted-foreground mb-4 text-sm">
                {returns.length === 0
                  ? 'Start by returning a product to a supplier.'
                  : 'No records match your search.'}
              </p>
              {returns.length === 0 && (
                <Button onClick={openDialog} variant="outline">
                  <Plus className="h-4 w-4 mr-2" />Make First Return
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Credited</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReturns.map(r => (
                    <TableRow key={r.id} className="hover:bg-orange-50/30">
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
                      <TableCell className="text-center font-medium">{r.quantity}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        ₹{Number(r.purchase_price).toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-orange-600">
                        ₹{Number(r.return_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                        {r.reason ?? <span className="italic opacity-40">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(r.return_date).toLocaleDateString('en-IN')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── New Return Dialog ── */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-orange-500" />
              New Purchase Return
            </DialogTitle>
            <DialogDescription>
              Select supplier → product → enter quantity. Stock reduces and supplier balance is credited.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 mt-1">

            {/* Supplier */}
            <div className="space-y-2">
              <Label className="font-semibold flex items-center gap-1">
                <Truck className="h-4 w-4 text-muted-foreground" /> Supplier *
              </Label>
              <Select
                value={selSupplierId}
                onValueChange={v => { setSelSupplierId(v); setSelProductId(''); setCustomPrice(''); }}
              >
                <SelectTrigger>
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
            </div>

            {/* Product — real-time search combobox */}
            <div className="space-y-2">
              <Label className="font-semibold flex items-center gap-1">
                <Package className="h-4 w-4 text-muted-foreground" /> Product *
              </Label>
              {!selSupplierId ? (
                <div className="text-sm text-muted-foreground border border-dashed rounded-lg p-3 text-center">
                  Select a supplier first
                </div>
              ) : filteredSupplierProducts.length === 0 && !productSearch ? (
                <div className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  No products linked to this supplier.
                </div>
              ) : (
                <div className="relative" ref={productSearchRef}>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-9 pr-8"
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
                    <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {filteredSupplierProducts.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          className={`w-full text-left px-3 py-2.5 hover:bg-orange-50 flex justify-between items-center text-sm ${
                            selProductId === p.id ? 'bg-orange-50 font-semibold' : ''
                          }`}
                          onClick={() => {
                            setSelProductId(p.id);
                            setProductSearch(p.name);
                            setCustomPrice(p.purchase_price ?? '');
                            setReturnQty(1);
                            setShowProductList(false);
                          }}
                        >
                          <span>{p.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">Stock: {p.quantity}</span>
                        </button>
                      ))}
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

            {/* Qty + Price */}
            <div className="grid grid-cols-2 gap-4 border-t pt-4 mt-2">
              <div className="space-y-2">
                <Label className="font-semibold text-muted-foreground">Return Qty *</Label>
                <Input
                  type="number"
                  min={1}
                  value={returnQty}
                  onChange={e => setReturnQty(Math.max(1, parseInt(e.target.value) || 1))}
                  required
                  className="font-medium"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-semibold text-muted-foreground">Purchase Price (₹)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={customPrice}
                  onChange={e => setCustomPrice(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="Auto"
                  className="font-medium"
                />
              </div>
            </div>

            {/* Date */}
            <div className="space-y-2">
              <Label className="font-semibold flex items-center gap-1 text-muted-foreground">
                <CalendarDays className="h-4 w-4" /> Return Date
              </Label>
              <Input
                type="date"
                value={returnDate}
                onChange={e => setReturnDate(e.target.value)}
              />
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label className="font-semibold text-muted-foreground">Reason (Optional)</Label>
              <Textarea
                value={returnReason}
                onChange={e => setReturnReason(e.target.value)}
                placeholder="e.g. Damaged goods, expiry issue, wrong product..."
                rows={2}
                className="resize-none"
              />
            </div>

            {/* Total Credit Preview */}
            {selectedProduct && (
              <div className="flex justify-between items-center py-3 border-t">
                <span className="font-semibold text-muted-foreground">Total Credit</span>
                <span className="text-xl font-bold text-orange-600">
                  ₹{estimatedRefund.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isProcessing || !selSupplierId || !selProductId || !tableExists}
                className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700"
              >
                {isProcessing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Process Return
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
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
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
              <FileText className="h-4 w-4 shrink-0" />
              <span>CSV format: <code>product_name,quantity,purchase_price,reason</code></span>
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
              className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 shadow-sm"
            >
              {isBulkProcessing
                ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Processing...</>
                : <><RotateCcw className="h-4 w-4 mr-2" />Process {bulkRows.filter(r => !r.error && (bulkProcessMode === 'all' || r.supplier_id === bulkSupplierId)).length} Return(s)</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
