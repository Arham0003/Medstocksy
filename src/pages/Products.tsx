import { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn, formatINR, formatExpiry, calcEffectivePurchasePrice } from "@/lib/utils";
import MultiProductForm from '@/components/MultiProductForm';
import { TableSkeleton } from '@/components/TableSkeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Search,
  Edit,
  Copy,
  Trash2,
  Package,
  AlertTriangle,
  Filter,
  X,
  MoreVertical,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Wallet,
  Clock,
  Loader2,
} from 'lucide-react';
import { loadMultiDraft } from '@/lib/productDraft';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { useHsnCodes } from '@/hooks/useHsnCodes';
import { HsnPicker } from '@/components/HsnPicker';
import { computeEffectiveCost } from '@/lib/gst';
import { db } from '@/lib/supabaseLoose';
import { ToastAction } from '@/components/ui/toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Product {
  id: string;
  name: string;
  sku?: string | null;
  hsn_code?: string | null;
  category: string | null;
  batch_number?: string | null;
  manufacturer?: string | null;
  expiry_date?: string | null;
  quantity: number;
  purchase_price: number | null;
  selling_price: number;
  gst: number | null;
  supplier: string | null;
  supplier_id?: string | null;
  low_stock_threshold: number | null;
  pcs_per_unit?: number | null;
  account_id?: string;
  created_at: string;
  updated_at?: string | null;
}

interface SupplierOption {
  id: string;
  name: string;
  supplier_code: string;
  phone: string | null;
  contact_person: string | null;
}

// Preset product categories for pharmacy/medical store
const PRESET_CATEGORIES = [
  "Tablets",
  "Capsules",
  "Syrups",
  "Ointments",
  "Injections",
  "Drops",
  "Medical Devices",
  "Supplements",
  "Ayurveda/Homeopathy",
  "Personal Care",
  "Baby Care",
  "Surgical",
  "Others"
];



