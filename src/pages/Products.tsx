import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from "@/lib/utils";
import CSVUpload from '@/components/CSVUpload';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Edit, Trash2, Package, AlertTriangle, Filter, X, SlidersHorizontal, MoreVertical } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
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
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [uploadedData, setUploadedData] = useState<string[][]>([]);
  const [parsedProducts, setParsedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  // State for category selection
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  // Filters
  const [expiryFilter, setExpiryFilter] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<string>('all');
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
    fetchProducts();
  }, []);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

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

    const productData = {
      name: formData.get('name') as string,
      hsn_code: formData.get('hsn_code') as string,
      category: formData.get('category') as string,
      batch_number: formData.get('batch_number') as string,
      manufacturer: formData.get('manufacturer') as string,
      expiry_date: (formData.get('expiry_date') as string) || null,
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
    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Product deleted",
        description: "Product has been deleted successfully.",
      });

      fetchProducts();
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

  // Memoize filtered products to prevent unnecessary recalculations
  const filteredProducts = useMemo(() =>
    products.filter(product => {
      // Search filter
      const searchMatch = !searchTerm ||
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.hsn_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.manufacturer?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.batch_number?.toLowerCase().includes(searchTerm.toLowerCase());

      if (!searchMatch) return false;

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

      return true;
    }), [products, searchTerm, stockFilter, expiryFilter]);

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

  const handleDeleteAll = async () => {
    if (!profile?.account_id) return;
    setIsDeletingAll(true);
    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('account_id', profile.account_id);

      if (error) throw error;
      toast({ title: 'All products deleted', description: 'Your inventory has been cleared.' });
      setProducts([]);
      setDeleteAllDialogOpen(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error deleting products', description: err.message });
    } finally {
      setIsDeletingAll(false);
    }
  };

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
    <div className="space-y-8">
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
          <div>
            <div className="flex items-center gap-4">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Product Management
              </h1>
              <button
                onClick={downloadSampleCSV}
                className="text-sm text-blue-600 hover:text-blue-800 underline cursor-pointer bg-transparent border-none"
              >
                Download Sample CSV
              </button>
            </div>
            <p className="text-muted-foreground text-lg mt-2">
              Manage your inventory products and stock levels
            </p>
          </div>
          <div className="flex gap-4">
            {/* <Button
              variant="destructive"
              onClick={() => setDeleteAllDialogOpen(true)}
              className="text-sm px-4 shadow-sm border border-red-200"
            >delete all products
              <Trash2 className="h-4 w-4 mr-2" />
              
            </Button> */}
          </div>
        </div>
        
        {/* Delete All Confirmation Dialog */}
        <Dialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-xl text-red-600 flex items-center gap-2">
                <AlertTriangle className="h-6 w-6" />
                Delete ALL Products?
              </DialogTitle>
              <DialogDescription className="text-base pt-2">
                This action cannot be undone. This will permanently delete your entire product inventory. Are you absolutely sure you want to proceed?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0 mt-4">
              <Button
                variant="outline"
                onClick={() => setDeleteAllDialogOpen(false)}
                className="text-lg py-3 px-6"
                disabled={isDeletingAll}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteAll}
                className="text-lg py-3 px-6"
                disabled={isDeletingAll}
              >
                {isDeletingAll ? 'Deleting...' : 'Delete All Products'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <CSVUpload onFileUpload={setUploadedData} />

        {parsedProducts.length > 0 && (
          <Card className="shadow-lg border-0 bg-gradient-to-r from-green-50 to-emerald-50">
            <CardHeader>
              <CardTitle className="text-xl font-bold">Parsed Products</CardTitle>
              <CardDescription>Found {parsedProducts.length} products in your CSV file</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
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
                    "Save All Products"
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
            </CardContent>
          </Card>
        )}

        {/* Global Supplier Fallback Dialog */}
        <Dialog open={unmatchedSupplierDialogOpen} onOpenChange={setUnmatchedSupplierDialogOpen}>
          <DialogContent className="sm:max-w-md">
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
          }
        }}>
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                setEditingProduct(null);
                setSelectedCategory("");
              }}
              className="text-lg py-3 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Product
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg md:max-w-xl max-h-[90vh] overflow-y-auto w-[95vw]">
            <DialogHeader>
              <DialogTitle className="text-2xl">
                {editingProduct ? 'Edit Product' : 'Add New Product'}
              </DialogTitle>
              <DialogDescription className="text-lg">
                {editingProduct ? 'Update product information' : 'Enter product details to add to your inventory'}
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
                    defaultValue={editingProduct?.name}
                    className="text-lg py-3 px-4"
                    placeholder="Enter product name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hsn_code" className="text-lg font-medium">HSN Code</Label>
                  <Input
                    id="hsn_code"
                    name="hsn_code"
                    defaultValue={editingProduct?.hsn_code}
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
                    defaultValue={editingProduct?.manufacturer}
                    className="text-lg py-3 px-4"
                    placeholder="Enter manufacturer"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expiry_date" className="text-lg font-medium">Expiry Date</Label>
                  <Input
                    id="expiry_date"
                    name="expiry_date"
                    type="date"
                    defaultValue={editingProduct?.expiry_date ? editingProduct.expiry_date.substring(0, 10) : ''}
                    className="text-lg py-3 px-4"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="quantity" className="text-lg font-medium">Quantity (Strips/Units)</Label>
                  <Input
                    id="quantity"
                    name="quantity"
                    type="number"
                    required
                    defaultValue={editingProduct?.quantity}
                    className="text-lg py-3 px-4"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pcs_per_unit" className="text-lg font-medium">PCS per Strip</Label>
                  <Input
                    id="pcs_per_unit"
                    name="pcs_per_unit"
                    type="number"
                    min="1"
                    defaultValue={editingProduct?.pcs_per_unit || ''}
                    className="text-lg py-3 px-4"
                    placeholder="e.g. 10, 15 (leave empty if N/A)"
                  />
                  <p className="text-xs text-muted-foreground">How many tablets/pieces in one strip? Leave empty for non-strip items.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="low_stock_threshold" className="text-lg font-medium">Low Stock Alert</Label>
                  <Input
                    id="low_stock_threshold"
                    name="low_stock_threshold"
                    type="number"
                    defaultValue={editingProduct?.low_stock_threshold || 10}
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
                    defaultValue={editingProduct?.gst || 18}
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
                    defaultValue={editingProduct?.purchase_price}
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
                    defaultValue={editingProduct?.selling_price}
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

      </div>

      <Card className="shadow-xl border-0 bg-gradient-to-br from-white to-gray-50">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <CardTitle className="text-2xl font-bold">Product Inventory</CardTitle>
              <CardDescription className="text-lg mt-1">
                Total: {products.length} products
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2 w-full md:w-auto">
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
                <Input
                  placeholder="      Search products..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 text-lg py-3 px-4 w-full"
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="flex gap-2 items-center text-lg py-3 px-4 h-auto">
                    <Filter className="h-5 w-5" />
                    Filters
                    {(stockFilter !== 'all' || expiryFilter !== 'all') && (
                      <Badge variant="secondary" className="ml-1 px-2 py-0.5">
                        {(stockFilter !== 'all' ? 1 : 0) + (expiryFilter !== 'all' ? 1 : 0)}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-6" align="end">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xl leading-none">Filters</h4>
                      {(stockFilter !== 'all' || expiryFilter !== 'all') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setStockFilter('all');
                            setExpiryFilter('all');
                          }}
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
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-muted-foreground text-lg">Loading products...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-16">
              <div className="bg-gray-100 p-6 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                <Package className="h-12 w-12 text-gray-400" />
              </div>
              <h3 className="text-2xl font-bold mb-2">No Products Found</h3>
              <p className="text-muted-foreground text-lg mb-6">
                {searchTerm ? 'No products match your search.' : 'Your inventory is empty.'}
              </p>
              <Button
                onClick={() => {
                  setSearchTerm('');
                  setIsDialogOpen(true);
                  setEditingProduct(null);
                  setSelectedCategory("");
                }}
                className="text-lg py-3 px-8 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
              >
                <Plus className="h-5 w-5 mr-2" />
                Add Your First Product
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border-0 bg-white shadow-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
                  <TableRow>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Product Details</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Category & Mfg</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Batch & Expiry</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4 text-center">Stock Info</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Price</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Status</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((product) => (
                    <TableRow
                      key={product.id}
                      className="hover:bg-blue-50 transition-colors"
                    >
                      <TableCell className="py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-lg text-blue-900">{product.name}</span>
                          {product.hsn_code && (
                            <span className="text-sm text-muted-foreground font-mono">HSN: {product.hsn_code}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="flex flex-col">
                          <span className="text-lg">{product.category || '-'}</span>
                          <span className="text-sm text-muted-foreground italic">{product.manufacturer || 'Unknown Mfg'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="flex flex-col">
                          <span className="text-lg font-medium">{product.batch_number || '-'}</span>
                          <span className={cn(
                            "text-sm",
                            (() => {
                              if (!product.expiry_date) return "text-muted-foreground";
                              const today = new Date();
                              const exp = new Date(product.expiry_date);
                              const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                              return diffDays <= 30 ? "text-red-500 font-bold" : "text-muted-foreground";
                            })()
                          )}>
                            Exp: {product.expiry_date ? new Date(product.expiry_date).toLocaleDateString() : '-'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="flex flex-col items-center">
                          <Badge
                            variant={product.quantity === 0 ? "destructive" : product.quantity <= product.low_stock_threshold ? "warning" : "success"}
                            className="text-lg py-1 px-3 mb-1"
                          >
                            {product.quantity} Units
                          </Badge>
                          {product.pcs_per_unit && (
                            <span className="text-xs text-muted-foreground">({product.pcs_per_unit} pcs/strip)</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="flex flex-col">
                          <span className="text-lg font-bold text-green-700">₹{product.selling_price}</span>
                          {product.gst && <span className="text-xs text-muted-foreground">Incl. {product.gst}% GST</span>}
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="flex flex-wrap gap-2">
                          <Badge
                            variant={product.quantity === 0 ? "destructive" : product.quantity <= product.low_stock_threshold ? "warning" : "success"}
                            className="text-sm py-1 px-2 whitespace-nowrap"
                          >
                            {product.quantity === 0 ? "Out of Stock" : product.quantity <= product.low_stock_threshold ? "Low Stock" : "In Stock"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="py-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-10 w-10 p-0 hover:bg-blue-100 rounded-full">
                              <MoreVertical className="h-5 w-5 text-gray-500" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40 p-2">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingProduct(product);
                                setSelectedCategory(product.category || "");
                                setIsDialogOpen(true);
                              }}
                              className="cursor-pointer py-2 focus:bg-blue-50 focus:text-blue-700"
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              Edit Product
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => confirmDelete(product)}
                              className="cursor-pointer py-2 text-red-600 focus:bg-red-50 focus:text-red-700"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete Product
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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