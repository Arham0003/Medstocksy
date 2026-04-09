import { useState, useEffect, useMemo, useCallback, useRef, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate } from 'react-router-dom';
import {
  Search, X, Save, ChevronDown, ChevronUp, Trash2,
  HelpCircle, ArrowLeft, CreditCard, Banknote, Smartphone, Receipt,
  CalendarDays, Stethoscope, CheckCircle2, Circle, ShoppingCart, User
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────
interface Product {
  id: string;
  name: string;
  quantity: number;
  selling_price: number;
  gst: number | null;
  hsn_code?: string | null;
  batch_number?: string | null;
  expiry_date?: string | null;
  pcs_per_unit?: number | null;
  category?: string | null;
  manufacturer?: string | null;
}

interface Settings {
  gst_enabled: boolean;
  default_gst_rate: number;
  gst_type?: string;
}

interface BillRow {
  uid: string; // unique row id for React keys & refs
  productId: string;
  productName: string;
  stock: number;
  qty: number;
  subQty: number | '';
  pcsPerUnit: number;
  batch: string;
  expiry: string;
  hsn: string;
  mrp: number;
  rate: number;
  gst: number;
  discount: number;
  amount: number;
}

const EMPTY_ROW = (): BillRow => ({
  uid: crypto.randomUUID(),
  productId: '',
  productName: '',
  stock: 0,
  qty: 1,
  subQty: '',
  pcsPerUnit: 10,
  batch: '',
  expiry: '',
  hsn: '',
  mrp: 0,
  rate: 0,
  gst: 0,
  discount: 0,
  amount: 0,
});

// ─── Helpers ────────────────────────────────────────────────────────────────
// Calculates: gross = (full strips × rate) + (loose tablets × per-tablet rate)
function calcAmount(row: BillRow, settings: Settings | null): number {
  const { qty, subQty, pcsPerUnit, rate, gst, discount } = row;
  const isGstInclusive = settings?.gst_type === 'inclusive';

  // Full-strip portion
  let gross = rate * qty;

  // Add loose-tablet portion if sub-qty is provided
  if (subQty !== '' && Number(subQty) > 0 && pcsPerUnit > 0) {
    gross += (rate / pcsPerUnit) * Number(subQty);
  }

  const discountAmt = (gross * discount) / 100;
  const net = gross - discountAmt;

  if (settings?.gst_enabled) {
    if (isGstInclusive) {
      return net; // GST already included
    } else {
      return net + (net * gst) / 100;
    }
  }
  return net;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function RecordSale() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  // ─── Data ───────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // ─── Customer Info ──────────────────────────────────────────────────────
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [billDate, setBillDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [prescriptionMonths, setPrescriptionMonths] = useState<number | ''>('');
  const [monthsTaken, setMonthsTaken] = useState<number | ''>(1);
  const [prescriptionNotes, setPrescriptionNotes] = useState('');

  // ─── CRM Retrieve Dialog ─────────────────────────────────────────────────
  type CrmField = 'name' | 'address' | 'doctor' | 'prescription_months' | 'months_taken' | 'notes';
  interface CrmBillItem {
    item_key: string;       // product_id used as unique key
    product_id: string;
    product_name: string;
    purchase_count: number; // how many times this product bought (all time)
    in_last_bill: boolean;  // was this in the most recent bill?
    quantity: number;       // qty from most recent purchase
    sub_qty: number | null;
    pcs_per_unit: number | null;
    unit_price: number;
    batch: string;
    expiry: string;
    hsn: string;
    gst: number;
    discount: number;
  }
  interface CrmFoundData {
    customer_name?: string | null;
    customer_address?: string | null;
    doctor_name?: string | null;
    prescription_months?: number | null;
    months_taken?: number | null;
    prescription_notes?: string | null;
    bill_date?: string | null;
    bill_id?: string | null;
    items: CrmBillItem[];
  }
  const [crmDialogOpen, setCrmDialogOpen] = useState(false);
  const [crmFoundData, setCrmFoundData] = useState<CrmFoundData | null>(null);
  const [crmSelectedFields, setCrmSelectedFields] = useState<Set<CrmField>>(new Set());
  const [crmSelectedItems, setCrmSelectedItems] = useState<Set<string>>(new Set()); // sale_id set

  // ─── Payment ────────────────────────────────────────────────────────────
  const [paymentMode, setPaymentMode] = useState('cash');
  const [globalDiscount, setGlobalDiscount] = useState(0);

  // ─── Rows ───────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<BillRow[]>([EMPTY_ROW()]);

  // ─── Product search state per row  ─────────────────────────────────────
  const [activeSearchRow, setActiveSearchRow] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // ─── UI state ───────────────────────────────────────────────────────────
  const [showShortcuts, setShowShortcuts] = useState(true);
  const [showShortcutOverlay, setShowShortcutOverlay] = useState(false);
  const [showPrescription, setShowPrescription] = useState(false);

  // ─── Master Search (new) ────────────────────────────────────────────────
  const [masterSearch, setMasterSearch] = useState('');
  const [masterHighlight, setMasterHighlight] = useState(0);
  const [masterDropdownOpen, setMasterDropdownOpen] = useState(false);

  // ─── Refs for tabbing ──────────────────────────────────────────────────
  const phoneRef = useRef<HTMLInputElement>(null);
  const masterSearchRef = useRef<HTMLInputElement>(null);
  const masterDropdownRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, Map<string, HTMLInputElement>>>(new Map());

  // Helper to set a ref for a specific row+field
  const setFieldRef = useCallback((rowUid: string, field: string, el: HTMLInputElement | null) => {
    if (!el) return;
    if (!rowRefs.current.has(rowUid)) rowRefs.current.set(rowUid, new Map());
    rowRefs.current.get(rowUid)!.set(field, el);
  }, []);

  const focusField = useCallback((rowUid: string, field: string) => {
    setTimeout(() => {
      rowRefs.current.get(rowUid)?.get(field)?.focus();
    }, 50);
  }, []);

  // ─── Fetch products & settings ─────────────────────────────────────────
  useEffect(() => {
    const fetch = async () => {
      try {
        const [prodRes, settingsRes] = await Promise.all([
          supabase.from('products').select('id, name, quantity, selling_price, gst, hsn_code, batch_number, expiry_date, pcs_per_unit, category, manufacturer').gt('quantity', 0),
          profile?.account_id
            ? supabase.from('settings').select('gst_enabled, default_gst_rate, gst_type').eq('account_id', profile.account_id).single()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (prodRes.error) throw prodRes.error;
        setProducts((prodRes.data as any) || []);
        if (settingsRes.data) setSettings(settingsRes.data as any);
      } catch (err: any) {
        toast({ variant: 'destructive', title: 'Error loading data', description: err.message });
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [profile?.account_id]);

  // ─── CRM lookup: group ALL purchases by product_id with frequency count ──
  const fetchCrmData = useCallback(async (phone?: string, name?: string) => {
    try {
      // Step 1: most-recent bill header (for customer details)
      let headerQuery = (supabase as any)
        .from('sales')
        .select('bill_id, customer_name, customer_address, doctor_name, sale_date, prescription_months, months_taken, prescription_notes, created_at')
        .order('created_at', { ascending: false })
        .limit(1);

      if (phone) {
        headerQuery = headerQuery.eq('customer_phone', phone);
      } else if (name && name.trim().length >= 3) {
        headerQuery = headerQuery.ilike('customer_name', `%${name.trim()}%`);
      } else {
        return;
      }

      const { data: headerData } = (await headerQuery) as { data: any[] | null };
      if (!headerData || headerData.length === 0) return;
      const header = headerData[0];
      const lastBillId = header.bill_id;

      // Step 2: fetch ALL sale rows for this customer across all time
      let allQuery = (supabase as any)
        .from('sales')
        .select('id, bill_id, product_id, quantity, sub_qty, pcs_per_unit, unit_price, discount_percentage, created_at, products(name, hsn_code, batch_number, expiry_date, gst)')
        .order('created_at', { ascending: false });

      if (phone) allQuery = allQuery.eq('customer_phone', phone);
      else if (name) allQuery = allQuery.ilike('customer_name', `%${name.trim()}%`);

      const { data: allRows } = (await allQuery) as { data: any[] | null };

      // Step 3: group by product_id — count purchases, keep latest details
      const productMap = new Map<string, CrmBillItem>();
      if (allRows) {
        // rows are newest-first; first hit per product = most recent details
        allRows.forEach((r: any) => {
          const pid = r.product_id;
          if (productMap.has(pid)) {
            productMap.get(pid)!.purchase_count++;
          } else {
            productMap.set(pid, {
              item_key: pid,
              product_id: pid,
              product_name: r.products?.name || 'Unknown Product',
              purchase_count: 1,
              in_last_bill: r.bill_id === lastBillId,
              quantity: r.quantity || 1,
              sub_qty: r.sub_qty ?? null,
              pcs_per_unit: r.pcs_per_unit ?? null,
              unit_price: r.unit_price || 0,
              batch: r.products?.batch_number || '',
              expiry: r.products?.expiry_date ? r.products.expiry_date.substring(0, 10) : '',
              hsn: r.products?.hsn_code || '',
              gst: r.products?.gst || 0,
              discount: r.discount_percentage || 0,
            });
          }
        });
      }

      // Sort: last-bill items first, then by purchase frequency desc
      const items = Array.from(productMap.values()).sort((a, b) => {
        if (a.in_last_bill && !b.in_last_bill) return -1;
        if (!a.in_last_bill && b.in_last_bill) return 1;
        return b.purchase_count - a.purchase_count;
      });

      const available = new Set<CrmField>();
      if (header.customer_name) available.add('name');
      if (header.customer_address) available.add('address');
      if (header.doctor_name) available.add('doctor');
      if (header.prescription_months != null) available.add('prescription_months');
      if (header.months_taken != null) available.add('months_taken');
      if (header.prescription_notes) available.add('notes');

      if (available.size > 0 || items.length > 0) {
        setCrmFoundData({
          customer_name: header.customer_name,
          customer_address: header.customer_address,
          doctor_name: header.doctor_name,
          prescription_months: header.prescription_months,
          months_taken: header.months_taken,
          prescription_notes: header.prescription_notes,
          bill_date: header.sale_date || header.created_at?.substring(0, 10),
          bill_id: lastBillId,
          items,
        });
        setCrmSelectedFields(new Set(available));
        // Pre-select only items that were in the last bill
        const lastBillItems = items.filter(i => i.in_last_bill).map(i => i.item_key);
        setCrmSelectedItems(new Set(lastBillItems.length > 0 ? lastBillItems : items.map(i => i.item_key)));
        setCrmDialogOpen(true);
      }
    } catch { /* ignore */ }
  }, []);

  // Trigger on phone number
  useEffect(() => {
    if (!customerPhone || customerPhone.replace(/\D/g, '').length < 10) return;
    const timer = setTimeout(() => fetchCrmData(customerPhone, undefined), 600);
    return () => clearTimeout(timer);
  }, [customerPhone, fetchCrmData]);

  // Trigger on name (3+ chars, debounced)
  const nameSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNameChange = useCallback((value: string) => {
    setCustomerName(value);
    if (nameSearchTimer.current) clearTimeout(nameSearchTimer.current);
    if (value.trim().length < 3 || customerPhone) return; // skip if phone already set
    nameSearchTimer.current = setTimeout(() => fetchCrmData(undefined, value), 800);
  }, [customerPhone, fetchCrmData]);

  // ─── Apply selected CRM fields ──────────────────────────────────────────
  const applyCrmFields = useCallback(() => {
    if (!crmFoundData) return;

    // Apply patient detail fields
    if (crmSelectedFields.has('name') && crmFoundData.customer_name) setCustomerName(crmFoundData.customer_name);
    if (crmSelectedFields.has('address') && crmFoundData.customer_address) setCustomerAddress(crmFoundData.customer_address);
    if (crmSelectedFields.has('doctor') && crmFoundData.doctor_name) setDoctorName(crmFoundData.doctor_name);
    if (crmSelectedFields.has('prescription_months') && crmFoundData.prescription_months != null) setPrescriptionMonths(crmFoundData.prescription_months);
    if (crmSelectedFields.has('notes') && crmFoundData.prescription_notes) setPrescriptionNotes(crmFoundData.prescription_notes);

    // ── Auto-increment months_taken when same medicines selected ──
    // Check if selected items == last bill's items (same prescription repeat)
    const lastBillProductIds = crmFoundData.items
      .filter(i => i.in_last_bill)
      .map(i => i.product_id)
      .sort();
    const selectedProductIds = [...crmSelectedItems].sort();
    const isSameAslastBill =
      lastBillProductIds.length > 0 &&
      lastBillProductIds.length === selectedProductIds.length &&
      lastBillProductIds.every((id, idx) => id === selectedProductIds[idx]);

    if (isSameAslastBill && crmFoundData.months_taken != null) {
      // Same prescription repeated → months counter goes up by 1
      setMonthsTaken((crmFoundData.months_taken as number) + 1);
    } else if (crmSelectedFields.has('months_taken') && crmFoundData.months_taken != null) {
      setMonthsTaken(crmFoundData.months_taken);
    } else if (crmFoundData.prescription_months != null) {
      // First visit for this prescription should be 1
      setMonthsTaken(1);
    }

    // Load selected prescription items into bill rows
    const selectedItems = crmFoundData.items.filter(i => crmSelectedItems.has(i.item_key));
    if (selectedItems.length > 0) {
      const newRows: BillRow[] = selectedItems.map(item => {
        const liveProduct = products.find(p => p.id === item.product_id);
        const row: BillRow = {
          uid: crypto.randomUUID(),
          productId: item.product_id,
          productName: item.product_name,
          stock: liveProduct?.quantity ?? 0,
          qty: item.quantity,
          subQty: item.sub_qty !== null ? item.sub_qty : '',
          pcsPerUnit: item.pcs_per_unit || 10,
          batch: item.batch,
          expiry: item.expiry,
          hsn: item.hsn,
          mrp: item.unit_price,
          rate: item.unit_price,
          gst: item.gst,
          discount: item.discount,
          amount: 0,
        };
        row.amount = calcAmount(row, settings);
        return row;
      });
      setRows(prev => {
        const filledRows = prev.filter(r => r.productId);
        return [...filledRows, ...newRows];
      });
    }

    setCrmDialogOpen(false);
    const itemCount = selectedItems.length;
    toast({
      title: '✅ Prescription loaded!',
      description: `${itemCount} medicine(s) added to bill${isSameAslastBill ? ' · months count auto-updated' : ''
        }.`,
    });
  }, [crmFoundData, crmSelectedFields, crmSelectedItems, products, settings, toast]);

  const toggleCrmField = useCallback((field: CrmField) => {
    setCrmSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field); else next.add(field);
      return next;
    });
  }, []);

  const toggleCrmItem = useCallback((itemKey: string) => {
    setCrmSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemKey)) next.delete(itemKey); else next.add(itemKey);
      return next;
    });
  }, []);

  // ─── Filtered products for search ──────────────────────────────────────
  const filteredProducts = useMemo(() => {
    if (!searchTerm) return products;
    const lower = searchTerm.toLowerCase();
    return products.filter(p => 
      p.name.toLowerCase().includes(lower) ||
      p.hsn_code?.toLowerCase().includes(lower) ||
      p.batch_number?.toLowerCase().includes(lower) ||
      p.category?.toLowerCase().includes(lower) ||
      p.manufacturer?.toLowerCase().includes(lower)
    );
  }, [products, searchTerm]);

  // Master search filtered products
  const masterFilteredProducts = useMemo(() => {
    if (!masterSearch.trim()) return [];
    const lower = masterSearch.toLowerCase();
    return products.filter(p => 
      p.name.toLowerCase().includes(lower) ||
      p.hsn_code?.toLowerCase().includes(lower) ||
      p.batch_number?.toLowerCase().includes(lower) ||
      p.category?.toLowerCase().includes(lower) ||
      p.manufacturer?.toLowerCase().includes(lower)
    ).slice(0, 20);
  }, [products, masterSearch]);

  // ─── Row operations ───────────────────────────────────────────────────
  const updateRow = useCallback((index: number, patch: Partial<BillRow>) => {
    setRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      // Recalculate amount
      next[index].amount = calcAmount(next[index], settings);
      return next;
    });
  }, [settings]);

  const addNewRow = useCallback(() => {
    const newRow = EMPTY_ROW();
    setRows(prev => [...prev, newRow]);
    // Focus product field of new row
    setTimeout(() => {
      setActiveSearchRow(rows.length);
      focusField(newRow.uid, 'product');
    }, 100);
  }, [rows.length, focusField]);

  const removeRow = useCallback((index: number) => {
    setRows(prev => {
      if (prev.length === 1) return [EMPTY_ROW()]; // always keep at least 1 row
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearRow = useCallback((index: number) => {
    setRows(prev => {
      const next = [...prev];
      next[index] = EMPTY_ROW();
      return next;
    });
  }, []);

  // ─── Product selection ────────────────────────────────────────────────
  const selectProduct = useCallback((rowIndex: number, product: Product) => {
    const gstRate = product.gst ?? settings?.default_gst_rate ?? 0;
    updateRow(rowIndex, {
      productId: product.id,
      productName: product.name,
      stock: product.quantity,
      batch: product.batch_number || '',
      expiry: product.expiry_date ? product.expiry_date.substring(0, 10) : '',
      hsn: product.hsn_code || '',
      mrp: product.selling_price,
      rate: product.selling_price,
      gst: gstRate,
      pcsPerUnit: product.pcs_per_unit || 10,
    });
    setActiveSearchRow(null);
    setSearchTerm('');
    setTimeout(() => focusField(rows[rowIndex]?.uid || '', 'qty'), 80);
  }, [updateRow, settings, rows, focusField]);

  // ─── Add product via master search bar ───────────────────────────────────
  const addProductFromMasterSearch = useCallback((product: Product) => {
    const gstRate = product.gst ?? settings?.default_gst_rate ?? 0;
    const newRow: BillRow = {
      uid: crypto.randomUUID(),
      productId: product.id,
      productName: product.name,
      stock: product.quantity,
      batch: product.batch_number || '',
      expiry: product.expiry_date ? product.expiry_date.substring(0, 10) : '',
      hsn: product.hsn_code || '',
      mrp: product.selling_price,
      rate: product.selling_price,
      gst: gstRate,
      pcsPerUnit: product.pcs_per_unit || 10,
      qty: 1,
      subQty: '',
      discount: 0,
      amount: 0,
    };
    newRow.amount = calcAmount(newRow, settings);
    setRows(prev => {
      const last = prev[prev.length - 1];
      const base = (last && !last.productId) ? prev.slice(0, -1) : prev;
      return [...base, newRow];
    });
    setMasterSearch('');
    setMasterDropdownOpen(false);
    setMasterHighlight(0);
    setTimeout(() => focusField(newRow.uid, 'qty'), 80);
  }, [settings, focusField]);

  // ─── Master search keyboard handler ─────────────────────────────────────
  const handleMasterSearchKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMasterHighlight(prev => Math.min(prev + 1, masterFilteredProducts.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMasterHighlight(prev => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const sel = masterFilteredProducts[masterHighlight];
      if (sel) addProductFromMasterSearch(sel);
      return;
    }
    if (e.key === 'Escape') {
      setMasterDropdownOpen(false);
      setMasterSearch('');
      return;
    }
  }, [masterFilteredProducts, masterHighlight, addProductFromMasterSearch]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!masterDropdownRef.current || !masterDropdownOpen) return;
    const items = masterDropdownRef.current.querySelectorAll('[data-item]');
    (items[masterHighlight] as HTMLElement)?.scrollIntoView({ block: 'nearest' });
  }, [masterHighlight, masterDropdownOpen]);

  // ─── Totals calculation ───────────────────────────────────────────────
  const totals = useMemo(() => {
    const isGstInclusive = settings?.gst_type === 'inclusive';
    let subtotal = 0;
    let gstTotal = 0;
    let discountTotal = 0;

    rows.forEach(row => {
      if (!row.productId) return;

      // Full strips + loose tablets
      let gross = row.rate * row.qty;
      if (row.subQty !== '' && Number(row.subQty) > 0 && row.pcsPerUnit > 0) {
        gross += (row.rate / row.pcsPerUnit) * Number(row.subQty);
      }

      // Per-row discount
      const rowDiscAmt = (gross * row.discount) / 100;
      const net = gross - rowDiscAmt;

      // Global discount
      const globalDiscAmt = (net * globalDiscount) / 100;
      const netAfterGlobal = net - globalDiscAmt;

      subtotal += gross;
      discountTotal += rowDiscAmt + globalDiscAmt;

      if (settings?.gst_enabled) {
        if (isGstInclusive) {
          gstTotal += (netAfterGlobal * row.gst) / 100;
        } else {
          gstTotal += (netAfterGlobal * row.gst) / 100;
        }
      }
    });

    const grandTotal = settings?.gst_enabled && !isGstInclusive
      ? (subtotal - discountTotal) + gstTotal
      : (subtotal - discountTotal);

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      gstTotal: Math.round(gstTotal * 100) / 100,
      discountTotal: Math.round(discountTotal * 100) / 100,
      grandTotal: Math.round(grandTotal),
    };
  }, [rows, settings, globalDiscount]);

  // ─── Handle Save ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const validRows = rows.filter(r => r.productId);
    if (validRows.length === 0) {
      toast({ variant: 'destructive', title: 'No products', description: 'Add at least one product before saving.' });
      return;
    }
    if (isSaving) return;
    setIsSaving(true);

    try {
      const billId = crypto.randomUUID();
      const isGstInclusive = settings?.gst_type === 'inclusive';

      const salesToInsert = validRows.map(row => {
        // Full strips + loose tablets
        let gross = row.rate * row.qty;
        if (row.subQty !== '' && Number(row.subQty) > 0 && row.pcsPerUnit > 0) {
          gross += (row.rate / row.pcsPerUnit) * Number(row.subQty);
        }

        // Per-row discount
        const rowDiscAmt = (gross * row.discount) / 100;
        const net = gross - rowDiscAmt;

        // Global discount
        const globalDiscAmt = (net * globalDiscount) / 100;
        const netAfterAll = net - globalDiscAmt;

        let finalGst = 0;
        let finalTotal = netAfterAll;

        if (settings?.gst_enabled) {
          finalGst = (netAfterAll * row.gst) / 100;
          if (!isGstInclusive) {
            finalTotal = netAfterAll + finalGst;
          }
        }

        const hasSubQty = row.subQty !== '' && Number(row.subQty) > 0;

        return {
          account_id: profile?.account_id,
          bill_id: billId,
          product_id: row.productId,
          user_id: profile?.id,
          quantity: row.qty,
          sub_qty: hasSubQty ? Number(row.subQty) : null,
          pcs_per_unit: hasSubQty ? row.pcsPerUnit : null,
          unit_price: Math.round(row.rate * 100) / 100,
          total_price: Math.round(finalTotal),
          gst_amount: Math.round(finalGst * 100) / 100,
          payment_mode: paymentMode,
          customer_name: customerName || 'Walk-in Customer',
          customer_phone: customerPhone || null,
          customer_address: customerAddress || null,
          doctor_name: doctorName || null,
          sale_date: billDate, // Store the user-edited date as the primary sale_date
          prescription_months: prescriptionMonths === '' ? null : Number(prescriptionMonths),
          months_taken: monthsTaken === '' ? null : Number(monthsTaken),
          prescription_notes: prescriptionNotes || null,
          discount_percentage: row.discount + globalDiscount,
        };
      });

      let { error } = await supabase.from('sales').insert(salesToInsert);

      if (error && error.message?.includes('column')) {
        // Fallback without optional fields
        const fallback = salesToInsert.map(s => {
          const { customer_name, customer_phone, customer_address, doctor_name, prescription_months, months_taken, prescription_notes, payment_mode, sub_qty, pcs_per_unit, ...rest } = s;
          return rest;
        });
        const res2 = await supabase.from('sales').insert(fallback);
        error = res2.error;
        if (error) throw new Error('Database needs migration. Please run required updates.');
      } else if (error) {
        throw error;
      }

      toast({
        title: 'Sale recorded!',
        description: `${validRows.length} item(s) billed successfully${customerName ? ' for ' + customerName : ''}`,
      });

      // Navigate to print
      navigate(`/print-bill/${billId}`);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error recording sale', description: err.message });
    } finally {
      setIsSaving(false);
    }
  }, [rows, settings, globalDiscount, paymentMode, customerName, customerPhone, customerAddress, doctorName, billDate, prescriptionMonths, monthsTaken, prescriptionNotes, profile, navigate, toast, isSaving]);

  // ─── Keyboard shortcuts (global) ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      // F10 or Ctrl+S = Save
      if (e.key === 'F10' || (e.ctrlKey && e.key === 's')) {
        e.preventDefault();
        handleSave();
        return;
      }
      // Ctrl+P = Print (save first then go to print)
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        handleSave();
        return;
      }
      // Escape = go back
      if (e.key === 'Escape') {
        navigate('/sales');
        return;
      }
      // F2 = focus master search
      if (e.key === 'F2') {
        e.preventDefault();
        masterSearchRef.current?.focus();
        return;
      }
      // Ctrl+F = jump to phone
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        phoneRef.current?.focus();
        return;
      }
      // Alt+S = focus sub qty of current row
      if (e.altKey && e.key === 's') {
        e.preventDefault();
        // Find the currently focused row
        const active = document.activeElement as HTMLElement;
        const rowEl = active?.closest('[data-row-uid]');
        if (rowEl) {
          const uid = rowEl.getAttribute('data-row-uid')!;
          focusField(uid, 'subQty');
        }
        return;
      }
      // Alt+C = clear current row
      if (e.altKey && e.key === 'c') {
        e.preventDefault();
        const active = document.activeElement as HTMLElement;
        const rowEl = active?.closest('[data-row-uid]');
        if (rowEl) {
          const uid = rowEl.getAttribute('data-row-uid')!;
          const idx = rows.findIndex(r => r.uid === uid);
          if (idx >= 0) clearRow(idx);
        }
        return;
      }
      // Delete = remove row (only when no input focused or when row action area)
      if (e.key === 'Delete' && e.altKey) {
        e.preventDefault();
        const active = document.activeElement as HTMLElement;
        const rowEl = active?.closest('[data-row-uid]');
        if (rowEl) {
          const uid = rowEl.getAttribute('data-row-uid')!;
          const idx = rows.findIndex(r => r.uid === uid);
          if (idx >= 0) removeRow(idx);
        }
        return;
      }
      // ? or Ctrl+/ = shortcut help
      if (e.key === '?' || (e.ctrlKey && e.key === '/')) {
        // Only show if not typing in an input
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setShowShortcutOverlay(prev => !prev);
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, navigate, rows, focusField, clearRow, removeRow]);

  // ─── Tab flow handler for row fields ──────────────────────────────────
  const TAB_FIELDS = ['qty', 'subQty', 'batch', 'expiry', 'hsn', 'rate', 'discount', 'gst'];

  const handleFieldKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>, rowIndex: number, field: string) => {
    const row = rows[rowIndex];
    if (!row) return;

    if (e.key === 'Tab' && !e.shiftKey) {
      const currentIdx = TAB_FIELDS.indexOf(field);
      if (currentIdx >= 0 && currentIdx < TAB_FIELDS.length - 1) {
        e.preventDefault();
        focusField(row.uid, TAB_FIELDS[currentIdx + 1]);
      }
    }

    if (e.key === 'Tab' && e.shiftKey) {
      const currentIdx = TAB_FIELDS.indexOf(field);
      if (currentIdx > 0) {
        e.preventDefault();
        focusField(row.uid, TAB_FIELDS[currentIdx - 1]);
      }
    }

    // Enter on discount = focus master search
    if (e.key === 'Enter' && (field === 'discount' || field === 'gst')) {
      e.preventDefault();
      setMasterDropdownOpen(false);
      setTimeout(() => masterSearchRef.current?.focus(), 50);
    }
  }, [rows, focusField, masterFilteredProducts, activeSearchRow, selectProduct]);

  // ─── Payment mode icons ───────────────────────────────────────────────
  const paymentModes = [
    { key: 'cash', label: 'Cash', icon: Banknote },
    { key: 'upi', label: 'UPI', icon: Smartphone },
    { key: 'card', label: 'Card', icon: CreditCard },
    { key: 'credit', label: 'Credit', icon: Receipt },
  ];

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-green-600"></div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="fixed inset-0 flex flex-col bg-gray-50 overflow-hidden z-50">


      {/* ──────── CRM RETRIEVE DIALOG ──────── */}
      {crmDialogOpen && crmFoundData && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setCrmDialogOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 p-5 border-b border-gray-100">
              <div className="bg-green-100 rounded-full p-2 shrink-0">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-gray-800">Returning Customer Found!</h2>
                <p className="text-sm text-gray-500">
                  {crmFoundData.customer_name || 'Customer'} &bull; Last visit: {crmFoundData.bill_date ? new Date(crmFoundData.bill_date).toLocaleDateString('en-IN') : 'Unknown'}
                </p>
              </div>
              <button type="button" onClick={() => setCrmDialogOpen(false)} className="text-gray-400 hover:text-gray-600 shrink-0">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 p-5 space-y-5">

              {/* ── Customer Details Section ── */}
              {[
                { field: 'name' as CrmField, label: 'Patient Name', value: crmFoundData.customer_name },
                { field: 'address' as CrmField, label: 'Address', value: crmFoundData.customer_address },
                { field: 'doctor' as CrmField, label: 'Doctor', value: crmFoundData.doctor_name },
                { field: 'prescription_months' as CrmField, label: 'Months Prescribed', value: crmFoundData.prescription_months != null ? `${crmFoundData.prescription_months} months` : null },
                { field: 'months_taken' as CrmField, label: 'Months Taken', value: crmFoundData.months_taken != null ? `${crmFoundData.months_taken} months` : null },
                { field: 'notes' as CrmField, label: 'Notes', value: crmFoundData.prescription_notes },
              ].filter(item => item.value != null).length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Patient Details</h3>
                      <button
                        type="button"
                        className="text-xs text-green-700 font-medium hover:underline"
                        onClick={() => {
                          const all = new Set<CrmField>(['name', 'address', 'doctor', 'prescription_months', 'months_taken', 'notes']);
                          setCrmSelectedFields(all);
                        }}
                      >Select All</button>
                    </div>
                    <div className="space-y-1.5">
                      {([
                        { field: 'name' as CrmField, label: 'Patient Name', value: crmFoundData.customer_name },
                        { field: 'address' as CrmField, label: 'Address', value: crmFoundData.customer_address },
                        { field: 'doctor' as CrmField, label: 'Doctor', value: crmFoundData.doctor_name },
                        { field: 'prescription_months' as CrmField, label: 'Months Prescribed', value: crmFoundData.prescription_months != null ? `${crmFoundData.prescription_months} months` : null },
                        { field: 'months_taken' as CrmField, label: 'Months Taken', value: crmFoundData.months_taken != null ? `${crmFoundData.months_taken} months` : null },
                        { field: 'notes' as CrmField, label: 'Notes', value: crmFoundData.prescription_notes },
                      ]).filter(item => item.value != null).map(item => (
                        <button
                          key={item.field}
                          type="button"
                          onClick={() => toggleCrmField(item.field)}
                          className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-all text-left shadow-sm ${crmSelectedFields.has(item.field)
                              ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500/20'
                              : 'border-gray-100 hover:border-emerald-200 bg-white'
                            }`}
                        >
                          {crmSelectedFields.has(item.field)
                            ? <div className="bg-emerald-500 rounded-full p-0.5 shrink-0"><CheckCircle2 className="h-4 w-4 text-white" /></div>
                            : <div className="border-2 border-gray-200 rounded-full h-5 w-5 shrink-0" />
                          }
                          <div className="min-w-0 flex-1">
                            <span className="text-[9px] font-bold text-emerald-600/60 uppercase tracking-widest block mb-0.5">{item.label}</span>
                            <span className={`text-sm font-semibold truncate block ${crmSelectedFields.has(item.field) ? 'text-emerald-900' : 'text-gray-700'}`}>
                              {String(item.value)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              {/* ── Prescription Items Section ── */}
              {crmFoundData.items.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                      💊 Prescription History ({crmFoundData.items.length} unique medicines)
                    </h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-xs text-green-700 font-medium hover:underline"
                        onClick={() => setCrmSelectedItems(new Set(crmFoundData!.items.map(i => i.item_key)))}
                      >All</button>
                      <span className="text-gray-300">|</span>
                      <button
                        type="button"
                        className="text-xs text-gray-500 font-medium hover:underline"
                        onClick={() => setCrmSelectedItems(new Set())}
                      >None</button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {crmFoundData.items.map(item => (
                      <button
                        key={item.item_key}
                        type="button"
                        onClick={() => toggleCrmItem(item.item_key)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left ${crmSelectedItems.has(item.item_key)
                            ? 'border-green-500 bg-green-50'
                            : 'border-gray-200 hover:border-gray-300 bg-white'
                          }`}
                      >
                        {crmSelectedItems.has(item.item_key)
                          ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                          : <Circle className="h-4 w-4 text-gray-300 shrink-0" />
                        }
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-800 truncate">{item.product_name}</span>
                            {item.in_last_bill && (
                              <span className="text-[10px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded-full shrink-0">Last Rx</span>
                            )}
                            <span className="text-[10px] bg-gray-100 text-gray-500 font-semibold px-1.5 py-0.5 rounded-full shrink-0 ml-auto">
                              ×{item.purchase_count} time{item.purchase_count > 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 flex gap-3 mt-0.5">
                            <span>Qty: <strong>{item.quantity}{item.sub_qty ? ` + ${item.sub_qty} tabs` : ''}</strong></span>
                            <span>Rate: <strong>₹{item.unit_price}</strong></span>
                            {item.batch && <span>Batch: {item.batch}</span>}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer buttons */}
            <div className="p-5 border-t border-gray-100 flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 text-gray-500"
                onClick={() => setCrmDialogOpen(false)}
              >
                Leave as is
              </Button>
              <Button
                type="button"
                className="flex-1 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 text-white font-semibold"
                onClick={applyCrmFields}
                disabled={crmSelectedFields.size === 0 && crmSelectedItems.size === 0}
              >
                Load Prescription
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* ──────── SHORTCUT OVERLAY ──────── */}
      {showShortcutOverlay && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowShortcutOverlay(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 animate-in fade-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-green-700">⌨️ Keyboard Shortcuts</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowShortcutOverlay(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Tab', 'Next field'],
                ['Shift+Tab', 'Previous field'],
                ['Enter', 'Next / New row'],
                ['Esc', 'Cancel & go back'],
                ['F2', 'Jump to product search'],
                ['F10 / Ctrl+S', 'Save bill'],
                ['Ctrl+P', 'Save & Print'],
                ['Alt+C', 'Clear current row'],
                ['Alt+Delete', 'Remove current row'],
                ['Ctrl+F', 'Jump to Phone field'],
                ['Alt+S', 'Sub Qty field'],
                ['? / Ctrl+/', 'This help'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center gap-3 py-1.5">
                  <kbd className="bg-gray-100 border border-gray-300 rounded-md px-2 py-1 text-xs font-mono font-semibold min-w-[80px] text-center">
                    {key}
                  </kbd>
                  <span className="text-gray-600">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════ ZONE 1: TOP TOOLBAR (COMPACT & MODERN) ══════ */}
      <div className="bg-white border-b border-green-100 flex items-center justify-between px-4 py-2 shrink-0 z-40 relative">
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate('/sales')} 
            className="text-emerald-600 hover:bg-emerald-50 h-9 w-9" 
            title="Back (Esc)"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="bg-green-600 p-1.5 rounded-lg">
              <ShoppingCart className="h-4 w-4 text-white" />
            </div>
            <h1 className="font-semibold text-lg text-emerald-900">Record Sale</h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-4 px-3 py-1 bg-emerald-50 rounded-full border border-emerald-100 text-[11px] font-medium text-emerald-700">
            <span className="flex items-center gap-1"><kbd className="bg-white border px-1 rounded">F2</kbd> Search</span>
            <span className="w-1 h-1 bg-emerald-300 rounded-full"></span>
            <span className="flex items-center gap-1"><kbd className="bg-white border px-1 rounded">F10</kbd> Save</span>
            <span className="w-1 h-1 bg-emerald-300 rounded-full"></span>
            <span className="flex items-center gap-1"><kbd className="bg-white border px-1 rounded">?</kbd> Help</span>
          </div>
          <Button 
            onClick={handleSave} 
            disabled={isSaving || rows.every(r => !r.productId)} 
            className="bg-green-600 hover:bg-green-700 text-white font-medium h-9 px-4 rounded-md transition-colors disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save & Print'}
          </Button>
        </div>
      </div>


      {/* ══════ ZONE 2 & 3: UNIFIED SEARCH & PATIENT INFO (SLIM) ══════ */}
      <div className="bg-white border-b border-green-100 px-4 py-2 shrink-0 z-30">
        <div className="flex flex-col gap-2 max-w-[1700px] mx-auto">
          
          {/* Row 1: Product Search (Large) */}
          <div className="relative" ref={masterDropdownRef}>
            <div className={`flex items-center bg-white border transition-all rounded-xl overflow-hidden ${masterDropdownOpen ? 'border-green-500 ring-2 ring-green-100' : 'border-green-200 hover:border-green-300'}`}>
              <div className="pl-4 pr-1 text-emerald-500">
                <Search className="h-5 w-5" />
              </div>
              <input
                ref={masterSearchRef}
                value={masterSearch}
                onChange={e => {
                  setMasterSearch(e.target.value);
                  setMasterDropdownOpen(true);
                  setMasterHighlight(0);
                }}
                onFocus={() => setMasterDropdownOpen(true)}
                onKeyDown={handleMasterSearchKeyDown}
                placeholder="Search Medicine... (F2)"
                className="w-full h-11 bg-transparent outline-none text-base text-gray-800 placeholder-gray-400"
              />
              {masterSearch && (
                <button type="button" onClick={() => { setMasterSearch(''); masterSearchRef.current?.focus(); }} className="px-4 text-gray-400 hover:text-emerald-500 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Dropdown Results (Floating) */}
            {masterDropdownOpen && masterSearch.trim() !== '' && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-emerald-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="max-h-[350px] overflow-y-auto py-1">
                  {masterFilteredProducts.length > 0 ? (
                    masterFilteredProducts.map((p, idx) => (
                      <button
                        key={p.id}
                        type="button"
                        data-item
                        onClick={() => addProductFromMasterSearch(p)}
                        onMouseEnter={() => setMasterHighlight(idx)}
                        className={`w-full text-left px-5 py-2.5 flex items-center justify-between border-b border-gray-50 last:border-0 transition-colors ${masterHighlight === idx ? 'bg-emerald-50' : 'hover:bg-gray-50/50'}`}
                      >
                        <div className="flex flex-col">
                          <p className={`font-bold text-sm ${masterHighlight === idx ? 'text-emerald-700' : 'text-gray-800'}`}>{p.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline" className="text-[10px] h-4 bg-emerald-50 text-emerald-600 border-emerald-100">Stock: {p.quantity}</Badge>
                            {p.hsn_code && <span className="text-[10px] text-gray-500 font-medium">HSN: {p.hsn_code}</span>}
                            {p.category && <span className="text-[10px] text-indigo-500 font-medium px-1 bg-indigo-50 rounded">{p.category}</span>}
                            <span className="text-[10px] text-gray-400">U: {p.pcs_per_unit || 10}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-emerald-600 text-sm">₹{p.selling_price.toFixed(2)}</p>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-5 py-8 text-center text-gray-400 text-sm font-medium">
                      No medicines found matching "{masterSearch}"
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Row 2: Patient Info (Compact) */}
          <div className="flex items-center gap-4 text-sm bg-green-50 p-1.5 rounded-lg border border-green-100">
            <div className="flex items-center gap-2 pl-2 grow min-w-0">
               <div className="flex items-center gap-1.5 flex-1 min-w-0 border-r border-emerald-100 pr-3">
                  <span className="text-emerald-500 shrink-0"><Smartphone className="h-3.5 w-3.5" /></span>
                  <input
                    ref={phoneRef}
                    value={customerPhone}
                    onChange={e => {
                      let value = e.target.value;
                      if (value && !value.startsWith('+')) {
                        const cleaned = value.replace(/\D/g, '');
                        if (cleaned.length === 10) value = '+91' + cleaned;
                        else if (cleaned.length === 12 && cleaned.startsWith('91')) value = '+' + cleaned;
                        else if (cleaned.length > 0) value = '+91' + cleaned;
                      }
                      setCustomerPhone(value);
                    }}
                    placeholder="Phone"
                    className="w-full h-7 bg-transparent outline-none font-medium text-emerald-900 placeholder-emerald-300 text-sm"
                  />
               </div>
               <div className="flex items-center gap-1.5 flex-[1.5] min-w-0 border-r border-emerald-100 pr-3">
                  <span className="text-emerald-500 shrink-0"><User className="h-3.5 w-3.5" /></span>
                  <input
                    value={customerName}
                    onChange={e => handleNameChange(e.target.value)}
                    placeholder="Patient Name"
                    className="w-full h-7 bg-transparent outline-none font-medium text-emerald-900 placeholder-emerald-300 text-sm"
                  />
               </div>
               <div className="hidden lg:flex items-center gap-1.5 flex-1 min-w-0 border-r border-emerald-100 pr-3">
                  <span className="text-emerald-500 shrink-0"><Stethoscope className="h-3.5 w-3.5" /></span>
                  <input
                    value={doctorName}
                    onChange={e => setDoctorName(e.target.value)}
                    placeholder="Doctor Name"
                    className="w-full h-7 bg-transparent outline-none font-medium text-emerald-900 placeholder-emerald-300 text-sm"
                  />
               </div>
               <div className="hidden xl:flex items-center gap-1.5 flex-1 min-w-0">
                  <span className="text-emerald-500 shrink-0"><CalendarDays className="h-3.5 w-3.5" /></span>
                  <input
                    type="date"
                    value={billDate}
                    onChange={e => setBillDate(e.target.value)}
                    className="w-full h-7 bg-transparent outline-none font-medium text-emerald-900 placeholder-emerald-300 text-sm appearance-none"
                  />
               </div>
            </div>

            <button
              type="button"
              onClick={() => setShowPrescription(!showPrescription)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${showPrescription ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
            >
              Rx Info
              {showPrescription ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>

          {/* Collapsible Rx (Compact & Visible) */}
          {showPrescription && (
            <div className="flex items-center gap-4 text-xs bg-emerald-50 p-1.5 rounded-lg border border-emerald-100 shadow-sm animate-in slide-in-from-top-1 duration-200">
              <div className="flex items-center gap-3 pl-2 grow min-w-0">
                <div className="flex items-center gap-2 border-r border-emerald-200 pr-4">
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider shrink-0">Months:</span>
                  <div className="flex items-center gap-1">
                    <input 
                      type="number" 
                      min="0" 
                      value={prescriptionMonths} 
                      onChange={e => {
                        const val = e.target.value === '' ? '' : parseInt(e.target.value) || 0;
                        setPrescriptionMonths(val);
                        if (val !== '' && (monthsTaken === '' || monthsTaken === 0)) setMonthsTaken(1);
                      }} 
                      className="w-12 h-7 bg-white/70 border border-emerald-200 rounded px-1.5 outline-none focus:border-emerald-500 focus:bg-white text-center font-bold text-emerald-900 transition-all" 
                    />
                    <span className="text-[9px] text-emerald-500 font-bold px-1 py-0.5 bg-emerald-100/50 rounded uppercase">Presc.</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 border-r border-emerald-200 pr-4">
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider shrink-0">Taken:</span>
                  <div className="flex items-center gap-1">
                    <input 
                      type="number" 
                      min="0" 
                      value={monthsTaken} 
                      onChange={e => setMonthsTaken(e.target.value === '' ? '' : parseInt(e.target.value) || 0)} 
                      className="w-12 h-7 bg-white/70 border border-emerald-200 rounded px-1.5 outline-none focus:border-emerald-500 focus:bg-white text-center font-bold text-emerald-900 transition-all" 
                    />
                    <span className="text-[9px] text-emerald-500 font-bold px-1 py-0.5 bg-emerald-100/50 rounded uppercase">Done</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider shrink-0">
                    <Receipt className="h-3 w-3 inline mr-1 opacity-70" />Notes:
                  </span>
                  <input 
                    value={prescriptionNotes} 
                    onChange={e => setPrescriptionNotes(e.target.value)} 
                    placeholder="Specific patient instructions, dosage schedules, next visit info..." 
                    className="flex-1 h-7 bg-white/70 border border-emerald-200 rounded px-3 outline-none focus:border-emerald-500 focus:bg-white text-emerald-900 placeholder-emerald-300 font-medium transition-all text-xs" 
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>


      {/* ══════ ZONE 4: PRODUCT ENTRY TABLE (HIGH DENSITY) ══════ */}
      <div className="flex-1 overflow-auto px-4 py-2 bg-gray-50">
        <div className="bg-white rounded-xl shadow-sm border border-green-100 overflow-hidden min-w-[1100px] max-w-[1700px] mx-auto flex flex-col">
          {/* Table header (Thinner) */}
          <div className="grid grid-cols-[2.5fr_0.6fr_0.6fr_0.8fr_0.8fr_0.7fr_0.7fr_0.6fr_0.6fr_1fr_0.4fr] bg-green-50 border-b border-green-100 text-xs font-semibold text-green-700 py-2 px-1">
            <div className="pl-4">Product Name</div>
            <div className="text-center">Qty</div>
            <div className="text-center">Sub</div>
            <div className="px-2">Batch</div>
            <div className="px-2">Expiry</div>
            <div className="px-2">HSN</div>
            <div className="px-2">Rate</div>
            <div className="px-2">Disc%</div>
            <div className="px-2">GST%</div>
            <div className="text-right pr-6">Amount</div>
            <div></div>
          </div>

          {/* Table rows */}
          <div className="divide-y divide-green-50">
            {rows.map((row, idx) => (
              <div
                key={row.uid}
                data-row-uid={row.uid}
                className={`group transition-all duration-150 ${row.productId ? 'bg-white hover:bg-green-50/40' : 'bg-transparent'}`}
              >
                <div className="grid grid-cols-[2.5fr_0.6fr_0.6fr_0.8fr_0.8fr_0.7fr_0.7fr_0.6fr_0.6fr_1fr_0.4fr] items-center py-1 focus-within:bg-green-50/50">
                  {/* Product */}
                  <div className="pl-4 relative flex items-center min-w-0">
                    {row.productId ? (
                      <div className="flex flex-col py-0.5 overflow-hidden pointer-events-none">
                        <span className="text-sm font-semibold text-gray-800 truncate">{row.productName}</span>
                        <div className="flex items-center gap-2 mt-0">
                          <span className="text-[10px] font-medium text-emerald-600">S:{row.stock}</span>
                          <span className="text-[9px] text-gray-400">U:{row.pcsPerUnit}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 py-1 text-[11px] text-emerald-300 pointer-events-none select-none">
                        <div className="w-4 h-4 border-2 border-dashed border-emerald-100 rounded-full"></div>
                        <span>Next Medicine (F2)...</span>
                      </div>
                    )}
                  </div>

                  {/* Qty */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'qty', el)}
                      type="number"
                      min="0"
                      value={row.qty}
                      onChange={e => updateRow(idx, { qty: parseInt(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'qty')}
                      disabled={!row.productId}
                      className="h-8 text-sm px-1 text-center font-medium bg-transparent border-transparent hover:bg-white focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all shadow-none"
                    />
                  </div>

                  {/* Sub Qty */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'subQty', el)}
                      type="number"
                      min="0"
                      value={row.subQty}
                      onChange={e => updateRow(idx, { subQty: e.target.value === '' ? '' : parseInt(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'subQty')}
                      disabled={!row.productId}
                      placeholder="—"
                      className="h-8 text-sm px-1 text-center font-medium bg-transparent border-transparent hover:bg-white focus:bg-white focus:border-green-500 focus:ring-2 focus:ring-green-100 transition-all shadow-none text-green-700"
                    />
                  </div>

                  {/* Batch */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'batch', el)}
                      value={row.batch}
                      onChange={e => updateRow(idx, { batch: e.target.value })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'batch')}
                      disabled={!row.productId}
                      className="h-8 text-[12px] px-2 font-medium bg-transparent border-transparent hover:bg-white focus:bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-50 transition-all shadow-none text-gray-700"
                    />
                  </div>

                  {/* Expiry */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'expiry', el)}
                      type="date"
                      value={row.expiry}
                      onChange={e => updateRow(idx, { expiry: e.target.value })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'expiry')}
                      disabled={!row.productId}
                      className="h-8 text-[10px] px-1 font-semibold bg-transparent border-transparent hover:bg-white focus:bg-white focus:border-emerald-400 transition-all shadow-none text-gray-500 appearance-none"
                    />
                  </div>

                  {/* HSN */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'hsn', el)}
                      value={row.hsn}
                      onChange={e => updateRow(idx, { hsn: e.target.value })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'hsn')}
                      disabled={!row.productId}
                      className="h-8 text-[11px] px-2 font-medium bg-transparent border-transparent hover:bg-white focus:bg-white focus:border-emerald-400 transition-all shadow-none text-gray-500"
                    />
                  </div>

                  {/* Rate */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'rate', el)}
                      type="number"
                      step="0.01"
                      value={row.rate || ''}
                      onChange={e => updateRow(idx, { rate: parseFloat(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'rate')}
                      disabled={!row.productId}
                      className="h-8 text-sm px-1 font-medium bg-transparent border-transparent hover:bg-white focus:bg-white focus:border-emerald-500 transition-all shadow-none text-gray-900"
                    />
                  </div>

                  {/* Disc% */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'discount', el)}
                      type="number"
                      step="0.1"
                      value={row.discount || ''}
                      onChange={e => updateRow(idx, { discount: parseFloat(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'discount')}
                      disabled={!row.productId}
                      placeholder="0"
                      className="h-8 text-sm px-1 font-medium bg-transparent border-transparent hover:bg-white focus:bg-white focus:border-red-400 transition-all shadow-none text-red-500 text-center"
                    />
                  </div>

                  {/* GST% */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'gst', el)}
                      type="number"
                      value={row.gst || ''}
                      onChange={e => updateRow(idx, { gst: parseFloat(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'gst')}
                      disabled={!row.productId}
                      className="h-8 text-sm px-1 font-medium bg-transparent border-transparent hover:bg-white focus:bg-white focus:border-emerald-400 transition-all shadow-none text-gray-500 text-center"
                    />
                  </div>

                  {/* Amount */}
                  <div className="pr-6 text-right">
                    <span className={`text-base font-semibold ${row.amount > 0 ? 'text-emerald-700' : 'text-gray-300'}`}>
                      {row.amount > 0 ? row.amount.toFixed(2) : '0.00'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-center">
                    {row.productId && (
                      <button
                        type="button"
                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        onClick={() => removeRow(idx)}
                        title="Remove row (Alt+Delete)"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>


      {/* ══════ ZONE 5: STICKY FOOTER (SLEEK) ══════ */}
      <div className="bg-white border-t border-green-100 shadow-[0_-8px_24px_rgba(0,0,0,0.04)] shrink-0 z-30">
        <div className="px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-4 max-w-[1700px] mx-auto">
          {/* Left: Payment & Global Info */}
          <div className="flex items-center gap-5">
            <div className="flex gap-1.5 bg-white p-1 rounded-lg border border-green-100">
              {paymentModes.map((mode, i) => (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setPaymentMode(mode.key)}
                  className={`
                    flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors relative
                    ${paymentMode === mode.key
                      ? 'bg-green-600 text-white shadow-sm z-10'
                      : 'text-gray-600 hover:text-green-700 hover:bg-green-50'
                    }
                  `}
                >
                  <mode.icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{mode.label}</span>
                </button>
              ))}
            </div>
            
            <div className="h-8 w-px bg-green-100 ml-2"></div>

            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-md border border-green-100">
              <Label className="text-xs font-medium text-green-700">Global Disc%</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={globalDiscount || ''}
                onChange={e => setGlobalDiscount(parseFloat(e.target.value) || 0)}
                className="w-14 h-8 text-sm text-center border-green-200 bg-white focus:border-green-500 focus:ring-green-100 shadow-none"
                placeholder="0"
              />
            </div>
          </div>

          {/* Right: Summary & Action */}
          <div className="flex items-center gap-8">
            <div className="hidden sm:flex items-center gap-5 text-sm font-medium">
              <div className="flex flex-col text-right">
                <span className="text-emerald-500 text-xs">Items</span>
                <span className="text-emerald-900">{rows.filter(r => r.productId).length}</span>
              </div>
              <div className="flex flex-col text-right">
                <span className="text-emerald-500 text-xs">Subtotal</span>
                <span className="text-emerald-900">₹{totals.subtotal.toFixed(2)}</span>
              </div>
              {(totals.discountTotal > 0) && (
                <div className="flex flex-col text-right">
                  <span className="text-red-400 text-xs">Discount</span>
                  <span className="text-red-600">-₹{(totals.discountTotal).toFixed(2)}</span>
                </div>
              )}
            </div>

            <div className="bg-emerald-50 text-emerald-900 px-5 py-2 rounded-md border border-emerald-200 flex flex-col items-center min-w-[170px]">
              <span className="text-xs font-medium text-emerald-600 mb-0.5">Amount Payable</span>
              <div className="flex items-baseline gap-1">
                <span className="text-emerald-600 text-sm font-medium">₹</span>
                <span className="text-2xl font-semibold tabular-nums leading-none">
                  {totals.grandTotal.toFixed(0)}<span className="text-base text-emerald-700/80">.{totals.grandTotal.toFixed(2).split('.')[1]}</span>
                </span>
              </div>
            </div>

            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving || rows.every(r => !r.productId)}
              className="h-10 px-5 bg-green-600 hover:bg-green-700 text-white font-medium text-sm rounded-md transition-colors disabled:opacity-50 border border-green-500/20"
            >
              {isSaving ? 'Recording...' : (
                <div className="flex items-center gap-3">
                  <span>Finalize</span>
                  <ChevronDown className="h-4 w-4 -rotate-90" />
                </div>
              )}
            </Button>
          </div>
        </div>
      </div>

    </div>
  );
}

