import { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn, formatINR, formatExpiry } from "@/lib/utils";
import CSVUpload from '@/components/CSVUpload';
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
  Upload,
  Wallet,
  Clock,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  const { toast } = useToast();
  // Account-wide default GST rate from Settings → drives the GST default on new-product forms
  const [defaultGstRate, setDefaultGstRate] = useState<number>(18);
  // URL state — initial values come from search params, changes get written back so views are shareable/bookmarkable
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
  const [uploadedData, setUploadedData] = useState<string[][]>([]);
  const [parsedProducts, setParsedProducts] = useState<Product[]>([]);
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
  // Bulk import collapsible
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  // New multi-product add dialog
  const [isMultiAddOpen, setIsMultiAddOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);

  // Supplier search state
  const [allSuppliers, setAllSuppliers] = useState<SupplierOption[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const supplierRef = useRef<HTMLDivElement>(null);

  // CSV Supplier mapping state
  const [unmatchedSupplierDialogOpen, setUnmatchedSupplierDialogOpen] = useState(false);
  const [csvGlobalSupplierId, setCsvGlobalSupplierId] = useState<string | null>(null);
  const [csvGlobalSupplierSearch, setCsvGlobalSupplierSearch] = useState('');
  const [csvSupplierDropdownOpen, setCsvSupplierDropdownOpen] = useState(false);
  const csvSupplierRef = useRef<HTMLDivElement>(null);
  const [unmatchedSupplierNames, setUnmatchedSupplierNames] = useState<string[]>([]);

  const filteredCsvSupplierOptions = useMemo(() => {
    if (!csvGlobalSupplierSearch.trim()) return allSuppliers.slice(0, 8);
    const q = csvGlobalSupplierSearch.toLowerCase();
    return allSuppliers.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.phone || '').includes(q) ||
      (s.contact_person || '').toLowerCase().includes(q) ||
      s.supplier_code.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [allSuppliers, csvGlobalSupplierSearch]);

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

  // Pull the account-wide default GST rate from Settings (Tax & Currency tab)
  useEffect(() => {
    if (!profile?.account_id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('settings')
        .select('default_gst_rate')
        .eq('account_id', profile.account_id)
        .single();
      const raw: any = data;
      if (!cancelled && typeof raw?.default_gst_rate === 'number') {
        setDefaultGstRate(raw.default_gst_rate);
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
      if (csvSupplierRef.current && !csvSupplierRef.current.contains(e.target as Node)) {
        setCsvSupplierDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // F2 Shortcut for Add Product
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

  // Function to download sample CSV
  const downloadSampleCSV = () => {
    const headers = [
      'name',
      'hsn_code',
      'category',
      'batch_number',
      'manufacturer',
      'expiry_date',
      'quantity',
      'purchase_price',
      'selling_price',
      'gst',
      'supplier',
      'low_stock_threshold'
    ];

    const sampleData = [
      ['Paracetamol 500mg', '30049099', 'Tablets', 'BATCH001', 'ABC Pharma', '2026-12-01', '100', '5.50', '10.00', '12', 'Vaibhav', '20'],
      ['Amoxicillin 250mg', '30042090', 'Capsules', 'BATCH002', 'XYZ Pharma', '2026-12-02', '150', '8.00', '15.00', '12', 'Vaibhav', '25'],
      ['Cough Syrup 100ml', '30049011', 'Syrups', 'BATCH003', 'DEF Pharma', '2026-12-03', '75', '45.00', '75.00', '18', 'Vaibhav', '15'],
      ['Antiseptic Cream 50g', '30039000', 'Ointments', 'BATCH004', 'GHI Pharma', '2026-12-04', '200', '25.00', '40.00', '18', 'Vaibhav', '30'],
      ['Vitamin D3 Tablets', '21069000', 'Supplements', 'BATCH005', 'JKL Nutrition', '2026-12-05', '120', '15.00', '25.00', '12', 'Vaibhav', '20'],
      ['Digital Thermometer', '90251180', 'Medical Devices', 'DEV001', 'MNO Medical', '2026-12-06', '50', '150.00', '250.00', '18', 'Vaibhav', '10'],
      ['Insulin Injection 10ml', '30043100', 'Injections', 'BATCH006', 'PQR Pharma', '2026-12-07', '80', '200.00', '350.00', '12', 'Vaibhav', '15'],
      ['Eye Drops 10ml', '30049031', 'Drops', 'BATCH007', 'STU Pharma', '2026-12-08', '90', '35.00', '60.00', '12', 'Vaibhav', '20'],
      ['Baby Diaper Pack', '96190010', 'Baby Care', 'PACK001', 'VWX Baby Care', '2026-12-09', '60', '180.00', '250.00', '18', 'Sajal Srivastava', '15'],
      ['Hand Sanitizer 500ml', '38089400', 'Personal Care', 'BATCH008', 'YZA Healthcare', '2026-12-10', '100', '45.00', '75.00', '18', 'Sajal Srivastava', '25']
    ];

    // Create CSV content
    const csvContent = [
      headers.join(','),
      ...sampleData.map(row => row.map(cell => {
        // Escape cells that contain commas or quotes
        if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      }).join(','))
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'sample-products.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Sample CSV downloaded",
      description: "Use this template to prepare your product data",
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    if (!profile?.account_id || isSaving) return;

    setIsSaving(true);

    const pcsPerUnitRaw = formData.get('pcs_per_unit') as string;
    const pcsPerUnitVal = pcsPerUnitRaw ? parseInt(pcsPerUnitRaw) : null;

    const expDateRaw = formData.get('expiry_date') as string;
    const productData = {
      name: formData.get('name') as string,
      hsn_code: formData.get('hsn_code') as string,
      category: formData.get('category') as string,
      batch_number: formData.get('batch_number') as string,
      manufacturer: formData.get('manufacturer') as string,
      expiry_date: expDateRaw && expDateRaw.length === 7 ? `${expDateRaw}-01` : (expDateRaw || null),
      quantity: parseInt(formData.get('quantity') as string),
      purchase_price: parseFloat(formData.get('purchase_price') as string),
      selling_price: parseFloat(formData.get('selling_price') as string),
      gst: parseFloat(formData.get('gst') as string),
      supplier: supplierSearch || (formData.get('supplier') as string) || null,
      supplier_id: selectedSupplierId || null,
      low_stock_threshold: parseInt(formData.get('low_stock_threshold') as string),
      pcs_per_unit: (pcsPerUnitVal && pcsPerUnitVal > 0) ? pcsPerUnitVal : null,
      account_id: profile?.account_id,
    };

    try {
      let error;

      if (editingProduct) {
        ({ error } = await supabase
          .from('products')
          .update(productData)
          .eq('id', editingProduct.id));
      } else {
        ({ error } = await supabase
          .from('products')
          .insert([productData]));
      }

      if (error) throw error;

      toast({
        title: editingProduct ? "Product updated" : "Product added",
        description: editingProduct ? "Product has been updated successfully." : "Product has been added successfully.",
      });

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
    // Keep a copy for the undo action before we hit the DB
    const deletedProduct = products.find(p => p.id === id);
    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // Optimistically drop from local list so the user sees it disappear immediately
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

  // Parse CSV data when uploaded
  useEffect(() => {
    if (uploadedData.length > 0) {
      try {
        const headers = uploadedData[0].map(h => h.toLowerCase().trim());
        const body = uploadedData.slice(1).filter(row => row.some(cell => cell.trim()));

        // Check for required columns
        const requiredColumns = ['name', 'selling_price'];
        const missingColumns = requiredColumns.filter(col => !headers.includes(col));

        if (missingColumns.length > 0) {
          toast({
            variant: "destructive",
            title: "Invalid CSV format",
            description: `Missing required columns: ${missingColumns.join(', ')}. Please check your CSV file.`,
          });
          setParsedProducts([]);
          return;
        }

        const products: Product[] = body.map((row, index) => {
          const getColumnValue = (columnName: string) => {
            const colIndex = headers.indexOf(columnName);
            return colIndex >= 0 ? row[colIndex]?.trim() : '';
          };

          const csvSupplierName = getColumnValue('supplier') || '';
          const matchedSupplier = allSuppliers.find(s => s.name.toLowerCase() === csvSupplierName.toLowerCase());

          return {
            id: (typeof crypto !== 'undefined' && crypto.randomUUID)
              ? crypto.randomUUID()
              : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
              }),
            name: getColumnValue('name') || '',
            sku: getColumnValue('sku') || '',
            hsn_code: getColumnValue('hsn_code') || getColumnValue('hsn code') || '',
            category: getColumnValue('category') || '',
            batch_number: getColumnValue('batch_number') || getColumnValue('batch number') || '',
            manufacturer: getColumnValue('manufacturer') || '',
            expiry_date: getColumnValue('expiry_date') || getColumnValue('expiry date') || null,
            quantity: parseInt(getColumnValue('quantity')) || 0,
            purchase_price: parseFloat(getColumnValue('purchase_price') || getColumnValue('purchase price')) || 0,
            selling_price: parseFloat(getColumnValue('selling_price') || getColumnValue('selling price')) || 0,
            gst: parseFloat(getColumnValue('gst')) || 0,
            supplier: matchedSupplier ? matchedSupplier.name : csvSupplierName,
            supplier_id: matchedSupplier ? matchedSupplier.id : null,
            low_stock_threshold: parseInt(getColumnValue('low_stock_threshold') || getColumnValue('low stock threshold')) || 10,
            pcs_per_unit: parseInt(getColumnValue('pcs_per_unit') || getColumnValue('pcs per unit') || getColumnValue('tablets_per_strip') || getColumnValue('tablets per strip')) || null,
            created_at: new Date().toISOString()
          };
        }).filter(product => product.name && product.selling_price > 0);

        // Identify distinct unmatched supplier names
        const unmatched = Array.from(new Set(
          products
            .filter(p => !p.supplier_id && p.supplier)
            .map(p => p.supplier as string)
        ));
        setUnmatchedSupplierNames(unmatched);

        setParsedProducts(products);

        if (products.length > 0) {
          toast({
            title: `Successfully parsed ${products.length} products`,
            description: "Click 'Save All Products' to add them to your inventory",
          });
        } else {
          toast({
            variant: "destructive",
            title: "No valid products found",
            description: "Please ensure your CSV has valid product data with name and selling price.",
          });
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Error parsing CSV",
          description: "There was an error processing your CSV file. Please check the format.",
        });
        setParsedProducts([]);
      }
    }
  }, [uploadedData, toast, allSuppliers]);

  const saveAllProducts = async () => {
    if (parsedProducts.length === 0) return;
    if (!profile?.account_id || isSavingAll) return;

    // Hustle-free logic: check if ANY product is missing a supplier
    const needsSupplier = parsedProducts.some(p => !p.supplier_id);
    if (needsSupplier && !csvGlobalSupplierId && allSuppliers.length > 0) {
      if (unmatchedSupplierNames.length > 1) {
        toast({
          variant: "destructive",
          title: "Too many new suppliers",
          description: `You have ${unmatchedSupplierNames.length} different unknown suppliers. Please add them in the Suppliers section first.`,
          action: <Button variant="outline" size="sm" onClick={() => navigate('/suppliers')}>Go to Suppliers</Button>
        });
        setUnmatchedSupplierDialogOpen(true);
        return;
      }
      // Pause saving and show popup to ask for default supplier
      setUnmatchedSupplierDialogOpen(true);
      return;
    }

    setIsSavingAll(true);

    try {
      const productsToInsert = parsedProducts.map(product => ({
        ...product,
        // Override unmatched supplier ID with the user-selected global fallback
        supplier_id: product.supplier_id || csvGlobalSupplierId || null,
        account_id: profile?.account_id
      }));

      const { error } = await supabase
        .from('products')
        .insert(productsToInsert);

      if (error) throw error;

      toast({
        title: `Successfully added ${parsedProducts.length} products`,
        description: "All products have been added to your inventory",
      });

      setUploadedData([]);
      setParsedProducts([]);
      setCsvGlobalSupplierId(null);
      setCsvGlobalSupplierSearch('');
      fetchProducts();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error adding products",
        description: error.message,
      });
    } finally {
      setIsSavingAll(false);
    }
  };

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
            <span>Add Product</span>
          </div>
          <span className="text-[10px] bg-primary-foreground/20 px-1.5 py-0.5 rounded border border-primary-foreground/30 opacity-80 hidden sm:inline-block">F2</span>
        </Button>
      </div>

        <MultiProductForm
          open={isMultiAddOpen}
          onOpenChange={setIsMultiAddOpen}
          allSuppliers={allSuppliers}
          accountId={profile?.account_id}
          onSaved={fetchProducts}
          defaultGstRate={defaultGstRate}
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

        {/* Bulk import — collapsible so it doesn't dominate above the fold */}
        <Collapsible open={bulkImportOpen} onOpenChange={setBulkImportOpen}>
          <Card className="border-slate-200">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 transition-colors rounded-t-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-50">
                    <Upload className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">Bulk Import</p>
                    <p className="text-xs text-muted-foreground">
                      Upload a CSV to add many products at once
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {parsedProducts.length > 0 && (
                    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
                      {parsedProducts.length} parsed
                    </Badge>
                  )}
                  {bulkImportOpen ? (
                    <ChevronUp className="h-5 w-5 text-slate-500" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-slate-500" />
                  )}
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="p-4 pt-0 space-y-4 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-3 pt-4">
                  <button
                    onClick={downloadSampleCSV}
                    className="text-sm text-blue-600 hover:text-blue-800 underline cursor-pointer bg-transparent border-none"
                  >
                    Download Sample CSV
                  </button>
                </div>
                <CSVUpload onFileUpload={setUploadedData} />

                {parsedProducts.length > 0 && (
                  <div className="rounded-lg border border-emerald-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4">
                    <p className="font-semibold text-slate-800">Parsed Products</p>
                    <p className="text-sm text-muted-foreground mb-3">
                      Found {parsedProducts.length} products in your CSV file
                    </p>
                    <div className="flex gap-3">
                      <Button
                        onClick={saveAllProducts}
                        disabled={isSavingAll}
                        className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                      >
                        {isSavingAll ? (
                          <div className="flex items-center">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Saving All...
                          </div>
                        ) : (
                          'Save All Products'
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setUploadedData([]);
                          setParsedProducts([]);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Global Supplier Fallback Dialog */}
        <Dialog open={unmatchedSupplierDialogOpen} onOpenChange={setUnmatchedSupplierDialogOpen}>
          <DialogContent className="w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl text-amber-600 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Unmatched Suppliers Detected!
              </DialogTitle>
              <DialogDescription className="text-base pt-2">
                {unmatchedSupplierNames.length > 1 
                  ? `There are ${unmatchedSupplierNames.length} different suppliers in your CSV that aren't registered. It's recommended to add them first, or you can assign a single fallback supplier below.`
                  : "Some products in your CSV don't have a recognized supplier. Please assign a supplier to apply to these unmatched products, or leave empty if you want to proceed without one."
                }
              </DialogDescription>
            </DialogHeader>
            {unmatchedSupplierNames.length > 1 && (
              <div className="bg-amber-50 p-3 rounded-md border border-amber-200 mb-4">
                <p className="text-sm font-medium text-amber-800 mb-1">Unrecognized Suppliers found:</p>
                <div className="flex flex-wrap gap-2">
                  {unmatchedSupplierNames.map((name, i) => (
                    <Badge key={i} variant="outline" className="bg-white">{name}</Badge>
                  ))}
                </div>
                <Button 
                  variant="link" 
                  className="mt-2 h-auto p-0 text-amber-900 font-bold underline"
                  onClick={() => navigate('/suppliers')}
                >
                  Click here to add them first →
                </Button>
              </div>
            )}
            <div className="py-2">
              <div className="space-y-2 relative" ref={csvSupplierRef}>
                <Label>Select Supplier for Unmatched Products</Label>
                <Input
                  placeholder="Search existing suppliers..."
                  value={csvGlobalSupplierSearch}
                  autoComplete="off"
                  onChange={(e) => {
                    setCsvGlobalSupplierSearch(e.target.value);
                    setCsvSupplierDropdownOpen(true);
                    if (csvGlobalSupplierId && !e.target.value) {
                      setCsvGlobalSupplierId(null);
                    }
                  }}
                  onFocus={() => setCsvSupplierDropdownOpen(true)}
                  className="w-full transition-all focus-visible:ring-blue-500"
                />
                {csvSupplierDropdownOpen && (
                  <div className="absolute z-50 w-full mt-1 bg-white rounded-md shadow-lg border max-h-48 overflow-auto">
                    {filteredCsvSupplierOptions.length > 0 ? (
                      <ul className="py-1 relative z-50 bg-white shadow-md">
                        {filteredCsvSupplierOptions.map((supplier) => (
                          <li
                            key={supplier.id}
                            className={`px-3 py-2 text-sm cursor-pointer hover:bg-slate-100 ${csvGlobalSupplierId === supplier.id ? 'bg-blue-50 font-medium' : ''}`}
                            onClick={() => {
                              setCsvGlobalSupplierId(supplier.id);
                              setCsvGlobalSupplierSearch(supplier.name);
                              setCsvSupplierDropdownOpen(false);
                            }}
                          >
                            <div className="font-medium">{supplier.name}</div>
                            {supplier.phone && <div className="text-xs text-muted-foreground">{supplier.phone}</div>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="px-3 py-4 text-sm text-center text-muted-foreground">
                        No suppliers found matching "{csvGlobalSupplierSearch}".
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="outline" onClick={() => setUnmatchedSupplierDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setUnmatchedSupplierDialogOpen(false);
                  saveAllProducts();
                }}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Proceed & Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
                  <Input
                    id="hsn_code"
                    name="hsn_code"
                    defaultValue={formSource?.hsn_code}
                    className="text-lg py-3 px-4"
                    placeholder="Enter HSN Code"
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="quantity" className="text-lg font-medium">Quantity (Strips)</Label>
                  <Input
                    id="quantity"
                    name="quantity"
                    type="number"
                    required
                    defaultValue={formSource?.quantity}
                    className="text-lg py-3 px-4"
                    placeholder="0"
                  />
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
                  <p className="text-xs text-muted-foreground">How many pieces in one strip? Leave empty for non-strip items.</p>
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
                    defaultValue={formSource?.gst ?? defaultGstRate}
                    className="text-lg py-3 px-4"
                    placeholder="18"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="purchase_price" className="text-lg font-medium">Purchase Price (₹)</Label>
                  <Input
                    id="purchase_price"
                    name="purchase_price"
                    type="number"
                    step="0.01"
                    defaultValue={formSource?.purchase_price}
                    className="text-lg py-3 px-4"
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="selling_price" className="text-lg font-medium">Selling Price (₹)</Label>
                  <Input
                    id="selling_price"
                    name="selling_price"
                    type="number"
                    step="0.01"
                    required
                    defaultValue={formSource?.selling_price}
                    className="text-lg py-3 px-4"
                    placeholder="0.00"
                  />
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
                    editingProduct ? 'Update Product' : 'Add Product'
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
                    Add Product
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

              {/* Mobile: compact table — real column alignment (Product | Stock | Price | ⋮)
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
                          ].filter(Boolean).join(' · ') || '—'}
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
                      <TableHead className="text-center font-medium">
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
                              <span className="text-sm">{product.category || '—'}</span>
                              <span className="text-xs text-muted-foreground">{product.manufacturer || 'Unknown manufacturer'}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="text-sm">{product.batch_number || '—'}</span>
                              <span className={cn("text-xs", isExpiringSoon ? "text-rose-600 font-medium" : "text-muted-foreground")}>
                                Exp {expiryText || '—'}
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