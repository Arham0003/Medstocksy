import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Trash2,
  Package as PackageIcon,
  Boxes,
  Wallet,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { parseInvoicePdf, type ParsedInvoiceItem } from '@/lib/parseInvoicePdf';
import { saveMultiDraft, loadMultiDraft, clearMultiDraft } from '@/lib/productDraft';

const PRESET_CATEGORIES = [
  'Tablets',
  'Capsules',
  'Syrups',
  'Ointments',
  'Injections',
  'Drops',
  'Medical Devices',
  'Supplements',
  'Ayurveda/Homeopathy',
  'Personal Care',
  'Baby Care',
  'Surgical',
  'Others',
];

export interface SupplierOption {
  id: string;
  name: string;
  supplier_code: string;
  phone: string | null;
  contact_person: string | null;
}

interface ProductRow {
  tempId: string;
  name: string;
  hsn_code: string;
  category: string;
  batch_number: string;
  manufacturer: string;
  expiry_date: string;
  quantity: string;
  pcs_per_unit: string;
  low_stock_threshold: string;
  gst: string;
  purchase_price: string;
  selling_price: string;
  supplier_search: string;
  supplier_id: string | null;
}

interface MultiProductFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allSuppliers: SupplierOption[];
  accountId: string | undefined;
  onSaved: () => void;
  /** Default GST rate from Settings → applied to fresh rows when no per-product override */
  defaultGstRate?: number;
}

const makeRow = (defaultGst: number = 18): ProductRow => ({
  tempId: (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2),
  name: '',
  hsn_code: '',
  category: '',
  batch_number: '',
  manufacturer: '',
  expiry_date: '',
  quantity: '',
  pcs_per_unit: '',
  low_stock_threshold: '10',
  gst: String(defaultGst),
  purchase_price: '',
  selling_price: '',
  supplier_search: '',
  supplier_id: null,
});

// Transparent-bg input that lights up on focus — matches Record Sale's cart-row feel
const bareInputCls =
  'h-9 text-sm bg-transparent border-transparent hover:bg-white focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all shadow-none';

// Spreadsheet grid: #  PRODUCT  HSN  BATCH  QTY  GST  BUY  SELL  ✕
// Fluid fr columns so the whole table fits the screen width with no horizontal scroll;
// opens out to roomier proportions from lg up.
const ROW_COLS =
  'grid-cols-[22px_1.7fr_0.7fr_0.85fr_0.5fr_0.5fr_0.72fr_0.8fr_26px] lg:grid-cols-[34px_2.4fr_0.9fr_1.05fr_0.62fr_0.6fr_0.9fr_0.95fr_38px]';

// Borderless cell input that blends into the grid (spreadsheet look)
const cellInputCls =
  'h-8 text-[13px] px-1 bg-transparent border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400 focus-visible:bg-white';

// Small label above bare inputs
const FieldLabel = ({ children, required }: { children: React.ReactNode; required?: boolean }) => (
  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
    {children}
    {required && <span className="text-rose-500 ml-0.5">*</span>}
  </span>
);

