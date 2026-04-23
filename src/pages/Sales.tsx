import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Plus, ShoppingCart, Package, Eye, Search, Printer, Download, ChevronDown, ChevronRight, Receipt } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate } from 'react-router-dom';

interface Product {
  id: string;
  name: string;
  quantity: number;
  selling_price: number;
  gst: number;
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
  const [productPrices, setProductPrices] = useState<Record<string, number>>({});
  // Custom GST rates for items in cart
  const [customGstRates, setCustomGstRates] = useState<Record<string, number>>({});
  // Discount state
  const [discountPercentage, setDiscountPercentage] = useState<number>(0);
  // Payment mode state
  const [paymentMode, setPaymentMode] = useState<string>('cash');
  // Sub quantity state (for loose tablet sales)
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

      try {
        // First, try to select with customer fields
        const result = await supabase
          .from('sales')
          .select(`
            id, bill_id, product_id, quantity, sub_qty, pcs_per_unit, unit_price, total_price, gst_amount, created_at, sale_date,
            customer_name, customer_phone, customer_address, prescription_months, months_taken, payment_mode,
            products(name)
          `, { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(from, to);

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

          const fallbackRes = await supabase
            .from('sales')
            .select(`
              id, bill_id, product_id, quantity, sub_qty, pcs_per_unit, unit_price, total_price, gst_amount, created_at, sale_date, payment_mode,
              products(name)
            `, { count: 'exact' })
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
  }, [currentPage]);

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

    // Save sub qty and pcs per unit for this product
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
    // Clean up sub qty and pcs per unit maps
    setSubQtyMap(prev => { const next = { ...prev }; delete next[productId]; return next; });
    setPcsPerUnitMap(prev => { const next = { ...prev }; delete next[productId]; return next; });
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
          toast({
            title: "Sale recorded",
            description: `Sale of ${selectedProducts.length} item(s) recorded successfully. Note: Some fields could not be saved.`,
          });
        }
      } else if (error) {
        throw error;
      } else {
        toast({
          title: "Sale recorded",
          description: `Sale of ${selectedProducts.length} item(s) recorded successfully${customerName ? ' for ' + customerName : ''}`,
          action: (
            <Button
              size="sm"
              onClick={() => navigate(`/print-bill/${billId}`)}
              className="mt-2 bg-blue-600 hover:bg-blue-700 text-white border-none shadow-sm"
            >
              Print Bill
            </Button>
          ),
        });
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

  // Function to download sale details as text
  const downloadSaleDetails = (transaction?: GroupedTransaction) => {
    const targetTransaction = transaction || selectedTransaction;
    if (!targetTransaction) return;

    const saleDate = new Date(targetTransaction.sale_date || targetTransaction.created_at).toLocaleString();
    const customerName = targetTransaction.customer_name || "Walk-in Customer";
    const customerPhone = targetTransaction.customer_phone || "Not provided";

    let itemsStr = targetTransaction.items.map(item => 
      `- ${item.products?.name}: ${item.quantity} ${item.sub_qty ? `(+${item.sub_qty} tabs)` : ''} x ₹${item.unit_price} = ₹${item.total_price}`
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
          <h1 className="text-4xl font-bold bg-gradient-to-r from-green-600 to-teal-600 bg-clip-text text-transparent">
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
                className="text-lg py-3 px-6 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
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
                <Plus className="h-5 w-5 mr-2" />
                Record Sale
              </Button>
            </DialogTrigger>
          <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl">Record New Sale</DialogTitle>
              <DialogDescription className="text-lg">
                Select a product and quantity to record the sale
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSale} className="space-y-6">
              {/* Cart Items Display */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label className="text-lg font-medium">Cart Items</Label>
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
                    className="text-sm"
                  >
                    Clear All
                  </Button>
                </div>

                {selectedProducts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <ShoppingCart className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg">Your cart is empty</p>
                    <p className="text-sm">Add products using the form below</p>
                  </div>
                ) : (
                  <div className="rounded-lg border bg-white p-4 space-y-3 max-h-60 overflow-y-auto">
                    {selectedProducts.map((item) => {
                      const product = products.find(p => p.id === item.id);
                      if (!product) return null;

                      // Use custom price if set, otherwise use product's selling price
                      const unitPrice = productPrices[item.id] || product.selling_price;
                      // Calculate subtotal: full strips + loose tablets
                      const cartSubQty = subQtyMap[item.id];
                      const cartPcsPerUnit = pcsPerUnitMap[item.id];
                      let itemSubtotal = unitPrice * item.quantity;
                      if (cartSubQty && cartPcsPerUnit) {
                        itemSubtotal += (unitPrice / cartPcsPerUnit) * cartSubQty;
                      }

                      // Use custom GST rate if set, otherwise use default from settings
                      const itemGstRate = customGstRates[item.id] !== undefined ? customGstRates[item.id] : settings?.default_gst_rate || 0;

                      let itemGstAmount = 0;
                      let itemTotal = 0;
                      const isGstInclusive = settings?.gst_type === 'inclusive';

                      if (settings?.gst_enabled) {
                        if (isGstInclusive) {
                          // For inclusive, the price already includes GST.
                          // User requested logic: GST = Amount * Rate / 100
                          itemGstAmount = (itemSubtotal * itemGstRate) / 100;
                          itemTotal = itemSubtotal;
                        } else {
                          // For exclusive, add GST
                          itemGstAmount = (itemSubtotal * itemGstRate) / 100;
                          itemTotal = itemSubtotal + itemGstAmount;
                        }
                      } else {
                        itemTotal = itemSubtotal;
                      }

                      // Note: This display item loop doesn't show the global discount per-item currently, 
                      // but it should show the correct pre-discount totals.

                      return (
                        <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                          <div className="flex-1">
                            <div className="font-medium text-lg">{product.name}</div>
                            {cartSubQty && cartPcsPerUnit && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                Sub Qty: {cartSubQty} / {cartPcsPerUnit} pcs
                              </span>
                            )}
                            <div className="flex items-center gap-2">
                              <div className="text-sm text-muted-foreground">
                                {cartSubQty && cartPcsPerUnit ? (
                                  <>₹{unitPrice.toFixed(2)} / {cartPcsPerUnit} × {cartSubQty} = ₹{itemSubtotal.toFixed(2)}</>
                                ) : (
                                  <>₹{unitPrice.toFixed(2)} × {item.quantity} = ₹{itemSubtotal.toFixed(2)}</>
                                )}
                                {productPrices[item.id] && productPrices[item.id] !== product.selling_price && (
                                  <span className="text-blue-600 font-medium ml-2">(Adjusted)</span>
                                )}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-blue-600"
                                onClick={() => {
                                  // Set the current product and price for editing
                                  setCurrentProduct(item.id);
                                  // Set the custom price to the current unit price
                                  setProductPrices(prev => ({
                                    ...prev,
                                    [item.id]: unitPrice
                                  }));
                                }}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </Button>
                            </div>
                            {/* GST Rate Editor */}
                            {settings?.gst_enabled && (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-muted-foreground">GST Rate:</span>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={itemGstRate}
                                  onChange={(e) => {
                                    const newRate = parseFloat(e.target.value) || 0;
                                    setCustomGstRates(prev => ({
                                      ...prev,
                                      [item.id]: newRate
                                    }));
                                  }}
                                  className="w-20 h-6 text-xs py-0 px-2"
                                />
                                <span className="text-xs text-muted-foreground">%</span>
                                {customGstRates[item.id] !== undefined && customGstRates[item.id] !== (settings?.default_gst_rate || 0) && (
                                  <span className="text-xs text-blue-600">(Custom)</span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 ml-4">
                            <div className="text-right">
                              <div className="font-medium">₹{itemTotal.toFixed(2)}</div>
                              <div className="text-xs text-muted-foreground">
                                {settings?.gst_enabled ? `GST: ₹${itemGstAmount.toFixed(2)}` : "GST disabled"}
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleRemoveFromCart(item.id)}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </Button>
                          </div>
                        </div>
                      );
                    })}

                  </div>
                )}
              </div>

              {/* Add Product to Cart Form */}
              <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-lg font-medium">Add Product</h3>
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="currentProduct" className="text-sm font-medium">Product</Label>
                    <div className="space-y-2">
                      {/* Search input always visible */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                        <Input
                          placeholder="Search products..."
                          value={productSearchTerm}
                          onChange={(e) => setProductSearchTerm(e.target.value)}
                          className="pl-10 py-2 text-sm"
                        />
                      </div>

                      {/* Product selection list - always visible when searching or no product selected */}
                      {(productSearchTerm || !currentProduct) && (
                        <div className="border rounded-md bg-white max-h-40 overflow-y-auto">
                          {filteredProducts.length > 0 ? (
                            filteredProducts.map((product) => (
                              <div
                                key={product.id}
                                className={`py-2 px-3 cursor-pointer flex justify-between items-center border-b last:border-b-0 ${currentProduct === product.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                                  }`}
                                onClick={() => {
                                  setCurrentProduct(product.id);
                                  // Don't clear search term so user can see what they selected
                                }}
                              >
                                <span>{product.name}</span>
                                <span className="text-muted-foreground text-sm">Stock: {product.quantity}</span>
                              </div>
                            ))
                          ) : (
                            <div className="py-4 text-center text-muted-foreground text-sm">
                              No products found
                            </div>
                          )}
                        </div>
                      )}

                      {/* Show selected product when one is selected and no search is active */}
                      {currentProduct && !productSearchTerm && (
                        <div
                          className="py-2 px-3 border rounded-md bg-white cursor-pointer flex justify-between items-center"
                          onClick={() => {
                            // Clear selection to show all products again
                            setCurrentProduct('');
                          }}
                        >
                          {(() => {
                            const selectedProduct = products.find(p => p.id === currentProduct);
                            return selectedProduct ? (
                              <>
                                <span>{selectedProduct.name}</span>
                                <span className="text-muted-foreground text-sm">Stock: {selectedProduct.quantity}</span>
                              </>
                            ) : (
                              <span>Select product</span>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="currentQuantity" className="text-sm font-medium">Quantity</Label>
                    <Input
                      id="currentQuantity"
                      type="number"
                      min="1"
                      max={currentProduct ? products.find(p => p.id === currentProduct)?.quantity : 1}
                      value={currentQuantity}
                      onChange={(e) => setCurrentQuantity(parseInt(e.target.value) || 1)}
                      className="py-2 px-3"
                    />
                  </div>
                </div>

                {/* Sub Qty and Pcs per Unit (Optional - for loose tablet sales) */}
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="currentSubQty" className="text-sm font-medium">Sub Qty <span className="text-muted-foreground text-xs">(Optional - loose tablets)</span></Label>
                    <Input
                      id="currentSubQty"
                      type="number"
                      min="0"
                      value={currentSubQty}
                      onChange={(e) => setCurrentSubQty(e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
                      placeholder="e.g. 6 tablets"
                      className="py-2 px-3"
                    />
                  </div>
                  {currentSubQty !== '' && Number(currentSubQty) > 0 && (
                    <div className="space-y-2">
                      <Label htmlFor="currentPcsPerUnit" className="text-sm font-medium">Pcs per Unit</Label>
                      <Input
                        id="currentPcsPerUnit"
                        type="number"
                        min="1"
                        value={currentPcsPerUnit}
                        onChange={(e) => setCurrentPcsPerUnit(parseInt(e.target.value) || 10)}
                        placeholder="e.g. 10"
                        className="py-2 px-3"
                      />
                    </div>
                  )}
                </div>

                {currentProduct && (
                  <div className="space-y-2 mt-3">
                    <Label htmlFor="customPrice" className="text-sm font-medium">
                      Price (Default: ₹{products.find(p => p.id === currentProduct)?.selling_price})
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="customPrice"
                        type="number"
                        step="0.01"
                        value={productPrices[currentProduct] || products.find(p => p.id === currentProduct)?.selling_price || ''}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value) || 0;
                          setProductPrices(prev => ({
                            ...prev,
                            [currentProduct]: value
                          }));
                        }}
                        className="py-2 px-3 flex-1"
                        placeholder="Enter custom price"
                      />
                      {productPrices[currentProduct] && productPrices[currentProduct] !== products.find(p => p.id === currentProduct)?.selling_price && (
                        <span className="text-sm text-blue-600 font-medium self-center">Adjusted</span>
                      )}
                    </div>
                  </div>
                )}

                <Button
                  type="button"
                  onClick={handleAddToCart}
                  className="w-full bg-blue-600 hover:bg-blue-700 mt-3"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {selectedProducts.some(p => p.id === currentProduct) ? 'Update Item' : 'Add to Cart'}
                </Button>
              </div>

              {/* Payment Mode Section */}
              <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                <Label htmlFor="paymentMode" className="text-sm font-medium whitespace-nowrap">Payment:</Label>
                <Select value={paymentMode} onValueChange={setPaymentMode}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select payment mode" />
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

              {/* Customer Details Form */}
              <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-lg font-medium">Customer Information</h3>
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="customerName" className="text-sm font-medium">Name</Label>
                    <Input
                      id="customerName"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Enter customer name"
                      className="py-2 px-3 w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="customerPhone" className="text-sm font-medium">Phone</Label>
                    <Input
                      id="customerPhone"
                      value={customerPhone}
                      onChange={(e) => {
                        let value = e.target.value;
                        // Auto-format with +91 for Indian numbers
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
                      placeholder="Enter phone number (auto-adds +91)"
                      type="tel"
                      className="py-2 px-3 w-full"
                    />
                  </div>
                </div>
                <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 space-y-4">
                  <h4 className="text-sm font-bold text-emerald-700 flex items-center gap-2">
                    <Receipt className="h-4 w-4" /> Prescription Information (Rx)
                  </h4>
                  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
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
                <Card className="space-y-4 p-6 bg-gradient-to-br from-gray-50 to-white border-0 shadow-md">
                  <h3 className="text-xl font-bold">Order Summary</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between text-lg">
                      <span>Items ({selectedProducts.length}):</span>
                      <span>{selectedProducts.reduce((sum, item) => sum + item.quantity, 0)} units</span>
                    </div>
                    <div className="flex justify-between text-lg">
                      <span>Subtotal:</span>
                      <span>₹{orderTotals.subtotal.toFixed(2)}</span>
                    </div>

                    {/* Discount Section */}
                    <div className="space-y-2 border-t pt-2">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm font-medium">Discount (%):</Label>
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
                        <div className="flex justify-between text-lg text-red-600">
                          <span>Discount ({discountPercentage}%):</span>
                          <span>-₹{orderTotals.discountAmount.toFixed(2)}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between text-lg">
                      <span>GST:</span>
                      <span>₹{orderTotals.gstAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-xl border-t pt-3 mt-2">
                      <span>Total:</span>
                      <span className="text-green-600">₹{orderTotals.grandTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </Card>
              )}

              <div className="flex gap-4 pt-2">
                <Button
                  type="submit"
                  disabled={selectedProducts.length === 0 || isRecordingSales}
                  className="flex-1 text-lg py-3 px-6 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
                >
                  <ShoppingCart className="h-5 w-5 mr-2" />
                  {isRecordingSales ? "Recording..." : "Record Sale"}
                </Button>
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
                  className="flex-1 text-lg py-3 px-6"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        ) : (
          <Button
            className="text-lg py-3 px-6 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
            onClick={() => navigate('/sales/new')}
          >
            <Plus className="h-5 w-5 mr-2" />
            Record Sale
          </Button>
        )}
      </div>

      <Card className="shadow-xl border-0 bg-gradient-to-br from-white to-gray-50">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <CardTitle className="text-2xl font-bold">Recent Sales</CardTitle>
              <CardDescription className="text-lg mt-1">
                Latest sales transactions (Page {currentPage} of {totalPages})
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-green-600 mx-auto"></div>
              <p className="mt-4 text-muted-foreground text-lg">Loading sales...</p>
            </div>
          ) : sales.length === 0 ? (
            <div className="text-center py-16">
              <div className="bg-gray-100 p-6 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                <ShoppingCart className="h-12 w-12 text-gray-400" />
              </div>
              <h3 className="text-2xl font-bold mb-2">No Sales Recorded</h3>
              <p className="text-muted-foreground text-lg mb-6">
                Start recording sales transactions
              </p>
              <Button
                onClick={() => isMobile ? setIsDialogOpen(true) : navigate('/sales/new')}
                className="text-lg py-3 px-8 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
              >
                <Plus className="h-5 w-5 mr-2" />
                Record Your First Sale
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-xl border-0 bg-white shadow-lg overflow-hidden">
                <Table>
                  <TableHeader className="bg-gradient-to-r from-green-50 to-teal-50">
                    <TableRow>
                      <TableHead className="text-lg font-bold text-gray-700 py-4 w-1/4">Customer</TableHead>
                      <TableHead className="text-lg font-bold text-gray-700 py-4">Phone</TableHead>
                      <TableHead className="text-lg font-bold text-gray-700 py-4">Total Items</TableHead>
                      <TableHead className="text-lg font-bold text-gray-700 py-4">Total Amount</TableHead>
                      <TableHead className="text-lg font-bold text-gray-700 py-4">Payment</TableHead>
                      <TableHead className="text-lg font-bold text-gray-700 py-4">Date</TableHead>
                      <TableHead className="text-lg font-bold text-gray-700 py-4">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedSales.map((group) => (
                      <React.Fragment key={group.bill_id}>
                        <TableRow
                          className="hover:bg-green-50 transition-colors cursor-pointer"
                          onClick={() => toggleExpand(group.bill_id)}
                        >
                          <TableCell className="font-medium text-lg py-4">
                            <div className="flex items-center gap-2">
                              {expandedBillId === group.bill_id ? (
                                <ChevronDown className="h-5 w-5 text-green-600" />
                              ) : (
                                <ChevronRight className="h-5 w-5 text-gray-400" />
                              )}
                              {group.customer_name}
                            </div>
                          </TableCell>
                          <TableCell className="text-lg py-4">{group.customer_phone}</TableCell>
                          <TableCell className="text-lg py-4">{group.items.length} product(s)</TableCell>
                          <TableCell className="text-lg py-4 font-bold text-green-600">₹{group.total_amount.toFixed(2)}</TableCell>
                          <TableCell className="text-lg py-4">
                            <Badge 
                              variant={group.items[0]?.payment_mode === 'credit' ? 'destructive' : 'secondary'}
                              className={`text-sm py-1 px-3 capitalize ${
                                group.items[0]?.payment_mode === 'credit' 
                                  ? 'bg-orange-100 text-orange-700 hover:bg-orange-200 border-orange-200' 
                                  : group.items[0]?.payment_mode === 'cash'
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200 border-green-200'
                                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200'
                              }`}
                            >
                              {group.items[0]?.payment_mode || 'cash'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-lg py-4">{new Date(group.sale_date || group.created_at).toLocaleDateString()}</TableCell>
                          <TableCell className="text-lg py-4" onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => showSaleDetails(group)}
                                className="h-8 w-8 p-0 border-blue-200 hover:bg-blue-50 text-blue-600"
                                title="View Details"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>

                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!group.items[0]?.bill_id}
                                onClick={() => group.items[0]?.bill_id && navigate(`/print-bill/${group.items[0].bill_id}`)}
                                className="h-8 w-8 p-0 border-purple-200 hover:bg-purple-50 text-purple-600"
                                title="Print Bill"
                              >
                                <Printer className="h-4 w-4" />
                              </Button>

                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => downloadSaleDetails(group)}
                                className="h-8 w-8 p-0 border-green-200 hover:bg-green-50 text-green-600"
                                title="Download Receipt"
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* Expanded Inner Items */}
                        {expandedBillId === group.bill_id && (
                          <TableRow className="bg-gray-50 hover:bg-gray-50">
                            <TableCell colSpan={6} className="p-0 border-b">
                              <div className="px-6 py-4">
                                <h4 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wider">Items in this Transaction</h4>
                                <div className="rounded-md border bg-white overflow-hidden shadow-sm">
                                  <Table>
                                    <TableHeader className="bg-gray-100/50">
                                      <TableRow>
                                        <TableHead className="font-medium text-gray-600">Product</TableHead>
                                        <TableHead className="font-medium text-gray-600">Qty</TableHead>
                                        <TableHead className="font-medium text-gray-600">Unit Rate</TableHead>
                                        <TableHead className="font-medium text-gray-600 text-right">Total</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {group.items.map((item, idx) => (
                                        <TableRow key={idx}>
                                          <TableCell className="py-2">{item.products?.name}</TableCell>
                                          <TableCell className="py-2">
                                            {item.quantity}
                                            {item.sub_qty ? <span className="text-xs text-blue-600 ml-1">+{item.sub_qty} tabs</span> : null}
                                          </TableCell>
                                          <TableCell className="py-2">₹{item.unit_price.toFixed(2)}</TableCell>
                                          <TableCell className="py-2 text-right font-medium">₹{item.total_price.toFixed(2)}</TableCell>
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
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="mt-8">
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => handlePageChange(currentPage - 1)}
                          className={`${currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"} text-lg py-2 px-4`}
                        />
                      </PaginationItem>

                      {/* First page */}
                      <PaginationItem>
                        <PaginationLink
                          onClick={() => handlePageChange(1)}
                          isActive={currentPage === 1}
                          className="text-lg py-2 px-4"
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
                                className="text-lg py-2 px-4"
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
                            className="text-lg py-2 px-4"
                          >
                            {totalPages}
                          </PaginationLink>
                        </PaginationItem>
                      )}

                      <PaginationItem>
                        <PaginationNext
                          onClick={() => handlePageChange(currentPage + 1)}
                          className={`${currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"} text-lg py-2 px-4`}
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

      {/* Sale Detail Modal */}
      <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
        <DialogContent className="w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">Sale Details</DialogTitle>
            <DialogDescription className="text-lg">
              Detailed information about this sale
            </DialogDescription>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-6">
              <Card className="bg-gradient-to-br from-gray-50 to-white border-0 shadow-md">
                <CardContent className="p-6 space-y-4">
                  <h3 className="text-xl font-bold border-b pb-2">Transaction Summary</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Date</p>
                      <p className="font-medium">{new Date(selectedTransaction.sale_date || selectedTransaction.created_at).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Items</p>
                      <p className="font-medium">{selectedTransaction.items.length} product(s)</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">GST Amount</p>
                      <p className="font-medium">₹{(selectedTransaction.gst_amount || 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Amount</p>
                      <p className="font-bold text-green-600 text-lg">₹{selectedTransaction.total_amount.toFixed(2)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-gray-50 to-white border-0 shadow-md">
                <CardContent className="p-6 space-y-4">
                  <h3 className="text-xl font-bold border-b pb-2">Customer Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Name</p>
                      <p className="font-medium">{selectedTransaction.customer_name || "Walk-in Customer"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Phone</p>
                      <p className="font-medium">{selectedTransaction.customer_phone || "Not provided"}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gradient-to-br from-gray-50 to-white border-0 shadow-md">
                <CardContent className="p-0 overflow-hidden">
                  <div className="bg-gray-100 px-6 py-3 border-b">
                    <h3 className="text-lg font-bold">Items Purchased</h3>
                  </div>
                  <div className="max-h-60 overflow-y-auto p-0">
                    <Table>
                      <TableHeader className="bg-white sticky top-0 shadow-sm z-10">
                        <TableRow>
                          <TableHead className="font-medium">Product</TableHead>
                          <TableHead className="font-medium">Qty</TableHead>
                          <TableHead className="font-medium text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedTransaction.items.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="py-3 px-6">{item.products?.name}</TableCell>
                            <TableCell className="py-3 px-6">
                              {item.quantity}
                              {item.sub_qty ? <span className="text-xs text-blue-600 ml-1">+{item.sub_qty} tabs</span> : null}
                            </TableCell>
                            <TableCell className="py-3 px-6 text-right font-medium">₹{item.total_price.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 pt-1">
                <Button
                  onClick={() => downloadSaleDetails(selectedTransaction)}
                  className="w-full h-10 px-3 text-sm sm:text-base bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
                >
                  Save Receipt
                </Button>
                <Button
                  variant="outline"
                  disabled={!selectedTransaction.items[0]?.bill_id}
                  onClick={() => selectedTransaction.items[0]?.bill_id && navigate(`/print-bill/${selectedTransaction.items[0].bill_id}`)}
                  className="w-full h-10 px-3 text-sm sm:text-base"
                >
                  Print Bill
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setIsDetailModalOpen(false)}
                  className="w-full h-10 px-3 text-sm sm:text-base"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

