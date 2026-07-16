import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { TableSkeleton } from '@/components/TableSkeleton';
import { Plus, ShoppingCart, Package, Eye, Search, Printer, Download, ChevronDown, ChevronRight, Receipt, MoreVertical, Pencil, X, Lock, Filter } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface Product {
  id: string;
  name: string;
  quantity: number;
  selling_price: number;
  gst: number;
  batch_number?: string | null;
  pcs_per_unit?: number | null;
}

interface Sale {
  id: string;
  bill_id?: string; // Added bill_id
  product_id: string;
  quantity: number;
  sub_qty?: number | null;
  pcs_per_unit?: number | null;
  unit_price: number;
  total_price: number;
  gst_amount: number | null;
  created_at: string;
  sale_date?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  prescription_months?: number | null;
  months_taken?: number | null;
  prescription_notes?: string | null;
  payment_mode?: string | null;
  printed_at?: string | null;
  products: {
    name: string;
  };
} // @ts-ignore

interface GroupedTransaction {
  bill_id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  created_at: string;
  sale_date?: string | null;
  total_amount: number;
  gst_amount: number;
  items: Sale[];
  prescription_notes?: string | null;
  printed_at?: string | null;
}

interface Settings {
  gst_enabled: boolean;
  default_gst_rate: number;
  gst_type?: string;
}

