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
  CalendarDays, Stethoscope, CheckCircle2, Circle, ShoppingCart, User, Zap, Diamond
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { calcGst } from '@/lib/gst';
import QuickAddMedicineSheet from '@/components/QuickAddMedicineSheet';
import { billDataPrefix, clearBillData } from '@/hooks/useBillSessions';
import { fetchFefoBatches, consumeBatchStock, type StockBatch } from '@/lib/batches';
import { apportionGst, expiryStatus, formatExpiryShort } from '@/lib/gst';
import { db } from '@/lib/supabaseLoose';

// ─── Types ──────────────────────────────────────────────────────────────────
export interface Product {
  id: string;
  name: string;
  quantity: number;
  selling_price: number;
  /** B2B rate set during purchase entry. NULL → wholesale bills fall back to selling_price. */
  wholesale_price?: number | null;
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
  /** When false, this instance is a hidden background tab - global shortcuts are ignored. */
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
  /** localStorage key (the session id) - persists this bill's contents across refresh/reopen. */
  persistKey?: string;
  /**
   * 'wholesale' switches on the B2B bill: wholesale_price as the default rate,
   * a Free Qty column, the buyer GSTIN field, and sale_type='wholesale' on save.
   * Defaults to 'retail' so every existing caller is unchanged.
   */
  mode?: 'retail' | 'wholesale';
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
  /** Scheme/free quantity - given away, never billed. Wholesale only. */
  freeQty: number;
  // FEFO batch tracking. batchOptions is what the counter can pick from,
  // nearest expiry first; batchId is the one actually being sold.
  batchId: string | null;
  batchExpiryIso: string;
  cogsRate: number;
  batchOptions: StockBatch[];
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
  freeQty: 0,
  batchId: null,
  batchExpiryIso: '',
  cogsRate: 0,
  batchOptions: [],
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
    return calcGst(net, gst, isGstInclusive).totalPrice;
  }
  return net;
}

// A grid cell is either a text/number input or the batch <select>.
type GridField = HTMLInputElement | HTMLSelectElement;