// Per-row supplier picker — compact, search + dropdown
const SupplierPicker = ({
  value,
  supplierId,
  onChange,
  suppliers,
  onAddNew,
  inputRef,
  onEnterNext,
}: {
  value: string;
  supplierId: string | null;
  onChange: (search: string, id: string | null) => void;
  suppliers: SupplierOption[];
  onAddNew: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  onEnterNext?: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLInputElement | null>(null);

  const reposition = () => {
    if (inRef.current) setRect(inRef.current.getBoundingClientRect());
  };
  const openMenu = () => { reposition(); setOpen(true); };
  const closeMenu = () => setOpen(false);

  // While open, keep the portal aligned to the input and close on outside click.
  useEffect(() => {
    if (!open) return;
    reposition();
    const onScroll = () => reposition();
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (wrapRef.current?.contains(t)) return;
      if (t.closest?.('[data-supplier-menu]')) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!value.trim()) return suppliers.slice(0, 8);
    const q = value.toLowerCase();
    return suppliers
      .filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.phone || '').includes(q) ||
        (s.contact_person || '').toLowerCase().includes(q) ||
        s.supplier_code.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [suppliers, value]);

  const pick = (s: SupplierOption) => {
    onChange(s.name, s.id);
    setOpen(false);
  };

  // Portal-rendered menu: fixed to the viewport so it is never clipped by the
  // scrollable dialog body. Width is clamped to stay on-screen.
  const menuWidth = rect ? Math.min(Math.max(rect.width, 240), window.innerWidth - 16) : 240;
  const menuLeft = rect ? Math.min(rect.left, window.innerWidth - menuWidth - 8) : 0;

  return (
    <div className="relative" ref={wrapRef}>
      <Input
        ref={el => { inRef.current = el; inputRef?.(el); }}
        value={value}
        onChange={e => {
          onChange(e.target.value, null);
          openMenu();
        }}
        onFocus={openMenu}
        onKeyDown={e => {
          if (e.key === 'Escape') { closeMenu(); return; }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          // If searching (no supplier chosen yet), auto-pick the top match, then move on.
          if (open && !supplierId && value.trim() && filtered.length > 0) {
            onChange(filtered[0].name, filtered[0].id);
          }
          setOpen(false);
          onEnterNext?.();
        }}
        placeholder="Search supplier..."
        className={cn(bareInputCls, 'h-8 text-[13px] border-slate-200 bg-white')}
        autoComplete="off"
      />
      {supplierId && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded pointer-events-none">
          {suppliers.find(s => s.id === supplierId)?.supplier_code}
        </span>
      )}
      {open && rect && createPortal(
        <div
          data-supplier-menu
          style={{ position: 'fixed', top: rect.bottom + 4, left: menuLeft, width: menuWidth }}
          className="z-[120] bg-white border border-slate-200 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] max-h-64 overflow-y-auto"
        >
          {filtered.map(s => (
            <button
              key={s.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between border-b border-slate-50 last:border-0"
              onMouseDown={e => { e.preventDefault(); pick(s); }}
            >
              <div className="min-w-0">
                <span className="font-medium text-sm block truncate">{s.name}</span>
                {s.contact_person && (
                  <span className="text-[11px] text-muted-foreground">{s.contact_person}</span>
                )}
              </div>
              <div className="text-right shrink-0 ml-2">
                <span className="text-[10px] font-mono bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">
                  {s.supplier_code}
                </span>
                {s.phone && <div className="text-[10px] text-muted-foreground mt-0.5">{s.phone}</div>}
              </div>
            </button>
          ))}
          {suppliers.length > 0 && filtered.length === 0 && (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              No matches for "{value}"
            </div>
          )}
          {suppliers.length === 0 && (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              No suppliers yet.
            </div>
          )}
          <div className="border-t border-slate-100 p-2 bg-slate-50 sticky bottom-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-blue-600 hover:text-blue-700 hover:bg-blue-100 font-medium"
              onMouseDown={e => { e.preventDefault(); onAddNew(); }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add New Supplier
            </Button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export const MultiProductForm = ({
  open,
  onOpenChange,
  allSuppliers,
  accountId,
  onSaved,
  defaultGstRate = 18,
}: MultiProductFormProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ProductRow[]>([makeRow(defaultGstRate)]);
  const [isSaving, setIsSaving] = useState(false);

  // ─── Import from invoice PDF ───
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importItems, setImportItems] = useState<ParsedInvoiceItem[]>([]);
  const [importSupplier, setImportSupplier] = useState('');
  const [importSelected, setImportSelected] = useState<Set<number>>(new Set());

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked again later
    if (!file) return;
    setImportOpen(true);
    setImporting(true);
    setImportError(null);
    setImportItems([]);
    setImportSelected(new Set());
    setImportSupplier('');
    try {
      const { supplierName, items } = await parseInvoicePdf(file);
      setImportSupplier(supplierName);
      if (items.length === 0) {
        setImportError('No products could be read from this PDF. It may be a scanned image or an unsupported layout.');
      } else {
        setImportItems(items);
        setImportSelected(new Set(items.map((_, i) => i)));
      }
    } catch (err) {
      console.error('Invoice parse failed:', err);
      setImportError('Could not read this PDF. Please check the file and try again.');
    } finally {
      setImporting(false);
    }
  };

  const toggleImportRow = (i: number) => {
    setImportSelected(prev => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  };

  const applyImport = () => {
    const chosen = importItems.filter((_, i) => importSelected.has(i));
    if (chosen.length === 0) return;
    const supplierMatch = importSupplier
      ? allSuppliers.find(s => s.name.toLowerCase() === importSupplier.toLowerCase())
      : undefined;
    const imported: ProductRow[] = chosen.map(it => ({
      ...makeRow(defaultGstRate),
      name: it.name,
      hsn_code: it.hsn_code,
      batch_number: it.batch_number,
      manufacturer: it.manufacturer,
      expiry_date: it.expiry_date,
      quantity: it.quantity,
      gst: it.gst || String(defaultGstRate),
      purchase_price: it.purchase_price,
      selling_price: it.selling_price,
      supplier_search: supplierMatch ? supplierMatch.name : importSupplier,
      supplier_id: supplierMatch ? supplierMatch.id : null,
    }));
    // Keep any rows the user already filled; drop a single empty starter row.
    setRows(prev => {
      const meaningful = prev.filter(r => r.name.trim() || r.selling_price || r.quantity || r.batch_number);
      return [...meaningful, ...imported];
    });
    setImportOpen(false);
    setImportItems([]);
    setImportSelected(new Set());
    toast({ title: 'Products imported', description: `${imported.length} product(s) added from the invoice.` });
  };

  // On open: restore a saved draft (e.g. after nipping to Suppliers to add one),
  // otherwise start fresh with the current default GST rate.
  useEffect(() => {
    if (!open) return;
    const draft = loadMultiDraft<ProductRow[]>();
    if (draft && draft.length > 0) {
      setRows(draft);
      clearMultiDraft();
    } else {
      setRows([makeRow(defaultGstRate)]);
    }
  }, [open, defaultGstRate]);

  // When the supplier list refreshes (e.g. user just registered one), link any
  // rows whose typed supplier name now matches a registered supplier.
  useEffect(() => {
    setRows(prev => {
      let changed = false;
      const next = prev.map(r => {
        if (!r.supplier_id && r.supplier_search.trim()) {
          const m = allSuppliers.find(s => s.name.toLowerCase() === r.supplier_search.trim().toLowerCase());
          if (m) { changed = true; return { ...r, supplier_id: m.id }; }
        }
        return r;
      });
      return changed ? next : prev;
    });
  }, [allSuppliers]);

  // Save the current rows and jump to Suppliers to register a new one, then
  // reopen here with everything intact.
  const goAddSupplier = () => {
    saveMultiDraft(rows);
    onOpenChange(false);
    navigate('/suppliers?from=add-products');
  };

  const updateRow = (tempId: string, patch: Partial<ProductRow>) => {
    setRows(prev => prev.map(r => (r.tempId === tempId ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    const next = makeRow(defaultGstRate);
    setRows(prev => [...prev, next]);
    // Queue focus onto the new row's first field once it renders.
    pendingFocus.current = refKey(next.tempId, 'name');
  };

  const removeRow = (tempId: string) => {
    setRows(prev => (prev.length === 1 ? prev : prev.filter(r => r.tempId !== tempId)));
  };

  // ─── Enter-key navigation across a row's fields (then on to the next row) ───
  const ENTER_FIELDS = [
    'name', 'hsn_code', 'batch_number', 'quantity', 'gst', 'purchase_price',
    'selling_price', 'category', 'supplier', 'manufacturer', 'expiry_date',
    'pcs_per_unit', 'low_stock_threshold',
  ] as const;
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingFocus = useRef<string | null>(null);
  const refKey = (tempId: string, field: string) => `${tempId}::${field}`;
  const setFieldRef = (tempId: string, field: string, el: HTMLElement | null) => {
    fieldRefs.current[refKey(tempId, field)] = el;
  };
  const focusField = (tempId: string, field: string) => {
    const el = fieldRefs.current[refKey(tempId, field)];
    if (el) { el.focus(); (el as HTMLInputElement).select?.(); }
  };

  // Focus a field queued by Enter after a new row has rendered.
  useEffect(() => {
    if (pendingFocus.current) {
      const el = fieldRefs.current[pendingFocus.current];
      if (el) { el.focus(); (el as HTMLInputElement).select?.(); pendingFocus.current = null; }
    }
  });

  // Move focus from `field` to the next field (or the next/new row).
  const advanceFrom = (rowIndex: number, field: string) => {
    const fi = ENTER_FIELDS.indexOf(field as (typeof ENTER_FIELDS)[number]);
    if (fi === -1) return;
    if (fi < ENTER_FIELDS.length - 1) {
      focusField(rows[rowIndex].tempId, ENTER_FIELDS[fi + 1]);
    } else if (rowIndex + 1 < rows.length) {
      focusField(rows[rowIndex + 1].tempId, ENTER_FIELDS[0]);
    } else {
      const next = makeRow(defaultGstRate);
      setRows(prev => [...prev, next]);
      pendingFocus.current = refKey(next.tempId, ENTER_FIELDS[0]);
    }
  };

  const handleEnterNav = (e: React.KeyboardEvent<HTMLElement>, rowIndex: number, field: string) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    advanceFrom(rowIndex, field);
  };

  // F2 (anywhere in the dialog) → add a new product row and focus it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        addRow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const validRows = rows.filter(r => r.name.trim() && parseFloat(r.selling_price) > 0);

  // Summary totals for sticky footer
  const totals = useMemo(() => {
    let stockValue = 0;
    let units = 0;
    const supplierSet = new Set<string>();
    rows.forEach(r => {
      const qty = parseInt(r.quantity) || 0;
      const buy = parseFloat(r.purchase_price) || 0;
      stockValue += qty * buy;
      units += qty;
      const supplierKey = r.supplier_id || r.supplier_search.trim();
      if (supplierKey) supplierSet.add(supplierKey);
    });
    return { stockValue, units, distinctSuppliers: supplierSet.size };
  }, [rows]);

  const canSave = validRows.length > 0 && !isSaving;

  const saveAll = async () => {
    if (!accountId) {
      toast({ variant: 'destructive', title: 'Not signed in', description: 'Cannot save without an account.' });
      return;
    }

    const firstInvalid = rows.find(r => !r.name.trim() || !(parseFloat(r.selling_price) > 0));
    if (firstInvalid) {
      toast({
        variant: 'destructive',
        title: 'Missing required fields',
        description: 'Each product needs a Name and a Selling Price greater than 0.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const payload = validRows.map(r => ({
        name: r.name.trim(),
        hsn_code: r.hsn_code.trim() || null,
        category: r.category || null,
        batch_number: r.batch_number.trim() || null,
        manufacturer: r.manufacturer.trim() || null,
        expiry_date: r.expiry_date ? (r.expiry_date.length === 7 ? `${r.expiry_date}-01` : r.expiry_date) : null,
        quantity: parseInt(r.quantity) || 0,
        purchase_price: parseFloat(r.purchase_price) || 0,
        selling_price: parseFloat(r.selling_price),
        gst: parseFloat(r.gst) || 0,
        supplier: r.supplier_search.trim() || null,
        supplier_id: r.supplier_id,
        low_stock_threshold: parseInt(r.low_stock_threshold) || 10,
        pcs_per_unit: r.pcs_per_unit && parseInt(r.pcs_per_unit) > 0 ? parseInt(r.pcs_per_unit) : null,
        account_id: accountId,
      }));

      const { error } = await supabase.from('products').insert(payload);
      if (error) throw error;

      toast({
        title: payload.length === 1 ? 'Product added' : `${payload.length} products added`,
        description: 'All products are now in your inventory.',
      });
      onSaved();
      onOpenChange(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      toast({ variant: 'destructive', title: 'Error saving products', description: msg });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[98vw] sm:w-[95vw] sm:max-w-5xl lg:max-w-6xl max-h-[94vh] h-[94vh] p-0 overflow-hidden flex flex-col gap-0 border-0"
      >
        {/* ═══════ TOP TOOLBAR ═══════ */}
        {/* pr-12 reserves space for the close X that <DialogContent> injects at top-right */}
        <div className="bg-white border-b border-blue-100 shrink-0">
          <div className="flex items-center justify-between pl-3 sm:pl-4 pr-12 py-2.5 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-1.5 rounded-lg shrink-0">
                <PackageIcon className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="font-semibold text-base sm:text-lg text-slate-900 leading-tight">
                  Add Products
                </h1>
                <p className="text-[11px] sm:text-xs text-muted-foreground leading-tight truncate">
                  Multiple products · different suppliers
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={handleImportFile}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-8 gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Import Invoice</span>
              </Button>
              <div className="hidden md:flex items-center gap-3 px-3 py-1 bg-blue-50 rounded-full border border-blue-100 text-[11px] font-medium text-blue-700">
                <span className="flex items-center gap-1">
                  <Boxes className="h-3 w-3" />
                  {rows.length} {rows.length === 1 ? 'row' : 'rows'}
                </span>
                <span className="w-1 h-1 bg-blue-300 rounded-full"></span>
                <span>{validRows.length} ready</span>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════ BODY: ROW ENTRIES ═══════ */}
        <div className="flex-1 overflow-auto bg-slate-50/60 px-2 sm:px-4 py-3">
          <div className="max-w-[1500px] mx-auto">
            {/* Spreadsheet table — one dense editable row per product, aligned columns */}
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              {/* Column header (sticky while scrolling) */}
              <div className={cn(
                'grid', ROW_COLS,
                'sticky top-0 z-20 bg-slate-100 border-b border-slate-200 rounded-t-lg',
                'text-[9px] lg:text-[10px] font-bold uppercase tracking-wide text-slate-500 divide-x divide-slate-200/70'
              )}>
                <div className="px-0.5 py-2 text-center">#</div>
                <div className="px-2 py-2">Product</div>
                <div className="px-1 py-2 text-center">HSN</div>
                <div className="px-1 py-2 text-center">Batch</div>
                <div className="px-1 py-2 text-center">Qty</div>
                <div className="px-1 py-2 text-center">GST</div>
                <div className="px-1 py-2 text-center">Buy</div>
                <div className="px-1 py-2 text-center">Sell</div>
                <div className="px-0.5 py-2" />
              </div>

              {/* Rows */}
              <div className="divide-y divide-slate-200">
                {rows.map((row, idx) => {
                  const hasContent = Boolean(row.name.trim() || row.selling_price || row.quantity);
                  const missingRequired = hasContent && (!row.name.trim() || !(parseFloat(row.selling_price) > 0));

                  return (
                    <div
                      key={row.tempId}
                      className={cn('transition-colors', missingRequired ? 'bg-rose-50/50' : 'hover:bg-blue-50/30')}
                    >
                      {/* Main line — the spreadsheet row */}
                      <div className={cn('grid items-stretch divide-x divide-slate-100', ROW_COLS)}>
                        <div className="flex items-center justify-center text-[11px] font-semibold text-slate-400 tabular-nums">
                          {idx + 1}
                        </div>
                        <div className="min-w-0">
                          <Input
                            ref={el => setFieldRef(row.tempId, 'name', el)}
                            value={row.name}
                            onChange={e => updateRow(row.tempId, { name: e.target.value })}
                            onKeyDown={e => handleEnterNav(e, idx, 'name')}
                            placeholder="Product name *"
                            className={cn(cellInputCls, 'w-full font-medium text-slate-900')}
                          />
                        </div>
                        <div className="min-w-0">
                          <Input
                            ref={el => setFieldRef(row.tempId, 'hsn_code', el)}
                            value={row.hsn_code}
                            onChange={e => updateRow(row.tempId, { hsn_code: e.target.value })}
                            onKeyDown={e => handleEnterNav(e, idx, 'hsn_code')}
                            placeholder="—"
                            className={cn(cellInputCls, 'w-full text-center')}
                          />
                        </div>
                        <div className="min-w-0">
                          <Input
                            ref={el => setFieldRef(row.tempId, 'batch_number', el)}
                            value={row.batch_number}
                            onChange={e => updateRow(row.tempId, { batch_number: e.target.value })}
                            onKeyDown={e => handleEnterNav(e, idx, 'batch_number')}
                            placeholder="—"
                            className={cn(cellInputCls, 'w-full text-center')}
                          />
                        </div>
                        <div className="min-w-0">
                          <Input
                            ref={el => setFieldRef(row.tempId, 'quantity', el)}
                            type="number"
                            min="0"
                            value={row.quantity}
                            onChange={e => updateRow(row.tempId, { quantity: e.target.value })}
                            onKeyDown={e => handleEnterNav(e, idx, 'quantity')}
                            placeholder="0"
                            className={cn(cellInputCls, 'w-full text-center')}
                          />
                        </div>
                        <div className="min-w-0">
                          <Input
                            ref={el => setFieldRef(row.tempId, 'gst', el)}
                            type="number"
                            step="0.01"
                            value={row.gst}
                            onChange={e => updateRow(row.tempId, { gst: e.target.value })}
                            onKeyDown={e => handleEnterNav(e, idx, 'gst')}
                            placeholder="18"
                            className={cn(cellInputCls, 'w-full text-center')}
                          />
                        </div>
                        <div className="min-w-0">
                          <Input
                            ref={el => setFieldRef(row.tempId, 'purchase_price', el)}
                            type="number"
                            step="0.01"
                            value={row.purchase_price}
                            onChange={e => updateRow(row.tempId, { purchase_price: e.target.value })}
                            onKeyDown={e => handleEnterNav(e, idx, 'purchase_price')}
                            placeholder="0.00"
                            className={cn(cellInputCls, 'w-full text-right')}
                          />
                        </div>
                        <div className="min-w-0">
                          <Input
                            ref={el => setFieldRef(row.tempId, 'selling_price', el)}
                            type="number"
                            step="0.01"
                            value={row.selling_price}
                            onChange={e => updateRow(row.tempId, { selling_price: e.target.value })}
                            onKeyDown={e => handleEnterNav(e, idx, 'selling_price')}
                            placeholder="0.00"
                            className={cn(cellInputCls, 'w-full text-right font-semibold text-emerald-700')}
                          />
                        </div>
                        <div className="flex items-center justify-center">
                          <button
                            type="button"
                            onClick={() => removeRow(row.tempId)}
                            disabled={rows.length === 1}
                            title={rows.length === 1 ? 'At least one product is required' : 'Remove'}
                            className="h-7 w-7 flex items-center justify-center rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-300 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Secondary strip — remaining fields, compact & always visible */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-2 gap-y-1.5 px-2 pb-2 pt-1 bg-slate-50/60 border-t border-slate-100">
                        <div className="flex flex-col gap-0.5">
                          <FieldLabel>Category</FieldLabel>
                          <Select value={row.category} onValueChange={v => updateRow(row.tempId, { category: v })}>
                            <SelectTrigger
                              ref={el => setFieldRef(row.tempId, 'category', el)}
                              onKeyDown={e => handleEnterNav(e, idx, 'category')}
                              className="h-8 text-[13px] bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all shadow-none"
                            >
                              <SelectValue placeholder="Select…" />
                            </SelectTrigger>
                            <SelectContent>
                              {PRESET_CATEGORIES.map(c => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-0.5 col-span-2 sm:col-span-1">
                          <FieldLabel>Supplier</FieldLabel>
                          <SupplierPicker
                            value={row.supplier_search}
                            supplierId={row.supplier_id}
                            onChange={(search, id) => updateRow(row.tempId, { supplier_search: search, supplier_id: id })}
                            suppliers={allSuppliers}
                            onAddNew={goAddSupplier}
                            inputRef={el => setFieldRef(row.tempId, 'supplier', el)}
                            onEnterNext={() => advanceFrom(idx, 'supplier')}
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <FieldLabel>Manufacturer</FieldLabel>
                          <Input
                            ref={el => setFieldRef(row.tempId, 'manufacturer', el)}
                            value={row.manufacturer}
                            onChange={e => updateRow(row.tempId, { manufacturer: e.target.value })}
                            onKeyDown={e => handleEnterNav(e, idx, 'manufacturer')}
                            placeholder="—"
                            className="h-8 text-[13px] bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 shadow-none"
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <FieldLabel>Expiry</FieldLabel>
                          <Input
                            ref={el => setFieldRef(row.tempId, 'expiry_date', el)}
                            type="date"
                            value={row.expiry_date}
                            onChange={e => updateRow(row.tempId, { expiry_date: e.target.value })}
                            onKeyDown={e => handleEnterNav(e, idx, 'expiry_date')}
                            className="h-8 text-[12px] bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 shadow-none"
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <FieldLabel>Pcs/Strip</FieldLabel>
                          <Input
                            ref={el => setFieldRef(row.tempId, 'pcs_per_unit', el)}
                            type="number"
                            min="1"
                            value={row.pcs_per_unit}
                            onChange={e => updateRow(row.tempId, { pcs_per_unit: e.target.value })}
                            onKeyDown={e => handleEnterNav(e, idx, 'pcs_per_unit')}
                            placeholder="—"
                            className="h-8 text-[13px] text-center bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 shadow-none"
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <FieldLabel>Low&nbsp;Stock</FieldLabel>
                          <Input
                            ref={el => setFieldRef(row.tempId, 'low_stock_threshold', el)}
                            type="number"
                            min="0"
                            value={row.low_stock_threshold}
                            onChange={e => updateRow(row.tempId, { low_stock_threshold: e.target.value })}
                            onKeyDown={e => handleEnterNav(e, idx, 'low_stock_threshold')}
                            placeholder="10"
                            className="h-8 text-[13px] text-center bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 shadow-none"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* + Add another product */}
            <button
              type="button"
              onClick={addRow}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-blue-300 text-blue-600 hover:border-blue-400 hover:bg-blue-50/50 transition-colors font-medium text-sm"
            >
              <Plus className="h-4 w-4" />
              Add another product
              <kbd className="ml-1 px-1.5 py-0.5 rounded border border-blue-200 bg-white text-[10px] font-semibold text-blue-500">F2</kbd>
            </button>
          </div>
        </div>

        {/* ═══════ STICKY FOOTER ═══════ */}
        <div className="bg-white border-t border-blue-100 shadow-[0_-8px_24px_rgba(0,0,0,0.04)] shrink-0">
          <div className="px-3 sm:px-5 py-2.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3 max-w-[1500px] mx-auto">
            {/* Left: stat tiles */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-4">
              <div className="hidden sm:flex items-center gap-4 text-sm font-medium">
                <div className="flex flex-col text-right">
                  <span className="text-blue-500 text-[10px] uppercase tracking-wider">Rows</span>
                  <span className="text-slate-800 text-base leading-tight">{rows.length}</span>
                </div>
                <div className="h-8 w-px bg-blue-100"></div>
                <div className="flex flex-col text-right">
                  <span className="text-emerald-500 text-[10px] uppercase tracking-wider">Ready</span>
                  <span className="text-emerald-700 text-base leading-tight">{validRows.length}</span>
                </div>
                <div className="h-8 w-px bg-blue-100"></div>
                <div className="flex flex-col text-right">
                  <span className="text-violet-500 text-[10px] uppercase tracking-wider">Suppliers</span>
                  <span className="text-violet-700 text-base leading-tight">{totals.distinctSuppliers}</span>
                </div>
                <div className="h-8 w-px bg-blue-100"></div>
                <div className="flex flex-col text-right">
                  <span className="text-slate-500 text-[10px] uppercase tracking-wider">Units</span>
                  <span className="text-slate-800 text-base leading-tight">{totals.units}</span>
                </div>
              </div>

              {/* Mobile compact version */}
              <div className="flex sm:hidden items-center gap-3 text-xs font-medium">
                <span className="text-slate-600">
                  <span className="font-bold text-slate-900">{rows.length}</span> rows
                </span>
                <span className="text-emerald-700">
                  <span className="font-bold">{validRows.length}</span> ready
                </span>
                <span className="text-violet-700">
                  <span className="font-bold">{totals.distinctSuppliers}</span> suppliers
                </span>
              </div>
            </div>

            {/* Right: Stock value tile + actions */}
            <div className="flex items-center gap-2 sm:gap-4 justify-between md:justify-end">
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 text-slate-900 px-3 sm:px-4 py-1.5 rounded-lg border border-blue-200 flex flex-col items-start sm:items-center min-w-[120px] sm:min-w-[150px]">
                <span className="text-[10px] font-medium text-blue-600 uppercase tracking-wider flex items-center gap-1">
                  <Wallet className="h-3 w-3" />
                  Stock Value
                </span>
                <div className="flex items-baseline gap-0.5 leading-tight">
                  <span className="text-blue-600 text-xs font-medium">₹</span>
                  <span className="text-lg sm:text-xl font-semibold tabular-nums">
                    {totals.stockValue.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="h-10 px-3 sm:px-4 text-sm"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={saveAll}
                  disabled={!canSave}
                  className="h-10 px-4 sm:px-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium text-sm rounded-md disabled:opacity-50"
                >
                  {isSaving ? (
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      Saving…
                    </div>
                  ) : (
                    <span>
                      Save {validRows.length > 0 ? `${validRows.length} ` : ''}
                      {validRows.length === 1 ? 'Product' : 'Products'}
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* ═══════ INVOICE IMPORT PREVIEW ═══════ */}
    <Dialog open={importOpen} onOpenChange={setImportOpen}>
      <DialogContent className="w-[98vw] sm:w-[95vw] sm:max-w-4xl max-h-[90vh] p-0 overflow-hidden flex flex-col gap-0">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 shrink-0 px-4 pr-12 py-3">
          <h2 className="font-semibold text-base sm:text-lg text-slate-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Import products from invoice
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review the products read from the PDF, then add the ones you want.
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-slate-50/60 p-4">
          {importing ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-3" />
              <p className="text-sm">Reading the invoice…</p>
            </div>
          ) : importError ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-500 mb-3" />
              <p className="text-sm font-medium text-slate-700">{importError}</p>
              <p className="text-xs text-muted-foreground mt-1">You can still add products manually.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {importSupplier && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Supplier:</span>
                  <span className="font-medium text-slate-800">{importSupplier}</span>
                  {allSuppliers.some(s => s.name.toLowerCase() === importSupplier.toLowerCase()) ? (
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Matched</Badge>
                  ) : (
                    <Badge variant="outline" className="text-amber-600 border-amber-200">New — will be typed in</Badge>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-500 text-[10px] uppercase tracking-wide">
                      <th className="p-2 w-8"></th>
                      <th className="p-2 text-left">Product</th>
                      <th className="p-2 text-center">HSN</th>
                      <th className="p-2 text-center">Batch</th>
                      <th className="p-2 text-center">Expiry</th>
                      <th className="p-2 text-center">Qty</th>
                      <th className="p-2 text-center">GST</th>
                      <th className="p-2 text-right">Buy</th>
                      <th className="p-2 text-right">MRP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importItems.map((it, i) => {
                      const selected = importSelected.has(i);
                      return (
                        <tr
                          key={i}
                          className={cn('cursor-pointer', selected ? 'bg-blue-50/40' : 'opacity-50')}
                          onClick={() => toggleImportRow(i)}
                        >
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleImportRow(i)}
                              onClick={e => e.stopPropagation()}
                              className="h-4 w-4 accent-blue-600"
                            />
                          </td>
                          <td className="p-2">
                            <div className="font-medium text-slate-800 leading-tight">{it.name}</div>
                            {it.manufacturer && <div className="text-[10px] text-muted-foreground">{it.manufacturer}</div>}
                          </td>
                          <td className="p-2 text-center text-slate-600">{it.hsn_code || '—'}</td>
                          <td className="p-2 text-center text-slate-600">{it.batch_number || '—'}</td>
                          <td className="p-2 text-center text-slate-600">{it.expiry_date ? it.expiry_date.slice(0, 7) : '—'}</td>
                          <td className="p-2 text-center font-medium">{it.quantity || '—'}</td>
                          <td className="p-2 text-center">{it.gst ? `${it.gst}%` : '—'}</td>
                          <td className="p-2 text-right text-slate-600">{it.purchase_price || '—'}</td>
                          <td className="p-2 text-right font-semibold text-emerald-700">{it.selling_price || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                MRP is set as the selling price and Rate as the purchase price. You can edit everything after adding.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-white border-t border-slate-200 shrink-0 px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {importItems.length > 0 && `${importSelected.size} of ${importItems.length} selected`}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={applyImport}
              disabled={importing || importSelected.size === 0}
              className="gap-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
            >
              <CheckCircle2 className="h-4 w-4" />
              Add {importSelected.size > 0 ? importSelected.size : ''} product{importSelected.size === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default MultiProductForm;