export default function Sales() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Array<{ id: string, quantity: number }>>([]);
  const [currentProduct, setCurrentProduct] = useState('');
  const [currentQuantity, setCurrentQuantity] = useState(1);
  // Customer details state
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [prescriptionMonths, setPrescriptionMonths] = useState<number | ''>('');
  const [monthsTaken, setMonthsTaken] = useState<number | ''>(1);
  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [totalSales, setTotalSales] = useState(0);
  const itemsPerPage = 10;
  const [productSearchTerm, setProductSearchTerm] = useState('');
  // Sales detail modal state
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<GroupedTransaction | null>(null);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);

  // Sales list filtering states
  const [filterPaymentMode, setFilterPaymentMode] = useState('all');
  const [filterDateRange, setFilterDateRange] = useState('all');

  // Edit Sale dialog — full edit: customer info, payment mode, item qty/price/gst, add or remove items
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [editingCreatedAt, setEditingCreatedAt] = useState<string | null>(null);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [editCustomerAddress, setEditCustomerAddress] = useState('');
  const [editPaymentMode, setEditPaymentMode] = useState('cash');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  // Editable cart of items in this sale
  interface EditCartItem {
    lineId: string;          // existing sales.id, or 'new-N' for newly added
    sales_id?: string;       // present for existing rows
    product_id: string;
    product_name: string;
    pcs_per_unit: number;    // strip size — fixed once product is selected
    quantity: number;        // full units
    sub_qty: number;         // loose pcs
    unit_price: number;
    gst_rate: number;
    // snapshot of original values (used to compute stock delta on save)
    original?: { quantity: number; sub_qty: number };
    isNew: boolean;
  }
  const [editCart, setEditCart] = useState<EditCartItem[]>([]);
  const [editProductSearch, setEditProductSearch] = useState('');
  const [showEditProductList, setShowEditProductList] = useState(false);
  const editProductSearchRef = useRef<HTMLDivElement>(null);
  const [productPrices, setProductPrices] = useState<Record<string, number>>({});
  // Custom GST rates for items in cart
  const [customGstRates, setCustomGstRates] = useState<Record<string, number>>({});
  // Discount state
  const [discountPercentage, setDiscountPercentage] = useState<number>(0);
  // Payment mode state
  const [paymentMode, setPaymentMode] = useState<string>('cash');
  // Pcs state (for loose tablet sales)
  const [currentSubQty, setCurrentSubQty] = useState<number | ''>('');
  const [currentPcsPerUnit, setCurrentPcsPerUnit] = useState<number>(10);
  const [subQtyMap, setSubQtyMap] = useState<Record<string, number>>({});
  const [pcsPerUnitMap, setPcsPerUnitMap] = useState<Record<string, number>>({});
  // Loading state for recording sale
  const [isRecordingSales, setIsRecordingSales] = useState(false);

  // Mobile detection
  const isMobile = useIsMobile();

  // Filter products based on search term
  const filteredProducts = useMemo(() => {
    if (!productSearchTerm) return products;

    return products.filter(product =>
      product.name.toLowerCase().includes(productSearchTerm.toLowerCase())
    );
  }, [products, productSearchTerm]);

  const fetchData = async () => {
    try {
      // Fetch products (all products with stock)
      const productsRes = await supabase.from('products').select('id, name, quantity, selling_price, gst').gt('quantity', 0);

      if (productsRes.error) throw productsRes.error;
      setProducts(productsRes.data || []);

      // Fetch sales with pagination
      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      let salesData: Sale[] = [];
      let totalCount = 0;

      const applyFilters = (query: any) => {
        if (filterPaymentMode !== 'all') {
          query = query.eq('payment_mode', filterPaymentMode);
        }
        if (filterDateRange !== 'all') {
          const now = new Date();
          let startDate = new Date();
          if (filterDateRange === 'today') {
            startDate.setHours(0, 0, 0, 0);
            query = query.gte('created_at', startDate.toISOString());
          } else if (filterDateRange === 'yesterday') {
            const yesterday = new Date();
            yesterday.setDate(now.getDate() - 1);
            yesterday.setHours(0, 0, 0, 0);
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            query = query.gte('created_at', yesterday.toISOString()).lt('created_at', todayStart.toISOString());
          } else if (filterDateRange === 'this_week') {
            const day = now.getDay();
            const diff = now.getDate() - day + (day === 0 ? -6 : 1);
            startDate = new Date(now.setDate(diff));
            startDate.setHours(0, 0, 0, 0);
            query = query.gte('created_at', startDate.toISOString());
          } else if (filterDateRange === 'this_month') {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            startDate.setHours(0, 0, 0, 0);
            query = query.gte('created_at', startDate.toISOString());
          }
        }
        return query;
      };

      try {
        // First, try with full columns including printed_at (needs latest migration)
        let query = supabase
          .from('sales')
          .select(`
            id, bill_id, product_id, quantity, sub_qty, pcs_per_unit, unit_price, total_price, gst_amount, created_at, sale_date, printed_at,
            customer_name, customer_phone, customer_address, prescription_months, months_taken, payment_mode,
            products(name)
          `, { count: 'exact' });

        query = applyFilters(query);

        let result = await query
          .order('created_at', { ascending: false })
          .range(from, to);

        // Migration not applied yet → retry without printed_at column
        if (result.error && (result.error.message?.includes('printed_at') || result.error.code === '42703')) {
          let retryQuery = supabase
            .from('sales')
            .select(`
              id, bill_id, product_id, quantity, sub_qty, pcs_per_unit, unit_price, total_price, gst_amount, created_at, sale_date,
              customer_name, customer_phone, customer_address, prescription_months, months_taken, payment_mode,
              products(name)
            `, { count: 'exact' });

          retryQuery = applyFilters(retryQuery);

          result = await retryQuery
            .order('created_at', { ascending: false })
            .range(from, to);
        }

        if (result.error) {
          throw result.error;
        }

        // Use unknown for type assertion to avoid TypeScript errors
        salesData = result.data as unknown as Sale[];
        totalCount = result.count || 0;
      } catch (error: any) {
        // If there's an error (likely due to missing columns), fall back to basic select
        if (error.message && (error.message.includes('customer_name') || error.message.includes('column'))) {
          console.log('Customer fields not found, falling back to basic select');

          let fallbackQuery = supabase
            .from('sales')
            .select(`
              id, bill_id, product_id, quantity, sub_qty, pcs_per_unit, unit_price, total_price, gst_amount, created_at, sale_date, payment_mode,
              products(name)
            `, { count: 'exact' });

          fallbackQuery = applyFilters(fallbackQuery);

          const fallbackRes = await fallbackQuery
            .order('created_at', { ascending: false })
            .range(from, to);

          if (fallbackRes.data) {
            // Transform data to include optional customer fields
            salesData = fallbackRes.data.map(sale => ({
              ...(sale as any),
              customer_name: null,
              customer_phone: null,
              customer_address: null,
              prescription_months: null,
              months_taken: null,
              sale_date: null,
              sub_qty: null,
              pcs_per_unit: null
            })) as unknown as Sale[];
            totalCount = fallbackRes.count || 0;
          }
        } else {
          // For other errors, re-throw
          throw error;
        }
      }

      setSales(salesData);
      setTotalSales(totalCount);

      // Remove duplicate processing of salesRes as it's not defined
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error fetching data",
        description: error.message.includes('customer_name') || error.message.includes('column')
          ? "The database needs to be updated to support customer information. Please ask your administrator to apply the required database migration from the Supabase dashboard."
          : error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentPage, filterPaymentMode, filterDateRange]);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterPaymentMode, filterDateRange]);

  // F2 Shortcut for Record Sale
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        if (isMobile) {
          setIsDialogOpen(true);
        } else {
          navigate('/sales/new');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, navigate]);

  // Add a separate effect to fetch settings when profile changes
  useEffect(() => {
    const fetchSettings = async () => {
      if (!profile?.account_id) return;

      try {
        const settingsRes = await supabase
          .from('settings')
          .select('gst_enabled, default_gst_rate, gst_type')
          .eq('account_id', profile.account_id)
          .single();

        if (!settingsRes.error) {
          setSettings(settingsRes.data as any);
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
      }
    };

    fetchSettings();

    // Subscribe to settings changes
    const settingsSubscription = supabase
      .channel('settings-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'settings',
          filter: `account_id=eq.${profile?.account_id}`
        },
        (payload) => {
          setSettings(payload.new as Settings);
        }
      )
      .subscribe();

    // Cleanup subscription on unmount
    return () => {
      supabase.removeChannel(settingsSubscription);
    };
  }, [profile?.account_id]);

  const handleAddToCart = () => {
    if (!currentProduct) {
      toast({
        variant: "destructive",
        title: "Please select a product",
      });
      return;
    }

    const product = products.find(p => p.id === currentProduct);
    if (!product) {
      toast({
        variant: "destructive",
        title: "Product not found",
      });
      return;
    }

    // Check if a custom price has been set, otherwise use the product's selling price
    const currentPrice = productPrices[currentProduct] || product.selling_price;

    if (currentQuantity > product.quantity) {
      toast({
        variant: "destructive",
        title: "Insufficient stock",
        description: `Only ${product.quantity} units available`,
      });
      return;
    }

    // Check if product already in cart
    const existingIndex = selectedProducts.findIndex(p => p.id === currentProduct);
    if (existingIndex >= 0) {
      // Update quantity if adding more would exceed stock
      const updatedProducts = [...selectedProducts];
      const newQuantity = updatedProducts[existingIndex].quantity + currentQuantity;
      if (newQuantity > product.quantity) {
        toast({
          variant: "destructive",
          title: "Insufficient stock",
          description: `Only ${product.quantity} units available, you already have ${updatedProducts[existingIndex].quantity} in cart`,
        });
        return;
      }
      updatedProducts[existingIndex].quantity = newQuantity;
      setSelectedProducts(updatedProducts);
    } else {
      setSelectedProducts([...selectedProducts, { id: currentProduct, quantity: currentQuantity }]);
    }

    // Save pcs and pcs per unit for this product
    if (currentSubQty !== '' && Number(currentSubQty) > 0) {
      setSubQtyMap(prev => ({ ...prev, [currentProduct]: Number(currentSubQty) }));
      setPcsPerUnitMap(prev => ({ ...prev, [currentProduct]: currentPcsPerUnit }));
    } else {
      setSubQtyMap(prev => { const next = { ...prev }; delete next[currentProduct]; return next; });
      setPcsPerUnitMap(prev => { const next = { ...prev }; delete next[currentProduct]; return next; });
    }

    // Reset current selection
    setCurrentProduct('');
    setCurrentQuantity(1);
    setCurrentSubQty('');
    setCurrentPcsPerUnit(10);
    // Reset search term
    setProductSearchTerm('');
    // Note: We don't reset the custom price here because it's needed for the cart calculation
    // The price will be used when the item is in the cart and will be cleared when the sale is recorded
  };

  const handleRemoveFromCart = (productId: string) => {
    setSelectedProducts(selectedProducts.filter(p => p.id !== productId));
    // Clean up pcs and pcs per unit maps
    setSubQtyMap(prev => { const next = { ...prev }; delete next[productId]; return next; });
    setPcsPerUnitMap(prev => { const next = { ...prev }; delete next[productId]; return next; });
  };

  // Shared pricing math for a cart line — used by both the desktop card view and
  // the mobile spreadsheet table so the two never diverge.
  const computeCartLine = (item: { id: string; quantity: number }) => {
    const product = products.find(p => p.id === item.id);
    if (!product) return null;
    const unitPrice = productPrices[item.id] !== undefined ? productPrices[item.id] : product.selling_price;
    const cartSubQty = subQtyMap[item.id];
    const cartPcsPerUnit = pcsPerUnitMap[item.id] || product.pcs_per_unit || 10;
    let itemSubtotal = unitPrice * item.quantity;
    if (cartSubQty && cartPcsPerUnit) {
      itemSubtotal += (unitPrice / cartPcsPerUnit) * cartSubQty;
    }
    const itemGstRate = customGstRates[item.id] !== undefined ? customGstRates[item.id] : settings?.default_gst_rate || 0;
    let itemGstAmount = 0;
    let itemTotal = 0;
    const isGstInclusive = settings?.gst_type === 'inclusive';
    if (settings?.gst_enabled) {
      itemGstAmount = (itemSubtotal * itemGstRate) / 100;
      itemTotal = isGstInclusive ? itemSubtotal : itemSubtotal + itemGstAmount;
    } else {
      itemTotal = itemSubtotal;
    }
    const isPriceAdjusted = productPrices[item.id] !== undefined && productPrices[item.id] !== product.selling_price;
    const isCustomGst = customGstRates[item.id] !== undefined && customGstRates[item.id] !== (settings?.default_gst_rate || 0);
    const overstock = item.quantity > product.quantity;
    return { product, unitPrice, cartSubQty, cartPcsPerUnit, itemSubtotal, itemGstRate, itemGstAmount, itemTotal, isPriceAdjusted, isCustomGst, overstock };
  };

  const handleUpdateQuantity = (productId: string, newQuantity: number) => {
    if (newQuantity <= 0) return;

    const product = products.find(p => p.id === productId);
    if (!product) return;

    if (newQuantity > product.quantity) {
      toast({
        variant: "destructive",
        title: "Insufficient stock",
        description: `Only ${product.quantity} units available`,
      });
      return;
    }

    setSelectedProducts(selectedProducts.map(p =>
      p.id === productId ? { ...p, quantity: newQuantity } : p
    ));
  };

  const handleSale = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isRecordingSales || selectedProducts.length === 0) {
      if (selectedProducts.length === 0) {
        toast({
          variant: "destructive",
          title: "Please add at least one product to cart",
        });
      }
      return;
    }

    // Pre-flight validation: prevent over-stock, invalid qty, missing product, invalid rate
    for (const item of selectedProducts) {
      const product = products.find(p => p.id === item.id);
      if (!product) {
        toast({
          variant: 'destructive',
          title: 'Unknown product in cart',
          description: 'One of the cart items is no longer available. Remove it and try again.',
        });
        return;
      }
      if (!item.quantity || item.quantity < 1) {
        toast({
          variant: 'destructive',
          title: `${product.name}: invalid quantity`,
          description: 'Quantity must be at least 1.',
        });
        return;
      }
      if (item.quantity > product.quantity) {
        toast({
          variant: 'destructive',
          title: `${product.name}: exceeds stock`,
          description: `Only ${product.quantity} unit${product.quantity === 1 ? '' : 's'} available. Adjust the quantity and try again.`,
        });
        return;
      }
      const rate = productPrices[item.id] !== undefined ? productPrices[item.id] : product.selling_price;
      if (rate < 0) {
        toast({
          variant: 'destructive',
          title: `${product.name}: invalid rate`,
          description: 'Rate cannot be negative.',
        });
        return;
      }
      const subQ = subQtyMap[item.id];
      const pcsPer = pcsPerUnitMap[item.id];
      if (subQ && subQ > 0 && (!pcsPer || pcsPer < 1)) {
        toast({
          variant: 'destructive',
          title: `${product.name}: missing pcs/strip`,
          description: 'Set the pieces-per-strip value next to Pcs.',
        });
        return;
      }
    }

    // Validation for Credit sales
    if (paymentMode === 'credit') {
      if (!customerName.trim() || !customerPhone.trim()) {
        toast({
          variant: 'destructive',
          title: 'Customer Info Required',
          description: 'Name and Phone number are mandatory for credit sales.',
        });
        return;
      }
    }

    setIsRecordingSales(true);

    try {
      // Generate a unique bill ID for this transaction
      const billId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });

      // Fetch the latest settings to ensure we're using current GST settings
      const settingsRes = await supabase
        .from('settings')
        .select('gst_enabled, default_gst_rate, gst_type')
        .eq('account_id', profile?.account_id)
        .single();

      if (settingsRes.error) throw settingsRes.error;
      const currentSettings = settingsRes.data as any;

      // Create sales records for each item in the cart
      const isGstInclusive = currentSettings?.gst_type === 'inclusive';

      let salesToInsert = selectedProducts.map(item => {
        const product = products.find(p => p.id === item.id);
        if (!product) {
          throw new Error(`Product with id ${item.id} not found`);
        }

        // Use custom price if set, otherwise use product's selling price
        const unitPrice = productPrices[item.id] || product.selling_price;
        // 1st: Amount = (full strips × rate) + (loose tablets × per-tablet rate)
        const itemSubQty = subQtyMap[item.id];
        const itemPcsPerUnit = pcsPerUnitMap[item.id];
        let grossAmount = unitPrice * item.quantity;
        if (itemSubQty && itemPcsPerUnit) {
          grossAmount += (unitPrice / itemPcsPerUnit) * itemSubQty;
        }

        // 2nd: Deduct discount
        const discountAmount = (grossAmount * discountPercentage) / 100;
        const netAmount = grossAmount - discountAmount;

        // 3rd: Calculation of GST
        // Use custom GST rate if set, otherwise use default from settings
        const itemGstRate = customGstRates[item.id] !== undefined ? customGstRates[item.id] : currentSettings?.default_gst_rate || 0;

        let finalGstAmount = 0;
        let finalTotalPrice = 0;

        if (currentSettings?.gst_enabled) {
          if (isGstInclusive) {
            finalGstAmount = (netAmount * itemGstRate) / 100;
            finalTotalPrice = netAmount;
          } else {
            finalGstAmount = (netAmount * itemGstRate) / 100;
            finalTotalPrice = netAmount + finalGstAmount;
          }
        } else {
          finalTotalPrice = netAmount;
          finalGstAmount = 0;
        }

        const totalPriceRounded = Math.round(finalTotalPrice);
        const isSettled = paymentMode !== 'credit';

        return {
          account_id: profile?.account_id,
          bill_id: billId,
          product_id: item.id,
          user_id: profile?.id,
          quantity: item.quantity,
          sub_qty: subQtyMap[item.id] || null,
          pcs_per_unit: pcsPerUnitMap[item.id] || null,
          unit_price: Math.round(unitPrice * 100) / 100,
          total_price: totalPriceRounded,
          gst_amount: Math.round(finalGstAmount * 100) / 100,
          payment_mode: paymentMode,
          customer_name: customerName || "Walk-in Customer",
          customer_phone: customerPhone || null,
          customer_address: customerAddress || null,
          prescription_months: prescriptionMonths === '' ? null : Number(prescriptionMonths),
          months_taken: monthsTaken === '' ? null : Number(monthsTaken),
          discount_percentage: discountPercentage,
          received_amount: isSettled ? totalPriceRounded : 0,
          is_settled: isSettled,
        };
      });

      let { error } = await supabase.from('sales').insert(salesToInsert);

      // If there's an error due to missing columns, try again without those fields
      if (error && error.message && error.message.includes('column')) {
        console.log('Missing column detected, trying without optional fields');
        const fallbackSalesToInsert = salesToInsert.map(sale => {
          const { customer_name, customer_phone, customer_address, prescription_months, months_taken, payment_mode, sub_qty, pcs_per_unit, ...rest } = sale;
          return rest;
        });

        const fallbackResult = await supabase.from('sales').insert(fallbackSalesToInsert);
        error = fallbackResult.error;

        if (error) {
          throw new Error("The database needs to be updated. Please run the required migrations in Supabase.");
        } else {
          navigate(`/print-bill/${billId}`);
        }
      } else if (error) {
        throw error;
      } else {
        // Direct navigation to print bill instead of showing toast
        navigate(`/print-bill/${billId}`);
      }

      setIsDialogOpen(false);
      setSelectedProducts([]);
      setCurrentProduct('');
      setCurrentQuantity(1);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerAddress('');
      setPrescriptionMonths('');
      setMonthsTaken(1);
      setDiscountPercentage(0);
      setProductPrices({});
      setCustomGstRates({});
      setPaymentMode('cash');
      setSubQtyMap({});
      setPcsPerUnitMap({});
      setCurrentSubQty('');
      setCurrentPcsPerUnit(10);
      fetchData();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error recording sale",
        description: error.message,
      });
    } finally {
      setIsRecordingSales(false);
    }
  };

  // Calculate pagination values
  const totalPages = Math.ceil(totalSales / itemsPerPage);

  // Memoize calculated values
  // Calculate totals for all selected products (updated to use custom prices and custom GST rates)
  const orderTotals = useMemo(() => {
    const isGstInclusive = settings?.gst_type === 'inclusive';
    let subtotal = 0; // The sum of (Price * Qty)
    let totalGstAmount = 0;
    let grandTotal = 0;

    selectedProducts.forEach(item => {
      const product = products.find(p => p.id === item.id);
      if (product) {
        // Use custom price if set, otherwise use product's selling price
        const unitPrice = productPrices[item.id] || product.selling_price;
        const itemSubQty = subQtyMap[item.id];
        const itemPcsPerUnit = pcsPerUnitMap[item.id];
        let grossAmount = unitPrice * item.quantity;
        if (itemSubQty && itemPcsPerUnit) {
          grossAmount += (unitPrice / itemPcsPerUnit) * itemSubQty;
        }

        // Accumulate subtotal (Gross)
        subtotal += grossAmount;

        // Calculate Discount for this line
        const discountAmount = (grossAmount * discountPercentage) / 100;
        const netAmount = grossAmount - discountAmount;

        // Calculate GST for this line
        const itemGstRate = customGstRates[item.id] !== undefined ? customGstRates[item.id] : settings?.default_gst_rate || 0;
        let itemGstVal = 0;
        let itemTotalVal = 0;

        if (settings?.gst_enabled) {
          if (isGstInclusive) {
            // Inclusive: User requested calculation is Net Amount * Rate / 100
            itemGstVal = (netAmount * itemGstRate) / 100;
            itemTotalVal = netAmount;
          } else {
            // Net Amount is Base, add GST
            itemGstVal = (netAmount * itemGstRate) / 100;
            itemTotalVal = netAmount + itemGstVal;
          }
        } else {
          itemTotalVal = netAmount;
        }

        totalGstAmount += itemGstVal;
        grandTotal += itemTotalVal;
      }
    });

    const totalDiscountAmount = (subtotal * discountPercentage) / 100;
    // Note: grandTotal already has discount deducted in the loop

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      discountAmount: Math.round(totalDiscountAmount * 100) / 100,
      // discountedSubtotal is just informational now, usually Subtotal - Discount
      discountedSubtotal: Math.round((subtotal - totalDiscountAmount) * 100) / 100,
      gstAmount: Math.round(totalGstAmount * 100) / 100,
      grandTotal: Math.round(grandTotal) // Round to nearest whole number
    };
  }, [selectedProducts, products, productPrices, customGstRates, settings, discountPercentage, subQtyMap, pcsPerUnitMap]);

  // Handle page change
  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      setLoading(true);
    }
  };

  // Group sales by bill_id
  const groupedSales = useMemo(() => {
    const groups: Record<string, GroupedTransaction> = {};
    sales.forEach(sale => {
      // Use bill_id, fallback to id for old records
      const key = sale.bill_id || sale.id; 
      
      if (!groups[key]) {
        groups[key] = {
          bill_id: key,
          customer_name: sale.customer_name || 'Walk-in Customer',
          customer_phone: sale.customer_phone || '-',
          customer_address: sale.customer_address || '',
          created_at: sale.created_at,
          sale_date: sale.sale_date,
          total_amount: 0,
          gst_amount: 0,
          items: []
        };
      }
      
      groups[key].items.push(sale);
      groups[key].total_amount += sale.total_price;
      groups[key].gst_amount += (sale.gst_amount || 0);
      // Propagate printed_at (any item printed → bill is locked)
      if (sale.printed_at && !groups[key].printed_at) {
        groups[key].printed_at = sale.printed_at;
      }
    });
    
    // Sort by latest created_at
    return Object.values(groups).sort((a, b) => {
      const aDate = new Date(a.sale_date || a.created_at).getTime();
      const bDate = new Date(b.sale_date || b.created_at).getTime();
      return bDate - aDate;
    });
  }, [sales]);

  const toggleExpand = (billId: string) => {
    setExpandedBillId(prev => (prev === billId ? null : billId));
  };

  // Function to show sale details in modal
  const showSaleDetails = (transaction: GroupedTransaction) => {
    setSelectedTransaction(transaction);
    setIsDetailModalOpen(true);
  };

  // ── Edit-lock policy ───────────────────────────────────────
  // A sale becomes locked (no further edits) when:
  //   1. It has been printed (printed_at IS NOT NULL on any of its rows), OR
  //   2. It is older than EDIT_WINDOW_MINUTES from creation
  const EDIT_WINDOW_MINUTES = 30;

  type LockReason = null | 'printed' | 'expired';
  const getLockReason = (group: GroupedTransaction): LockReason => {
    if (group.items.some(it => !!it.printed_at) || !!group.printed_at) return 'printed';
    const ageMin = (Date.now() - new Date(group.created_at).getTime()) / 60000;
    if (ageMin > EDIT_WINDOW_MINUTES) return 'expired';
    return null;
  };
  const lockReasonText = (r: LockReason): string => {
    if (r === 'printed') return 'Locked — bill has been printed';
    if (r === 'expired') return `Locked — older than ${EDIT_WINDOW_MINUTES} min`;
    return '';
  };

  // Stamp `printed_at` for every row of a bill, then navigate to the print preview.
  // The migration adds the column; if it isn't applied yet, the update silently fails
  // and the lock won't take effect until then.
  const handlePrintBill = async (billId: string) => {
    try {
      await (supabase as any)
        .from('sales')
        .update({ printed_at: new Date().toISOString() })
        .eq('bill_id', billId)
        .is('printed_at', null);
    } catch {
      // ignore — column may not exist yet
    }
    navigate(`/print-bill/${billId}`);
  };

  // Open edit dialog for a recorded sale — full edit (items + customer + payment)
  const openEditSale = (group: GroupedTransaction) => {
    const reason = getLockReason(group);
    if (reason) {
      toast({
        variant: 'destructive',
        title: lockReasonText(reason),
        description: 'Edits are disabled to keep the printed bill and customer records consistent.',
      });
      return;
    }
    setEditingBillId(group.bill_id);
    setEditingCreatedAt(group.created_at);
    setEditCustomerName(group.customer_name || '');
    setEditCustomerPhone(group.customer_phone || '');
    setEditCustomerAddress(group.customer_address || '');
    setEditPaymentMode(group.items[0]?.payment_mode || 'cash');
    setEditProductSearch('');
    setShowEditProductList(false);
    setEditCart(group.items.map(it => {
      const pcs = it.pcs_per_unit ?? 1;
      const qty = Number(it.quantity) || 0;
      const sub = Number(it.sub_qty || 0);
      const lineTotal = Number(it.total_price) || 0;
      const gstAmt = Number(it.gst_amount) || 0;
      // back-out the GST rate from gst_amount and net (before-GST) total
      const baseTotal = lineTotal - gstAmt;
      const gstRate = baseTotal > 0 ? Math.round((gstAmt / baseTotal) * 100) : 0;
      // back-out unit_price stored on row, fall back to net/effective-units
      const effectiveUnits = qty + (sub > 0 && pcs > 0 ? sub / pcs : 0);
      const unitPrice = Number(it.unit_price)
        || (effectiveUnits > 0 ? baseTotal / effectiveUnits : 0);
      return {
        lineId: it.id,
        sales_id: it.id,
        product_id: it.product_id,
        product_name: it.products?.name || 'Unknown',
        pcs_per_unit: pcs,
        quantity: qty,
        sub_qty: sub,
        unit_price: unitPrice,
        gst_rate: gstRate,
        original: { quantity: qty, sub_qty: sub },
        isNew: false,
      };
    }));
    setIsEditOpen(true);
  };

  // ── Cart helpers ────────────────────────────────────────────
  const updateEditCartItem = (lineId: string, patch: Partial<EditCartItem>) => {
    setEditCart(prev => prev.map(it => it.lineId === lineId ? { ...it, ...patch } : it));
  };
  const removeEditCartItem = (lineId: string) => {
    setEditCart(prev => prev.filter(it => it.lineId !== lineId));
  };
  const addEditCartItem = (p: Product) => {
    // If already in cart, just bump qty
    const existing = editCart.find(it => it.product_id === p.id);
    if (existing) {
      updateEditCartItem(existing.lineId, { quantity: existing.quantity + 1 });
    } else {
      const lineId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setEditCart(prev => [...prev, {
        lineId,
        product_id: p.id,
        product_name: p.name,
        pcs_per_unit: p.pcs_per_unit ?? 1,
        quantity: 1,
        sub_qty: 0,
        unit_price: Number(p.selling_price) || 0,
        gst_rate: Number(p.gst) || 0,
        isNew: true,
      }]);
    }
    setEditProductSearch('');
    setShowEditProductList(false);
  };

  // Available stock for a cart item (current stock + already-deducted from this sale)
  const availableStockFor = (item: EditCartItem) => {
    const product = products.find(p => p.id === item.product_id);
    const currentStock = product?.quantity ?? 0;
    if (item.isNew) return currentStock;
    const orig = item.original;
    if (!orig) return currentStock;
    return currentStock + orig.quantity + (orig.sub_qty > 0 && item.pcs_per_unit > 0 ? orig.sub_qty / item.pcs_per_unit : 0);
  };

  // Effective units consumed (qty + sub_qty / pcs_per_unit)
  const effUnits = (qty: number, sub: number, pcs: number) =>
    qty + (sub > 0 && pcs > 0 ? sub / pcs : 0);

  // Live totals for the edit cart
  const editCartTotals = useMemo(() => {
    let net = 0; let gst = 0;
    for (const it of editCart) {
      const units = effUnits(it.quantity, it.sub_qty, it.pcs_per_unit);
      const lineNet = units * it.unit_price;
      net += lineNet;
      gst += lineNet * (it.gst_rate / 100);
    }
    return { net, gst, total: net + gst };
  }, [editCart]);

  // Outside-click handler for the edit-cart product search
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (editProductSearchRef.current && !editProductSearchRef.current.contains(e.target as Node)) {
        setShowEditProductList(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const editFilteredProducts = useMemo(() => {
    if (!editProductSearch.trim()) return products.slice(0, 50);
    const q = editProductSearch.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q)).slice(0, 50);
  }, [products, editProductSearch]);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBillId || isSavingEdit) return;

    if (editCart.length === 0) {
      toast({ variant: 'destructive', title: 'Cart is empty', description: 'Add at least one item or cancel the edit.' });
      return;
    }
    if (editPaymentMode === 'credit' && (!editCustomerName.trim() || !editCustomerPhone.trim())) {
      toast({
        variant: 'destructive',
        title: 'Customer info required for credit',
        description: 'Name and phone are mandatory when payment mode is Credit / Dues.',
      });
      return;
    }

    // Validate stock for every cart line
    for (const it of editCart) {
      const newUnits = effUnits(it.quantity, it.sub_qty, it.pcs_per_unit);
      if (newUnits <= 0) {
        toast({ variant: 'destructive', title: 'Invalid quantity', description: `${it.product_name}: qty must be > 0.` });
        return;
      }
      const avail = availableStockFor(it);
      if (newUnits > avail + 0.0001) {
        toast({
          variant: 'destructive',
          title: 'Not enough stock',
          description: `${it.product_name}: need ${newUnits.toFixed(2)} units, only ${avail.toFixed(2)} available.`,
        });
        return;
      }
    }

    setIsSavingEdit(true);
    try {
      // Identify rows to delete (originally in sale, now removed from cart)
      const cartLineIds = new Set(editCart.filter(it => !it.isNew).map(it => it.sales_id));
      const removedItems: any[] = [];
      const { data: originalRows, error: fetchOrigErr } = await (supabase as any)
        .from('sales')
        .select('id, product_id, quantity, sub_qty, pcs_per_unit')
        .eq('bill_id', editingBillId);
      if (fetchOrigErr) throw fetchOrigErr;
      for (const row of (originalRows ?? [])) {
        if (!cartLineIds.has(row.id)) removedItems.push(row);
      }

      const customerPayload = {
        customer_name: editCustomerName.trim() || 'Walk-in Customer',
        customer_phone: editCustomerPhone.trim() || null,
        customer_address: editCustomerAddress.trim() || null,
        payment_mode: editPaymentMode,
      };

      // 1. Restore stock + delete removed items
      for (const row of removedItems) {
        const restored = effUnits(Number(row.quantity) || 0, Number(row.sub_qty) || 0, Number(row.pcs_per_unit) || 1);
        const product = products.find(p => p.id === row.product_id);
        if (product) {
          const newStock = (product.quantity || 0) + restored;
          await (supabase as any).from('products').update({ quantity: Math.round(newStock) }).eq('id', row.product_id);
        }
        await (supabase as any).from('sales').delete().eq('id', row.id);
      }

      // 2. Update existing items + adjust stock by delta
      for (const it of editCart) {
        if (it.isNew) continue;
        const newUnits = effUnits(it.quantity, it.sub_qty, it.pcs_per_unit);
        const oldUnits = effUnits(it.original?.quantity ?? 0, it.original?.sub_qty ?? 0, it.pcs_per_unit);
        const delta = newUnits - oldUnits; // positive => deduct more from stock
        const product = products.find(p => p.id === it.product_id);
        if (Math.abs(delta) > 0.0001 && product) {
          const newStock = (product.quantity || 0) - delta;
          await (supabase as any).from('products').update({ quantity: Math.round(newStock) }).eq('id', it.product_id);
        }

        const baseTotal = newUnits * it.unit_price;
        const gstAmount = baseTotal * (it.gst_rate / 100);
        const totalPrice = baseTotal + gstAmount;
        await (supabase as any).from('sales')
          .update({
            quantity: it.quantity,
            sub_qty: it.sub_qty || null,
            pcs_per_unit: it.pcs_per_unit,
            unit_price: it.unit_price,
            gst_amount: gstAmount,
            total_price: totalPrice,
            ...customerPayload,
          })
          .eq('id', it.sales_id);
      }

      // 3. Insert newly added items + deduct stock
      const newRows: any[] = [];
      for (const it of editCart) {
        if (!it.isNew) continue;
        const units = effUnits(it.quantity, it.sub_qty, it.pcs_per_unit);
        const baseTotal = units * it.unit_price;
        const gstAmount = baseTotal * (it.gst_rate / 100);
        const totalPrice = baseTotal + gstAmount;
        const product = products.find(p => p.id === it.product_id);
        if (product) {
          const newStock = (product.quantity || 0) - units;
          await (supabase as any).from('products').update({ quantity: Math.round(newStock) }).eq('id', it.product_id);
        }
        newRows.push({
          account_id: profile?.account_id,
          bill_id: editingBillId,
          product_id: it.product_id,
          quantity: it.quantity,
          sub_qty: it.sub_qty || null,
          pcs_per_unit: it.pcs_per_unit,
          unit_price: it.unit_price,
          total_price: totalPrice,
          gst_amount: gstAmount,
          sale_date: editingCreatedAt ? editingCreatedAt.split('T')[0] : new Date().toISOString().split('T')[0],
          ...customerPayload,
        });
      }
      if (newRows.length > 0) {
        const { error: insErr } = await (supabase as any).from('sales').insert(newRows);
        if (insErr) throw insErr;
      }

      // 4. Apply customer/payment-mode change to any rows we didn't touch (e.g. unchanged ones already updated)
      // (UPDATE on existing rows already applied customer fields. New inserts also applied them. Done.)

      toast({ title: 'Sale updated', description: `${editCart.length} item(s) saved.` });
      setIsEditOpen(false);
      setEditingBillId(null);
      setEditCart([]);
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error updating sale', description: err.message });
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Function to download sale details as text
  const downloadSaleDetails = (transaction?: GroupedTransaction) => {
    const targetTransaction = transaction || selectedTransaction;
    if (!targetTransaction) return;

    const saleDate = new Date(targetTransaction.sale_date || targetTransaction.created_at).toLocaleString();
    const customerName = targetTransaction.customer_name || "Walk-in Customer";
    const customerPhone = targetTransaction.customer_phone || "Not provided";

    let itemsStr = targetTransaction.items.map(item => 
      `- ${item.products?.name}: ${item.quantity} ${item.sub_qty ? `(+${item.sub_qty} pcs)` : ''} x ₹${item.unit_price} = ₹${item.total_price}`
    ).join('\n');

    const content = `
SALE RECEIPT
====================
Date: ${saleDate}

ITEMS:
${itemsStr}

====================
GST Amount: ₹${(targetTransaction.gst_amount || 0).toFixed(2)}
Total Amount: ₹${targetTransaction.total_amount.toFixed(2)}

CUSTOMER DETAILS
====================
Name: ${customerName}
Phone: ${customerPhone}

Thank you for your purchase!
    `.trim();

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sale-receipt-${targetTransaction.bill_id}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-green-600 to-teal-600 bg-clip-text text-transparent">
            Sales Management
          </h1>
          <p className="text-muted-foreground text-lg mt-2">
            Record and manage sales transactions
          </p>
        </div>
        {/* Desktop: Navigate to full-page billing. Mobile: Open dialog */}
        {isMobile ? (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button
                className="text-lg py-3 px-6 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 gap-3"
                onClick={async () => {
                  if (profile?.account_id) {
                    try {
                      const settingsRes = await supabase
                        .from('settings')
                        .select('gst_enabled, default_gst_rate, gst_type')
                        .eq('account_id', profile.account_id)
                        .single();
                      if (!settingsRes.error) {
                        setSettings(settingsRes.data as any);
                      }
                    } catch (error) {
                      console.error('Error refreshing settings:', error);
                    }
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  <span>Record Sale</span>
                </div>
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded border border-white/30 opacity-90 hidden sm:inline-block">F2</span>
              </Button>
            </DialogTrigger>
          <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
            <DialogHeader className="pr-8 space-y-1">
              <DialogTitle className="text-lg sm:text-xl">Record New Sale</DialogTitle>
              <DialogDescription className="text-sm">
                Select a product and quantity to record the sale.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSale} className="space-y-4 sm:space-y-6">
              {/* Top: persistent product search — adds to cart on click (no separate "Add Product" form) */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold flex items-center gap-2">
                  <Search className="h-3.5 w-3.5" />
                  Add medicines to this sale
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4 pointer-events-none" />
                  <Input
                    placeholder="Search by name to add..."
                    value={productSearchTerm}
                    onChange={(e) => setProductSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {productSearchTerm && (
                  <div className="border rounded-md bg-white max-h-48 overflow-y-auto shadow-sm">
                    {filteredProducts.length > 0 ? (
                      filteredProducts.map((product) => {
                        const alreadyInCart = selectedProducts.some(p => p.id === product.id);
                        const outOfStock = product.quantity < 1;
                        return (
                          <button
                            type="button"
                            key={product.id}
                            disabled={outOfStock}
                            className={cn(
                              "w-full text-left py-2 px-3 flex items-center justify-between gap-2 border-b last:border-b-0 transition-colors",
                              outOfStock ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-50",
                              alreadyInCart && "bg-blue-50/50"
                            )}
                            onClick={() => {
                              if (outOfStock) return;
                              if (alreadyInCart) {
                                // Already in cart — just clear search and let user edit it inline
                                setProductSearchTerm('');
                                return;
                              }
                              setSelectedProducts(prev => [...prev, { id: product.id, quantity: 1 }]);
                              setProductSearchTerm('');
                            }}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">{product.name}</div>
                              {product.batch_number && (
                                <div className="text-[11px] text-muted-foreground">Batch {product.batch_number}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={cn("text-xs", outOfStock ? "text-red-600 font-medium" : "text-muted-foreground")}>
                                Stock: {product.quantity}
                              </span>
                              {alreadyInCart && (
                                <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                                  In cart
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="py-4 text-center text-muted-foreground text-sm">
                        No products found
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Cart Items — each item is fully inline-editable (Qty, Pcs, Rate, GST%) */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <Label className="text-sm font-semibold">
                    Items {selectedProducts.length > 0 && (
                      <span className="text-xs font-normal text-muted-foreground">({selectedProducts.length})</span>
                    )}
                  </Label>
                  {selectedProducts.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedProducts([]);
                        setCurrentProduct('');
                        setCurrentQuantity(1);
                        setProductPrices({});
                        setCustomGstRates({});
                        setDiscountPercentage(0);
                        setSubQtyMap({});
                        setPcsPerUnitMap({});
                        setCurrentSubQty('');
                        setCurrentPcsPerUnit(10);
                      }}
                      className="h-8 text-xs"
                    >
                      Clear all
                    </Button>
                  )}
                </div>

                {selectedProducts.length === 0 ? (
                  <div className="text-center py-10 border border-dashed rounded-lg text-muted-foreground">
                    <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm font-medium">No medicines added yet</p>
                    <p className="text-xs mt-0.5">Search above to add the first item.</p>
                  </div>
                ) : (
                  <>
                  {/* Laptop / tablet: inline-editable cards */}
                  <div className="hidden md:block space-y-2 max-h-[420px] overflow-y-auto pr-0.5">
                    {selectedProducts.map((item) => {
                      const product = products.find(p => p.id === item.id);
                      if (!product) return null;

                      const unitPrice = productPrices[item.id] !== undefined ? productPrices[item.id] : product.selling_price;
                      const cartSubQty = subQtyMap[item.id];
                      const cartPcsPerUnit = pcsPerUnitMap[item.id] || product.pcs_per_unit || 10;
                      let itemSubtotal = unitPrice * item.quantity;
                      if (cartSubQty && cartPcsPerUnit) {
                        itemSubtotal += (unitPrice / cartPcsPerUnit) * cartSubQty;
                      }

                      const itemGstRate = customGstRates[item.id] !== undefined ? customGstRates[item.id] : settings?.default_gst_rate || 0;

                      let itemGstAmount = 0;
                      let itemTotal = 0;
                      const isGstInclusive = settings?.gst_type === 'inclusive';

                      if (settings?.gst_enabled) {
                        if (isGstInclusive) {
                          itemGstAmount = (itemSubtotal * itemGstRate) / 100;
                          itemTotal = itemSubtotal;
                        } else {
                          itemGstAmount = (itemSubtotal * itemGstRate) / 100;
                          itemTotal = itemSubtotal + itemGstAmount;
                        }
                      } else {
                        itemTotal = itemSubtotal;
                      }

                      const isPriceAdjusted = productPrices[item.id] !== undefined && productPrices[item.id] !== product.selling_price;
                      const isCustomGst = customGstRates[item.id] !== undefined && customGstRates[item.id] !== (settings?.default_gst_rate || 0);
                      const overstock = item.quantity > product.quantity;

                      return (
                        <div
                          key={item.id}
                          className={cn(
                            "bg-white rounded-md border transition-colors",
                            overstock ? "border-red-300" : "border-gray-200 hover:border-blue-300 hover:shadow-sm"
                          )}
                        >
                          <div className="flex flex-wrap items-end gap-x-2 gap-y-1.5 px-2.5 py-2">
                            {/* Identity block — full width on mobile, ~36% on tablet+ */}
                            <div className="flex items-start gap-2 min-w-0 basis-full md:basis-auto md:flex-1 md:min-w-[180px] md:max-w-[40%]">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-gray-900 truncate leading-tight">{product.name}</div>
                                <div className="text-[10px] flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5">
                                  <span className={cn("font-medium", overstock ? "text-red-600" : "text-emerald-600")}>
                                    Stk: {product.quantity}
                                  </span>
                                  {overstock && <span className="text-red-600 font-semibold">· exceeds!</span>}
                                  {isPriceAdjusted && <span className="text-blue-600 font-semibold">· ADJ</span>}
                                  {isCustomGst && <span className="text-blue-600 font-semibold">· CUST GST</span>}
                                </div>
                              </div>
                              {/* Mobile-only remove (desktop has it on the right) */}
                              <button
                                type="button"
                                onClick={() => handleRemoveFromCart(item.id)}
                                className="md:hidden h-7 w-7 -mt-0.5 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                title="Remove"
                                aria-label="Remove from cart"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>

                            {/* Editable inputs — labelled stacks, fit in one line on tablet+, wrap below name on mobile */}
                            <div className="flex flex-col">
                              <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-medium leading-none mb-0.5">Qty</span>
                              <Input
                                type="number"
                                inputMode="numeric"
                                min="1"
                                max={product.quantity}
                                value={item.quantity}
                                onChange={(e) => {
                                  const raw = parseInt(e.target.value) || 1;
                                  // Clamp to [1, product.quantity] so user can't accidentally save an impossible qty
                                  const q = Math.max(1, Math.min(product.quantity, raw));
                                  setSelectedProducts(prev => prev.map(p =>
                                    p.id === item.id ? { ...p, quantity: q } : p
                                  ));
                                }}
                                className="h-8 w-14 text-sm px-1 text-center font-medium"
                              />
                            </div>

                            <div className="flex flex-col">
                              <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-medium leading-none mb-0.5">Pcs</span>
                              <div className="flex items-center gap-0.5">
                                <Input
                                  type="number"
                                  inputMode="numeric"
                                  min="0"
                                  value={cartSubQty ?? ''}
                                  onChange={(e) => {
                                    const v = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0);
                                    if (v <= 0) {
                                      setSubQtyMap(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                                      setPcsPerUnitMap(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                                    } else {
                                      setSubQtyMap(prev => ({ ...prev, [item.id]: v }));
                                      if (!pcsPerUnitMap[item.id]) {
                                        setPcsPerUnitMap(prev => ({ ...prev, [item.id]: product.pcs_per_unit || 10 }));
                                      }
                                    }
                                  }}
                                  placeholder="—"
                                  className="h-8 w-12 text-sm px-1 text-center font-medium"
                                />
                                {cartSubQty ? (
                                  <>
                                    <span className="text-muted-foreground text-xs leading-none">/</span>
                                    <Input
                                      type="number"
                                      inputMode="numeric"
                                      min="1"
                                      value={cartPcsPerUnit}
                                      onChange={(e) => {
                                        const v = Math.max(1, parseInt(e.target.value) || 10);
                                        setPcsPerUnitMap(prev => ({ ...prev, [item.id]: v }));
                                      }}
                                      className="h-8 w-10 text-sm px-1 text-center font-medium"
                                      title="Pieces per strip"
                                    />
                                  </>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex flex-col">
                              <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-medium leading-none mb-0.5">Rate ₹</span>
                              <Input
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                min="0"
                                value={unitPrice}
                                onChange={(e) => {
                                  const v = Math.max(0, parseFloat(e.target.value) || 0);
                                  setProductPrices(prev => ({ ...prev, [item.id]: v }));
                                }}
                                className="h-8 w-16 text-sm px-1 text-right font-medium"
                              />
                            </div>

                            {settings?.gst_enabled && (
                              <div className="flex flex-col">
                                <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-medium leading-none mb-0.5">GST %</span>
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.01"
                                  min="0"
                                  value={itemGstRate}
                                  onChange={(e) => {
                                    const newRate = Math.max(0, parseFloat(e.target.value) || 0);
                                    setCustomGstRates(prev => ({ ...prev, [item.id]: newRate }));
                                  }}
                                  className="h-8 w-12 text-sm px-1 text-center font-medium"
                                />
                              </div>
                            )}

                            {/* Total + (optional) GST sub-line + desktop remove — pushed to the far right */}
                            <div className="ml-auto flex items-center gap-2">
                              <div className="text-right leading-tight">
                                <div className="text-sm sm:text-base font-bold text-emerald-700">₹{itemTotal.toFixed(2)}</div>
                                {settings?.gst_enabled && itemGstAmount > 0 && (
                                  <div className="text-[10px] text-muted-foreground leading-none mt-0.5">incl ₹{itemGstAmount.toFixed(2)} GST</div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveFromCart(item.id)}
                                className="hidden md:inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                title="Remove"
                                aria-label="Remove from cart"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Mobile: spreadsheet-style billing table (ref: classic billing software).
                      Columns mirror the laptop line: Product · Batch · Qty · Pcs · Rate · Amount.
                      Horizontally scrollable so the dense grid never crushes on small screens. */}
                  <div className="md:hidden -mx-1 overflow-x-auto rounded-md border border-slate-300 max-h-[420px] overflow-y-auto">
                    <table className="w-full min-w-[540px] border-collapse text-xs">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-sky-100 text-slate-700">
                          <th className="text-left font-semibold uppercase tracking-wide px-2 py-1.5 border-b border-r border-slate-300">Product</th>
                          <th className="text-left font-semibold uppercase tracking-wide px-1.5 py-1.5 border-b border-r border-slate-300 w-[52px]">Batch</th>
                          <th className="text-center font-semibold uppercase tracking-wide px-1 py-1.5 border-b border-r border-slate-300 w-[52px]">Qty</th>
                          <th className="text-center font-semibold uppercase tracking-wide px-1 py-1.5 border-b border-r border-slate-300 w-[70px]">Pcs</th>
                          <th className="text-right font-semibold uppercase tracking-wide px-1 py-1.5 border-b border-r border-slate-300 w-[60px]">Rate</th>
                          <th className="text-right font-semibold uppercase tracking-wide px-1.5 py-1.5 border-b border-r border-slate-300 w-[64px]">Amount</th>
                          <th className="w-7 border-b border-slate-300" aria-label="Remove" />
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProducts.map((item) => {
                          const line = computeCartLine(item);
                          if (!line) return null;
                          const { product, unitPrice, cartSubQty, cartPcsPerUnit, itemGstAmount, itemTotal, isPriceAdjusted, isCustomGst, overstock } = line;
                          return (
                            <tr
                              key={item.id}
                              className={cn(
                                "border-b border-slate-200 last:border-b-0",
                                overstock ? "bg-red-50" : "bg-white even:bg-slate-50/60"
                              )}
                            >
                              {/* Product */}
                              <td className="px-2 py-1 border-r border-slate-200 align-top">
                                <div className="font-semibold text-slate-900 leading-snug break-words">{product.name}</div>
                                <div className="text-[10px] leading-none mt-0.5 flex flex-wrap items-center gap-x-1">
                                  <span className={cn("font-medium", overstock ? "text-red-600" : "text-emerald-600")}>Stk {product.quantity}</span>
                                  {overstock && <span className="text-red-600 font-semibold">· exceeds!</span>}
                                  {isPriceAdjusted && <span className="text-blue-600 font-semibold">· ADJ</span>}
                                  {isCustomGst && <span className="text-blue-600 font-semibold">· GST*</span>}
                                </div>
                              </td>
                              {/* Batch */}
                              <td className="px-1.5 py-1 border-r border-slate-200 align-middle text-slate-600 break-words">
                                {product.batch_number || '—'}
                              </td>
                              {/* Qty (strips) */}
                              <td className="px-0.5 py-1 border-r border-slate-200 align-middle">
                                <Input
                                  type="number"
                                  inputMode="numeric"
                                  min="1"
                                  max={product.quantity}
                                  value={item.quantity}
                                  onChange={(e) => {
                                    const raw = parseInt(e.target.value) || 1;
                                    const q = Math.max(1, Math.min(product.quantity, raw));
                                    setSelectedProducts(prev => prev.map(p => p.id === item.id ? { ...p, quantity: q } : p));
                                  }}
                                  className="h-7 w-full text-xs px-0.5 text-center font-medium border-0 bg-transparent rounded-none focus-visible:ring-1 focus-visible:ring-inset"
                                />
                              </td>
                              {/* Pcs (loose) */}
                              <td className="px-0.5 py-1 border-r border-slate-200 align-middle">
                                <div className="flex items-center justify-center gap-0.5">
                                  <Input
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    value={cartSubQty ?? ''}
                                    onChange={(e) => {
                                      const v = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0);
                                      if (v <= 0) {
                                        setSubQtyMap(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                                        setPcsPerUnitMap(prev => { const n = { ...prev }; delete n[item.id]; return n; });
                                      } else {
                                        setSubQtyMap(prev => ({ ...prev, [item.id]: v }));
                                        if (!pcsPerUnitMap[item.id]) {
                                          setPcsPerUnitMap(prev => ({ ...prev, [item.id]: product.pcs_per_unit || 10 }));
                                        }
                                      }
                                    }}
                                    placeholder="—"
                                    className="h-7 w-9 text-xs px-0.5 text-center font-medium border-0 bg-transparent rounded-none focus-visible:ring-1 focus-visible:ring-inset"
                                  />
                                  {cartSubQty ? (
                                    <span className="text-[10px] text-slate-400 leading-none whitespace-nowrap">/{cartPcsPerUnit}</span>
                                  ) : null}
                                </div>
                              </td>
                              {/* Rate (M.R.P.) */}
                              <td className="px-0.5 py-1 border-r border-slate-200 align-middle">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.01"
                                  min="0"
                                  value={unitPrice}
                                  onChange={(e) => {
                                    const v = Math.max(0, parseFloat(e.target.value) || 0);
                                    setProductPrices(prev => ({ ...prev, [item.id]: v }));
                                  }}
                                  className="h-7 w-full text-xs px-0.5 text-right font-medium border-0 bg-transparent rounded-none focus-visible:ring-1 focus-visible:ring-inset"
                                />
                              </td>
                              {/* Amount */}
                              <td className="px-1.5 py-1 border-r border-slate-200 align-middle text-right leading-tight">
                                <div className="font-bold text-emerald-700 tabular-nums">₹{itemTotal.toFixed(2)}</div>
                                {settings?.gst_enabled && itemGstAmount > 0 && (
                                  <div className="text-[9px] text-slate-400 leading-none">+{itemGstAmount.toFixed(2)}</div>
                                )}
                              </td>
                              {/* Remove */}
                              <td className="px-0 py-1 align-middle text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFromCart(item.id)}
                                  className="h-6 w-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                                  title="Remove"
                                  aria-label="Remove from cart"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </div>

              {/* Customer & Payment — exactly 2 rows: Name, then Phone | Payment */}
              <div className="space-y-3 p-3 sm:p-4 bg-gray-50 rounded-lg">
                <h3 className="text-sm font-semibold">Customer & Payment</h3>

                {/* Row 1: Name (full width) */}
                <div className="space-y-1">
                  <Label htmlFor="customerName" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Customer Name</Label>
                  <Input
                    id="customerName"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="e.g. Rohan Sharma (or leave blank for Walk-in)"
                    className="h-9"
                  />
                </div>

                {/* Row 2: Phone | Payment (50/50 split) */}
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="customerPhone" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Phone</Label>
                    <Input
                      id="customerPhone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={customerPhone}
                      onChange={(e) => {
                        let value = e.target.value;
                        if (value && !value.startsWith('+')) {
                          const cleaned = value.replace(/\D/g, '');
                          if (cleaned.length === 10) {
                            value = '+91' + cleaned;
                          } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
                            value = '+' + cleaned;
                          } else if (cleaned.length > 0) {
                            value = '+91' + cleaned;
                          }
                        }
                        setCustomerPhone(value);
                      }}
                      placeholder="+91 9876543210"
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="paymentMode" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Payment</Label>
                    <Select value={paymentMode} onValueChange={setPaymentMode}>
                      <SelectTrigger id="paymentMode" className="h-9">
                        <SelectValue placeholder="Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">💵 Cash</SelectItem>
                        <SelectItem value="upi">📱 UPI</SelectItem>
                        <SelectItem value="card">💳 Card</SelectItem>
                        <SelectItem value="credit">⏳ Credit / Dues</SelectItem>
                        <SelectItem value="net_banking">🏦 Net Banking</SelectItem>
                        <SelectItem value="wallet">👛 Wallet</SelectItem>
                        <SelectItem value="cheque">📝 Cheque</SelectItem>
                        <SelectItem value="other">💰 Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="bg-emerald-50/50 p-3 sm:p-4 rounded-lg border border-emerald-100 space-y-3">
                  <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-wide flex items-center gap-1.5">
                    <Receipt className="h-3.5 w-3.5" /> Prescription Information (Rx)
                  </h4>
                  <div className="grid gap-3 grid-cols-2 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="prescriptionMonths" className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Rx Duration (Months)</Label>
                      <Input
                        id="prescriptionMonths"
                        type="number"
                        min="0"
                        value={prescriptionMonths}
                        onChange={(e) => setPrescriptionMonths(e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
                        placeholder="e.g. 6"
                        className="bg-white border-emerald-200 focus:border-emerald-500 shadow-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="monthsTaken" className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Months Done</Label>
                      <Input
                        id="monthsTaken"
                        type="number"
                        min="0"
                        value={monthsTaken}
                        onChange={(e) => setMonthsTaken(e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
                        placeholder="e.g. 1"
                        className="bg-white border-emerald-200 focus:border-emerald-500 shadow-sm"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-1 lg:col-span-2">
                      <Label htmlFor="customerAddress" className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Address</Label>
                      <Input
                        id="customerAddress"
                        value={customerAddress}
                        onChange={(e) => setCustomerAddress(e.target.value)}
                        placeholder="Enter customer address..."
                        className="bg-white border-emerald-200 focus:border-emerald-500 shadow-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Order Summary */}
              {selectedProducts.length > 0 && (
                <Card className="space-y-3 p-4 sm:p-5 bg-gradient-to-br from-gray-50 to-white border shadow-sm">
                  <h3 className="text-base font-bold">Order Summary</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Items ({selectedProducts.length})</span>
                      <span>{selectedProducts.reduce((sum, item) => sum + item.quantity, 0)} units</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>₹{orderTotals.subtotal.toFixed(2)}</span>
                    </div>

                    {/* Discount Section */}
                    <div className="space-y-1.5 border-t pt-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-sm text-muted-foreground">Discount (%)</Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={discountPercentage}
                          onChange={(e) => setDiscountPercentage(parseFloat(e.target.value) || 0)}
                          className="w-20 h-8 text-sm"
                          placeholder="0"
                        />
                      </div>
                      {discountPercentage > 0 && (
                        <div className="flex justify-between text-red-600">
                          <span>Discount ({discountPercentage}%)</span>
                          <span>-₹{orderTotals.discountAmount.toFixed(2)}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between">
                      <span className="text-muted-foreground">GST</span>
                      <span>₹{orderTotals.gstAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-lg border-t pt-2.5 mt-1">
                      <span>Total</span>
                      <span className="text-green-600">₹{orderTotals.grandTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </Card>
              )}

              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    // Reset all form fields
                    setSelectedProducts([]);
                    setCurrentProduct('');
                    setCurrentQuantity(1);
                    setCustomerName('');
                    setCustomerPhone('');
                    setPrescriptionMonths('');
                    setMonthsTaken('');
                    setDiscountPercentage(0);
                    setProductPrices({});
                    setCustomGstRates({});
                    setPaymentMode('cash');
                    setSubQtyMap({});
                    setPcsPerUnitMap({});
                    setCurrentSubQty('');
                    setCurrentPcsPerUnit(10);
                  }}
                  className="sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={selectedProducts.length === 0 || isRecordingSales}
                  className="sm:flex-1 sm:min-w-[200px] h-11 gap-2 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
                >
                  <ShoppingCart className="h-4 w-4" />
                  {isRecordingSales ? 'Recording...' : 'Record Sale'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        ) : (
          <Button
            className="text-lg py-3 px-6 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 gap-3"
            onClick={() => navigate('/sales/new')}
          >
            <div className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              <span>Record Sale</span>
            </div>
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded border border-white/30 opacity-90 hidden sm:inline-block">F2</span>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <CardTitle className="text-lg font-semibold">Recent Sales</CardTitle>
              <CardDescription className="text-sm">
                {loading ? 'Loading...' : `${totalSales} transaction${totalSales === 1 ? '' : 's'} found`}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-2">
                    <Filter className="h-4 w-4" />
                    Filters
                    {(filterPaymentMode !== 'all' || filterDateRange !== 'all') && (
                      <Badge variant="secondary" className="ml-1 h-5 px-1 bg-blue-100 text-blue-700">
                        { (filterPaymentMode !== 'all' ? 1 : 0) + (filterDateRange !== 'all' ? 1 : 0) }
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="end">
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <h4 className="font-medium leading-none">Filter Sales</h4>
                      <p className="text-sm text-muted-foreground">
                        Refine the sales list by payment mode or date.
                      </p>
                    </div>
                    <div className="grid gap-2">
                      <div className="grid gap-1">
                        <Label htmlFor="payment-filter">Payment Mode</Label>
                        <Select value={filterPaymentMode} onValueChange={setFilterPaymentMode}>
                          <SelectTrigger id="payment-filter">
                            <SelectValue placeholder="All Payment Modes" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Modes</SelectItem>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="upi">UPI</SelectItem>
                            <SelectItem value="card">Card</SelectItem>
                            <SelectItem value="credit">Credit / Dues</SelectItem>
                            <SelectItem value="net_banking">Net Banking</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1 mt-2">
                        <Label htmlFor="date-filter">Date Range</Label>
                        <Select value={filterDateRange} onValueChange={setFilterDateRange}>
                          <SelectTrigger id="date-filter">
                            <SelectValue placeholder="All Time" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Time</SelectItem>
                            <SelectItem value="today">Today</SelectItem>
                            <SelectItem value="yesterday">Yesterday</SelectItem>
                            <SelectItem value="this_week">This Week</SelectItem>
                            <SelectItem value="this_month">This Month</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="mt-2 text-xs h-8 text-blue-600 hover:text-blue-700"
                      onClick={() => {
                        setFilterPaymentMode('all');
                        setFilterDateRange('all');
                      }}
                    >
                      Clear all filters
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <TableSkeleton rows={6} cols={['w-24', 'w-40', 'w-16', 'w-24', 'w-20', 'w-16']} />
          ) : sales.length === 0 ? (
            <div className="text-center py-12 border border-dashed rounded-md">
              <div className="bg-muted/50 p-4 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-3">
                <ShoppingCart className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold mb-1">No sales recorded yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Record your first sale to see it here.</p>
              <Button
                onClick={() => isMobile ? setIsDialogOpen(true) : navigate('/sales/new')}
                size="sm"
              >
                <Plus className="h-4 w-4 mr-2" />Record First Sale
              </Button>
            </div>
          ) : (
            <>
              {/* Mobile: card list */}
              <div className="md:hidden space-y-2">
                {groupedSales.map((group) => {
                  const paymentMode = group.items[0]?.payment_mode || 'cash';
                  const paymentClass =
                    paymentMode === 'credit' ? 'bg-orange-50 text-orange-700 border-orange-200'
                    : paymentMode === 'cash' ? 'bg-green-50 text-green-700 border-green-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200';
                  const isExpanded = expandedBillId === group.bill_id;
                  return (
                    <div
                      key={group.bill_id}
                      className="rounded-md border bg-card overflow-hidden"
                    >
                      <button
                        type="button"
                        className="w-full flex items-start gap-2 p-3 text-left hover:bg-muted/40 transition-colors"
                        onClick={() => toggleExpand(group.bill_id)}
                      >
                        <div className="shrink-0 mt-0.5">
                          {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium truncate">{group.customer_name}</p>
                            <p className="text-base font-bold text-green-700 whitespace-nowrap">₹{group.total_amount.toFixed(2)}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] text-muted-foreground">
                            {group.customer_phone && <span>{group.customer_phone}</span>}
                            <span>· {group.items.length} item{group.items.length === 1 ? '' : 's'}</span>
                            <span>· {new Date(group.sale_date || group.created_at).toLocaleDateString()}</span>
                            <Badge variant="outline" className={`h-5 text-[10px] capitalize ${paymentClass}`}>
                              {paymentMode}
                            </Badge>
                            {(() => {
                              const r = getLockReason(group);
                              if (!r) return null;
                              return (
                                <Badge
                                  variant="outline"
                                  className="h-5 text-[10px] bg-slate-100 text-slate-700 border-slate-200 gap-1"
                                  title={lockReasonText(r)}
                                >
                                  <Lock className="h-2.5 w-2.5" />
                                  {r === 'printed' ? 'Printed' : 'Locked'}
                                </Badge>
                              );
                            })()}
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
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => showSaleDetails(group)}>
                                <Eye className="h-4 w-4 mr-2" /> View details
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={!!getLockReason(group)}
                                onClick={() => openEditSale(group)}
                                title={lockReasonText(getLockReason(group))}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit sale
                                {getLockReason(group) && <Lock className="h-3 w-3 ml-auto text-muted-foreground" />}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={!group.items[0]?.bill_id}
                                onClick={() => group.items[0]?.bill_id && handlePrintBill(group.items[0].bill_id!)}
                              >
                                <Printer className="h-4 w-4 mr-2" /> Print bill
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => downloadSaleDetails(group)}>
                                <Download className="h-4 w-4 mr-2" /> Download receipt
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </button>

                      {/* Expanded items list (mobile) */}
                      {isExpanded && (
                        <div className="border-t bg-muted/20 px-3 py-2 space-y-1.5">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Items in this transaction</p>
                          {group.items.map((item, idx) => (
                            <div key={idx} className="flex items-baseline justify-between gap-2 text-sm">
                              <div className="min-w-0 flex-1">
                                <span className="truncate">{item.products?.name}</span>
                                <span className="text-muted-foreground text-xs ml-1">
                                  × {item.quantity}{item.sub_qty ? ` +${item.sub_qty}` : ''}
                                </span>
                              </div>
                              <span className="font-medium whitespace-nowrap">₹{item.total_price.toFixed(2)}</span>
                            </div>
                          ))}
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
                      <TableHead className="hidden lg:table-cell font-medium">Phone</TableHead>
                      <TableHead className="hidden md:table-cell font-medium text-center">Items</TableHead>
                      <TableHead className="font-medium text-right">Amount</TableHead>
                      <TableHead className="hidden lg:table-cell font-medium text-center">Payment</TableHead>
                      <TableHead className="hidden sm:table-cell font-medium">Date</TableHead>
                      <TableHead className="font-medium text-right w-12"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedSales.map((group) => {
                      const paymentMode = group.items[0]?.payment_mode || 'cash';
                      const paymentClass =
                        paymentMode === 'credit' ? 'bg-orange-50 text-orange-700 border-orange-200'
                        : paymentMode === 'cash' ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200';
                      const isExpanded = expandedBillId === group.bill_id;
                      return (
                        <React.Fragment key={group.bill_id}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() => toggleExpand(group.bill_id)}
                          >
                            <TableCell className="py-2.5">
                              <div className="flex items-center gap-1.5">
                                {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                <span className="font-medium">{group.customer_name}</span>
                                {(() => {
                                  const r = getLockReason(group);
                                  if (!r) return null;
                                  return (
                                    <span title={lockReasonText(r)} className="shrink-0">
                                      <Lock className="h-3 w-3 text-slate-400" />
                                    </span>
                                  );
                                })()}
                              </div>
                            </TableCell>
                            <TableCell className="hidden lg:table-cell py-2.5 text-sm">{group.customer_phone || '—'}</TableCell>
                            <TableCell className="hidden md:table-cell py-2.5 text-center text-sm">{group.items.length}</TableCell>
                            <TableCell className="py-2.5 text-right font-semibold text-green-700">₹{group.total_amount.toFixed(2)}</TableCell>
                            <TableCell className="hidden lg:table-cell py-2.5 text-center">
                              <Badge variant="outline" className={`text-[10px] capitalize h-5 ${paymentClass}`}>
                                {paymentMode}
                              </Badge>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell py-2.5 text-sm">{new Date(group.sale_date || group.created_at).toLocaleDateString()}</TableCell>
                            <TableCell className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreVertical className="h-4 w-4 text-muted-foreground" />
                                    <span className="sr-only">Actions</span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                  <DropdownMenuItem onClick={() => showSaleDetails(group)}>
                                    <Eye className="h-4 w-4 mr-2" /> View details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={!!getLockReason(group)}
                                    onClick={() => openEditSale(group)}
                                    title={lockReasonText(getLockReason(group))}
                                  >
                                    <Pencil className="h-4 w-4 mr-2" />
                                    Edit sale
                                    {getLockReason(group) && <Lock className="h-3 w-3 ml-auto text-muted-foreground" />}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    disabled={!group.items[0]?.bill_id}
                                    onClick={() => group.items[0]?.bill_id && handlePrintBill(group.items[0].bill_id!)}
                                  >
                                    <Printer className="h-4 w-4 mr-2" /> Print bill
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => downloadSaleDetails(group)}>
                                    <Download className="h-4 w-4 mr-2" /> Download receipt
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>

                          {/* Expanded inner items */}
                          {isExpanded && (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell colSpan={7} className="p-0 border-t">
                                <div className="px-4 py-3">
                                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Items in this transaction</p>
                                  <div className="rounded-md border bg-white overflow-hidden">
                                    <Table>
                                      <TableHeader className="bg-muted/30">
                                        <TableRow className="hover:bg-transparent">
                                          <TableHead className="font-medium text-xs">Product</TableHead>
                                          <TableHead className="font-medium text-xs text-center">Qty</TableHead>
                                          <TableHead className="font-medium text-xs text-right">Unit Rate</TableHead>
                                          <TableHead className="font-medium text-xs text-right">Total</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {group.items.map((item, idx) => (
                                          <TableRow key={idx}>
                                            <TableCell className="py-2 text-sm">{item.products?.name}</TableCell>
                                            <TableCell className="py-2 text-center text-sm">
                                              {item.quantity}
                                              {item.sub_qty ? <span className="text-xs text-blue-600 ml-1">+{item.sub_qty}</span> : null}
                                            </TableCell>
                                            <TableCell className="py-2 text-right text-sm">₹{item.unit_price.toFixed(2)}</TableCell>
                                            <TableCell className="py-2 text-right text-sm font-medium">₹{item.total_price.toFixed(2)}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="mt-8">
                  <Pagination>
                    <PaginationContent className="flex-wrap">
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => handlePageChange(currentPage - 1)}
                          className={`${currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"} text-sm sm:text-lg py-1 px-2 sm:px-4`}
                        />
                      </PaginationItem>

                      {/* First page */}
                      <PaginationItem>
                        <PaginationLink
                          onClick={() => handlePageChange(1)}
                          isActive={currentPage === 1}
                          className="text-sm sm:text-lg py-1 px-2 sm:px-4"
                        >
                          1
                        </PaginationLink>
                      </PaginationItem>

                      {/* Ellipsis for skipped pages at the start */}
                      {currentPage > 3 && (
                        <PaginationItem>
                          <PaginationEllipsis className="text-lg" />
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
                                className="text-sm sm:text-lg py-1 px-2 sm:px-4"
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
                          <PaginationEllipsis className="text-lg" />
                        </PaginationItem>
                      )}

                      {/* Last page */}
                      {totalPages > 1 && (
                        <PaginationItem>
                          <PaginationLink
                            onClick={() => handlePageChange(totalPages)}
                            isActive={currentPage === totalPages}
                            className="text-sm sm:text-lg py-1 px-2 sm:px-4"
                          >
                            {totalPages}
                          </PaginationLink>
                        </PaginationItem>
                      )}

                      <PaginationItem>
                        <PaginationNext
                          onClick={() => handlePageChange(currentPage + 1)}
                          className={`${currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"} text-sm sm:text-lg py-1 px-2 sm:px-4`}
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

      {/* ── Edit Sale Dialog — full edit (cart + customer + payment) ── */}
      <Dialog
        open={isEditOpen}
        onOpenChange={(open) => {
          setIsEditOpen(open);
          if (!open) {
            setEditingBillId(null);
            setEditingCreatedAt(null);
            setEditCustomerName('');
            setEditCustomerPhone('');
            setEditCustomerAddress('');
            setEditPaymentMode('cash');
            setEditCart([]);
            setEditProductSearch('');
          }
        }}
      >
        <DialogContent className="p-0 gap-0 flex flex-col overflow-hidden
                                   w-screen h-[100dvh] max-w-none rounded-none
                                   sm:w-[min(96vw,960px)] sm:max-w-none sm:h-auto sm:max-h-[92vh] sm:rounded-lg">
          {/* Header */}
          <div className="px-4 sm:px-5 py-2 sm:py-3 border-b bg-gradient-to-br from-blue-50/40 to-white shrink-0">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm">
                <Pencil className="h-4 w-4" strokeWidth={2.5} />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-sm sm:text-lg font-semibold tracking-tight leading-tight">
                  Edit sale
                </DialogTitle>
                <DialogDescription className="hidden sm:block text-xs leading-tight mt-0.5 truncate">
                  Modify items, change qty/price, add or remove products. Stock adjusts automatically.
                </DialogDescription>
              </div>
              {editingBillId && (
                <Badge variant="outline" className="font-mono text-[10px] shrink-0 hidden sm:inline-flex">
                  #{editingBillId.slice(0, 8).toUpperCase()}
                </Badge>
              )}
            </div>
          </div>

          {/* Body */}
          <form
            id="edit-sale-form"
            onSubmit={handleSaveEdit}
            className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-3 sm:py-4 space-y-4"
          >
            {/* ─── Items section ─── */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                  <ShoppingCart className="h-3 w-3" />
                  Items <span className="text-slate-400">({editCart.length})</span>
                </div>
              </div>

              {/* Cart items */}
              <div className="rounded-md border border-slate-200 overflow-hidden">
                {editCart.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-6 px-3">
                    No items in this sale. Add a product below.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {editCart.map(it => {
                      const units = effUnits(it.quantity, it.sub_qty, it.pcs_per_unit);
                      const lineNet = units * it.unit_price;
                      const lineGst = lineNet * (it.gst_rate / 100);
                      const lineTotal = lineNet + lineGst;
                      const avail = availableStockFor(it);
                      const overStock = units > avail + 0.0001;
                      return (
                        <div key={it.lineId} className={`p-2.5 sm:p-3 ${it.isNew ? 'bg-blue-50/30' : ''}`}>
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-sm truncate">{it.product_name}</span>
                                {it.isNew && (
                                  <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">New</Badge>
                                )}
                                {it.pcs_per_unit > 1 && (
                                  <span className="text-[10px] text-muted-foreground">· {it.pcs_per_unit}/strip</span>
                                )}
                              </div>
                              {/* Inline editable fields */}
                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2">
                                <div className="space-y-0.5">
                                  <Label className="text-[10px] uppercase tracking-wide text-slate-500">Qty</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={it.quantity}
                                    onChange={e => updateEditCartItem(it.lineId, { quantity: Math.max(0, parseInt(e.target.value) || 0) })}
                                    className={`h-8 text-sm tabular-nums ${overStock ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                                  />
                                </div>
                                {it.pcs_per_unit > 1 && (
                                  <div className="space-y-0.5">
                                    <Label className="text-[10px] uppercase tracking-wide text-slate-500">Pcs</Label>
                                    <Input
                                      type="number"
                                      min={0}
                                      max={it.pcs_per_unit - 1}
                                      value={it.sub_qty}
                                      onChange={e => updateEditCartItem(it.lineId, { sub_qty: Math.max(0, parseInt(e.target.value) || 0) })}
                                      className="h-8 text-sm tabular-nums"
                                    />
                                  </div>
                                )}
                                <div className="space-y-0.5">
                                  <Label className="text-[10px] uppercase tracking-wide text-slate-500">Rate (₹)</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    value={it.unit_price}
                                    onChange={e => updateEditCartItem(it.lineId, { unit_price: parseFloat(e.target.value) || 0 })}
                                    className="h-8 text-sm tabular-nums"
                                  />
                                </div>
                                <div className="space-y-0.5">
                                  <Label className="text-[10px] uppercase tracking-wide text-slate-500">GST %</Label>
                                  <Input
                                    type="number"
                                    step="1"
                                    min={0}
                                    max={100}
                                    value={it.gst_rate}
                                    onChange={e => updateEditCartItem(it.lineId, { gst_rate: parseFloat(e.target.value) || 0 })}
                                    className="h-8 text-sm tabular-nums"
                                  />
                                </div>
                                <div className="space-y-0.5 col-span-2 sm:col-span-1">
                                  <Label className="text-[10px] uppercase tracking-wide text-slate-500">Line total</Label>
                                  <div className="h-8 px-2 flex items-center font-semibold tabular-nums text-slate-900 border rounded-md bg-slate-50/50">
                                    ₹{lineTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                  </div>
                                </div>
                              </div>
                              {overStock && (
                                <p className="text-[10px] text-red-600 mt-1 flex items-center gap-1">
                                  ⚠ {units.toFixed(2)} units requested, only {avail.toFixed(2)} available
                                </p>
                              )}
                            </div>
                            <Button
                              type="button" variant="ghost" size="icon"
                              onClick={() => removeEditCartItem(it.lineId)}
                              className="h-7 w-7 shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Remove item"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Add product */}
              <div className="relative" ref={editProductSearchRef}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9 pr-3 h-9 text-sm"
                    placeholder="Add a product..."
                    value={editProductSearch}
                    onChange={e => { setEditProductSearch(e.target.value); setShowEditProductList(true); }}
                    onFocus={() => setShowEditProductList(true)}
                  />
                </div>
                {showEditProductList && editFilteredProducts.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {editFilteredProducts.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b last:border-b-0"
                        onClick={() => addEditCartItem(p)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{p.name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                            ₹{Number(p.selling_price).toLocaleString('en-IN')} · Stock: {p.quantity}
                          </span>
                        </div>
                        {p.batch_number && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">Batch {p.batch_number}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {showEditProductList && editProductSearch && editFilteredProducts.length === 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-lg shadow-lg px-3 py-3 text-sm text-muted-foreground">
                    No products match "{editProductSearch}"
                  </div>
                )}
              </div>
            </section>

            {/* ─── Customer & payment ─── */}
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-500 font-semibold pb-1 border-b border-slate-100">
                <Receipt className="h-3 w-3" />
                Customer &amp; payment
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-[10px] sm:text-[11px] font-semibold text-slate-700">Customer name</Label>
                  <Input
                    value={editCustomerName}
                    onChange={(e) => setEditCustomerName(e.target.value)}
                    placeholder="Walk-in Customer"
                    className="h-8 sm:h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] sm:text-[11px] font-semibold text-slate-700">Phone</Label>
                  <Input
                    type="tel"
                    inputMode="tel"
                    value={editCustomerPhone}
                    onChange={(e) => {
                      let value = e.target.value;
                      if (value && !value.startsWith('+')) {
                        const cleaned = value.replace(/\D/g, '');
                        if (cleaned.length === 10) value = '+91' + cleaned;
                        else if (cleaned.length === 12 && cleaned.startsWith('91')) value = '+' + cleaned;
                        else if (cleaned.length > 0) value = '+91' + cleaned;
                      }
                      setEditCustomerPhone(value);
                    }}
                    placeholder="+91 9876543210"
                    className="h-8 sm:h-9 text-sm"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-[10px] sm:text-[11px] font-semibold text-slate-700">Address</Label>
                  <Input
                    value={editCustomerAddress}
                    onChange={(e) => setEditCustomerAddress(e.target.value)}
                    placeholder="Optional"
                    className="h-8 sm:h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] sm:text-[11px] font-semibold text-slate-700">Payment</Label>
                  <Select value={editPaymentMode} onValueChange={setEditPaymentMode}>
                    <SelectTrigger className="h-8 sm:h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">💵 Cash</SelectItem>
                      <SelectItem value="upi">📱 UPI</SelectItem>
                      <SelectItem value="card">💳 Card</SelectItem>
                      <SelectItem value="credit">⏳ Credit / Dues</SelectItem>
                      <SelectItem value="net_banking">🏦 Net Banking</SelectItem>
                      <SelectItem value="wallet">👛 Wallet</SelectItem>
                      <SelectItem value="cheque">📝 Cheque</SelectItem>
                      <SelectItem value="other">💰 Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {/* ─── Totals card ─── */}
            <div className="rounded-lg border-2 border-blue-200 bg-gradient-to-br from-blue-50/70 to-blue-50/20 px-3 py-2 sm:py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-blue-700/80">
                  Totals
                </div>
                <div className="flex items-center gap-3 sm:gap-4 tabular-nums">
                  <div className="text-right">
                    <div className="text-[10px] uppercase text-slate-500">Subtotal</div>
                    <div className="text-sm font-medium text-slate-900">₹{editCartTotals.net.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase text-slate-500">GST</div>
                    <div className="text-sm font-medium text-slate-900">₹{editCartTotals.gst.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                  </div>
                  <div className="text-right border-l border-blue-200/70 pl-3 sm:pl-4">
                    <div className="text-[10px] uppercase text-blue-700/80 font-semibold">Total</div>
                    <div className="text-base sm:text-xl font-bold text-blue-700">
                      ₹{editCartTotals.total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </form>

          {/* Footer */}
          <div
            className="shrink-0 border-t bg-white px-3 sm:px-5 py-2 sm:py-3 flex items-center justify-end gap-2"
            style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
          >
            <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} className="h-8 sm:h-9 flex-1 sm:flex-none">
              Cancel
            </Button>
            <Button
              type="submit"
              form="edit-sale-form"
              disabled={isSavingEdit || editCart.length === 0}
              className="h-8 sm:h-9 flex-1 sm:flex-none sm:min-w-[140px]"
            >
              {isSavingEdit ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />Saving...</>
              ) : (
                <><Pencil className="h-4 w-4 mr-2" />Save changes</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sale Detail Modal */}
      <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
        <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          {selectedTransaction && (() => {
            const paymentMode = selectedTransaction.items[0]?.payment_mode || 'cash';
            const paymentClass =
              paymentMode === 'credit' ? 'bg-orange-50 text-orange-700 border-orange-200'
              : paymentMode === 'cash' ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-blue-50 text-blue-700 border-blue-200';
            const saleDate = new Date(selectedTransaction.sale_date || selectedTransaction.created_at);
            const billId = selectedTransaction.bill_id;
            return (
              <>
                <DialogHeader className="pr-8 space-y-1">
                  <DialogTitle className="text-lg sm:text-xl">Sale Details</DialogTitle>
                  <DialogDescription asChild>
                    <span className="text-xs font-mono text-muted-foreground break-all">
                      Bill #{billId}
                    </span>
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 mt-3">
                  {/* Identity strip — customer + payment + total */}
                  <div className="rounded-md border bg-muted/30 p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold text-gray-900 truncate">
                          {selectedTransaction.customer_name || 'Walk-in Customer'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {selectedTransaction.customer_phone || 'No phone on file'}
                        </p>
                      </div>
                      <Badge variant="outline" className={`text-[11px] capitalize h-6 ${paymentClass}`}>
                        {paymentMode}
                      </Badge>
                    </div>
                    <div className="mt-3 pt-3 border-t border-border/60 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Total Amount</p>
                        <p className="text-2xl font-bold text-green-700 leading-tight mt-0.5">
                          ₹{selectedTransaction.total_amount.toFixed(2)}
                        </p>
                      </div>
                      {(selectedTransaction.gst_amount || 0) > 0 && (
                        <p className="text-[11px] text-muted-foreground mb-0.5">
                          incl. ₹{(selectedTransaction.gst_amount || 0).toFixed(2)} GST
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Info grid — 3 cells */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <div className="rounded-md border p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Date</p>
                      <p className="text-sm font-medium mt-0.5">{saleDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{saleDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Items</p>
                      <p className="text-sm font-medium mt-0.5">{selectedTransaction.items.length} product{selectedTransaction.items.length === 1 ? '' : 's'}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {selectedTransaction.items.reduce((s, i) => s + i.quantity, 0)} unit{selectedTransaction.items.reduce((s, i) => s + i.quantity, 0) === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">GST</p>
                      <p className="text-sm font-medium mt-0.5">₹{(selectedTransaction.gst_amount || 0).toFixed(2)}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{(selectedTransaction.gst_amount || 0) > 0 ? 'tax included' : 'no tax'}</p>
                    </div>
                  </div>

                  {/* Items list */}
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
                      Items purchased
                    </p>
                    <div className="rounded-md border overflow-hidden">
                      <div className="max-h-72 overflow-y-auto">
                        <Table>
                          <TableHeader className="bg-muted/40 sticky top-0 z-10">
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="font-medium text-xs">Product</TableHead>
                              <TableHead className="font-medium text-xs text-center">Qty</TableHead>
                              <TableHead className="hidden sm:table-cell font-medium text-xs text-right">Rate</TableHead>
                              <TableHead className="font-medium text-xs text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedTransaction.items.map((item, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="py-2 text-sm">{item.products?.name || '—'}</TableCell>
                                <TableCell className="py-2 text-sm text-center">
                                  {item.quantity}
                                  {item.sub_qty ? <span className="text-[10px] text-blue-600 ml-1">+{item.sub_qty}</span> : null}
                                </TableCell>
                                <TableCell className="hidden sm:table-cell py-2 text-sm text-right">₹{item.unit_price.toFixed(2)}</TableCell>
                                <TableCell className="py-2 text-sm text-right font-medium">₹{item.total_price.toFixed(2)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>

                  {/* Footer actions */}
                  <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
                    <Button
                      variant="outline"
                      disabled={!billId}
                      onClick={() => billId && navigate(`/print-bill/${billId}`)}
                      className="sm:w-auto gap-2"
                    >
                      <Printer className="h-4 w-4" /> Print Bill
                    </Button>
                    <Button
                      onClick={() => downloadSaleDetails(selectedTransaction)}
                      className="sm:w-auto sm:min-w-[180px] gap-2 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
                    >
                      <Download className="h-4 w-4" /> Download Receipt
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