// Caret helpers for arrow-key grid nav. number/date inputs throw on
// selectionStart access, and a <select> has no caret at all, so both are
// treated as "at boundary" → arrows navigate between fields.
function caretAtStart(el: GridField): boolean {
  if (!(el instanceof HTMLInputElement)) return true;
  try { return el.selectionStart === 0 && el.selectionEnd === 0; } catch { return true; }
}
function caretAtEnd(el: GridField): boolean {
  if (!(el instanceof HTMLInputElement)) return true;
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
  mode = 'retail',
}: RecordSaleProps = {}) {
  const isWholesale = mode === 'wholesale';
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  // Saved contents for this bill (restored on refresh / app reopen). Read once.
  const [hydrated] = useState<any>(() => {
    if (!persistKey) return null;
    try {
      const raw = localStorage.getItem(billDataPrefix(mode === 'wholesale' ? 'wholesale' : undefined) + persistKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  // When the container injects data, this component does NOT fetch on its own.
  const usingInjected = injectedProducts !== undefined;

  // ─── Data ───────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>(injectedProducts ?? []);
  const [settings, setSettings] = useState<Settings | null>(injectedSettings ?? null);
  const [isInterstate, setIsInterstate] = useState(false);
  const [loading, setLoading] = useState(usingInjected ? !!dataLoading : true);
  const [isSaving, setIsSaving] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  // F3 edit-gate: only one field unlocked at a time
  const [f3Unlocked, setF3Unlocked] = useState<string | null>(null);
  const [f3Dialog, setF3Dialog] = useState<{ uid: string; field: string } | null>(null);

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
  // B2B buyer GSTIN. Held per-instance (not lifted to the tab container) so
  // each of the parallel bills keeps its own buyer.
  const [wholesaleGstin, setWholesaleGstin] = useState<string>(hydrated?.wholesaleGstin ?? '');
  const [billDate, setBillDate] = useState<string>(hydrated?.billDate ?? new Date().toISOString().split('T')[0]);
  const [prescriptionMonths, setPrescriptionMonths] = useState<number | ''>(hydrated?.prescriptionMonths ?? '');
  const [monthsTaken, setMonthsTaken] = useState<number | ''>(hydrated?.monthsTaken ?? 1);
  // When set, this bill is being EDITED - save replaces the finalized bill of this id.
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
  const [rows, setRows] = useState<BillRow[]>(() => {
    if (Array.isArray(hydrated?.rows) && hydrated.rows.length) {
      return hydrated.rows.map((r: any) => ({
        ...EMPTY_ROW(),
        ...r,
        batchOptions: Array.isArray(r.batchOptions) ? r.batchOptions : [],
      }));
    }
    return [EMPTY_ROW()];
  });

  // ─── Product search state per row  ─────────────────────────────────────
  const [activeSearchRow, setActiveSearchRow] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchHighlight, setSearchHighlight] = useState(0);
  const [searchRect, setSearchRect] = useState<DOMRect | null>(null);
  const searchListRef = useRef<HTMLDivElement>(null); // scroll container for product results
  const [infoProduct, setInfoProduct] = useState<Product | null>(null); // F1 → full product info
  const [infoRow, setInfoRow] = useState<number | null>(null); // which row the info was opened from
  // Full product record + sales history, fetched when the info modal opens.
  const [infoDetails, setInfoDetails] = useState<{ full: any | null; sales: any[]; loading: boolean }>({ full: null, sales: [], loading: false });
  useEffect(() => {
    if (!infoProduct) { setInfoDetails({ full: null, sales: [], loading: false }); return; }
    let cancelled = false;
    setInfoDetails({ full: null, sales: [], loading: true });
    (async () => {
      try {
        const [prodRes, salesRes] = await Promise.all([
          (supabase as any).from('products').select('*').eq('id', infoProduct.id).single(),
          (supabase as any)
            .from('sales')
            .select('quantity, sub_qty, unit_price, total_price, sale_date, created_at, customer_name, payment_mode')
            .eq('product_id', infoProduct.id)
            .order('created_at', { ascending: false })
            .limit(100),
        ]);
        if (cancelled) return;
        setInfoDetails({ full: prodRes.data ?? null, sales: salesRes.data ?? [], loading: false });
      } catch {
        if (!cancelled) setInfoDetails({ full: null, sales: [], loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [infoProduct]);

  // Info-modal button focus: land on "Add to bill", ←/→ toggle to Close, Enter selects.
  // Uses a capture-phase window listener so these keys don't leak to the tab bar.
  const addToBillRef = useRef<HTMLButtonElement>(null);
  const closeInfoRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!infoProduct) return;
    setTimeout(() => addToBillRef.current?.focus(), 60);
    const handler = (e: KeyboardEvent) => {
      const isArrow = e.key.startsWith('Arrow');
      const isDigit = /^[1-5]$/.test(e.key);
      if (!isArrow && !isDigit) return;
      e.stopImmediatePropagation(); // keep navigation inside the modal
      if (e.key === 'ArrowLeft') { e.preventDefault(); addToBillRef.current?.focus(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); closeInfoRef.current?.focus(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [infoProduct]);

  const finalizeRef = useRef<HTMLButtonElement>(null);
  const paymentRefs = useRef<(HTMLButtonElement | null)[]>([]); // cash/upi/card/credit buttons
  const globalDiscRef = useRef<HTMLInputElement>(null);
  const receivedRef = useRef<HTMLInputElement>(null);
  // Live mirrors so the capture-phase Escape handler always sees current state.
  const infoProductRef = useRef<Product | null>(null);
  const activeSearchRowRef = useRef<number | null>(null);
  infoProductRef.current = infoProduct;
  activeSearchRowRef.current = activeSearchRow;

  // Keep the highlighted product result scrolled into view during ↑/↓ navigation.
  useEffect(() => {
    searchListRef.current
      ?.querySelector(`[data-item="${searchHighlight}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [searchHighlight, activeSearchRow, searchTerm]);

  // ─── UI state ───────────────────────────────────────────────────────────
  const [showShortcuts, setShowShortcuts] = useState(true);
  const [showShortcutOverlay, setShowShortcutOverlay] = useState(false);

  // ─── Master Search (new) ────────────────────────────────────────────────
  const [masterSearch, setMasterSearch] = useState('');
  const [masterHighlight, setMasterHighlight] = useState(0);
  const [masterDropdownOpen, setMasterDropdownOpen] = useState(false);

  // ─── Refs for tabbing ──────────────────────────────────────────────────
  const patientNameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const doctorRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const prescRef = useRef<HTMLInputElement>(null);
  const takenRef = useRef<HTMLInputElement>(null);
  const masterSearchRef = useRef<HTMLInputElement>(null);
  const masterDropdownRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, Map<string, GridField>>>(new Map());

  // When the sale opens (active tab, data ready), put the cursor in Patient Name
  // so the pharmacist can start typing straight away. Focuses once per mount.
  const didFocusName = useRef(false);
  useEffect(() => {
    if (isActive && !loading && !didFocusName.current) {
      didFocusName.current = true;
      setTimeout(() => patientNameRef.current?.focus(), 80);
    }
  }, [isActive, loading]);

  // Helper to set a ref for a specific row+field
  const setFieldRef = useCallback((rowUid: string, field: string, el: GridField | null) => {
    if (!el) return;
    if (!rowRefs.current.has(rowUid)) rowRefs.current.set(rowUid, new Map());
    rowRefs.current.get(rowUid)!.set(field, el);
  }, []);

  const focusField = useCallback((rowUid: string, field: string) => {
    setTimeout(() => {
      rowRefs.current.get(rowUid)?.get(field)?.focus();
    }, 50);
  }, []);

  // Close the product-info modal and return focus to the search cell it opened from.
  const closeInfo = useCallback(() => {
    const row = infoRow;
    setInfoProduct(null);
    setInfoRow(null);
    if (row !== null) {
      setActiveSearchRow(row);
      setTimeout(() => rowRefs.current.get(rows[row]?.uid || '')?.get('product')?.focus(), 20);
    }
  }, [infoRow, rows]);

  // ─── Fetch products & settings ─────────────────────────────────────────
  useEffect(() => {
    if (usingInjected) return; // container provides the data
    const fetch = async () => {
      try {
        const [prodRes, settingsRes] = await Promise.all([
          supabase.from('products').select('id, name, quantity, selling_price, wholesale_price, gst, hsn_code, batch_number, expiry_date, pcs_per_unit, category, manufacturer'),
          profile?.account_id
            ? supabase.from('settings').select('gst_enabled, default_gst_rate, gst_type').eq('account_id', profile.account_id).single()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (prodRes.error) throw prodRes.error;
        setProducts((prodRes.data as any) || []);
        if (settingsRes.data) setSettings(settingsRes.data as any);

        // Account-level GST identity decides CGST+SGST vs IGST on every line.
        if (profile?.account_id) {
          const { data: acct } = await db
            .from('accounts')
            .select('is_interstate_billing')
            .eq('id', profile.account_id)
            .single();
          setIsInterstate(Boolean(acct?.is_interstate_billing));
        }
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

      // Step 3: group by product_id - count purchases, keep latest details
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
  // Enter → next field, Shift+Enter → previous field (bidirectional chain).
  const enterTo = (nextRef: React.RefObject<HTMLElement | null>, prevRef?: React.RefObject<HTMLElement | null>) =>
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const target = e.shiftKey ? prevRef : nextRef;
      target?.current?.focus();
      (target?.current as HTMLInputElement | null)?.select?.();
    };

  // Modern boxed input used across the patient-detail block.
  const patientFieldCls =
    'w-full h-8 rounded-md border border-emerald-200 bg-white px-2 text-sm font-medium text-emerald-900 placeholder-emerald-400/60 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-colors';

  // ─── Apply selected CRM fields ──────────────────────────────────────────
  /**
   * Attach the product's sellable batches to a row and default to the
   * nearest expiry (FEFO). Addressed by uid rather than index because the
   * fetch is async and rows can shift while it is in flight.
   *
   * Silent when the product has no batches - the row keeps the
   * product-level batch/expiry, so an account still on aggregate stock
   * bills exactly as it did before.
   */
  const loadBatchesForRow = useCallback(async (uid: string, productId: string) => {
    if (!profile?.account_id) return;
    const batches = await fetchFefoBatches(profile.account_id, productId);
    if (batches.length === 0) return;
    const first = batches[0];
    setRows(prev => prev.map(r => {
      if (r.uid !== uid) return r;
      const next: BillRow = {
        ...r,
        batchOptions: batches,
        batchId: first.id,
        batch: first.batch_number,
        batchExpiryIso: first.expiry_date,
        expiry: first.expiry_date.substring(0, 7),
        cogsRate: Number(first.effective_cost) || 0,
        // The batch's own rate wins: it is what the goods were taxed at.
        gst: Number(first.gst_rate) || r.gst,
        hsn: first.hsn_code || r.hsn,
      };
      next.amount = calcAmount(next, settings);
      return next;
    }));
  }, [profile?.account_id, settings]);

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
          freeQty: 0,
          batchId: null,
          batchExpiryIso: '',
          cogsRate: 0,
          batchOptions: [],
        };
        row.amount = calcAmount(row, settings);
        return row;
      });
      setRows(prev => {
        const filledRows = prev.filter(r => r.productId);
        return [...filledRows, ...newRows];
      });
      // Repeat-prescription rows come from history; resolve each one's
      // current FEFO batch so they sell from live stock like any other row.
      newRows.forEach(r => void loadBatchesForRow(r.uid, r.productId));
    }

    setCrmDialogOpen(false);
    const itemCount = selectedItems.length;
    toast({
      title: '✅ Prescription loaded!',
      description: `${itemCount} medicine(s) added to bill${isSameAslastBill ? ' · months count auto-updated' : ''
        }.`,
    });
  }, [crmFoundData, crmSelectedFields, crmSelectedItems, products, settings, toast, loadBatchesForRow]);

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
      // Wholesale bills open at the B2B rate; products without one fall back to MRP.
      rate: isWholesale ? (product.wholesale_price ?? product.selling_price) : product.selling_price,
      gst: gstRate,

      pcsPerUnit: product.pcs_per_unit || 10,
      freeQty: 0,
      batchId: null,
      batchExpiryIso: '',
      cogsRate: 0,
      batchOptions: [],
    });

    const rowUid = rows[rowIndex]?.uid;
    if (rowUid) void loadBatchesForRow(rowUid, product.id);

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
    setTimeout(() => focusField(uid || '', 'qty'), 90);
  }, [updateRow, settings, rows, focusField, loadBatchesForRow, isWholesale]);

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
    if (e.key === 'Enter' && e.shiftKey) {
      // Go BACK: previous filled row's last field, else up to the patient "Taken" field.
      e.preventDefault();
      setActiveSearchRow(null);
      setSearchRect(null);
      const prevRow = rows[rowIndex - 1];
      if (prevRow && prevRow.productId) focusField(prevRow.uid, TAB_FIELDS[TAB_FIELDS.length - 1]);
      else takenRef.current?.focus();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchTerm.trim() && list.length) {
        selectProduct(rowIndex, list[searchHighlight] || list[0]);
      } else {
        // Nothing typed → move into the payment area (Payment → Global Disc → Received → Finalize)
        setActiveSearchRow(null);
        setSearchRect(null);
        setTimeout(() => paymentRefs.current[0]?.focus(), 20);
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
  }, [filteredProducts, searchTerm, searchHighlight, selectProduct, infoProduct, rows, focusField]);

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
      rate: isWholesale ? (product.wholesale_price ?? product.selling_price) : product.selling_price,
      gst: gstRate,
      pcsPerUnit: product.pcs_per_unit ?? 0,
      qty: 1,
      subQty: '',
      discount: 0,
      amount: 0,
      freeQty: 0,
      batchId: null,
      batchExpiryIso: '',
      cogsRate: 0,
      batchOptions: [],
    };
    newRow.amount = calcAmount(newRow, settings);
    setRows(prev => {
      const last = prev[prev.length - 1];
      const base = (last && !last.productId) ? prev.slice(0, -1) : prev;
      return [...base, newRow];
    });
    void loadBatchesForRow(newRow.uid, product.id);
    setMasterSearch('');
    setMasterDropdownOpen(false);
    setMasterHighlight(0);
    setTimeout(() => focusField(newRow.uid, 'qty'), 80);
  }, [settings, focusField, loadBatchesForRow, isWholesale]);

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
        gstTotal += calcGst(netAfterGlobal, row.gst, isGstInclusive).gstAmount;
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
      // Only set to 0 when switching TO credit mode - handled by the paymentMode change below
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
      localStorage.setItem(billDataPrefix(isWholesale ? 'wholesale' : undefined) + persistKey, JSON.stringify({
        customerName, customerPhone, customerAddress, doctorName, billDate,
        prescriptionMonths, monthsTaken, rows, paymentMode, receivedAmount, globalDiscount,
        editBillId, wholesaleGstin,
      }));
    } catch { /* ignore quota errors */ }
  }, [persistKey, customerName, customerPhone, customerAddress, doctorName, billDate,
      prescriptionMonths, monthsTaken, rows, paymentMode, receivedAmount, globalDiscount,
      wholesaleGstin, isWholesale]);

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
      rate: isWholesale ? (product.wholesale_price ?? product.selling_price) : product.selling_price,
      gst: gstRate,
      pcsPerUnit: product.pcs_per_unit ?? 0,
      qty,
      subQty: '',
      discount: 0,
      amount: 0,
      freeQty: 0,
      batchId: null,
      batchExpiryIso: '',
      cogsRate: 0,
      batchOptions: [],
    };
    newRow.amount = calcAmount(newRow, settings);
    setRows(prev => {
      const last = prev[prev.length - 1];
      const base = (last && !last.productId) ? prev.slice(0, -1) : prev;
      return [...base, newRow];
    });
    void loadBatchesForRow(newRow.uid, product.id);
    setTimeout(() => focusField(newRow.uid, 'qty'), 80);
  }, [settings, onProductCreated, focusField, loadBatchesForRow, isWholesale]);

  // ─── Handle Save ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const validRows = rows.filter(r => r.productId);
    if (validRows.length === 0) {
      toast({ variant: 'destructive', title: 'No products', description: 'Add at least one product before saving.' });
      return;
    }
    if (isSaving) return;

    // A tax invoice must name its buyer, and a GSTIN - when given - must be
    // well formed, because it is printed on the invoice and feeds GSTR-1.
    if (isWholesale) {
      if (!customerName.trim()) {
        toast({
          variant: 'destructive',
          title: 'Buyer name required',
          description: 'A wholesale tax invoice must name the buyer.',
        });
        return;
      }
      const gstin = wholesaleGstin.trim();
      if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
        toast({
          variant: 'destructive',
          title: 'Invalid GSTIN',
          description: 'Enter a valid 15-character GSTIN, or leave it blank.',
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

    setIsSaving(true);

    try {
      // Editing an existing bill → reuse its id (same invoice); otherwise a new bill.
      const billId = editBillId || crypto.randomUUID();
      const isGstInclusive = settings?.gst_type === 'inclusive';

      // receivedNum = how much the customer actually paid right now (can be 0 for pure credit,
      // or a partial amount even on credit mode - e.g. ₹200 upfront on a ₹500 credit sale)
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
          const gstResult = calcGst(netAfterAll, row.gst, isGstInclusive);
          finalGst = gstResult.gstAmount;
          finalTotal = gstResult.totalPrice;
        }

        const hasSubQty = row.subQty !== '' && Number(row.subQty) > 0;
        const totalPriceRounded = Math.round(finalTotal);
        
        // received_amount per row, distributed proportionally:
        // - Pure credit (receivedNum=0) → 0 per row → full due shows in CustomerRelation
        // - Partial upfront (e.g. ₹200 of ₹500) → proportional per row → ₹300 due shows
        // - Full payment → match total_price exactly to avoid rounding dust
        let rowReceivedAmount = 0;
        if (isFullPayment) {
          rowReceivedAmount = totalPriceRounded; // Paid in full - match total exactly
        } else if (receivedNum > 0 && totals.grandTotal > 0) {
          // Partial payment - distribute proportionally across rows
          rowReceivedAmount = receivedNum * (finalTotal / totals.grandTotal);
        }
        // else receivedNum === 0 → rowReceivedAmount stays 0 (pure credit, nothing paid)

        // GST breakup for GSTR-1. finalGst is the tax actually charged on
        // this line after both discounts, so it is apportioned rather than
        // recomputed - recomputing taxable x rate would drift by paise.
        const taxableValue = isGstInclusive ? netAfterAll - finalGst : netAfterAll;
        const split = apportionGst(finalGst, isInterstate);

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
          taxable_value: Math.round(taxableValue * 100) / 100,
          gst_rate: row.gst,
          cgst_amount: split.cgst,
          sgst_amount: split.sgst,
          igst_amount: split.igst,
          hsn_code: row.hsn || null,
          batch_id: row.batchId,
          cogs_rate: row.cogsRate || null,
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
          // Retail bills keep the column default; only a wholesale bill marks itself.
          sale_type: isWholesale ? 'wholesale' : 'retail',
          wholesale_customer_name: isWholesale ? (customerName.trim() || null) : null,
          wholesale_customer_gstin: isWholesale ? (wholesaleGstin.trim() || null) : null,
        };
      });

      // Free / scheme quantity rides along as its own ₹0 line on the same bill
      // (the Marg/Vyapar convention). Two reasons it is a separate row rather
      // than being folded into `quantity`:
      //   • the invoice must show it at ₹0 without distorting unit_price
      //   • the AFTER INSERT stock trigger deducts NEW.quantity, so the giveaway
      //     leaves inventory exactly like any other line
      const freeRowsToInsert = isWholesale
        ? validRows
            .filter(row => Number(row.freeQty) > 0)
            .map(row => ({
              account_id: profile?.account_id,
              bill_id: billId,
              product_id: row.productId,
              user_id: profile?.id,
              quantity: Number(row.freeQty),
              sub_qty: null,
              pcs_per_unit: null,
              unit_price: 0,
              total_price: 0,
              gst_amount: 0,
              taxable_value: 0,
              gst_rate: row.gst,
              cgst_amount: 0,
              sgst_amount: 0,
              igst_amount: 0,
              hsn_code: row.hsn || null,
              batch_id: row.batchId,
              cogs_rate: row.cogsRate || null,
              payment_mode: paymentMode,
              customer_name: customerName || 'Walk-in Customer',
              customer_phone: customerPhone || null,
              customer_address: customerAddress || null,
              doctor_name: doctorName || null,
              sale_date: billDate,
              prescription_months: null,
              months_taken: null,
              discount_percentage: 0,
              received_amount: 0,
              is_settled: isFullPayment,
              sale_type: 'wholesale',
              wholesale_customer_name: customerName.trim() || null,
              wholesale_customer_gstin: wholesaleGstin.trim() || null,
            }))
        : [];

      const allRowsToInsert = [...salesToInsert, ...freeRowsToInsert];

      // Editing: un-apply the original bill first (restore its stock, then delete its
      // rows) so re-inserting below re-deducts cleanly. The stock trigger only fires
      // on INSERT, so the restore is done manually - mirroring the item-delete flow.
      if (editBillId) {
        const { data: orig, error: origErr } = await (supabase.from('sales') as any)
          .select('product_id, quantity, sub_qty, pcs_per_unit, batch_number')
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
          // Restore batch ledger so FEFO stays accurate (never throws - batch row may not exist for legacy stock)
          if (profile?.account_id && restore > 0) {
            await db.rpc('adjust_batch_stock', {
              p_account_id: profile.account_id,
              p_product_id: it.product_id,
              p_batch_number: it.batch_number || null,
              p_delta: restore,
            });
          }
        }
        const { error: delErr } = await (supabase.from('sales') as any).delete().eq('bill_id', editBillId);
        if (delErr) throw delErr;
      }

      let { error } = await supabase.from('sales').insert(allRowsToInsert);

      if (error && error.message?.includes('column')) {
        // A wholesale bill cannot be downgraded to a retail one - losing
        // sale_type would silently file it under retail. Say so instead.
        if (isWholesale) {
          throw new Error('Wholesale billing needs a database update. Please run the pending migrations.');
        }
        // Fallback without optional fields
        const fallback = allRowsToInsert.map(s => {
          const {
            customer_name, customer_phone, customer_address, doctor_name,
            prescription_months, months_taken, payment_mode, sub_qty, pcs_per_unit,
            // GST-split and batch columns arrive with the compliance
            // migrations; drop them too so an un-migrated database still bills.
            taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount,
            hsn_code, batch_id, cogs_rate,
            // Wholesale columns arrive with 20260918000000.
            sale_type, wholesale_customer_name, wholesale_customer_gstin,
            ...rest
          } = s as any;
          return rest;
        });
        const res2 = await supabase.from('sales').insert(fallback);
        error = res2.error;
        if (error) throw new Error('Database needs migration. Please run required updates.');
      } else if (error) {
        throw error;
      }


      // Batch ledger. products.quantity was already moved by the sales
      // trigger; this takes the same units off the batches so FEFO and
      // expiry tracking stay truthful. A failure here is reported but never
      // fails the bill - the sale is already committed.
      const batchProblems: string[] = [];
      if (profile?.account_id) {
        for (const row of validRows) {
          const hasSub = row.subQty !== '' && Number(row.subQty) > 0;
          // Free qty leaves the shelf too, so the batch ledger takes it as well.
          const freeUnits = isWholesale ? Number(row.freeQty) || 0 : 0;
          const units = row.qty + freeUnits + (hasSub ? Number(row.subQty) / (row.pcsPerUnit || 1) : 0);
          if (units <= 0) continue;
          const res = await consumeBatchStock({
            accountId: profile.account_id,
            productId: row.productId,
            batchNumber: row.batchId ? row.batch : null,
            qty: units,
          });
          if (!res.ok) batchProblems.push(`${row.productName}: ${res.message}`);
        }
      }

      if (batchProblems.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Bill saved - batch ledger out of step',
          description: batchProblems.slice(0, 3).join(' · '),
        });
      } else {
        toast({
          title: 'Sale recorded!',
          description: `${validRows.length} item(s) billed successfully${customerName ? ' for ' + customerName : ''}`,
        });
      }

      // Bill is finalized → drop its locally-saved draft so it isn't restored later.
      if (persistKey) clearBillData(persistKey, isWholesale ? 'wholesale' : undefined);

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
  }, [rows, settings, globalDiscount, paymentMode, receivedAmount, totals, customerName, customerPhone, customerAddress, doctorName, billDate, prescriptionMonths, monthsTaken, profile, navigate, toast, isSaving, onCompleted, persistKey, editBillId, isInterstate, isWholesale, wholesaleGstin]);

  // ─── Keyboard shortcuts (global) ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (!isActive) return; // background tabs must not hijack the keyboard
      // Ctrl+Enter or Ctrl+S = Save
      if ((e.ctrlKey && e.key === 'Enter') || (e.ctrlKey && e.key === 's')) {
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
        const hasItems = rows.some(r => r.productId);
        if (hasItems) { setShowLeaveConfirm(true); return; }
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
  // closes first (and only the popup) - even while typing in the product search.
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
  const TAB_FIELDS = useMemo(
    () => (isWholesale
      ? ['expiry', 'qty', 'freeQty', 'subQty', 'batch', 'mrp', 'rate', 'discount', 'gst']
      : ['expiry', 'qty', 'subQty', 'batch', 'mrp', 'rate', 'discount', 'gst']),
    [isWholesale]
  );
  // Shared column template for the Marg-style grid: PRODUCT PACK BATCH STRI TAB DISC MRP AMOUNT ⋯
  // Mobile uses tighter fractions so all columns fit the full screen width with NO horizontal
  // scroll; from lg up it opens out to the spacious desktop proportions.
  // Columns: Product · QTY · PCS · HSN · Batch · MRP · Rate · DISC · GST · Amount · ⋯
  // All 11 columns on every screen. On phones the grid keeps a legible min-width
  // and scrolls horizontally (swipe); on desktop it fits within max-width.
  const GRID_COLS = isWholesale
    ? 'grid-cols-[2.2fr_0.7fr_0.55fr_0.5fr_0.8fr_0.9fr_0.75fr_0.8fr_0.6fr_0.55fr_0.95fr_0.5fr]'
    : 'grid-cols-[2.2fr_0.7fr_0.55fr_0.8fr_0.9fr_0.75fr_0.8fr_0.6fr_0.55fr_0.95fr_0.5fr]';
  /** Cells per grid line - kept in step with GRID_COLS for the filler rows. */
  const GRID_COL_COUNT = isWholesale ? 12 : 11;


  const isF3Unlocked = (uid: string, field: string) => f3Unlocked === `${uid}:${field}`;

  const handleF3Confirm = useCallback(() => {
    if (!f3Dialog) return;
    const key = `${f3Dialog.uid}:${f3Dialog.field}`;
    setF3Unlocked(key);
    setF3Dialog(null);
    setTimeout(() => focusField(f3Dialog.uid, f3Dialog.field), 0);
  }, [f3Dialog, focusField]);

  const handleFieldKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>, rowIndex: number, field: string) => {

    const row = rows[rowIndex];
    if (!row) return;
    const currentIdx = TAB_FIELDS.indexOf(field);

    // F3: toggle edit-gate for this field
    if (e.key === 'F3') {
      e.preventDefault();
      if (isF3Unlocked(row.uid, field)) {
        setF3Unlocked(null); // F3 again = done, re-lock
      } else {
        setF3Dialog({ uid: row.uid, field });
      }
      return;
    }

    // ── Tab / Shift+Tab : move between fields in the same row ──
    if (e.key === 'Tab' && !e.shiftKey) {
      if (currentIdx >= 0 && currentIdx < TAB_FIELDS.length - 1) { e.preventDefault(); focusField(row.uid, TAB_FIELDS[currentIdx + 1]); }
      return;
    }
    if (e.key === 'Tab' && e.shiftKey) {
      if (currentIdx > 0) { e.preventDefault(); focusField(row.uid, TAB_FIELDS[currentIdx - 1]); }
      return;
    }

    // ↑ / ↓ : next / previous field within row (at caret boundary).
    // ← / → owed page-wide - see handleVerticalArrowNav.
    if (e.key === 'ArrowDown') {
      if (caretAtEnd(e.currentTarget) && currentIdx >= 0 && currentIdx < TAB_FIELDS.length - 1) {
        e.preventDefault();
        focusField(row.uid, TAB_FIELDS[currentIdx + 1]);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
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
      if (e.shiftKey) {
        // Go BACK: previous field → previous row's last field → patient "Taken" field.
        if (currentIdx > 0) {
          focusField(row.uid, TAB_FIELDS[currentIdx - 1]);
        } else {
          const prevRow = rows[rowIndex - 1];
          if (prevRow && prevRow.productId) focusField(prevRow.uid, TAB_FIELDS[TAB_FIELDS.length - 1]);
          else takenRef.current?.focus();
        }
        return;
      }
      if (currentIdx >= 0 && currentIdx < TAB_FIELDS.length - 1) {
        focusField(row.uid, TAB_FIELDS[currentIdx + 1]);
      } else {
        const nextRow = rows[rowIndex + 1];
        if (nextRow) {
          if (nextRow.productId) {
            // Next row already has a medicine → jump to its first editable field (QTY).
            focusField(nextRow.uid, TAB_FIELDS[0]);
          } else {
            // Next row is empty → focus its product search.
            setActiveSearchRow(rowIndex + 1);
            focusField(nextRow.uid, 'product');
          }
        } else {
          addNewRow();
        }
      }
    }
  }, [rows, focusField, addNewRow]);

  // ─── ← / → : walk every focusable element on the page (top-to-bottom) ────
  // Horizontal keyboard navigation across the whole billing screen - customer
  // fields, every row's inputs, payment, discount, save. stopPropagation keeps
  // it from bubbling to the tab-bar's bill-switch handler.
  const handleVerticalArrowNav = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    // The product search owns ↑/↓ for its results dropdown - leave it alone.
    if (active === masterSearchRef.current) return;
    // date/month inputs use ←/→ internally (mm/dd/yyyy segments) - don't intercept.
    const inputType = (active as HTMLInputElement).type;
    if (inputType === 'date' || inputType === 'month') return;

    const focusables = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(el => el.offsetParent !== null); // visible only

    const idx = focusables.indexOf(active);
    if (idx === -1) return;

    e.preventDefault();
    e.stopPropagation();
    const nextIdx = e.key === 'ArrowRight'
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


      {/* CRM "Returning Customer Found" popup removed - replaced by inline
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
                ['F3', 'Edit field / lock changes'],
                ['Ctrl+Enter / Ctrl+S', 'Save bill'],
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
            onClick={() => { const hasItems = rows.some(r => r.productId); if (hasItems) setShowLeaveConfirm(true); else navigate('/sales'); }}
            className="text-white/90 hover:bg-white/15 hover:text-white h-9 w-9"
            title="Back (Esc)"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="bg-white/15 p-1.5 rounded-lg">
              <ShoppingCart className="h-4 w-4 text-white" />
            </div>
            <h1 className="font-semibold text-lg tracking-wide text-white">
              {isWholesale ? 'Wholesale Sale Entry' : 'Sale Entry'}
            </h1>
            {isWholesale && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/90 text-white text-[10px] font-bold uppercase tracking-wider">
                <Diamond className="h-3 w-3" /> B2B
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden lg:block text-sm font-medium text-white/80 tabular-nums">
            {new Date(billDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
          <div className="hidden md:flex items-center gap-3 px-3 py-1 bg-white/10 rounded-full border border-white/20 text-[11px] font-medium text-white/90">
            <span className="flex items-center gap-1"><kbd className="bg-white/20 border border-white/20 px-1 rounded">F2</kbd> Search</span>
            <span className="w-1 h-1 bg-white/40 rounded-full"></span>
            <span className="flex items-center gap-1"><kbd className="bg-white/20 border border-white/20 px-1 rounded">Ctrl+↵</kbd> Save</span>
            <span className="w-1 h-1 bg-white/40 rounded-full"></span>
            <span className="flex items-center gap-1"><kbd className="bg-white/20 border border-white/20 px-1 rounded">?</kbd> Help</span>
          </div>
          <Button
            type="button"
            onClick={() => setQuickAddOpen(true)}
            className="h-9 gap-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold px-3 rounded-md shadow-sm shadow-amber-500/25 transition-colors"
            title="Add a new medicine to inventory and this bill - without leaving billing"
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

          {/* Row 2: Patient details - modern boxed fields, Enter moves to the next */}
          <div className="bg-white border border-emerald-200 rounded-xl px-3 py-2.5 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">

              {/* Patient (with existing-customer autocomplete) */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-[58px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">{isWholesale ? 'Buyer' : 'Patient'}</span>
                <div className="relative flex-1 min-w-0">
                  <input
                    ref={patientNameRef}
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

              {/* Phone - +91 prefix box, 10 digits only */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-[58px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Phone</span>
                <div className="flex items-center flex-1 min-w-0 h-8 rounded-md border border-emerald-200 bg-white overflow-hidden transition-colors focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-100">
                  <span className="grid place-items-center h-full px-2 text-sm font-bold text-emerald-700 bg-emerald-50 border-r border-emerald-200 shrink-0">+91</span>
                  <input
                    ref={phoneRef}
                    value={(customerPhone || '').replace(/^\+91/, '')}
                    onChange={e => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setCustomerPhone(digits ? '+91' + digits : '');
                    }}
                    onKeyDown={enterTo(doctorRef, patientNameRef)}
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit mobile"
                    className="flex-1 min-w-0 h-full px-2 text-sm font-medium text-emerald-900 placeholder-emerald-400/60 outline-none bg-transparent tabular-nums"
                  />
                </div>
              </div>

              {/* Doctor */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-[58px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Doctor</span>
                <input
                  ref={doctorRef}
                  value={doctorName}
                  onChange={e => setDoctorName(e.target.value)}
                  onKeyDown={enterTo(addressRef, phoneRef)}
                  placeholder="Name"
                  className={patientFieldCls}
                />
              </div>

              {/* GSTIN - B2B buyer identity, printed on the tax invoice. */}
              {isWholesale && (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-[58px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-violet-600">GSTIN</span>
                  <input
                    value={wholesaleGstin}
                    onChange={e => setWholesaleGstin(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15))}
                    placeholder="15-character GSTIN"
                    maxLength={15}
                    autoComplete="off"
                    title="Buyer GSTIN - printed on the tax invoice"
                    className={cn(patientFieldCls, 'uppercase tracking-wide')}
                  />
                </div>
              )}

              {/* Address (single column so Months fits on this row too) */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-[58px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Address</span>
                <input
                  ref={addressRef}
                  value={customerAddress}
                  onChange={e => setCustomerAddress(e.target.value)}
                  onKeyDown={enterTo(dateRef, doctorRef)}
                  placeholder="Area / street"
                  className={patientFieldCls}
                />
              </div>

              {/* Date - locked once a bill is generated */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-[58px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Date</span>
                <input
                  ref={dateRef}
                  type="date"
                  value={billDate}
                  onChange={e => !editBillId && setBillDate(e.target.value)}
                  onKeyDown={enterTo(prescRef, addressRef)}
                  readOnly={!!editBillId}
                  title={editBillId ? 'Bill date cannot be changed after a bill is generated' : undefined}
                  className={cn(patientFieldCls, 'appearance-none', editBillId && 'opacity-60 cursor-not-allowed pointer-events-none')}
                />
              </div>

              {/* Prescription months / taken - compact, same row as Address & Date */}
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
                    onKeyDown={enterTo(takenRef, dateRef)}
                    placeholder="0"
                    title="Prescribed months"
                    className={cn(patientFieldCls, 'no-spinner w-11 px-1 text-center font-bold')}
                  />
                  <span className="text-[9px] font-semibold text-emerald-500 uppercase">Presc</span>
                  <input
                    ref={takenRef}
                    type="number"
                    min="0"
                    value={monthsTaken}
                    onChange={e => setMonthsTaken(e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
                    onKeyDown={e => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      if (e.shiftKey) prescRef.current?.focus();
                      else focusFirstEmptyProduct();
                    }}
                    placeholder="0"
                    title="Months taken"
                    className={cn(patientFieldCls, 'no-spinner w-11 px-1 text-center font-bold')}
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
        {/* Marg-style dense billing grid - one responsive table for every screen.
            On phones the fluid fr columns shrink to fill the full width with no
            horizontal scroll; from lg up it opens out to the spacious desktop size. */}
        <div className="billing-grid flex w-full min-w-[900px] lg:max-w-[1700px] mx-auto bg-white rounded-lg shadow-sm border border-emerald-200 overflow-hidden flex-col">
          {/* Table header - Product · QTY · PCS · HSN · Batch · MRP · Rate · DISC · GST · Amount */}
          <div className={`grid ${GRID_COLS} bg-emerald-100/70 border-b-2 border-emerald-200 text-[11px] lg:text-[13px] font-bold uppercase tracking-tight lg:tracking-wide text-emerald-800 py-2 divide-x divide-emerald-200/60`}>
            <div className="pl-2 lg:pl-4 truncate">Product</div>
            <div className="px-0.5 lg:px-1 text-center">Expiry</div>
            <div className="px-0.5 lg:px-1 text-center">Strip</div>
            {isWholesale && <div className="px-0.5 lg:px-1 text-center" title="Free / scheme quantity - given away, not billed">Free</div>}
            <div className="px-0.5 lg:px-1 text-center">PCS</div>
            <div className="px-0.5 lg:px-1 text-center">Batch</div>
            <div className="px-0.5 lg:px-1 text-center">MRP</div>
            <div className="px-0.5 lg:px-1 text-center">Rate</div>
            <div className="px-0.5 lg:px-1 text-center">Disc%</div>
            <div className="px-0.5 lg:px-1 text-center">GST%</div>
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
                  {/* PRODUCT - inline search when empty, name once selected */}
                  <div className="pl-2 lg:pl-4 relative flex items-center min-w-0">
                    {row.productId ? (
                      <div className="flex items-center gap-1.5 lg:gap-2 min-w-0 pointer-events-none">
                        <span className="text-[15px] lg:text-[16px] font-semibold text-gray-800 truncate">{row.productName}</span>
                        <span className="text-[10px] font-medium text-emerald-600 shrink-0">S:{row.stock}</span>

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
                        className="w-full h-8 bg-transparent outline-none px-1 text-[15px] lg:text-[16px] font-medium text-gray-800 placeholder-emerald-300 rounded-md focus:bg-cyan-50 focus:text-cyan-900 focus:ring-[3px] focus:ring-inset focus:ring-cyan-400 focus:rounded-lg"
                      />
                    )}
                  </div>

                  {/* EXPIRY - editable YYYY-MM */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'expiry', el)}
                      type="month"
                      value={row.expiry}
                      onChange={e => updateRow(idx, { expiry: e.target.value })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'expiry')}
                      disabled={!row.productId}
                      className="h-8 text-[13px] px-1 text-center font-medium bg-transparent border-transparent hover:bg-emerald-50 focus:bg-cyan-50 focus:!text-cyan-900 focus:!border-cyan-400 focus:!ring-[3px] focus:!ring-inset focus:!ring-cyan-400 focus:!rounded-lg transition-all shadow-none text-rose-500 appearance-none"
                    />
                  </div>

                  {/* STRIP - full strips qty */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'qty', el)}
                      type="number"
                      min="0"
                      value={row.qty}
                      onChange={e => updateRow(idx, { qty: parseInt(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'qty')}
                      disabled={!row.productId}
                      className="h-8 text-[16px] px-1 text-center font-medium bg-transparent border-transparent hover:bg-emerald-50 focus:bg-cyan-50 focus:!text-cyan-900 focus:!border-cyan-400 focus:!ring-[3px] focus:!ring-inset focus:!ring-cyan-400 focus:!rounded-lg focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all shadow-none"
                    />
                  </div>

                  {/* FREE - scheme qty. Given away: excluded from the amount,
                      still deducted from stock as its own ₹0 invoice line. */}
                  {isWholesale && (
                    <div className="px-0.5">
                      <Input
                        ref={el => setFieldRef(row.uid, 'freeQty', el)}
                        type="number"
                        min="0"
                        value={row.freeQty || ''}
                        onChange={e => updateRow(idx, { freeQty: Math.max(0, parseInt(e.target.value) || 0) })}
                        onKeyDown={e => handleFieldKeyDown(e, idx, 'freeQty')}
                        disabled={!row.productId}
                        placeholder="-"
                        title="Free / scheme quantity - not billed, but deducted from stock"
                        className="h-8 text-[15px] px-1 text-center font-medium bg-transparent border-transparent hover:bg-violet-50 focus:bg-violet-50 focus:!text-violet-900 focus:!border-violet-400 focus:!ring-[3px] focus:!ring-inset focus:!ring-violet-400 focus:!rounded-lg transition-all shadow-none text-violet-700"
                      />
                    </div>
                  )}

                  {/* PCS - loose tablets (subQty) */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'subQty', el)}
                      type="number"
                      min="0"
                      max={row.pcsPerUnit > 0 ? row.pcsPerUnit - 1 : undefined}
                      value={row.subQty}
                      onChange={e => updateRow(idx, { subQty: e.target.value === '' ? '' : parseInt(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'subQty')}
                      disabled={!row.productId || row.pcsPerUnit === 0}
                      placeholder={row.pcsPerUnit > 0 ? '-' : 'N/A'}
                      className="h-8 text-[15px] px-1 text-center font-medium bg-transparent border-transparent hover:bg-emerald-50 focus:bg-indigo-100 focus:!text-gray-900 focus:!border-indigo-400 focus:!ring-2 focus:!ring-indigo-300 transition-all shadow-none text-green-700"
                    />
                  </div>

                  {/* BATCH - FEFO picker when the product has batches, free
                      text otherwise (accounts not yet on the batch ledger). */}
                  <div className="px-0.5">
                    {(row.batchOptions?.length ?? 0) > 0 ? (
                      <select
                        ref={el => setFieldRef(row.uid, 'batch', el)}
                        value={row.batchId ?? ''}
                        onChange={e => {
                          const picked = row.batchOptions?.find(b => b.id === e.target.value);
                          if (!picked) return;
                          updateRow(idx, {
                            batchId: picked.id,
                            batch: picked.batch_number,
                            batchExpiryIso: picked.expiry_date,
                            expiry: picked.expiry_date.substring(0, 7),
                            cogsRate: Number(picked.effective_cost) || 0,
                            gst: Number(picked.gst_rate) || row.gst,
                          });
                        }}
                        onKeyDown={e => handleFieldKeyDown(e, idx, 'batch')}
                        disabled={!row.productId}
                        title={
                          row.batchExpiryIso
                            ? `Expires ${formatExpiryShort(row.batchExpiryIso)}`
                            : undefined
                        }
                        className={cn(
                          'h-8 w-full text-[15px] px-1 text-center font-medium bg-transparent border border-transparent rounded-md hover:bg-emerald-50 focus:bg-cyan-50 focus:border-cyan-400 focus:outline-none transition-all',
                          expiryStatus(row.batchExpiryIso) === 'critical' && 'text-red-600',
                          expiryStatus(row.batchExpiryIso) === 'warning' && 'text-amber-600',
                        )}
                      >
                        {row.batchOptions?.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.batch_number} · {formatExpiryShort(b.expiry_date)} · {b.qty_available}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        ref={el => setFieldRef(row.uid, 'batch', el)}
                        value={row.batch}
                        onChange={e => updateRow(idx, { batch: e.target.value })}
                        onKeyDown={e => handleFieldKeyDown(e, idx, 'batch')}
                        disabled={!row.productId}
                        className="h-8 text-[16px] px-1 text-center font-medium bg-transparent border-transparent hover:bg-emerald-50 focus:bg-cyan-50 focus:!text-cyan-900 focus:!border-cyan-400 focus:!ring-[3px] focus:!ring-inset focus:!ring-cyan-400 focus:!rounded-lg focus:border-emerald-400 focus:ring-2 focus:ring-emerald-50 transition-all shadow-none text-gray-700"
                      />
                    )}
                  </div>

                  {/* MRP - F3 to edit */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'mrp', el)}
                      type="number"
                      step="0.01"
                      value={row.mrp || ''}
                      onChange={e => updateRow(idx, { mrp: parseFloat(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'mrp')}
                      disabled={!row.productId}
                      readOnly={!isF3Unlocked(row.uid, 'mrp')}
                      onBlur={() => { if (isF3Unlocked(row.uid, 'mrp')) setF3Unlocked(null); }}
                      title={isF3Unlocked(row.uid, 'mrp') ? 'Editing MRP - press F3 to lock' : 'Press F3 to edit MRP'}
                      className={`h-8 text-[15px] px-1 text-center font-medium bg-transparent border-transparent hover:bg-emerald-50 transition-all shadow-none tabular-nums ${
                        isF3Unlocked(row.uid, 'mrp')
                          ? 'focus:bg-amber-50 focus:!text-amber-900 focus:!border-amber-400 focus:!ring-[3px] focus:!ring-inset focus:!ring-amber-400 focus:!rounded-lg text-amber-700'
                          : 'text-gray-500 cursor-default'
                      }`}
                    />
                  </div>

                  {/* Rate (editable selling rate) */}
                  <div className="px-0.5">
                    <Input
                      ref={el => setFieldRef(row.uid, 'rate', el)}
                      type="number"
                      step="0.01"
                      value={row.rate || ''}
                      onChange={e => updateRow(idx, { rate: parseFloat(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'rate')}
                      disabled={!row.productId}
                      className="h-8 text-[16px] px-1 text-center font-medium bg-transparent border-transparent hover:bg-emerald-50 focus:bg-cyan-50 focus:!text-cyan-900 focus:!border-cyan-400 focus:!ring-[3px] focus:!ring-inset focus:!ring-cyan-400 focus:!rounded-lg focus:border-emerald-500 transition-all shadow-none text-gray-900"
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
                      className="h-8 text-[16px] pl-1 pr-4 font-medium bg-transparent border-transparent hover:bg-emerald-50 focus:bg-cyan-50 focus:!text-cyan-900 focus:!border-cyan-400 focus:!ring-[3px] focus:!ring-inset focus:!ring-cyan-400 focus:!rounded-lg focus:border-red-400 transition-all shadow-none text-red-500 text-center"
                    />
                    {row.productId && (
                      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-red-400/70">%</span>
                    )}
                  </div>

                  {/* GST% (auto-fetched from product, editable) */}
                  <div className="px-0.5 relative">
                    <Input
                      ref={el => setFieldRef(row.uid, 'gst', el)}
                      type="number"
                      step="0.1"
                      value={row.gst || ''}
                      onChange={e => updateRow(idx, { gst: parseFloat(e.target.value) || 0 })}
                      onKeyDown={e => handleFieldKeyDown(e, idx, 'gst')}
                      disabled={!row.productId}
                      placeholder="0"
                      className="h-8 text-[16px] pl-1 pr-4 font-medium bg-transparent border-transparent hover:bg-emerald-50 focus:bg-cyan-50 focus:!text-cyan-900 focus:!border-cyan-400 focus:!ring-[3px] focus:!ring-inset focus:!ring-cyan-400 focus:!rounded-lg focus:border-emerald-400 transition-all shadow-none text-gray-600 text-center"
                    />
                    {row.productId && (
                      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-gray-400/70">%</span>
                    )}
                  </div>

                  {/* AMOUNT */}
                  <div className="pr-2 lg:pr-6 text-right">
                    <span className={`text-base lg:text-lg font-semibold ${row.amount > 0 ? 'text-emerald-700' : 'text-gray-300'}`}>
                      {row.amount > 0 ? row.amount.toFixed(2) : '0.00'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-center">
                    {row.productId && (
                      <button
                        type="button"
                        className="grid place-items-center h-7 w-7 rounded-md text-red-400 hover:text-white hover:bg-red-500 transition-colors"
                        onClick={() => removeRow(idx)}
                        title="Remove row (Alt+Delete)"
                        aria-label="Remove row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Empty ledger lines to fill the grid (Marg look) */}
            {Array.from({ length: Math.max(0, 10 - rows.length) }).map((_, i) => (
              <div key={`filler-${i}`} className={`grid ${GRID_COLS} h-9 divide-x divide-green-50`}>
                {Array.from({ length: GRID_COL_COUNT }).map((__, c) => <div key={c} />)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Floating results for the in-row product search (portal → never clipped) */}
      {activeSearchRow !== null && searchTerm.trim() !== '' && searchRect && createPortal(
        (() => {
          const list = filteredProducts.slice(0, 20);
          const width = Math.min(Math.max(searchRect.width, 620), window.innerWidth - 16);
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
              <div ref={searchListRef} className="flex-1 overflow-y-auto py-1">
                {list.length > 0 ? list.map((p, i) => (
                  <div
                    key={p.id}
                    data-item={i}
                    onMouseEnter={() => setSearchHighlight(i)}
                    className={`group/item w-full pl-4 pr-2 h-9 flex items-center gap-3 border-b border-gray-50 last:border-0 transition-colors ${searchHighlight === i ? 'bg-emerald-50' : 'hover:bg-gray-50/50'} ${p.quantity <= 0 ? 'opacity-50 grayscale' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => selectProduct(activeSearchRow as number, p)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left h-full"
                    >
                      <span className={`text-sm font-semibold truncate flex-1 min-w-0 ${searchHighlight === i ? 'text-emerald-700' : 'text-gray-800'} ${p.quantity <= 0 ? 'text-red-500 line-through decoration-red-300' : ''}`}>{p.name}</span>
                      {p.hsn_code && <span className="hidden lg:inline text-[11px] text-gray-400 shrink-0 w-[86px] text-right truncate">HSN {p.hsn_code}</span>}
                      {p.pcs_per_unit && p.pcs_per_unit > 0 && <span className="hidden sm:inline text-[11px] font-medium text-indigo-500 shrink-0 w-[64px] text-right tabular-nums">1×{p.pcs_per_unit}</span>}
                      <span className={`text-[11px] font-medium shrink-0 w-16 text-right tabular-nums ${p.quantity <= 0 ? 'text-red-600 font-bold' : 'text-emerald-600'}`}>Stk {p.quantity}</span>
                      <span className="text-sm font-bold text-emerald-700 shrink-0 w-20 text-right tabular-nums">₹{p.selling_price.toFixed(2)}</span>
                    </button>
                    <button
                      type="button"
                      title="View full info (F1)"
                      onClick={() => { setInfoProduct(p); setInfoRow(activeSearchRow); }}
                      className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-full text-indigo-500 hover:bg-indigo-50"
                    >
                      <HelpCircle className="h-4 w-4" />
                    </button>
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
          onClick={closeInfo}
        >
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white flex items-center justify-between gap-2 shrink-0">
              <div className="min-w-0">
                <p className="font-bold text-lg truncate">{infoProduct.name}</p>
                <p className="text-[11px] text-emerald-50 truncate">
                  {[infoProduct.category, infoProduct.manufacturer].filter(Boolean).join(' · ') || 'Product details'}
                </p>
              </div>
              <button type="button" onClick={closeInfo} className="p-1 rounded-full hover:bg-white/20 shrink-0">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {infoDetails.loading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
                </div>
              ) : (() => {
                const full = infoDetails.full || {};
                const sales = infoDetails.sales;
                const purchase = full.purchase_price ?? null;
                const mrp = infoProduct.selling_price;
                const margin = (purchase && purchase > 0) ? ((mrp - purchase) / purchase) * 100 : null;
                const strips = sales.reduce((s: number, r: any) => s + (r.quantity || 0), 0);
                const tabs = sales.reduce((s: number, r: any) => s + (r.sub_qty || 0), 0);
                const revenue = sales.reduce((s: number, r: any) => s + (r.total_price || 0), 0);
                const lastSold = sales[0];
                const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
                return (
                  <>
                    {/* Key stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <StatTile label="Current Stock" value={String(full.quantity ?? infoProduct.quantity)} />
                      <StatTile label="M.R.P." value={`₹${mrp.toFixed(2)}`} accent />
                      <StatTile label="Purchase" value={purchase != null ? `₹${Number(purchase).toFixed(2)}` : '-'} />
                      <StatTile label="Margin" value={margin != null ? `${margin >= 0 ? '+' : ''}${margin.toFixed(1)}%` : '-'} accent={margin != null && margin >= 0} />
                    </div>

                    {/* Product details */}
                    <InfoSection title="Product Details">
                      <DetailItem label="HSN Code" value={full.hsn_code || infoProduct.hsn_code} />
                      <DetailItem label="Batch" value={full.batch_number || infoProduct.batch_number} />
                      <DetailItem label="Expiry" value={(full.expiry_date || infoProduct.expiry_date) ? (full.expiry_date || infoProduct.expiry_date).substring(0, 7) : null} />
                      <DetailItem label="GST" value={(full.gst ?? infoProduct.gst) != null ? `${full.gst ?? infoProduct.gst}%` : null} />
                      <DetailItem label="Pcs / Unit" value={String(full.pcs_per_unit || infoProduct.pcs_per_unit || 10)} />
                      <DetailItem label="Low-stock alert" value={full.low_stock_threshold != null ? String(full.low_stock_threshold) : null} />
                      <DetailItem label="SKU" value={full.sku} />
                      <DetailItem label="Category" value={full.category || infoProduct.category} />
                      <DetailItem label="Manufacturer" value={full.manufacturer || infoProduct.manufacturer} />
                    </InfoSection>

                    {/* Purchase & supplier */}
                    <InfoSection title="Purchase & Supplier">
                      <DetailItem label="Supplier" value={full.supplier} />
                      <DetailItem label="Purchase Price" value={purchase != null ? `₹${Number(purchase).toFixed(2)}` : null} />
                      <DetailItem label="Added on" value={fmtDate(full.created_at)} />
                      <DetailItem label="Last updated" value={fmtDate(full.updated_at)} />
                    </InfoSection>

                    {/* Sales summary */}
                    <InfoSection title="Sales Summary">
                      <DetailItem label="Bills" value={String(sales.length)} />
                      <DetailItem label="Strips sold" value={String(strips)} />
                      <DetailItem label="Tablets sold" value={String(tabs)} />
                      <DetailItem label="Total revenue" value={`₹${revenue.toFixed(2)}`} />
                      <DetailItem label="Last sold" value={lastSold ? fmtDate(lastSold.sale_date || lastSold.created_at) : '-'} />
                      <DetailItem label="Last sold to" value={lastSold?.customer_name || null} />
                    </InfoSection>

                    {/* Recent sales */}
                    <div>
                      <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Recent Sales</h3>
                      {sales.length > 0 ? (
                        <div className="border border-gray-100 rounded-lg overflow-hidden">
                          <div className="grid grid-cols-[1fr_1.4fr_0.7fr_0.9fr_1fr] bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400 px-3 py-1.5">
                            <span>Date</span><span>Customer</span><span className="text-center">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span>
                          </div>
                          <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
                            {sales.slice(0, 40).map((r: any, i: number) => (
                              <div key={i} className="grid grid-cols-[1fr_1.4fr_0.7fr_0.9fr_1fr] px-3 py-1.5 text-xs items-center hover:bg-gray-50/60">
                                <span className="text-gray-500 tabular-nums">{fmtDate(r.sale_date || r.created_at)}</span>
                                <span className="text-gray-700 truncate">{r.customer_name || 'Walk-in'}</span>
                                <span className="text-center font-medium text-gray-700 tabular-nums">{r.quantity}{r.sub_qty ? `+${r.sub_qty}` : ''}</span>
                                <span className="text-right text-gray-600 tabular-nums">₹{Number(r.unit_price || 0).toFixed(2)}</span>
                                <span className="text-right font-semibold text-emerald-700 tabular-nums">₹{Number(r.total_price || 0).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic">No sales recorded for this medicine yet.</p>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex gap-2 shrink-0">
              <Button
                ref={addToBillRef}
                type="button"
                onClick={() => { if (infoRow !== null) selectProduct(infoRow, infoProduct); setInfoProduct(null); setInfoRow(null); }}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Add to bill
              </Button>
              <Button
                ref={closeInfoRef}
                type="button"
                variant="outline"
                onClick={closeInfo}
                className="focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Close
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}


      {/* ══════ ZONE 5: STICKY FOOTER (SLEEK) ══════ */}
      <div className="bg-white border-t border-green-100 shadow-[0_-8px_24px_rgba(0,0,0,0.04)] shrink-0 z-30">
        <div className="px-2 sm:px-6 py-2 flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-4 max-w-[1700px] mx-auto">
          {/* Left: Payment & inputs - full width on mobile */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 sm:gap-3 md:gap-4 md:flex-1 min-w-0">
            {/* Payment modes - 4-up grid on phones, inline from sm */}
            <div className="grid grid-cols-4 sm:flex gap-1 sm:gap-1.5 bg-white p-1 rounded-lg border border-green-100 w-full sm:w-auto">
              {paymentModes.map((mode, i) => (
                <button
                  key={mode.key}
                  type="button"
                  ref={el => (paymentRefs.current[i] = el)}
                  onClick={() => setPaymentMode(mode.key)}
                  onKeyDown={e => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                      e.preventDefault(); e.stopPropagation();
                      const n = (i + 1) % paymentModes.length;
                      setPaymentMode(paymentModes[n].key);
                      paymentRefs.current[n]?.focus();
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                      e.preventDefault(); e.stopPropagation();
                      const n = (i - 1 + paymentModes.length) % paymentModes.length;
                      setPaymentMode(paymentModes[n].key);
                      paymentRefs.current[n]?.focus();
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      setPaymentMode(mode.key);
                      if (e.shiftKey) focusFirstEmptyProduct(); // back to the item rows
                      else globalDiscRef.current?.focus();       // forward
                    }
                  }}
                  className={`flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-colors relative outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${paymentMode === mode.key ? 'bg-green-600 text-white shadow-sm z-10' : 'text-gray-600 hover:text-green-700 hover:bg-green-50'}`}
                >
                  <mode.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{mode.label}</span>
                </button>
              ))}
            </div>

            <div className="hidden md:block h-8 w-px bg-green-100"></div>

            {/* Disc + Received - share one row on phones, flow inline from sm */}
            <div className="flex gap-2 w-full sm:contents">
              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-md border border-green-100 flex-1 sm:flex-none min-w-0">
                <Label className="text-[11px] font-medium text-green-700 shrink-0">Global Disc%</Label>
                <Input
                  ref={globalDiscRef}
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={globalDiscount || ''}
                  onChange={e => setGlobalDiscount(parseFloat(e.target.value) || 0)}
                  onKeyDown={e => {
                    const empty = e.currentTarget.value === '';
                    const toPayment = () => { const idx = Math.max(0, paymentModes.findIndex(m => m.key === paymentMode)); paymentRefs.current[idx]?.focus(); };
                    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) toPayment(); else receivedRef.current?.focus(); }
                    else if (e.key === 'ArrowRight' && empty) { e.preventDefault(); receivedRef.current?.focus(); }
                    else if (e.key === 'ArrowLeft' && empty) { e.preventDefault(); toPayment(); }
                  }}
                  className="no-spinner flex-1 sm:flex-none sm:w-14 min-w-0 h-8 text-sm text-center border-green-200 bg-white focus:border-green-500 focus:ring-green-100 shadow-none"
                  placeholder="0"
                />
              </div>

              <div className={`flex items-center gap-1.5 bg-white px-2 py-1 rounded-md border transition-all flex-1 sm:flex-none min-w-0 ${paymentMode === 'credit' ? 'border-orange-200 bg-orange-50' : 'border-green-100'}`}>
                <Label className={`text-[11px] font-medium shrink-0 ${paymentMode === 'credit' ? 'text-orange-700' : 'text-green-700'}`}>
                  {paymentMode === 'credit' ? 'Amt Paid' : 'Received'}
                </Label>
                <Input
                  ref={receivedRef}
                  type="number"
                  min="0"
                  step="0.01"
                  value={receivedAmount}
                  onChange={e => setReceivedAmount(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                  onKeyDown={e => {
                    const empty = e.currentTarget.value === '';
                    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) globalDiscRef.current?.focus(); else finalizeRef.current?.focus(); }
                    else if (e.key === 'ArrowRight' && empty) { e.preventDefault(); finalizeRef.current?.focus(); }
                    else if (e.key === 'ArrowLeft' && empty) { e.preventDefault(); globalDiscRef.current?.focus(); }
                  }}
                  className={`no-spinner flex-1 min-w-0 sm:flex-none sm:w-auto sm:min-w-[3.5rem] sm:max-w-[9rem] sm:[field-sizing:content] h-8 text-sm font-bold border-none shadow-none bg-transparent focus:ring-0 text-right ${paymentMode === 'credit' ? 'text-orange-900' : 'text-green-900'}`}
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Live due amount indicator for partial / credit payments */}
            {(() => {
              const paid = receivedAmount !== '' ? Number(receivedAmount) : 0;
              const due = totals.grandTotal - paid;
              if (due > 0.01) {
                return (
                  <div className="flex items-center justify-between sm:justify-center gap-2 px-3 py-1 rounded-md bg-red-50 border border-red-200 w-full sm:w-auto sm:min-w-[80px]">
                    <span className="text-[10px] sm:text-[9px] font-bold text-red-400 uppercase tracking-wider">Due</span>
                    <span className="text-sm font-black text-red-600">₹{Math.round(due * 100) / 100}</span>
                  </div>
                );
              }
              return null;
            })()}
          </div>

          {/* Right: Amount + Finalize - full width on mobile */}
          <div className="flex items-stretch gap-2 sm:gap-3 w-full md:w-auto">
            <div className="hidden lg:flex items-center gap-5 text-sm font-medium">
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

            <div className="bg-emerald-50 text-emerald-900 px-4 py-2 rounded-md border border-emerald-200 flex flex-col items-center justify-center flex-1 md:flex-none md:min-w-[170px] min-w-0">
              <span className="text-[11px] font-medium text-emerald-600">Amount Payable</span>
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
              className="flex-1 md:flex-none h-auto md:h-10 px-5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-md transition-colors disabled:opacity-50 border border-green-500/20"
            >
              {isSaving ? 'Recording...' : (
                <div className="flex items-center justify-center gap-2">
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

      {/* ══════ LEAVE CONFIRMATION ══════ */}
      {/* ══════ F3 EDIT CONFIRMATION ══════ */}
      {f3Dialog && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
          onKeyDown={e => {
            if (e.key === 'Escape') { e.stopPropagation(); setF3Dialog(null); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              const btns = document.querySelectorAll<HTMLButtonElement>('[data-f3-btn]');
              const cur = Array.from(btns).indexOf(document.activeElement as HTMLButtonElement);
              btns[(cur + 1) % btns.length]?.focus();
            }
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-2">
              <p className="text-base font-bold text-gray-900">Edit this field?</p>
              <p className="text-sm text-gray-500 mt-1">Press F3 again to lock in your changes.</p>
            </div>
            <div className="flex gap-3 px-6 py-4 justify-end">
              <button
                data-f3-btn
                autoFocus
                type="button"
                onClick={handleF3Confirm}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors"
              >
                Yes
              </button>
              <button
                data-f3-btn
                type="button"
                onClick={() => setF3Dialog(null)}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors"
              >
                No
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showLeaveConfirm && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-title"
          className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
          onKeyDown={e => {
            if (e.key === 'Escape') { e.stopPropagation(); setShowLeaveConfirm(false); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              const btns = document.querySelectorAll<HTMLButtonElement>('[data-leave-btn]');
              const cur = Array.from(btns).indexOf(document.activeElement as HTMLButtonElement);
              btns[(cur + 1) % btns.length]?.focus();
            }
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-2">
              <p id="leave-title" className="text-base font-bold text-gray-900">Bill in progress - leave without saving?</p>
              <p className="text-sm text-gray-500 mt-1">Your unsaved bill will be lost.</p>
            </div>
            <div className="flex gap-3 px-6 py-4 justify-end">
              <button
                data-leave-btn
                autoFocus
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors"
              >
                Stay
              </button>
              <button
                data-leave-btn
                type="button"
                onClick={() => { setShowLeaveConfirm(false); if (persistKey) clearBillData(persistKey, isWholesale ? 'wholesale' : undefined); navigate('/sales'); }}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors"
              >
                Leave
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

    </div>
  );
}

// ── Product-info modal helpers ──────────────────────────────────────────────
function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-emerald-200 bg-emerald-50' : 'border-gray-100 bg-gray-50'}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-lg font-bold mt-0.5 tabular-nums ${accent ? 'text-emerald-700' : 'text-gray-800'}`}>{value}</p>
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">{children}</div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-800 break-words">{value || '-'}</p>
    </div>
  );
}

