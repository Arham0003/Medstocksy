import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db_conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate } from 'react-router-dom';
import {
  Search, X, Save, ChevronDown, ChevronUp, Trash2,
  HelpCircle, ArrowLeft, CreditCard, Banknote, Smartphone, Receipt,
  CalendarDays, Stethoscope, CheckCircle2, Circle, ShoppingCart, User, Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import QuickAddMedicineSheet from '@/components/QuickAddMedicineSheet';
import { BILL_DATA_PREFIX, clearBillData } from '@/hooks/useBillSessions';

// ─── Types ──────────────────────────────────────────────────────────────────
export interface Product {
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

export interface Settings {
  gst_enabled: boolean;
  default_gst_rate: number;
  gst_type?: string;
}

// Props are all optional so <RecordSale/> still works standalone. The tab
// container (SalesBilling) injects shared data + wires tab behaviour.
export interface RecordSaleProps {
  /** When false, this instance is a hidden background tab — global shortcuts are ignored. */
  isActive?: boolean;
  /** Rendered inside the tab container (absolute) vs. standalone full-screen (fixed). */
  embedded?: boolean;
  /** Shared product list injected by the container; when provided, this component skips its own fetch. */
  injectedProducts?: Product[];
  injectedSettings?: Settings | null;
  dataLoading?: boolean;
  /** Reports item count / customer / dirty state up for the tab badge. */
  onMetaChange?: (meta: { itemCount: number; customerName: string; dirty: boolean }) => void;
  /** Called after a successful save instead of the default in-app navigation. */
  onCompleted?: (billId: string) => void;
  /** Bubbles a freshly quick-added product up so the container can share it across tabs. */
  onProductCreated?: (product: Product) => void;
  /** localStorage key (the session id) — persists this bill's contents across refresh/reopen. */
  persistKey?: string;
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

  // Add loose portion if pcs is provided
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

// Caret helpers for arrow-key grid nav. number/date inputs throw on
// selectionStart access, so we treat those as "at boundary" → arrows navigate.
function caretAtStart(el: HTMLInputElement): boolean {
  try { return el.selectionStart === 0 && el.selectionEnd === 0; } catch { return true; }
}
function caretAtEnd(el: HTMLInputElement): boolean {
  try { return el.selectionStart === el.value.length && el.selectionEnd === el.value.length; } catch { return true; }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function RecordSale({
  isActive = true,
  embedded = false,
  injectedProducts,
  injectedSettings,
  dataLoading,
  onMetaChange,
  onCompleted,
  onProductCreated,
  persistKey,
}: RecordSaleProps = {}) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  // Saved contents for this bill (restored on refresh / app reopen). Read once.
  const [hydrated] = useState<any>(() => {
    if (!persistKey) return null;
    try {
      const raw = localStorage.getItem(BILL_DATA_PREFIX + persistKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  // When the container injects data, this component does NOT fetch on its own.
  const usingInjected = injectedProducts !== undefined;

  // ─── Data ───────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>(injectedProducts ?? []);
  const [settings, setSettings] = useState<Settings | null>(injectedSettings ?? null);
  const [loading, setLoading] = useState(usingInjected ? !!dataLoading : true);
  const [isSaving, setIsSaving] = useState(false);

  // ─── Quick Add slide-over ─────────────────────────────────────────────────
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // Keep injected data in sync when the container updates it (e.g. after Quick Add)
  useEffect(() => { if (injectedProducts !== undefined) setProducts(injectedProducts); }, [injectedProducts]);
  useEffect(() => { if (injectedSettings !== undefined) setSettings(injectedSettings); }, [injectedSettings]);
  useEffect(() => { if (usingInjected) setLoading(!!dataLoading); }, [dataLoading, usingInjected]);

  // ─── Customer Info ──────────────────────────────────────────────────────
  const [customerName, setCustomerName] = useState(hydrated?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(hydrated?.customerPhone ?? '');
  const [customerAddress, setCustomerAddress] = useState(hydrated?.customerAddress ?? '');
  const [doctorName, setDoctorName] = useState(hydrated?.doctorName ?? '');
  const [billDate, setBillDate] = useState<string>(hydrated?.billDate ?? new Date().toISOString().split('T')[0]);
  const [prescriptionMonths, setPrescriptionMonths] = useState<number | ''>(hydrated?.prescriptionMonths ?? '');
  const [monthsTaken, setMonthsTaken] = useState<number | ''>(hydrated?.monthsTaken ?? 1);
  // When set, this bill is being EDITED — save replaces the finalized bill of this id.
  const [editBillId] = useState<string | null>(() => hydrated?.editBillId ?? null);

  // ─── CRM Retrieve Dialog ─────────────────────────────────────────────────
  type CrmField = 'name' | 'address' | 'doctor' | 'prescription_months' | 'months_taken';
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
    bill_date?: string | null;
    bill_id?: string | null;
    items: CrmBillItem[];
  }
  const [crmDialogOpen, setCrmDialogOpen] = useState(false);
  const [crmFoundData, setCrmFoundData] = useState<CrmFoundData | null>(null);
  const [crmSelectedFields, setCrmSelectedFields] = useState<Set<CrmField>>(new Set());
  const [crmSelectedItems, setCrmSelectedItems] = useState<Set<string>>(new Set()); // sale_id set

  // ─── Payment ────────────────────────────────────────────────────────────
  const [paymentMode, setPaymentMode] = useState(hydrated?.paymentMode ?? 'cash');
  const [receivedAmount, setReceivedAmount] = useState<number | ''>(hydrated?.receivedAmount ?? '');
  const [globalDiscount, setGlobalDiscount] = useState(hydrated?.globalDiscount ?? 0);

  // ─── Rows ───────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<BillRow[]>(
    Array.isArray(hydrated?.rows) && hydrated.rows.length ? (hydrated.rows as BillRow[]) : [EMPTY_ROW()],
  );

  // ─── Product search state per row  ─────────────────────────────────────
  const [activeSearchRow, setActiveSearchRow] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchHighlight, setSearchHighlight] = useState(0);
  const [searchRect, setSearchRect] = useState<DOMRect | null>(null);
  const [infoProduct, setInfoProduct] = useState<Product | null>(null); // F1 → full product info
  const [infoRow, setInfoRow] = useState<number | null>(null); // which row the info was opened from
  const finalizeRef = useRef<HTMLButtonElement>(null);
  // Live mirrors so the capture-phase Escape handler always sees current state.
  const infoProductRef = useRef<Product | null>(null);
  const activeSearchRowRef = useRef<number | null>(null);
  infoProductRef.current = infoProduct;
  activeSearchRowRef.current = activeSearchRow;

  // ─── UI state ───────────────────────────────────────────────────────────
  const [showShortcuts, setShowShortcuts] = useState(true);
  const [showShortcutOverlay, setShowShortcutOverlay] = useState(false);

  // ─── Master Search (new) ────────────────────────────────────────────────
  const [masterSearch, setMasterSearch] = useState('');
  const [masterHighlight, setMasterHighlight] = useState(0);
  const [masterDropdownOpen, setMasterDropdownOpen] = useState(false);

  // ─── Refs for tabbing ──────────────────────────────────────────────────
  const phoneRef = useRef<HTMLInputElement>(null);
  const doctorRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const prescRef = useRef<HTMLInputElement>(null);
  const takenRef = useRef<HTMLInputElement>(null);
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
    if (usingInjected) return; // container provides the data
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
        .select('bill_id, customer_name, customer_address, doctor_name, sale_date, prescription_months, months_taken, created_at')
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
              expiry: r.products?.expiry_date ? r.products.expiry_date.substring(0, 7) : '',
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

      if (available.size > 0 || items.length > 0) {
        setCrmFoundData({
          customer_name: header.customer_name,
          customer_address: header.customer_address,
          doctor_name: header.doctor_name,
          prescription_months: header.prescription_months,
          months_taken: header.months_taken,
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

  // ─── Existing-customer autocomplete (inline suggestions, no popup) ────────
  interface CustomerSuggestion {
    name: string;
    phone: string | null;
    address: string | null;
    doctor: string | null;
  }
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [customerHighlight, setCustomerHighlight] = useState(0);
  const nameSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCustomerSuggestions = useCallback(async (name: string) => {
    const q = name.trim();
    if (q.length < 1) { setCustomerSuggestions([]); setCustomerDropdownOpen(false); return; }
    try {
      const { data } = await (supabase as any)
        .from('sales')
        .select('customer_name, customer_phone, customer_address, doctor_name, created_at')
        .ilike('customer_name', `${q}%`)
        .order('created_at', { ascending: false })
        .limit(40);
      const seen = new Set<string>();
      const list: CustomerSuggestion[] = [];
      for (const r of (data || [])) {
        const nm = (r.customer_name || '').trim();
        if (!nm || nm.toLowerCase() === 'walk-in customer') continue;
        const key = nm.toLowerCase() + '|' + (r.customer_phone || '');
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ name: nm, phone: r.customer_phone ?? null, address: r.customer_address ?? null, doctor: r.doctor_name ?? null });
        if (list.length >= 6) break;
      }
      setCustomerSuggestions(list);
      setCustomerDropdownOpen(list.length > 0);
      setCustomerHighlight(0);
    } catch { /* ignore */ }
  }, []);

  const handleNameChange = useCallback((value: string) => {
    setCustomerName(value);
    if (nameSearchTimer.current) clearTimeout(nameSearchTimer.current);
    if (value.trim().length < 1) { setCustomerSuggestions([]); setCustomerDropdownOpen(false); return; }
    nameSearchTimer.current = setTimeout(() => fetchCustomerSuggestions(value), 250);
  }, [fetchCustomerSuggestions]);

  const selectCustomer = useCallback((c: CustomerSuggestion) => {
    setCustomerName(c.name);
    if (c.phone) setCustomerPhone(c.phone);
    if (c.address) setCustomerAddress(c.address);
    if (c.doctor) setDoctorName(c.doctor);
    setCustomerDropdownOpen(false);
    setCustomerSuggestions([]);
  }, []);

  const handleNameKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!customerDropdownOpen || customerSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setCustomerHighlight(h => Math.min(h + 1, customerSuggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setCustomerHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = customerSuggestions[customerHighlight]; if (c) selectCustomer(c); }
    else if (e.key === 'Escape') { setCustomerDropdownOpen(false); }
  }, [customerDropdownOpen, customerSuggestions, customerHighlight, selectCustomer]);

  // Enter in a patient-detail field → focus the next field (or the master search).
  const enterTo = (ref: React.RefObject<HTMLElement | null>) =>
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      ref.current?.focus();
      (ref.current as HTMLInputElement | null)?.select?.();
    };

  // Modern boxed input used across the patient-detail block.
  const patientFieldCls =
    'w-full h-8 rounded-md border border-emerald-200 bg-white px-2 text-sm font-medium text-emerald-900 placeholder-emerald-400/60 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-colors';

  // ─── Apply selected CRM fields ──────────────────────────────────────────
  const applyCrmFields = useCallback(() => {
    if (!crmFoundData) return;

    // Apply patient detail fields
    if (crmSelectedFields.has('name') && crmFoundData.customer_name) setCustomerName(crmFoundData.customer_name);
    if (crmSelectedFields.has('address') && crmFoundData.customer_address) setCustomerAddress(crmFoundData.customer_address);
    if (crmSelectedFields.has('doctor') && crmFoundData.doctor_name) setDoctorName(crmFoundData.doctor_name);
    if (crmSelectedFields.has('prescription_months') && crmFoundData.prescription_months != null) setPrescriptionMonths(crmFoundData.prescription_months);

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
      expiry: product.expiry_date ? product.expiry_date.substring(0, 7) : '',
      hsn: product.hsn_code || '',
      mrp: product.selling_price,
      rate: product.selling_price,
      gst: gstRate,
      pcsPerUnit: product.pcs_per_unit || 10,
    });
    setActiveSearchRow(null);
    setSearchTerm('');
    setSearchRect(null);
    const uid = rows[rowIndex]?.uid;
    // Always keep one empty row at the end so the "next medicine" search drops to
    // the next line automatically after a product is added.
    setRows(prev => {
      const last = prev[prev.length - 1];
      return last && last.productId ? [...prev, EMPTY_ROW()] : prev;
    });
    // Move the cursor to the first editable field of this row (Batch → Qty → …).
    setTimeout(() => focusField(uid || '', 'batch'), 90);
  }, [updateRow, settings, rows, focusField]);

  // ─── Inline product search (inside each grid row) ─────────────────────────
  const handleProductSearchKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>, rowIndex: number) => {
    const list = filteredProducts.slice(0, 20);
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSearchHighlight(h => Math.min(h + 1, Math.max(0, list.length - 1))); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSearchHighlight(h => Math.max(h - 1, 0)); return; }
    // F1 → show full info for the highlighted product
    if (e.key === 'F1') {
      e.preventDefault();
      const p = list[searchHighlight] || list[0];
      if (p) { setInfoProduct(p); setInfoRow(rowIndex); }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchTerm.trim() && list.length) {
        selectProduct(rowIndex, list[searchHighlight] || list[0]);
      } else {
        // Nothing typed → go straight to Finalize
        setActiveSearchRow(null);
        setSearchRect(null);
        finalizeRef.current?.focus();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // If the info popup is open, close only that; otherwise close the search dropdown.
      if (infoProduct) { setInfoProduct(null); setInfoRow(null); }
      else { setSearchTerm(''); setActiveSearchRow(null); setSearchRect(null); }
    }
  }, [filteredProducts, searchTerm, searchHighlight, selectProduct, infoProduct]);

  // Focus the search cell of the first row without a product (add one if needed).
  const focusFirstEmptyProduct = useCallback(() => {
    const idx = rows.findIndex(r => !r.productId);
    if (idx >= 0) { setActiveSearchRow(idx); focusField(rows[idx].uid, 'product'); }
    else { addNewRow(); }
  }, [rows, focusField, addNewRow]);

  // Measure the active search input right before paint (fresh, never stale) and
  // keep it aligned while scrolling/resizing.
  useLayoutEffect(() => {
    if (activeSearchRow === null) { setSearchRect(null); return; }
    const measure = () => {
      const el = rowRefs.current.get(rows[activeSearchRow]?.uid || '')?.get('product');
      if (el) setSearchRect(el.getBoundingClientRect());
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [activeSearchRow, searchTerm, rows]);

  // ─── Add product via master search bar ───────────────────────────────────
  const addProductFromMasterSearch = useCallback((product: Product) => {
    const gstRate = product.gst ?? settings?.default_gst_rate ?? 0;
    const newRow: BillRow = {
      uid: crypto.randomUUID(),
      productId: product.id,
      productName: product.name,
      stock: product.quantity,
      batch: product.batch_number || '',
      expiry: product.expiry_date ? product.expiry_date.substring(0, 7) : '',
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

  // Sync receivedAmount:
  // - Cash/UPI/Card: auto-fill to grand total (can be overridden for partial)
  // - Credit: keep at 0 by default, but DON'T reset if user has typed a partial amount
  useEffect(() => {
    if (paymentMode !== 'credit') {
      setReceivedAmount(totals.grandTotal);
    } else {
      // Only set to 0 when switching TO credit mode — handled by the paymentMode change below
    }
  }, [totals.grandTotal]);

  // When payment mode changes, reset receivedAmount appropriately
  useEffect(() => {
    if (paymentMode === 'credit') {
      setReceivedAmount(0); // Start credit with 0 paid (user can type partial amount)
    } else {
      setReceivedAmount(totals.grandTotal); // Cash/UPI/Card: default to full
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMode]);

  // ─── Report meta to the tab container (item count / customer / dirty) ────
  const onMetaChangeRef = useRef(onMetaChange);
  useEffect(() => { onMetaChangeRef.current = onMetaChange; }, [onMetaChange]);
  useEffect(() => {
    const itemCount = rows.filter(r => r.productId).length;
    const dirty = itemCount > 0 || customerName.trim() !== '' || customerPhone.trim() !== '';
    onMetaChangeRef.current?.({ itemCount, customerName: customerName.trim(), dirty });
  }, [rows, customerName, customerPhone]);

  // ─── Persist this bill's contents locally (survives refresh / app reopen) ─
  useEffect(() => {
    if (!persistKey) return;
    try {
      localStorage.setItem(BILL_DATA_PREFIX + persistKey, JSON.stringify({
        customerName, customerPhone, customerAddress, doctorName, billDate,
        prescriptionMonths, monthsTaken, rows, paymentMode, receivedAmount, globalDiscount,
        editBillId,
      }));
    } catch { /* ignore quota errors */ }
  }, [persistKey, customerName, customerPhone, customerAddress, doctorName, billDate,
      prescriptionMonths, monthsTaken, rows, paymentMode, receivedAmount, globalDiscount]);

  // ─── Quick Add: add a freshly created product straight into this bill ────
  const handleQuickAddSaved = useCallback((product: Product, qty: number) => {
    // Make it searchable in this instance immediately + bubble up to siblings
    setProducts(prev => (prev.some(p => p.id === product.id) ? prev : [product, ...prev]));
    onProductCreated?.(product);

    const gstRate = product.gst ?? settings?.default_gst_rate ?? 0;
    const newRow: BillRow = {
      uid: crypto.randomUUID(),
      productId: product.id,
      productName: product.name,
      stock: product.quantity,
      batch: product.batch_number || '',
      expiry: product.expiry_date ? product.expiry_date.substring(0, 7) : '',
      hsn: product.hsn_code || '',
      mrp: product.selling_price,
      rate: product.selling_price,
      gst: gstRate,
      pcsPerUnit: product.pcs_per_unit || 10,
      qty,
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
    setTimeout(() => focusField(newRow.uid, 'qty'), 80);
  }, [settings, onProductCreated, focusField]);

  // ─── Handle Save ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const validRows = rows.filter(r => r.productId);
    if (validRows.length === 0) {
      toast({ variant: 'destructive', title: 'No products', description: 'Add at least one product before saving.' });
      return;
    }
    if (isSaving) return;

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

    setIsSaving(true);

    try {
      // Editing an existing bill → reuse its id (same invoice); otherwise a new bill.
      const billId = editBillId || crypto.randomUUID();
      const isGstInclusive = settings?.gst_type === 'inclusive';

      // receivedNum = how much the customer actually paid right now (can be 0 for pure credit,
      // or a partial amount even on credit mode — e.g. ₹200 upfront on a ₹500 credit sale)
      const receivedNum = receivedAmount !== '' ? Number(receivedAmount) : 0;

      // Settled = fully paid (applies to ALL modes including credit with full upfront payment)
      const isFullPayment = receivedNum >= totals.grandTotal && totals.grandTotal > 0;

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
        const totalPriceRounded = Math.round(finalTotal);
        
        // received_amount per row, distributed proportionally:
        // - Pure credit (receivedNum=0) → 0 per row → full due shows in CustomerRelation
        // - Partial upfront (e.g. ₹200 of ₹500) → proportional per row → ₹300 due shows
        // - Full payment → match total_price exactly to avoid rounding dust
        let rowReceivedAmount = 0;
        if (isFullPayment) {
          rowReceivedAmount = totalPriceRounded; // Paid in full — match total exactly
        } else if (receivedNum > 0 && totals.grandTotal > 0) {
          // Partial payment — distribute proportionally across rows
          rowReceivedAmount = receivedNum * (finalTotal / totals.grandTotal);
        }
        // else receivedNum === 0 → rowReceivedAmount stays 0 (pure credit, nothing paid)

        return {
          account_id: profile?.account_id,
          bill_id: billId,
          product_id: row.productId,
          user_id: profile?.id,
          quantity: row.qty,
          sub_qty: hasSubQty ? Number(row.subQty) : null,
          pcs_per_unit: hasSubQty ? row.pcsPerUnit : null,
          unit_price: Math.round(row.rate * 100) / 100,
          total_price: totalPriceRounded,
          gst_amount: Math.round(finalGst * 100) / 100,
          payment_mode: paymentMode,
          customer_name: customerName || 'Walk-in Customer',
          customer_phone: customerPhone || null,
          customer_address: customerAddress || null,
          doctor_name: doctorName || null,
          sale_date: billDate,
          prescription_months: prescriptionMonths === '' ? null : Number(prescriptionMonths),
          months_taken: monthsTaken === '' ? null : Number(monthsTaken),
          discount_percentage: row.discount + globalDiscount,
          received_amount: Math.round(rowReceivedAmount * 100) / 100,
          // Settled when customer has paid the full amount (works for all payment modes)
          is_settled: isFullPayment,
        };
      });

      // Editing: un-apply the original bill first (restore its stock, then delete its
      // rows) so re-inserting below re-deducts cleanly. The stock trigger only fires
      // on INSERT, so the restore is done manually — mirroring the item-delete flow.
      if (editBillId) {
        const { data: orig, error: origErr } = await (supabase.from('sales') as any)
          .select('product_id, quantity, sub_qty, pcs_per_unit')
          .eq('bill_id', editBillId);
        if (origErr) throw origErr;
        for (const it of (orig || []) as any[]) {
          const q = Number(it.quantity) || 0;
          const sq = Number(it.sub_qty) || 0;
          const pcs = Number(it.pcs_per_unit) || 0;
          const restore = sq && pcs > 0 ? q + sq / pcs : q;
          const { data: prod } = await (supabase.from('products') as any).select('quantity').eq('id', it.product_id).single();
          const cur = Number((prod as any)?.quantity) || 0;
          await (supabase.from('products') as any).update({ quantity: cur + restore }).eq('id', it.product_id);
        }
        const { error: delErr } = await (supabase.from('sales') as any).delete().eq('bill_id', editBillId);
        if (delErr) throw delErr;
      }

      let { error } = await supabase.from('sales').insert(salesToInsert);

      if (error && error.message?.includes('column')) {
        // Fallback without optional fields
        const fallback = salesToInsert.map(s => {
          const { customer_name, customer_phone, customer_address, doctor_name, prescription_months, months_taken, payment_mode, sub_qty, pcs_per_unit, ...rest } = s as any;
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

      // Bill is finalized → drop its locally-saved draft so it isn't restored later.
      if (persistKey) clearBillData(persistKey);

      // Completion: container decides (preserve other tabs); standalone navigates as before.
      if (onCompleted) {
        onCompleted(billId);
      } else {
        navigate(`/print-bill/${billId}`);
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error recording sale', description: err.message });
    } finally {
      setIsSaving(false);
    }
  }, [rows, settings, globalDiscount, paymentMode, receivedAmount, totals, customerName, customerPhone, customerAddress, doctorName, billDate, prescriptionMonths, monthsTaken, profile, navigate, toast, isSaving, onCompleted, persistKey, editBillId]);

  // ─── Keyboard shortcuts (global) ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (!isActive) return; // background tabs must not hijack the keyboard
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
      // Escape: close any open popup first; only leave the screen when none are open.
      if (e.key === 'Escape') {
        if (infoProduct) { e.preventDefault(); setInfoProduct(null); setInfoRow(null); return; }
        if (activeSearchRow !== null) { e.preventDefault(); setActiveSearchRow(null); setSearchTerm(''); setSearchRect(null); return; }
        if (customerDropdownOpen) { e.preventDefault(); setCustomerDropdownOpen(false); return; }
        navigate('/sales');
        return;
      }
      // F2 = jump to the first empty row's product search
      if (e.key === 'F2') {
        e.preventDefault();
        focusFirstEmptyProduct();
        return;
      }
      // Ctrl+F = jump to phone
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        phoneRef.current?.focus();
        return;
      }
      // Alt+S = focus pcs of current row
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
  }, [handleSave, navigate, rows, focusField, clearRow, removeRow, isActive, focusFirstEmptyProduct, infoProduct, activeSearchRow, customerDropdownOpen]);

  // Capture-phase Escape: runs before any field/handler so an open popup ALWAYS
  // closes first (and only the popup) — even while typing in the product search.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (infoProductRef.current) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        setInfoProduct(null); setInfoRow(null);
      } else if (activeSearchRowRef.current !== null) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        setActiveSearchRow(null); setSearchTerm(''); setSearchRect(null);
      }
    };
    window.addEventListener('keydown', onEsc, true); // capture phase
    return () => window.removeEventListener('keydown', onEsc, true);
  }, []);

  // ─── Tab flow handler for row fields (Marg column order) ──────────────
  const TAB_FIELDS = ['batch', 'qty', 'subQty', 'discount', 'rate'];
  // Shared column template for the Marg-style grid: PRODUCT PACK BATCH STRI TAB DISC MRP AMOUNT ⋯
  // Mobile uses tighter fractions so all columns fit the full screen width with NO horizontal
  // scroll; from lg up it opens out to the spacious desktop proportions.
  const GRID_COLS = 'grid-cols-[1.8fr_0.45fr_0.85fr_0.62fr_0.62fr_0.62fr_0.85fr_1fr_0.34fr] lg:grid-cols-[2.6fr_0.7fr_1fr_0.55fr_0.55fr_0.6fr_0.9fr_1fr_0.4fr]';

  const handleFieldKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>, rowIndex: number, field: string) => {
    const row = rows[rowIndex];
    if (!row) return;
    const currentIdx = TAB_FIELDS.indexOf(field);

    // ── Tab / Shift+Tab : move between fields in the same row ──
    if (e.key === 'Tab' && !e.shiftKey) {
      if (currentIdx >= 0 && currentIdx < TAB_FIELDS.length - 1) { e.preventDefault(); focusField(row.uid, TAB_FIELDS[currentIdx + 1]); }
      return;
    }
    if (e.key === 'Tab' && e.shiftKey) {
      if (currentIdx > 0) { e.preventDefault(); focusField(row.uid, TAB_FIELDS[currentIdx - 1]); }
      return;
    }

    // → / ← : next / previous field, but only at the caret boundary so you can
    // still edit within a text field normally. (↑/↓ are handled page-wide on
    // the root — see handleVerticalArrowNav.)
    if (e.key === 'ArrowRight') {
      if (caretAtEnd(e.currentTarget) && currentIdx >= 0 && currentIdx < TAB_FIELDS.length - 1) {
        e.preventDefault();
        focusField(row.uid, TAB_FIELDS[currentIdx + 1]);
      }
      return;
    }
    if (e.key === 'ArrowLeft') {
      if (caretAtStart(e.currentTarget) && currentIdx > 0) {
        e.preventDefault();
        focusField(row.uid, TAB_FIELDS[currentIdx - 1]);
      }
      return;
    }

    // Enter: advance to the next field in the row; after the last field (rate),
    // jump to the next row's product search (or open a fresh row).
    if (e.key === 'Enter') {
      e.preventDefault();
      if (currentIdx >= 0 && currentIdx < TAB_FIELDS.length - 1) {
        focusField(row.uid, TAB_FIELDS[currentIdx + 1]);
      } else {
        const nextRow = rows[rowIndex + 1];
        if (nextRow) { setActiveSearchRow(rowIndex + 1); focusField(nextRow.uid, 'product'); }
        else { addNewRow(); }
      }
    }
  }, [rows, focusField, addNewRow]);

  // ─── ↑ / ↓ : walk every focusable element on the page (top-to-bottom) ────
  // Vertical keyboard navigation across the whole billing screen — customer
  // fields, every row's inputs, payment, discount, save. stopPropagation keeps
  // it from bubbling to the tab-bar's bill-switch handler.
  const handleVerticalArrowNav = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    // The product search owns ↑/↓ for its results dropdown — leave it alone.
    if (active === masterSearchRef.current) return;

    const focusables = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(el => el.offsetParent !== null); // visible only

    const idx = focusables.indexOf(active);
    if (idx === -1) return;

    e.preventDefault();
    e.stopPropagation();
    const nextIdx = e.key === 'ArrowDown'
      ? Math.min(idx + 1, focusables.length - 1)
      : Math.max(idx - 1, 0);
    const next = focusables[nextIdx];
    next?.focus();
    const asInput = next as HTMLInputElement;
    if (asInput && typeof asInput.select === 'function') {
      try { asInput.select(); } catch { /* number/date inputs can't select */ }
    }
  }, []);

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
    <div className={cn('flex flex-col bg-gray-50 overflow-hidden', embedded ? 'absolute inset-0' : 'fixed inset-0 z-50')} onKeyDown={handleVerticalArrowNav}>


      {/* CRM "Returning Customer Found" popup removed — replaced by inline
          existing-customer suggestions in the Patient Name field. */}
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
                ['Alt+S', 'Pcs field'],
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
      <div className="bg-gradient-to-r from-emerald-700 to-teal-700 text-white flex items-center justify-between px-4 py-1.5 shrink-0 z-40 relative shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/sales')}
            className="text-white/90 hover:bg-white/15 hover:text-white h-9 w-9"
            title="Back (Esc)"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="bg-white/15 p-1.5 rounded-lg">
              <ShoppingCart className="h-4 w-4 text-white" />
            </div>
            <h1 className="font-semibold text-lg tracking-wide text-white">Sale Entry</h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden lg:block text-sm font-medium text-white/80 tabular-nums">
            {new Date(billDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
          <div className="hidden md:flex items-center gap-3 px-3 py-1 bg-white/10 rounded-full border border-white/20 text-[11px] font-medium text-white/90">
            <span className="flex items-center gap-1"><kbd className="bg-white/20 border border-white/20 px-1 rounded">F2</kbd> Search</span>
            <span className="w-1 h-1 bg-white/40 rounded-full"></span>
            <span className="flex items-center gap-1"><kbd className="bg-white/20 border border-white/20 px-1 rounded">F10</kbd> Save</span>
            <span className="w-1 h-1 bg-white/40 rounded-full"></span>
            <span className="flex items-center gap-1"><kbd className="bg-white/20 border border-white/20 px-1 rounded">?</kbd> Help</span>
          </div>
          <Button
            type="button"
            onClick={() => setQuickAddOpen(true)}
            className="h-9 gap-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold px-3 rounded-md shadow-sm shadow-amber-500/25 transition-colors"
            title="Add a new medicine to inventory and this bill — without leaving billing"
          >
            <Zap className="h-4 w-4" />
            <span className="hidden sm:inline">Quick Add</span>
          </Button>
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
      <div className="bg-white border-b border-green-100 px-3 py-1.5 shrink-0 z-30">
        <div className="flex flex-col gap-1.5 max-w-[1700px] mx-auto">
          
          {/* Product search now lives inline in each grid row's Product cell.
              Press F2 (or Enter from the last patient field) to jump there. */}

          {/* Row 2: Patient details — modern boxed fields, Enter moves to the next */}
          <div className="bg-white border border-emerald-200 rounded-xl px-3 py-2.5 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">

              {/* Patient (with existing-customer autocomplete) */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-[58px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Patient</span>
                <div className="relative flex-1 min-w-0">
                  <input
                    value={customerName}
                    onChange={e => handleNameChange(e.target.value)}
                    onKeyDown={e => {
                      if (customerDropdownOpen && customerSuggestions.length) { handleNameKeyDown(e); return; }
                      enterTo(phoneRef)(e);
                    }}
                    onFocus={() => { if (customerSuggestions.length) setCustomerDropdownOpen(true); }}
                    onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 150)}
                    placeholder="Name"
                    autoComplete="off"
                    className={patientFieldCls}
                  />
                  {customerDropdownOpen && customerSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 mt-1 min-w-[240px] w-max max-w-[320px] bg-white rounded-lg shadow-[0_12px_32px_rgba(0,0,0,0.15)] border border-emerald-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                      <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Existing customers</p>
                      {customerSuggestions.map((c, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onMouseDown={e => e.preventDefault()} /* keep input focus so click registers before blur */
                          onClick={() => selectCustomer(c)}
                          onMouseEnter={() => setCustomerHighlight(idx)}
                          className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 border-t border-gray-50 first:border-t-0 transition-colors ${customerHighlight === idx ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{c.name}</p>
                            {(c.phone || c.doctor) && (
                              <p className="text-[11px] text-gray-400 truncate">{[c.phone, c.doctor && `Dr. ${c.doctor}`].filter(Boolean).join(' · ')}</p>
                            )}
                          </div>
                          <User className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Phone */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-[58px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Phone</span>
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
                  onKeyDown={enterTo(doctorRef)}
                  placeholder="Mobile no."
                  className={patientFieldCls}
                />
              </div>

              {/* Doctor */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-[58px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Doctor</span>
                <input
                  ref={doctorRef}
                  value={doctorName}
                  onChange={e => setDoctorName(e.target.value)}
                  onKeyDown={enterTo(addressRef)}
                  placeholder="Name"
                  className={patientFieldCls}
                />
              </div>

              {/* Address (single column so Months fits on this row too) */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-[58px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Address</span>
                <input
                  ref={addressRef}
                  value={customerAddress}
                  onChange={e => setCustomerAddress(e.target.value)}
                  onKeyDown={enterTo(dateRef)}
                  placeholder="Area / street"
                  className={patientFieldCls}
                />
              </div>

              {/* Date */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-[58px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Date</span>
                <input
                  ref={dateRef}
                  type="date"
                  value={billDate}
                  onChange={e => setBillDate(e.target.value)}
                  onKeyDown={enterTo(prescRef)}
                  className={cn(patientFieldCls, 'appearance-none')}
                />
              </div>

              {/* Prescription months / taken — compact, same row as Address & Date */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-[58px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Months</span>
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <input
                    ref={prescRef}
                    type="number"
                    min="0"
                    value={prescriptionMonths}
                    onChange={e => {
                      const val = e.target.value === '' ? '' : parseInt(e.target.value) || 0;
                      setPrescriptionMonths(val);
                      if (val !== '' && (monthsTaken === '' || monthsTaken === 0)) setMonthsTaken(1);
                    }}
                    onKeyDown={enterTo(takenRef)}
                    placeholder="0"
                    title="Prescribed months"
                    className={cn(patientFieldCls, 'w-11 px-1 text-center font-bold')}
                  />
                  <span className="text-[9px] font-semibold text-emerald-500 uppercase">Presc</span>
                  <input
                    ref={takenRef}
                    type="number"
                    min="0"
                    value={monthsTaken}
                    onChange={e => setMonthsTaken(e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusFirstEmptyProduct(); } }}
                    placeholder="0"
                    title="Months taken"
                    className={cn(patientFieldCls, 'w-11 px-1 text-center font-bold')}
                  />
                  <span className="text-[9px] font-semibold text-emerald-500 uppercase">Taken</span>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>


      {/* ══════ ZONE 4: PRODUCT ENTRY ══════ */}
      <div className="flex-1 overflow-auto px-1.5 sm:px-4 py-1.5 bg-gray-50">
        {/* Marg-style dense billing grid — one responsive table for every screen.
            On phones the fluid fr columns shrink to fill the full width with no
            horizontal scroll; from lg up it opens out to the spacious desktop size. */}
        <div className="billing-grid flex w-full lg:min-w-[1100px] lg:max-w-[1700px] mx-auto bg-white rounded-lg shadow-sm border border-emerald-200 overflow-hidden flex-col">
          {/* Table header — Marg columns: PRODUCT PACK BATCH STRI TAB DISC MRP AMOUNT */}
          <div className={`grid ${GRID_COLS} bg-emerald-100/70 border-b-2 border-emerald-200 text-[10px] lg:text-[12px] font-bold uppercase tracking-tight lg:tracking-wide text-emerald-800 py-2 divide-x divide-emerald-200/60`}>
            <div className="pl-2 lg:pl-4 truncate">Product</div>
            <div className="px-0.5 lg:px-1 text-center truncate">Pack</div>
            <div className="px-0.5 lg:px-1 text-center truncate">Batch</div>
            <div className="px-0.5 lg:px-1 text-center truncate">STRI</div>
            <div className="px-0.5 lg:px-1 text-center truncate">TAB.</div>
            <div className="px-0.5 lg:px-1 text-center truncate">Disc%</div>
            <div className="px-0.5 lg:px-1 text-center truncate">M.R.P.</div>
            <div className="text-right pr-2 lg:pr-6 truncate">Amount</div>
            <div></div>
          </div>

          {/* Table rows */}
          <div className="divide-y divide-emerald-100/70">
            {rows.map((row, idx) => (
              <div
                key={row.uid}
                data-row-uid={row.uid}
                className={`group/row group transition-colors duration-100 focus-within:bg-emerald-50 focus-within:shadow-sm ${row.productId ? 'bg-white hover:bg-green-50/40' : 'bg-transparent'}`}
              >
                <div className={`grid ${GRID_COLS} items-center h-9 overflow-hidden divide-x divide-green-50 group-focus-within/row:divide-emerald-200`}>
                  {/* PRODUCT — inline search when empty, name once selected */}
                  <div className="pl-2 lg:pl-4 relative flex items-center min-w-0">
                    {row.productId ? (
                      <div className="flex items-center gap-1.5 lg:gap-2 min-w-0 pointer-events-none">
                        <span className="text-sm lg:text-[15px] font-semibold text-gray-800 truncate">{row.productName}</span>
                        <span className="text-[10px] font-medium text-emerald-600 shrink-0">S:{row.stock}</span>
                        {row.expiry && <span className="hidden lg:inline text-[9px] text-gray-400 shrink-0">Exp:{row.expiry}</span>}
                      </div>
                    ) : (
                      <input
                        ref={el => setFieldRef(row.uid, 'product', el)}
                        value={activeSearchRow === idx ? searchTerm : ''}
                        onFocus={() => { setActiveSearchRow(idx); setSearchTerm(''); setSearchHighlight(0); }}
                        onChange={e => { setActiveSearchRow(idx); setSearchTerm(e.target.value); setSearchHighlight(0); }}
                        onKeyDown={e => handleProductSearchKeyDown(e, idx)}
                        onBlur={() => setTimeout(() => { setActiveSearchRow(cur => (cur === idx ? null : cur)); }, 150)}
                        placeholder={idx === 0 ? 'Search medicine… (F2)' : 'Next medicine…'}
                        autoComplete="off"
                        className="w-full h-8 bg-transparent outline-none px-1 text-sm lg:text-[15px] font-medium text-gray-800 placeholder-emerald-300 rounded-md focus:bg-indigo-100 focus:text-gray-900"
                      />
                    )}
                  </div>

                  {/* PACK (units per pack — read only) */}
                  <div className="px-1 text-center">
                    <span className="text-sm font-medium text-gray-500">
                      {row.productId ? (row.pcsPerUnit || '—') : ''}
                    </span>
                  </div>

                  {/* BATCH */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'batch', el)}
                      value={row.batch}
                      onChange={e => updateRow(idx, { batch: e.target.value })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'batch')}
                      disabled={!row.productId}
                      className="h-8 text-sm px-1 text-center font-medium bg-transparent border-transparent hover:bg-emerald-50 focus:bg-indigo-100 focus:!text-gray-900 focus:!border-indigo-400 focus:!ring-2 focus:!ring-indigo-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-50 transition-all shadow-none text-gray-700"
                    />
                  </div>

                  {/* STRI (full strips = qty) */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'qty', el)}
                      type="number"
                      min="0"
                      value={row.qty}
                      onChange={e => updateRow(idx, { qty: parseInt(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'qty')}
                      disabled={!row.productId}
                      className="h-8 text-[15px] px-1 text-center font-medium bg-transparent border-transparent hover:bg-emerald-50 focus:bg-indigo-100 focus:!text-gray-900 focus:!border-indigo-400 focus:!ring-2 focus:!ring-indigo-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all shadow-none"
                    />
                  </div>

                  {/* TAB (loose tablets = subQty) */}
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
                      className="h-8 text-[15px] px-1 text-center font-medium bg-transparent border-transparent hover:bg-emerald-50 focus:bg-indigo-100 focus:!text-gray-900 focus:!border-indigo-400 focus:!ring-2 focus:!ring-indigo-300 focus:border-green-500 focus:ring-2 focus:ring-green-100 transition-all shadow-none text-green-700"
                    />
                  </div>

                  {/* DISC% (always a percentage) */}
                  <div className="px-0.5 relative">
                    <Input
                      ref={el => setFieldRef(row.uid, 'discount', el)}
                      type="number"
                      step="0.1"
                      value={row.discount || ''}
                      onChange={e => updateRow(idx, { discount: parseFloat(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'discount')}
                      disabled={!row.productId}
                      placeholder="0"
                      className="h-8 text-[15px] pl-1 pr-4 font-medium bg-transparent border-transparent hover:bg-emerald-50 focus:bg-indigo-100 focus:!text-gray-900 focus:!border-indigo-400 focus:!ring-2 focus:!ring-indigo-300 focus:border-red-400 transition-all shadow-none text-red-500 text-center"
                    />
                    {row.productId && (
                      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-red-400/70">%</span>
                    )}
                  </div>

                  {/* M.R.P. (rate) */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'rate', el)}
                      type="number"
                      step="0.01"
                      value={row.rate || ''}
                      onChange={e => updateRow(idx, { rate: parseFloat(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'rate')}
                      disabled={!row.productId}
                      className="h-8 text-[15px] px-1 text-center font-medium bg-transparent border-transparent hover:bg-emerald-50 focus:bg-indigo-100 focus:!text-gray-900 focus:!border-indigo-400 focus:!ring-2 focus:!ring-indigo-300 focus:border-emerald-500 transition-all shadow-none text-gray-900"
                    />
                  </div>

                  {/* AMOUNT */}
                  <div className="pr-2 lg:pr-6 text-right">
                    <span className={`text-base lg:text-lg font-semibold ${row.amount > 0 ? 'text-emerald-700' : 'text-gray-300'}`}>
                      {row.amount > 0 ? row.amount.toFixed(2) : '0.00'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-center">
                    {row.productId && (
                      <button
                        type="button"
                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100 group-focus-within/row:opacity-100"
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

            {/* Empty ledger lines to fill the grid (Marg look) */}
            {Array.from({ length: Math.max(0, 10 - rows.length) }).map((_, i) => (
              <div key={`filler-${i}`} className={`grid ${GRID_COLS} h-9 divide-x divide-green-50`}>
                {Array.from({ length: 9 }).map((__, c) => <div key={c} />)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Floating results for the in-row product search (portal → never clipped) */}
      {activeSearchRow !== null && searchTerm.trim() !== '' && searchRect && createPortal(
        (() => {
          const list = filteredProducts.slice(0, 20);
          const width = Math.min(Math.max(searchRect.width, 320), window.innerWidth - 16);
          const left = Math.max(8, Math.min(searchRect.left, window.innerWidth - width - 8));
          const gap = 4;
          const maxH = 320;
          // Open below the field by default; flip above only if there isn't room.
          const spaceBelow = window.innerHeight - searchRect.bottom;
          const openUp = spaceBelow < 220 && searchRect.top > spaceBelow;
          const pos = openUp
            ? { bottom: window.innerHeight - searchRect.top + gap }
            : { top: searchRect.bottom + gap };
          return (
            <div
              style={{ position: 'fixed', left, width, ...pos, maxHeight: maxH }}
              className="z-[200] bg-white rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.25)] border border-emerald-100 overflow-hidden flex flex-col"
              onMouseDown={e => e.preventDefault()} /* keep the input focused so click registers */
            >
              <div className="flex-1 overflow-y-auto py-1">
                {list.length > 0 ? list.map((p, i) => (
                  <div
                    key={p.id}
                    onMouseEnter={() => setSearchHighlight(i)}
                    className={`group/item w-full px-4 py-2 flex items-center justify-between border-b border-gray-50 last:border-0 transition-colors ${searchHighlight === i ? 'bg-emerald-50' : 'hover:bg-gray-50/50'}`}
                  >
                    <button
                      type="button"
                      onClick={() => selectProduct(activeSearchRow as number, p)}
                      className="flex flex-col min-w-0 text-left flex-1"
                    >
                      <p className={`font-bold text-sm truncate ${searchHighlight === i ? 'text-emerald-700' : 'text-gray-800'}`}>{p.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px] h-4 bg-emerald-50 text-emerald-600 border-emerald-100">Stock: {p.quantity}</Badge>
                        {p.hsn_code && <span className="text-[10px] text-gray-500 font-medium">HSN: {p.hsn_code}</span>}
                        <span className="text-[10px] text-gray-400">U: {p.pcs_per_unit || 10}</span>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="font-bold text-emerald-600 text-sm">₹{p.selling_price.toFixed(2)}</span>
                      <button
                        type="button"
                        title="View full info (F1)"
                        onClick={() => { setInfoProduct(p); setInfoRow(activeSearchRow); }}
                        className="h-6 w-6 inline-flex items-center justify-center rounded-full text-indigo-500 hover:bg-indigo-50"
                      >
                        <HelpCircle className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className="px-4 py-6 text-center text-gray-400 text-sm font-medium">No medicines found matching "{searchTerm}"</div>
                )}
              </div>
              <div className="px-4 py-1.5 border-t border-gray-100 bg-slate-50 text-[10px] text-gray-500 flex items-center justify-between">
                <span><kbd className="px-1 rounded border bg-white">↵</kbd> select · <kbd className="px-1 rounded border bg-white">F1</kbd> full info</span>
                <span><kbd className="px-1 rounded border bg-white">↑↓</kbd> move</span>
              </div>
            </div>
          );
        })(),
        document.body,
      )}

      {/* Full product info (opened with F1 or the ⓘ button in the search results) */}
      {infoProduct && createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setInfoProduct(null)}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-base truncate">{infoProduct.name}</p>
                <p className="text-[11px] text-emerald-50">Product details</p>
              </div>
              <button type="button" onClick={() => setInfoProduct(null)} className="p-1 rounded-full hover:bg-white/20 shrink-0">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-x-4 gap-y-3">
              {([
                ['Stock', String(infoProduct.quantity)],
                ['M.R.P.', `₹${infoProduct.selling_price.toFixed(2)}`],
                ['GST', infoProduct.gst != null ? `${infoProduct.gst}%` : '—'],
                ['Pcs / Unit', String(infoProduct.pcs_per_unit || 10)],
                ['HSN', infoProduct.hsn_code || '—'],
                ['Batch', infoProduct.batch_number || '—'],
                ['Expiry', infoProduct.expiry_date ? infoProduct.expiry_date.substring(0, 7) : '—'],
                ['Category', infoProduct.category || '—'],
                ['Manufacturer', infoProduct.manufacturer || '—'],
              ] as [string, string][]).map(([label, value], i, arr) => (
                <div key={label} className={i === arr.length - 1 ? 'col-span-2' : ''}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
                  <p className="text-sm font-medium text-gray-800 break-words">{value}</p>
                </div>
              ))}
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <Button
                type="button"
                onClick={() => { if (infoRow !== null) selectProduct(infoRow, infoProduct); setInfoProduct(null); setInfoRow(null); }}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Add to bill
              </Button>
              <Button type="button" variant="outline" onClick={() => { setInfoProduct(null); setInfoRow(null); }}>Close</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}


      {/* ══════ ZONE 5: STICKY FOOTER (SLEEK) ══════ */}
      <div className="bg-white border-t border-green-100 shadow-[0_-8px_24px_rgba(0,0,0,0.04)] shrink-0 z-30">
        <div className="px-3 sm:px-6 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4 max-w-[1700px] mx-auto">
          {/* Left: Payment & Global Info */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 md:gap-5">
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
            
            <div className="hidden md:block h-8 w-px bg-green-100 ml-2"></div>

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

            <div className={`flex items-center gap-2 bg-white px-3 py-1.5 rounded-md border transition-all ${paymentMode === 'credit' ? 'border-orange-200 bg-orange-50' : 'border-green-100'}`}>
              <Label className={`text-xs font-medium ${paymentMode === 'credit' ? 'text-orange-700' : 'text-green-700'}`}>
                {paymentMode === 'credit' ? 'Amt Paid' : 'Received'}
              </Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={receivedAmount}
                onChange={e => setReceivedAmount(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                className={`w-20 h-8 text-sm font-bold border-none shadow-none bg-transparent focus:ring-0 text-right ${paymentMode === 'credit' ? 'text-orange-900' : 'text-green-900'}`}
                placeholder="0.00"
              />
            </div>

            {/* Live due amount indicator for partial / credit payments */}
            {(() => {
              const paid = receivedAmount !== '' ? Number(receivedAmount) : 0;
              const due = totals.grandTotal - paid;
              if (due > 0.01) {
                return (
                  <div className="flex flex-col items-center px-3 py-1 rounded-md bg-red-50 border border-red-200 min-w-[80px]">
                    <span className="text-[9px] font-bold text-red-400 uppercase tracking-wider">Due</span>
                    <span className="text-sm font-black text-red-600">₹{Math.round(due * 100) / 100}</span>
                  </div>
                );
              }
              return null;
            })()}
          </div>

          {/* Right: Summary & Action */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-6 md:gap-8 justify-between md:justify-end w-full md:w-auto">
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
              ref={finalizeRef}
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

      {/* ══════ QUICK ADD MEDICINE SLIDE-OVER ══════ */}
      <QuickAddMedicineSheet
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        existingProducts={products}
        onSaved={handleQuickAddSaved}
        defaultGst={settings?.default_gst_rate}
      />

    </div>
  );
}