export default function Products() {
  const navigate = useNavigate();
  const { isOwner, profile } = useAuth();
  const { codes: hsnCodes, available: hsnAvailable, rateFor: hsnRateFor } = useHsnCodes(profile?.account_id);
  const { toast } = useToast();
  // Account-wide default GST rate & type from Settings → drives the GST defaults on new-product forms
  const [defaultGstRate, setDefaultGstRate] = useState<number>(18);

  // HSN master drives the GST rate; the manual rate below stays as a fallback
  // for products whose HSN is not in the master yet.
  const [hsnState, setHsnState] = useState<string>('');
  const [gstState, setGstState] = useState<string>('');
  // Purchase terms, needed to land the true per-unit cost into the batch.
  const [qtyState, setQtyState] = useState<string>('');
  const [freeQtyState, setFreeQtyState] = useState<string>('');
  const [discPctState, setDiscPctState] = useState<string>('');
  const [purchasePriceState, setPurchasePriceState] = useState<string>('');
  const [gstInclusive, setGstInclusive] = useState<boolean>(false);

  // URL state - initial values come from search params, changes get written back so views are shareable/bookmarkable
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSort = (() => {
    const raw = searchParams.get('sort');
    if (!raw) return { key: null as 'name' | 'quantity' | 'expiry_date' | 'selling_price' | null, dir: 'asc' as 'asc' | 'desc' };
    const [k, d] = raw.split(':');
    const allowedKeys = ['name', 'quantity', 'expiry_date', 'selling_price'] as const;
    const key = (allowedKeys as readonly string[]).includes(k) ? (k as typeof allowedKeys[number]) : null;
    const dir: 'asc' | 'desc' = d === 'desc' ? 'desc' : 'asc';
    return { key, dir };
  })();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') ?? '');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  // When duplicating: pre-fills the dialog (everything except batch + expiry) but saves as an INSERT
  const [duplicateSource, setDuplicateSource] = useState<Product | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  // State for category selection
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  // Filters
  const [expiryFilter, setExpiryFilter] = useState<string>(() => searchParams.get('expiry') ?? 'all');
  const [stockFilter, setStockFilter] = useState<string>(() => searchParams.get('stock') ?? 'all');
  const [categoryFilter, setCategoryFilter] = useState<string>(() => searchParams.get('category') ?? 'all');
  const [supplierFilter, setSupplierFilter] = useState<string>(() => searchParams.get('supplier') ?? 'all');
  // Sorting
  const [sortKey, setSortKey] = useState<'name' | 'quantity' | 'expiry_date' | 'selling_price' | null>(initialSort.key);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(initialSort.dir);
  // Pagination
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  // New multi-product add dialog
  const [isMultiAddOpen, setIsMultiAddOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Supplier search state
  const [allSuppliers, setAllSuppliers] = useState<SupplierOption[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const supplierRef = useRef<HTMLDivElement>(null);

  const filteredSupplierOptions = useMemo(() => {
    if (!supplierSearch.trim()) return allSuppliers.slice(0, 8);
    const q = supplierSearch.toLowerCase();
    return allSuppliers.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.phone || '').includes(q) ||
      (s.contact_person || '').toLowerCase().includes(q) ||
      s.supplier_code.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [allSuppliers, supplierSearch]);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProducts(data || []);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error fetching products",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchSuppliers = useCallback(async () => {
    if (!profile?.account_id) return;
    try {
      const { data } = await supabase
        .from('suppliers')
        .select('id, name, supplier_code, phone, contact_person')
        .eq('account_id', profile.account_id)
        .order('name');
      setAllSuppliers((data || []) as unknown as SupplierOption[]);
    } catch (_) { }
  }, [profile?.account_id]);

  useEffect(() => {
    if (profile?.account_id) fetchProducts();
  }, [profile?.account_id]);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  // Pull the account-wide default GST rate & mode from Settings (Tax & Currency tab)
  useEffect(() => {
    if (!profile?.account_id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('settings')
        .select('default_gst_rate, gst_type')
        .eq('account_id', profile.account_id)
        .single();
      const raw: any = data;
      if (!cancelled) {
        if (typeof raw?.default_gst_rate === 'number') {
          setDefaultGstRate(raw.default_gst_rate);
        }
        setGstInclusive(raw?.gst_type === 'inclusive');
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.account_id]);

  // Close supplier dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (supplierRef.current && !supplierRef.current.contains(e.target as Node)) {
        setSupplierDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // F2 Shortcut for Purchase Entry
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setIsMultiAddOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);



  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    if (!profile?.account_id || isSaving) return;

    setIsSaving(true);

    const pcsPerUnitRaw = formData.get('pcs_per_unit') as string;
    const pcsPerUnitVal = pcsPerUnitRaw ? parseInt(pcsPerUnitRaw) : null;

    const expDateRaw = formData.get('expiry_date') as string;

    const expiryIso = expDateRaw && expDateRaw.length === 7 ? `${expDateRaw}-01` : (expDateRaw || null);
    const enteredQty = parseInt(formData.get('quantity') as string);
    const batchNumber = (formData.get('batch_number') as string) || '';
    const invoiceRate = parseFloat(formData.get('purchase_price') as string) || 0;
    const freeQty = parseFloat(formData.get('free_qty') as string) || 0;
    const discPct = parseFloat(formData.get('disc_pct') as string) || 0;
    const gstRate = parseFloat(formData.get('gst') as string);

    // The units arriving now: on a new product that is the whole quantity, on
    // an edit only the increase. A batch can only be created when we know
    // which batch and when it expires.
    const priorQty = editingProduct?.quantity ?? 0;
    const inwardQty = editingProduct ? enteredQty - priorQty : enteredQty;
    const canCreateBatch = Boolean(expiryIso) && inwardQty > 0;

    const baseProductData = {
      name: formData.get('name') as string,
      hsn_code: hsnState || null,
      category: formData.get('category') as string,
      batch_number: batchNumber,
      manufacturer: formData.get('manufacturer') as string,
      expiry_date: expDateRaw && expDateRaw.length === 7 ? `${expDateRaw}-01` : (expDateRaw || null),
      purchase_price: invoiceRate,
      selling_price: parseFloat(formData.get('mrp') as string) || 0,
      gst: gstRate,
      supplier: supplierSearch || (formData.get('supplier') as string) || null,
      supplier_id: selectedSupplierId || null,
      low_stock_threshold: parseInt(formData.get('low_stock_threshold') as string),
      pcs_per_unit: (pcsPerUnitVal && pcsPerUnitVal > 0) ? pcsPerUnitVal : null,
      account_id: profile?.account_id,
    };

    try {
      let error;
      let productId = editingProduct?.id;

      if (editingProduct) {
        ({ error } = await supabase
          .from('products')
          .update(baseProductData)
          .eq('id', editingProduct.id));
      } else {
        const newProductData = { ...baseProductData, quantity: 0 };
        const inserted = await supabase
          .from('products')
          .insert([newProductData])
          .select('id')
          .single();
        error = inserted.error;
        productId = inserted.data?.id;
      }

      if (error) throw error;

      // Batch ledger. products.quantity has already been written above, so
      // the RPC is told not to touch it (p_sync_product_qty: false) - it only
      // records the batch, its expiry and its landed cost.
      let batchWarning: string | null = null;
      if (productId && canCreateBatch) {
        const { error: batchError } = await db.rpc('add_stock_batch', {
          p_product_id: productId,
          p_batch_number: batchNumber || 'NA',
          p_expiry_date: expiryIso,
          p_qty: inwardQty,
          p_free_qty: freeQty,
          p_invoice_rate: invoiceRate,
          p_disc_pct: discPct,
          p_mrp: baseProductData.selling_price,
          p_hsn_code: hsnState || null,
          p_gst_rate: Number.isFinite(gstRate) ? gstRate : null,
          p_manufacturer: baseProductData.manufacturer || null,
          p_supplier_id: selectedSupplierId || null,
          p_source: 'purchase',
          p_sync_product_qty: false,
        });
        if (batchError) batchWarning = batchError.message;
      } else if (productId && editingProduct && inwardQty < 0) {
        // Stock reduced by hand - take it off the batches too, nearest expiry
        // first, so the ledger does not drift above products.quantity.
        const { error: adjError } = await db.rpc('adjust_batch_stock', {
          p_account_id: profile?.account_id,
          p_product_id: productId,
          p_batch_number: batchNumber || null,
          p_delta: inwardQty,
        });
        if (adjError) batchWarning = adjError.message;
      }

      // Before the compliance migrations the RPC simply does not exist. That
      // is not a fault worth alarming the user about - the product saved and
      // stock is correct, batch tracking just is not installed yet.
      const batchRpcMissing =
        !!batchWarning &&
        (batchWarning.includes('does not exist') ||
          batchWarning.includes('Could not find the function') ||
          batchWarning.includes('schema cache'));

      if (batchWarning && !batchRpcMissing) {
        toast({
          variant: 'destructive',
          title: 'Saved, but the batch was not recorded',
          description: `${batchWarning}. Stock count is correct; FEFO and expiry tracking will miss this consignment.`,
        });
      } else {
        toast({
          title: editingProduct ? "Product updated" : "Product added",
          // Only claim a batch when one was actually written.
          description: canCreateBatch && !batchWarning
            ? `Batch ${batchNumber || 'NA'} recorded at ${formatINR(previewEffectiveCost)}/unit effective cost.`
            : (editingProduct ? "Product has been updated successfully." : "Product has been added successfully."),
        });
      }

      setIsDialogOpen(false);
      setEditingProduct(null);
      setSelectedCategory("");
      setSupplierSearch('');
      setSelectedSupplierId(null);
      fetchProducts();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error saving product",
        description: error.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const deletedProduct = products.find(p => p.id === id);
    if (!deletedProduct) return;


    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) {
        // 23503 is Postgres foreign_key_violation (e.g., referenced in sale_items)
        if (error.code === '23503') {
          toast({
            variant: "destructive",
            title: "Cannot delete product",
            description: "This product is referenced in historical sales and cannot be deleted."
          });
          return;
        }
        throw error;
      }

      setProducts(prev => prev.filter(p => p.id !== id));

      toast({
        title: "Product deleted",
        description: deletedProduct?.name ? `"${deletedProduct.name}" removed from inventory.` : "Product removed.",
        action: deletedProduct ? (
          <ToastAction
            altText="Undo delete"
            onClick={async () => {
              const { id: _omit, created_at: _omit2, updated_at: _omit3, ...payload } = deletedProduct;
              const { error: undoErr } = await supabase.from('products').insert([{
                ...payload,
                account_id: profile?.account_id,
              }]);
              if (undoErr) {
                toast({
                  variant: 'destructive',
                  title: 'Could not undo',
                  description: undoErr.message,
                });
                return;
              }
              toast({ title: 'Restored', description: `"${deletedProduct.name}" is back in your inventory.` });
              fetchProducts();
            }}
          >
            Undo
          </ToastAction>
        ) : undefined,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error deleting product",
        description: error.message,
      });
    } finally {
      setDeleteDialogOpen(false);
      setProductToDelete(null);
    }
  };

  const confirmDelete = (product: Product) => {
    setProductToDelete(product);
    setDeleteDialogOpen(true);
  };

  // Distinct category / supplier options for filter selects
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => { if (p.category) set.add(p.category); });
    return Array.from(set).sort();
  }, [products]);

  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => { if (p.supplier) set.add(p.supplier); });
    return Array.from(set).sort();
  }, [products]);

  // Summary metrics computed from loaded products
  const summary = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const in30Days = new Date(now);
    in30Days.setDate(in30Days.getDate() + 30);
    let stockValue = 0;
    let lowStock = 0;
    let expired = 0;
    let expiringSoon = 0;
    for (const p of products) {
      stockValue += (p.quantity || 0) * (p.purchase_price || 0);
      if (p.quantity <= (p.low_stock_threshold || 10)) lowStock += 1;
      if (p.expiry_date) {
        const exp = new Date(p.expiry_date);
        if (exp < now) expired += 1;
        else if (exp <= in30Days) expiringSoon += 1;
      }
    }
    return { total: products.length, stockValue, lowStock, expired, expiringSoon };
  }, [products]);

  // Memoize filtered products to prevent unnecessary recalculations
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const filteredProducts = useMemo(() => {
    const q = deferredSearchTerm.trim().toLowerCase();
    const filtered = products.filter(product => {
      // Search filter
      if (q) {
        const searchMatch =
          product.name.toLowerCase().includes(q) ||
          product.hsn_code?.toLowerCase().includes(q) ||
          product.category?.toLowerCase().includes(q) ||
          product.manufacturer?.toLowerCase().includes(q) ||
          product.batch_number?.toLowerCase().includes(q) ||
          product.supplier?.toLowerCase().includes(q);
        if (!searchMatch) return false;
      }

      // Stock filter
      if (stockFilter !== 'all') {
        const threshold = product.low_stock_threshold || 10;
        const isLowStock = product.quantity <= threshold && product.quantity > 0;
        const isOutOfStock = product.quantity === 0;
        const isInStock = product.quantity > threshold;

        if (stockFilter === 'in_stock' && !isInStock) return false;
        if (stockFilter === 'low_stock' && !isLowStock) return false;
        if (stockFilter === 'out_of_stock' && !isOutOfStock) return false;
      }

      // Expiry filter
      if (expiryFilter !== 'all') {
        if (!product.expiry_date) return false;

        const expiryDate = new Date(product.expiry_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(today.getDate() + 30);
        thirtyDaysFromNow.setHours(23, 59, 59, 999);

        if (expiryFilter === 'expired' && expiryDate >= today) return false;
        if (expiryFilter === 'soon' && (expiryDate < today || expiryDate > thirtyDaysFromNow)) return false;
      }

      // Category filter
      if (categoryFilter !== 'all' && product.category !== categoryFilter) return false;

      // Supplier filter
      if (supplierFilter !== 'all' && product.supplier !== supplierFilter) return false;

      return true;
    });

    if (!sortKey) return filtered;

    const dir = sortDirection === 'asc' ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls always sort last regardless of direction
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (sortKey === 'expiry_date') {
        return (new Date(av as string).getTime() - new Date(bv as string).getTime()) * dir;
      }
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return sorted;
  }, [products, deferredSearchTerm, stockFilter, expiryFilter, categoryFilter, supplierFilter, sortKey, sortDirection]);

  // Reset to first page whenever the filtered set or its size changes
  useEffect(() => {
    setPage(1);
  }, [deferredSearchTerm, stockFilter, expiryFilter, categoryFilter, supplierFilter, sortKey, sortDirection]);

  // Sync state -> URL so views are shareable/bookmarkable
  useEffect(() => {
    const next = new URLSearchParams();
    if (searchTerm) next.set('q', searchTerm);
    if (stockFilter !== 'all') next.set('stock', stockFilter);
    if (expiryFilter !== 'all') next.set('expiry', expiryFilter);
    if (categoryFilter !== 'all') next.set('category', categoryFilter);
    if (supplierFilter !== 'all') next.set('supplier', supplierFilter);
    if (sortKey) next.set('sort', `${sortKey}:${sortDirection}`);
    if (page > 1) next.set('page', String(page));
    setSearchParams(next, { replace: true });
  }, [searchTerm, stockFilter, expiryFilter, categoryFilter, supplierFilter, sortKey, sortDirection, page, setSearchParams]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedProducts = useMemo(
    () => filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredProducts, currentPage]
  );

  const activeFilterCount =
    (stockFilter !== 'all' ? 1 : 0) +
    (expiryFilter !== 'all' ? 1 : 0) +
    (categoryFilter !== 'all' ? 1 : 0) +
    (supplierFilter !== 'all' ? 1 : 0);

  const clearAllFilters = () => {
    setStockFilter('all');
    setExpiryFilter('all');
    setCategoryFilter('all');
    setSupplierFilter('all');
  };

  // Form pre-fill source: edit fills from editingProduct, duplicate fills from duplicateSource (except batch/expiry)
  const formSource = editingProduct ?? duplicateSource;

  const toggleSort = (key: NonNullable<typeof sortKey>) => {
    if (sortKey === key) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ column }: { column: NonNullable<typeof sortKey> }) => {
    if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />;
    return sortDirection === 'asc'
      ? <ChevronUp className="h-3.5 w-3.5 text-blue-600" />
      : <ChevronDown className="h-3.5 w-3.5 text-blue-600" />;
  };

  // Restore manual "Add Products" draft if present
  useEffect(() => {
    if (loadMultiDraft<unknown[]>()) {
      setIsMultiAddOpen(true);
    }
  }, []);

  // Reset selected category and supplier when dialog opens/closes
  useEffect(() => {
    if (isDialogOpen && editingProduct) {
      setSelectedCategory(editingProduct.category || "");
      setSupplierSearch(editingProduct.supplier || '');
      setSelectedSupplierId(editingProduct.supplier_id || null);
    } else if (!isDialogOpen) {
      setSelectedCategory("");
      setSupplierSearch('');
      setSelectedSupplierId(null);
    }
  }, [isDialogOpen, editingProduct]);

  // Seed the controlled HSN / purchase-terms fields whenever the dialog opens.
  // Free qty and discount are per-consignment, so they always start blank
  // rather than carrying over from the product record.
  useEffect(() => {
    if (!isDialogOpen) return;
    setHsnState(formSource?.hsn_code ?? '');
    setGstState(formSource?.gst != null ? String(formSource.gst) : String(defaultGstRate));
    setQtyState(formSource?.quantity != null ? String(formSource.quantity) : '');
    setPurchasePriceState(formSource?.purchase_price != null ? String(formSource.purchase_price) : '');
    setFreeQtyState('');
    setDiscPctState('');
  }, [isDialogOpen, formSource, defaultGstRate]);

  // Landed cost preview - the figure that will be stored on the batch and
  // used as COGS. Mirrors computeEffectiveCost() in add_stock_batch().
  const previewEffectiveCost = computeEffectiveCost(
    parseFloat(qtyState) || 0,
    parseFloat(purchasePriceState) || 0,
    parseFloat(discPctState) || 0,
    parseFloat(freeQtyState) || 0,
  );

  if (!isOwner) {
    return (
      <div className="text-center py-12">
        <div className="bg-red-100 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="h-8 w-8 text-red-600" />
        </div>
        <h2 className="text-2xl font-bold text-red-600 mb-2">Access Denied</h2>
        <p className="text-muted-foreground text-lg">You don't have permission to access this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {searchParams.get('from') === 'record-sale' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-sm text-blue-800">
            Add the new product here, then head back - your sale in progress was saved and will be restored.
          </p>
          <Button
            size="sm"
            onClick={() => navigate('/sales')}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
          >
            ← Back to sale
          </Button>
        </div>
      )}
      {/* Header: title + primary action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Product Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your inventory products and stock levels
          </p>
        </div>
        <Button onClick={() => setIsMultiAddOpen(true)} className="w-full sm:w-auto gap-2">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            <span>Purchase Entry</span>
          </div>
          <span className="text-[10px] bg-primary-foreground/20 px-1.5 py-0.5 rounded border border-primary-foreground/30 opacity-80 hidden sm:inline-block">F2</span>
        </Button>
      </div>

        <MultiProductForm
          open={isMultiAddOpen}
          onOpenChange={setIsMultiAddOpen}
          allSuppliers={allSuppliers}
          allProducts={products}
          accountId={profile?.account_id}
          onSaved={fetchProducts}
          defaultGstRate={defaultGstRate}
          gstInclusive={gstInclusive}
        />

        {/* Summary strip */}
        <section>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <Card className="border-slate-200">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-blue-50">
                  <Package className="h-5 w-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Total Products</p>
                  <p className="text-xl font-bold text-slate-900">{loading ? '-' : summary.total}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-200">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-emerald-50">
                  <Wallet className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Stock Value</p>
                  <p className="text-xl font-bold text-slate-900 truncate">
                    {loading ? '-' : formatINR(summary.stockValue)}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-200">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-amber-50">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Low Stock</p>
                  <p className="text-xl font-bold text-slate-900">{loading ? '-' : summary.lowStock}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-200">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-rose-50">
                  <Clock className="h-5 w-5 text-rose-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Expired</p>
                  <p className="text-xl font-bold text-slate-900">{loading ? '-' : summary.expired}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>


        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setSelectedCategory("");
            setEditingProduct(null);
            setDuplicateSource(null);
          }
        }}>
          <DialogContent className="sm:max-w-lg md:max-w-xl max-h-[90vh] overflow-y-auto w-[95vw]">
            <DialogHeader>
              <DialogTitle className="text-2xl">
                {editingProduct ? 'Edit Product' : duplicateSource ? 'Duplicate Product' : 'Add New Product'}
              </DialogTitle>
              <DialogDescription className="text-lg">
                {editingProduct
                  ? 'Update product information'
                  : duplicateSource
                  ? 'Pre-filled from "' + duplicateSource.name + '". Set a new batch and expiry.'
                  : 'Enter product details to add to your inventory'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-lg font-medium">Product Name</Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    defaultValue={formSource?.name}
                    className="text-lg py-3 px-4"
                    placeholder="Enter product name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hsn_code" className="text-lg font-medium">HSN Code</Label>
                  <HsnPicker
                    codes={hsnCodes}
                    value={hsnState}
                    onChange={setHsnState}
                    // Picking a listed HSN sets the GST rate from the master.
                    onRateResolved={(rate) => setGstState(String(rate))}
                    className="text-lg py-3 px-4"
                    placeholder={hsnAvailable ? 'Search HSN or description' : 'Enter HSN Code'}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="category" className="text-lg font-medium">Category</Label>
                  <Select
                    name="category"
                    value={selectedCategory || editingProduct?.category || ""}
                    onValueChange={(value) => setSelectedCategory(value)}
                  >
                    <SelectTrigger className="text-lg py-3 px-4">
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRESET_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Hidden input to capture the selected value for form submission */}
                  <input
                    type="hidden"
                    name="category"
                    value={selectedCategory || editingProduct?.category || ""}
                  />
                </div>
                <div className="space-y-2" ref={supplierRef}>
                  <Label htmlFor="supplier_search" className="text-lg font-medium">Supplier</Label>
                  <div className="relative">
                    <Input
                      id="supplier_search"
                      value={supplierSearch}
                      onChange={e => {
                        setSupplierSearch(e.target.value);
                        setSelectedSupplierId(null);
                        setSupplierDropdownOpen(true);
                      }}
                      onFocus={() => setSupplierDropdownOpen(true)}
                      className="text-lg py-3 px-4"
                      placeholder="Search by name or phone..."
                      autoComplete="off"
                    />
                    {selectedSupplierId && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono bg-violet-100 text-violet-700 px-2 py-0.5 rounded">
                        {allSuppliers.find(s => s.id === selectedSupplierId)?.supplier_code}
                      </span>
                    )}
                    {supplierDropdownOpen && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                        {filteredSupplierOptions.map(s => (
                          <button
                            key={s.id}
                            type="button"
                            className="w-full text-left px-4 py-3 hover:bg-violet-50 flex items-center justify-between border-b border-gray-50 last:border-0"
                            onMouseDown={e => {
                              e.preventDefault();
                              setSupplierSearch(s.name);
                              setSelectedSupplierId(s.id);
                              setSupplierDropdownOpen(false);
                            }}
                          >
                            <div>
                              <span className="font-medium text-base">{s.name}</span>
                              {s.contact_person && <span className="text-sm text-muted-foreground ml-2">· {s.contact_person}</span>}
                            </div>
                            <div className="text-right">
                              <span className="text-xs font-mono bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">{s.supplier_code}</span>
                              {s.phone && <div className="text-xs text-muted-foreground mt-0.5">{s.phone}</div>}
                            </div>
                          </button>
                        ))}
                        <div className="border-t border-gray-100 p-2 bg-gray-50 sticky bottom-0">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="w-full justify-start text-blue-600 hover:text-blue-700 hover:bg-blue-100 font-medium"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              navigate('/suppliers');
                            }}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add New Supplier
                          </Button>
                        </div>
                        {allSuppliers.length === 0 && filteredSupplierOptions.length === 0 && (
                          <div className="px-4 py-3 text-muted-foreground text-sm">No suppliers registered yet. <span className="text-violet-600 font-medium">Register one in Suppliers section.</span></div>
                        )}
                        {allSuppliers.length > 0 && filteredSupplierOptions.length === 0 && (
                          <div className="px-4 py-3 text-muted-foreground text-sm">No matches found for "{supplierSearch}"</div>
                        )}
                      </div>
                    )}
                  </div>
                  <input type="hidden" name="supplier" value={supplierSearch} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="batch_number" className="text-lg font-medium">Batch Number</Label>
                  <Input
                    id="batch_number"
                    name="batch_number"
                    defaultValue={editingProduct?.batch_number}
                    className="text-lg py-3 px-4"
                    placeholder="Enter batch number"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manufacturer" className="text-lg font-medium">Manufacturer</Label>
                  <Input
                    id="manufacturer"
                    name="manufacturer"
                    defaultValue={formSource?.manufacturer}
                    className="text-lg py-3 px-4"
                    placeholder="Enter manufacturer"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expiry_date" className="text-lg font-medium">Expiry</Label>
                  <Input
                    id="expiry_date"
                    name="expiry_date"
                    type="month"
                    defaultValue={editingProduct?.expiry_date ? editingProduct.expiry_date.substring(0, 7) : ''}
                    className="text-lg py-3 px-4"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="quantity" className="text-lg font-medium">Current Stock</Label>
                  <Input
                    id="quantity"
                    name="quantity"
                    type="number"
                    readOnly
                    defaultValue={formSource?.quantity || 0}
                    className="text-lg py-3 px-4 bg-gray-50 text-gray-500"
                  />
                  <p className="text-xs text-muted-foreground">Stock can only be updated via transactions.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pcs_per_unit" className="text-lg font-medium">Pcs per Strip</Label>
                  <Input
                    id="pcs_per_unit"
                    name="pcs_per_unit"
                    type="number"
                    min="1"
                    defaultValue={formSource?.pcs_per_unit || ''}
                    className="text-lg py-3 px-4"
                    placeholder="e.g. 10, 15 (leave empty if N/A)"
                  />
                  <p className="text-xs text-muted-foreground">How many pieces in one strip?</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="low_stock_threshold" className="text-lg font-medium">Low Stock Alert</Label>
                  <Input
                    id="low_stock_threshold"
                    name="low_stock_threshold"
                    type="number"
                    defaultValue={formSource?.low_stock_threshold || 10}
                    className="text-lg py-3 px-4"
                    placeholder="10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gst" className="text-lg font-medium">GST %</Label>
                  <Input
                    id="gst"
                    name="gst"
                    type="number"
                    step="0.01"
                    value={gstState}
                    onChange={(e) => setGstState(e.target.value)}
                    className="text-lg py-3 px-4"
                    placeholder="18"
                  />
                  <p className="text-xs text-muted-foreground">
                    {hsnRateFor(hsnState) != null
                      ? `Filled from HSN ${hsnState}. Override only if this item is rated differently.`
                      : 'No HSN match - this manually entered rate will be used.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">

                  <Label htmlFor="rate" className="text-lg font-medium">Rate (₹)</Label>

                  <Input
                    id="rate"
                    name="rate"
                    type="number"
                    step="0.01"
                    value={purchasePriceState}
                    onChange={(e) => setPurchasePriceState(e.target.value)}
                    className="text-lg py-3 px-4"
                    placeholder="0.00"
                  />
                  <p className="text-xs text-muted-foreground">Rate on the supplier invoice, before discount.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discount" className="text-lg font-medium">Discount (%)</Label>
                  <Input
                    id="discount"
                    name="discount"
                    type="number"
                    step="0.01"
                    defaultValue={0}
                    className="text-lg py-3 px-4"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mrp" className="text-lg font-medium">MRP (₹)</Label>
                  <Input
                    id="mrp"
                    name="mrp"
                    type="number"
                    step="0.01"
                    required
                    defaultValue={formSource?.selling_price}
                    className="text-lg py-3 px-4"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Purchase terms -> landed cost. Free goods and trade discount
                  both move the real per-unit cost, so they are captured here
                  and stored on the batch as effective_cost. */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="free_qty" className="text-lg font-medium">Free Qty</Label>
                  <Input
                    id="free_qty"
                    name="free_qty"
                    type="number"
                    min="0"
                    step="0.001"
                    value={freeQtyState}
                    onChange={(e) => setFreeQtyState(e.target.value)}
                    className="text-lg py-3 px-4"
                    placeholder="0"
                  />
                  <p className="text-xs text-muted-foreground">Scheme goods received free (10+1 → enter 1).</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="disc_pct" className="text-lg font-medium">Trade Discount %</Label>
                  <Input
                    id="disc_pct"
                    name="disc_pct"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={discPctState}
                    onChange={(e) => setDiscPctState(e.target.value)}
                    className="text-lg py-3 px-4"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-lg font-medium">Effective Cost / Unit</Label>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <div className="text-xl font-semibold text-emerald-700">
                      {formatINR(previewEffectiveCost)}
                    </div>
                    <p className="text-xs text-emerald-700/80 mt-0.5">
                      Landed cost after discount and free goods. This is the COGS figure.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 text-lg py-3 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                >
                  {isSaving ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Saving...
                    </div>
                  ) : (
                    editingProduct ? 'Update Product' : 'Purchase Entry'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    setSelectedCategory("");
                  }}
                  className="flex-1 text-lg py-3 px-6"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-xl">Confirm Product Deletion</DialogTitle>
              <DialogDescription className="text-lg">
                Are you sure you want to delete this product? This action cannot be undone and the item will be permanently removed from your inventory.
              </DialogDescription>
            </DialogHeader>
            {productToDelete && (
              <div className="py-4">
                <div className="flex items-center gap-4 p-4 bg-red-50 rounded-lg">
                  <div className="bg-red-100 p-3 rounded-full">
                    <AlertTriangle className="h-6 w-6 text-red-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{productToDelete.name}</h3>
                    <p className="text-muted-foreground">HSN: {productToDelete.hsn_code || 'N/A'}</p>
                  </div>
                </div>
                <p className="mt-4 text-red-600 font-medium">
                  Warning: This action is irreversible. Once deleted, the product cannot be recovered.
                </p>
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteDialogOpen(false);
                  setProductToDelete(null);
                }}
                className="text-lg py-3 px-6"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => productToDelete && handleDelete(productToDelete.id)}
                className="text-lg py-3 px-6"
              >
                <Trash2 className="h-5 w-5 mr-2" />
                Delete Permanently
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      {/* Expiring-soon banner: dismissed implicitly by removing the underlying products */}
      {summary.expiringSoon > 0 && expiryFilter !== 'soon' && (
        <button
          type="button"
          onClick={() => setExpiryFilter('soon')}
          className="w-full flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left hover:bg-amber-100 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-sm text-amber-900">
              <strong>{summary.expiringSoon}</strong> {summary.expiringSoon === 1 ? 'product is' : 'products are'} expiring within 30 days
            </span>
          </div>
          <span className="text-xs font-medium text-amber-700 shrink-0">View →</span>
        </button>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-lg font-semibold">Product Inventory</CardTitle>
              <CardDescription className="text-sm mt-0.5">
                Showing {filteredProducts.length} of {products.length} products
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-80 md:flex-none">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4 pointer-events-none" />
                <Input
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-3 w-full"
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="default" className="flex gap-2 items-center shrink-0">
                    <Filter className="h-4 w-4" />
                    <span className="hidden sm:inline">Filters</span>
                    {activeFilterCount > 0 && (
                      <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                        {activeFilterCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[calc(100vw-2rem)] max-w-80 p-4 sm:p-6" align="end">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xl leading-none">Filters</h4>
                      {activeFilterCount > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearAllFilters}
                          className="h-auto p-1 text-blue-600 hover:text-blue-800"
                        >
                          Clear all
                        </Button>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Stock Status</Label>
                        <Select value={stockFilter} onValueChange={setStockFilter}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="All Stock" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Stock</SelectItem>
                            <SelectItem value="in_stock">In Stock</SelectItem>
                            <SelectItem value="low_stock">Low Stock</SelectItem>
                            <SelectItem value="out_of_stock">Out of Stock</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Expiry Status</Label>
                        <Select value={expiryFilter} onValueChange={setExpiryFilter}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="All Expiries" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Expiries</SelectItem>
                            <SelectItem value="expired">Expired</SelectItem>
                            <SelectItem value="soon">Expiring Soon (30 days)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Category</Label>
                        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="All Categories" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Categories</SelectItem>
                            {categoryOptions.map(c => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Supplier</Label>
                        <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="All Suppliers" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Suppliers</SelectItem>
                            {supplierOptions.map(s => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Active filter chips */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-2">
              {stockFilter !== 'all' && (
                <Badge variant="secondary" className="h-6 gap-1 pr-1 text-xs font-normal">
                  Stock: {stockFilter.replace('_', ' ')}
                  <button
                    onClick={() => setStockFilter('all')}
                    className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                    aria-label="Remove stock filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {expiryFilter !== 'all' && (
                <Badge variant="secondary" className="h-6 gap-1 pr-1 text-xs font-normal">
                  Expiry: {expiryFilter === 'soon' ? 'expiring soon' : expiryFilter}
                  <button
                    onClick={() => setExpiryFilter('all')}
                    className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                    aria-label="Remove expiry filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {categoryFilter !== 'all' && (
                <Badge variant="secondary" className="h-6 gap-1 pr-1 text-xs font-normal">
                  Category: {categoryFilter}
                  <button
                    onClick={() => setCategoryFilter('all')}
                    className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                    aria-label="Remove category filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {supplierFilter !== 'all' && (
                <Badge variant="secondary" className="h-6 gap-1 pr-1 text-xs font-normal">
                  Supplier: {supplierFilter}
                  <button
                    onClick={() => setSupplierFilter('all')}
                    className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                    aria-label="Remove supplier filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              <button
                onClick={clearAllFilters}
                className="text-xs text-muted-foreground hover:text-foreground underline ml-1"
              >
                Clear all
              </button>
            </div>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <TableSkeleton rows={6} cols={['w-40', 'w-24', 'w-16', 'w-20', 'w-20', 'w-16']} />
          ) : filteredProducts.length === 0 ? (
            (() => {
              const isFiltered = searchTerm !== '' || activeFilterCount > 0;
              if (isFiltered) {
                return (
                  <div className="text-center py-12">
                    <div className="bg-muted/50 p-4 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-4">
                      <Search className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="text-base font-semibold mb-1">No matches found</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Try adjusting your search or clearing filters.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSearchTerm('');
                        clearAllFilters();
                      }}
                    >
                      Clear search & filters
                    </Button>
                  </div>
                );
              }
              return (
                <div className="text-center py-12">
                  <div className="bg-muted/50 p-4 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-4">
                    <Package className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="text-base font-semibold mb-1">Your inventory is empty</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Add your first product to start tracking stock.
                  </p>
                  <Button onClick={() => setIsMultiAddOpen(true)} size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Purchase Entry
                  </Button>
                </div>
              );
            })()
          ) : (
            <>
              {/* Mobile: sort pill (desktop sorts via column headers) */}
              <div className="md:hidden flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{filteredProducts.length} products</span>
                <Select
                  value={sortKey ? `${sortKey}:${sortDirection}` : 'default'}
                  onValueChange={(v) => {
                    if (v === 'default') {
                      setSortKey(null);
                      setSortDirection('asc');
                      return;
                    }
                    const [key, dir] = v.split(':') as [typeof sortKey, 'asc' | 'desc'];
                    setSortKey(key);
                    setSortDirection(dir);
                  }}
                >
                  <SelectTrigger className="h-8 w-auto gap-2 text-xs">
                    <span className="text-muted-foreground">Sort:</span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="name:asc">Name A→Z</SelectItem>
                    <SelectItem value="name:desc">Name Z→A</SelectItem>
                    <SelectItem value="quantity:asc">Stock low→high</SelectItem>
                    <SelectItem value="quantity:desc">Stock high→low</SelectItem>
                    <SelectItem value="expiry_date:asc">Expiry soonest</SelectItem>
                    <SelectItem value="expiry_date:desc">Expiry latest</SelectItem>
                    <SelectItem value="selling_price:asc">Price low→high</SelectItem>
                    <SelectItem value="selling_price:desc">Price high→low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Mobile: compact table - real column alignment (Product | Stock | Price | ⋮)
                  so rows read like the desktop table and many products fit on screen. */}
              <div className="md:hidden rounded-md border bg-card overflow-hidden">
                {/* Column header */}
                <div className="grid grid-cols-[1fr_auto_auto_1.75rem] items-center gap-2 px-2.5 py-1.5 bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                  <span>Product</span>
                  <span className="text-center">Stock</span>
                  <span className="text-right">Price</span>
                  <span aria-hidden />
                </div>
                <div className="divide-y">
                {paginatedProducts.map((product) => {
                  const isExpiringSoon = (() => {
                    if (!product.expiry_date) return false;
                    const days = Math.ceil((new Date(product.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                    return days <= 30;
                  })();
                  const expiryText = product.expiry_date ? formatExpiry(product.expiry_date) : null;
                  const stockVariant: 'destructive' | 'warning' | 'success' =
                    product.quantity === 0 ? 'destructive'
                    : product.quantity <= (product.low_stock_threshold || 10) ? 'warning'
                    : 'success';

                  return (
                    <div key={product.id} className="grid grid-cols-[1fr_auto_auto_1.75rem] items-center gap-2 px-2.5 py-1.5">
                      {/* Product: name + tiny meta line (batch/exp/category) */}
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate leading-tight">{product.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate leading-tight">
                          {[
                            product.batch_number && `B:${product.batch_number}`,
                            product.category,
                          ].filter(Boolean).join(' · ') || '-'}
                          {expiryText && (
                            <span className={cn("ml-1", isExpiringSoon && "text-rose-600 font-medium")}>Exp {expiryText}</span>
                          )}
                        </p>
                      </div>
                      {/* Stock */}
                      <Badge variant={stockVariant} className="h-5 px-1.5 text-[10px] font-normal justify-self-center tabular-nums">
                        {product.quantity}
                      </Badge>
                      {/* Price */}
                      <span className="text-sm font-semibold text-right tabular-nums">{formatINR(product.selling_price)}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingProduct(product);
                              setSelectedCategory(product.category || "");
                              setIsDialogOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4 mr-2" />
                            Edit Product
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setDuplicateSource(product);
                              setEditingProduct(null);
                              setSelectedCategory(product.category || "");
                              setSupplierSearch(product.supplier || "");
                              setIsDialogOpen(true);
                            }}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(product.id)}
                            className="text-red-600 focus:text-red-700"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Product
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
                </div>
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-medium">
                        <button
                          type="button"
                          onClick={() => toggleSort('name')}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          Product
                          <SortIcon column="name" />
                        </button>
                      </TableHead>
                      <TableHead className="hidden lg:table-cell font-medium">Category & Mfg</TableHead>
                      <TableHead className="font-medium">
                        <button
                          type="button"
                          onClick={() => toggleSort('expiry_date')}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          Batch & Expiry
                          <SortIcon column="expiry_date" />
                        </button>
                      </TableHead>
                      <TableHead className="text-center font-medium" title="Total physical inventory stock (includes billed + scheme/free units)">
                        <button
                          type="button"
                          onClick={() => toggleSort('quantity')}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          Stock
                          <SortIcon column="quantity" />
                        </button>
                      </TableHead>
                      <TableHead className="font-medium">
                        <button
                          type="button"
                          onClick={() => toggleSort('selling_price')}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          Price
                          <SortIcon column="selling_price" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right font-medium">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedProducts.map((product) => {
                      const isExpiringSoon = (() => {
                        if (!product.expiry_date) return false;
                        const days = Math.ceil((new Date(product.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                        return days <= 30;
                      })();
                      const expiryText = product.expiry_date ? formatExpiry(product.expiry_date) : null;
                      const stockVariant: 'destructive' | 'warning' | 'success' =
                        product.quantity === 0 ? 'destructive'
                        : product.quantity <= (product.low_stock_threshold || 10) ? 'warning'
                        : 'success';
                      const stockLabel =
                        product.quantity === 0 ? 'Out of stock'
                        : product.quantity <= (product.low_stock_threshold || 10) ? 'Low'
                        : 'In stock';

                      return (
                        <TableRow key={product.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{product.name}</span>
                              {product.hsn_code && (
                                <span className="text-xs text-muted-foreground font-mono">HSN: {product.hsn_code}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <div className="flex flex-col">
                              <span className="text-sm">{product.category || '-'}</span>
                              <span className="text-xs text-muted-foreground">{product.manufacturer || 'Unknown manufacturer'}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="text-sm">{product.batch_number || '-'}</span>
                              <span className={cn("text-xs", isExpiringSoon ? "text-rose-600 font-medium" : "text-muted-foreground")}>
                                Exp {expiryText || '-'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="inline-flex flex-col items-center gap-0.5">
                              <Badge variant={stockVariant} className="h-5 text-xs font-normal">
                                {product.quantity} · {stockLabel}
                              </Badge>
                              {product.pcs_per_unit && (
                                <span className="text-[10px] text-muted-foreground">{product.pcs_per_unit} pcs/strip</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-semibold">{formatINR(product.selling_price)}</span>
                              {product.gst && <span className="text-[10px] text-muted-foreground">Incl. {product.gst}% GST</span>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditingProduct(product);
                                    setSelectedCategory(product.category || "");
                                    setIsDialogOpen(true);
                                  }}
                                >
                                  <Edit className="h-4 w-4 mr-2" />
                                  Edit Product
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => confirmDelete(product)}
                                  className="text-red-600 focus:text-red-700"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete Product
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
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
                    Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredProducts.length)} of {filteredProducts.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                    >
                      Prev
                    </Button>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === totalPages}
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
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
    </div>
  );
}