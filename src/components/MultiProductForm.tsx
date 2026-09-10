import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Trash2,
  Boxes,
  Wallet,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Receipt,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { cn, calcEffectivePurchasePrice } from '@/lib/utils';
import { calcGst } from '@/lib/gst';
import { parseInvoicePdf, type ParsedInvoiceItem } from '@/lib/parseInvoicePdf';
import { saveMultiDraft, loadMultiDraft, clearMultiDraft } from '@/lib/productDraft';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  manufacturer: string; // product manufacturer
  category: string;     // product category
  hsn_code: string;
  batch_number: string;
  expiry_date: string;  // MM/YY text
  quantity: string;
  pcs_per_unit: string; // tablets/pcs per strip (blank = not applicable)
  free: string;         // free qty
  low_stock: string;    // low stock alert threshold (defaults to '10')
  mrp: string;          // max retail price → maps to selling_price
  rate: string;         // purchase rate   → maps to purchase_price
  disc_pct: string;     // line discount %
  gst: string;          // GST %
  rowErrors: Record<string, string>;
}

interface InvoiceHeader {
  supplierSearch: string;
  supplierId: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
}

// Draft persists header + rows across navigation (e.g. trip to /suppliers)
type DraftShape = { header: InvoiceHeader; rows: ProductRow[] };

export interface MultiProductFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allSuppliers: SupplierOption[];
  allProducts?: any[];
  accountId: string | undefined;
  onSaved: () => void;
  defaultGstRate?: number;
  gstInclusive?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const blankHeader = (): InvoiceHeader => ({
  supplierSearch: '',
  supplierId: null,
  invoiceNumber: '',
  invoiceDate: new Date().toISOString().slice(0, 10),
  dueDate: '',
});

const makeRow = (defaultGst = 18): ProductRow => ({
  tempId:
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  name: '',
  manufacturer: '',
  category: '',
  hsn_code: '',
  batch_number: '',
  expiry_date: '',
  quantity: '',
  pcs_per_unit: '',
  free: '',
  low_stock: '10',
  mrp: '',
  rate: '',
  disc_pct: '',
  gst: String(defaultGst),
  rowErrors: {},
});

/** MM/YY or YYYY-MM-DD → YYYY-MM-01 for DB storage; returns null on bad input. */
const expiryToDate = (input: string): string | null => {
  if (!input || !input.trim()) return null;
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split(/[\/-]/);
  if (parts.length < 2) return null;
  const [m, y] = parts;
  if (!m || !y || y.length < 2) return null;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${m.padStart(2, '0')}-01`;
};

/** Automatically insert '/' after MM when typing digits for MM/YY */
const formatExpiryInput = (val: string, prev: string): string => {
  if (val.length < prev.length) return val;
  let clean = val.replace(/[^\d/]/g, '');
  
  if (clean.length >= 2) {
    const mm = parseInt(clean.slice(0, 2), 10);
    if (mm > 12) clean = '12' + clean.slice(2);
    else if (mm === 0) clean = '01' + clean.slice(2);
  }

  if (/^\d{2}$/.test(clean)) return clean + '/';
  if (/^\d{3,4}$/.test(clean) && !clean.includes('/')) {
    return clean.slice(0, 2) + '/' + clean.slice(2, 4);
  }
  return clean.slice(0, 5);
};

// ─── Styles ───────────────────────────────────────────────────────────────────

// Borderless spreadsheet-cell input
const cellCls =
  'h-8 text-[13px] px-1 bg-transparent border-0 rounded-none shadow-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ' +
  'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400 focus-visible:bg-white';

// Red highlight for validation errors
const cellErrCls = 'border border-rose-400 bg-rose-50/40 rounded focus-visible:ring-rose-300';

const cardInputCls =
  'h-7 text-xs bg-white border border-slate-200 rounded px-2 shadow-none hover:border-slate-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ' +
  'focus-visible:ring-1 focus-visible:ring-blue-500 transition-all';

const FieldLabel = ({ children, required }: { children: React.ReactNode; required?: boolean }) => (
  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block leading-none mb-0.5">
    {children}
    {required && <span className="text-rose-500 ml-0.5">*</span>}
  </span>
);

// Kept in sync with category presets in Products.tsx & QuickAddMedicineSheet.tsx
const PRESET_CATEGORIES = [
  'Tablets', 'Capsules', 'Syrups', 'Ointments', 'Injections', 'Drops',
  'Medical Devices', 'Supplements', 'Ayurveda/Homeopathy', 'Personal Care',
  'Baby Care', 'Surgical', 'Others',
];

// 17 visible columns + row# col + delete col (19 cols total)
// # | PRODUCT | CATEGORY | HSN | BATCH | EXPIRY | QTY | PCS | FREE | LOW STOCK | MRP | RATE | DISC% | GST% | MARGIN | AMOUNT | ✕
const ROW_COLS =
  'grid-cols-[22px_1.8fr_0.75fr_0.52fr_0.68fr_0.55fr_0.44fr_0.42fr_0.42fr_0.48fr_0.65fr_0.65fr_0.5fr_0.5fr_0.55fr_0.68fr_26px]';

// ─── SupplierPicker ───────────────────────────────────────────────────────────
// Reused as-is for the invoice header. Portal-based dropdown to avoid clipping.

const SupplierPicker = ({
  value,
  supplierId,
  onChange,
  suppliers,
  onAddNew,
  inputRef,
  onEnterNext,
  placeholder = 'Search supplier…',
  inputClassName,
}: {
  value: string;
  supplierId: string | null;
  onChange: (search: string, id: string | null) => void;
  suppliers: SupplierOption[];
  onAddNew: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  onEnterNext?: () => void;
  placeholder?: string;
  inputClassName?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLInputElement | null>(null);

  const reposition = useCallback(() => {
    if (inRef.current) setRect(inRef.current.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    const onScroll = (e: Event) => {
      if ((e.target as HTMLElement)?.closest?.('[data-supplier-menu]')) return;
      reposition();
    };
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
  }, [open, reposition]);

  const filtered = useMemo(() => {
    if (!value.trim()) return suppliers;
    const q = value.toLowerCase();
    return suppliers.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        (s.phone || '').includes(q) ||
        (s.contact_person || '').toLowerCase().includes(q) ||
        s.supplier_code.toLowerCase().includes(q),
    );
  }, [suppliers, value]);

  const pick = (s: SupplierOption) => {
    onChange(s.name, s.id);
    setOpen(false);
  };

  const menuWidth = rect
    ? Math.min(Math.max(rect.width, 260), window.innerWidth - 16)
    : 260;
  const menuLeft = rect
    ? Math.min(rect.left, window.innerWidth - menuWidth - 8)
    : 0;

  return (
    <div className="relative" ref={wrapRef}>
      <Input
        ref={el => {
          inRef.current = el;
          inputRef?.(el);
        }}
        value={value}
        onChange={e => {
          onChange(e.target.value, null);
          setActiveIdx(0);
          reposition();
          setOpen(true);
        }}
        onFocus={() => {
          setActiveIdx(0);
          reposition();
          setOpen(true);
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) setOpen(true);
            else {
              const next = Math.min(activeIdx + 1, filtered.length - 1);
              setActiveIdx(next);
              document.getElementById(`supplier-opt-${next}`)?.scrollIntoView({ block: 'nearest' });
            }
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            const next = Math.max(activeIdx - 1, 0);
            setActiveIdx(next);
            document.getElementById(`supplier-opt-${next}`)?.scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (open && filtered.length > 0) {
            const chosen = filtered[activeIdx] || filtered[0];
            onChange(chosen.name, chosen.id);
          }
          setOpen(false);
          onEnterNext?.();
        }}
        placeholder={placeholder}
        className={inputClassName}
        autoComplete="off"
      />
      {supplierId && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded pointer-events-none">
          {suppliers.find(s => s.id === supplierId)?.supplier_code}
        </span>
      )}
      {open &&
        rect &&
        createPortal(
          <div
            data-supplier-menu
            style={{
              position: 'fixed',
              top: rect.bottom + 4,
              left: menuLeft,
              width: menuWidth,
              pointerEvents: 'auto',
            }}
            className="z-[120] bg-white border border-slate-200 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] max-h-72 flex flex-col overflow-hidden"
          >
            <div className="overflow-y-auto flex-1 min-h-0">
              {filtered.map((s, idx) => (
                <button
                  key={s.id}
                  id={`supplier-opt-${idx}`}
                  type="button"
                  className={`w-full text-left px-3 py-2 flex items-center justify-between border-b border-slate-50 last:border-0 ${idx === activeIdx ? 'bg-blue-50' : 'hover:bg-blue-50'}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onMouseDown={e => {
                    e.preventDefault();
                    pick(s);
                  }}
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
                    {s.phone && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">{s.phone}</div>
                    )}
                  </div>
                </button>
              ))}
              {suppliers.length > 0 && filtered.length === 0 && (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  No matches for "{value}"
                </div>
              )}
              {suppliers.length === 0 && (
                <div className="px-3 py-3 text-sm text-muted-foreground">No suppliers yet.</div>
              )}
            </div>
            <div className="border-t border-slate-100 p-2 bg-slate-50 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start text-blue-600 hover:text-blue-700 hover:bg-blue-100 font-medium"
                onMouseDown={e => {
                  e.preventDefault();
                  onAddNew();
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New Supplier
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

// ─── Category Picker ──────────────────────────────────────────────────────────

const CategoryPicker = ({
  value,
  onChange,
  onKeyDown,
  options,
  inputRef,
  placeholder = 'Category',
  className,
}: {
  value: string;
  onChange: (val: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  options: string[];
  inputRef?: (el: HTMLInputElement | null) => void;
  placeholder?: string;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = useMemo(() => {
    if (!value.trim()) return options;
    const q = value.toLowerCase();
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, value]);

  const pick = (opt: string) => {
    onChange(opt);
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <Input
        ref={inputRef}
        value={value}
        onChange={e => {
          onChange(e.target.value);
          setActiveIdx(0);
          setOpen(true);
        }}
        onFocus={() => {
          setActiveIdx(0);
          setOpen(true);
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) setOpen(true);
            else {
              const next = Math.min(activeIdx + 1, filtered.length - 1);
              setActiveIdx(next);
              document.getElementById(`cat-opt-${next}`)?.scrollIntoView({ block: 'nearest' });
            }
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            const next = Math.max(activeIdx - 1, 0);
            setActiveIdx(next);
            document.getElementById(`cat-opt-${next}`)?.scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key === 'Enter' && open && filtered.length > 0 && filtered[activeIdx]) {
            e.preventDefault();
            pick(filtered[activeIdx]);
            return;
          }
          onKeyDown?.(e);
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open &&
        filtered.length > 0 && (
          <div
            data-category-menu
            className="absolute top-[calc(100%+4px)] left-0 min-w-[220px] w-full z-[120] bg-white border border-slate-200 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] max-h-64 flex flex-col overflow-hidden"
          >
            <div className="overflow-y-auto flex-1 min-h-0 py-1.5">
              {filtered.map((opt, idx) => (
                <button
                  key={opt}
                  id={`cat-opt-${idx}`}
                  type="button"
                  className={`w-full text-left px-3 py-2 flex items-center justify-between text-sm font-medium transition-colors ${idx === activeIdx ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700'}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onMouseDown={e => {
                    e.preventDefault();
                    pick(opt);
                  }}
                >
                  <span>{opt}</span>
                </button>
              ))}
            </div>
          </div>
        )}
    </div>
  );
};

// ─── Product Picker ─────────────────────────────────────────────────────────────

const ProductPicker = ({
  value,
  onChange,
  onKeyDown,
  products,
  inputRef,
  placeholder = 'Product name *',
  className,
}: {
  value: string;
  onChange: (val: string, product?: any) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  products?: any[];
  inputRef?: (el: HTMLInputElement | null) => void;
  placeholder?: string;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = useMemo(() => {
    if (!products) return [];
    if (!value.trim()) return products.slice(0, 50);
    const q = value.toLowerCase();
    return products.filter((p: any) => p.name.toLowerCase().includes(q) || (p.manufacturer && p.manufacturer.toLowerCase().includes(q))).slice(0, 50);
  }, [products, value]);

  const pick = (opt: any) => {
    onChange(opt.name, opt);
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <Input
        ref={inputRef}
        value={value}
        onChange={e => {
          const val = e.target.value;
          onChange(val);
          setActiveIdx(0);
          if (val.trim()) setOpen(true);
          else setOpen(false);
        }}
        onFocus={() => {
          if (value.trim()) {
            setActiveIdx(0);
            setOpen(true);
          }
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) setOpen(true);
            else {
              const next = Math.min(activeIdx + 1, filtered.length - 1);
              setActiveIdx(next);
              document.getElementById(`prod-opt-${next}`)?.scrollIntoView({ block: 'nearest' });
            }
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            const next = Math.max(activeIdx - 1, 0);
            setActiveIdx(next);
            document.getElementById(`prod-opt-${next}`)?.scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key === 'Enter' && open && filtered.length > 0 && filtered[activeIdx]) {
            e.preventDefault();
            pick(filtered[activeIdx]);
            return;
          }
          onKeyDown?.(e);
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open &&
        filtered.length > 0 && (
          <div
            data-product-menu
            className="absolute top-[calc(100%+4px)] left-0 min-w-[300px] w-full z-[120] bg-white border border-slate-200 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] max-h-64 flex flex-col overflow-hidden"
          >
            <div className="overflow-y-auto flex-1 min-h-0 py-1.5">
              {filtered.map((opt: any, idx: number) => (
                <button
                  key={opt.id}
                  id={`prod-opt-${idx}`}
                  type="button"
                  className={`w-full text-left px-3 py-2.5 flex flex-col gap-1 text-sm transition-all border-b border-slate-100 last:border-0 ${idx === activeIdx ? 'bg-blue-50 text-blue-900' : 'text-slate-700 hover:bg-slate-50'}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onMouseDown={e => {
                    e.preventDefault();
                    pick(opt);
                  }}
                >
                  <div className="flex justify-between items-start w-full gap-2">
                    <div className="font-semibold truncate">{opt.name}</div>
                    <div className="text-[10px] font-medium bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded shrink-0">Stock: {opt.quantity || 0}</div>
                  </div>
                  <div className="flex justify-between items-center w-full text-[11px] text-slate-500">
                    <div className="truncate pr-2">{opt.manufacturer || 'Unknown'}</div>
                    {opt.batch_number && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm font-medium text-slate-600">B: {opt.batch_number}</span>
                        {opt.expiry_date && <span className="text-slate-400">Exp: {opt.expiry_date.substring(5, 7)}/{opt.expiry_date.substring(2, 4)}</span>}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
    </div>
  );
};


// ─── Main Component ───────────────────────────────────────────────────────────

const MemoizedRowCard = React.memo(({ row, idx, rowsLength, removeRow, setFieldRef, updateRow, handleEnterNav, formatExpiryInput, onProductNameChange, allProducts }: any) => {

                const hasErr = Object.keys(row.rowErrors).length > 0;
                return (
                  <div
                    key={row.tempId}
                    className={cn(
                      'bg-white rounded-lg shadow-sm border transition-all',
                      hasErr
                        ? 'border-rose-300 ring-1 ring-rose-200 bg-rose-50/20'
                        : 'border-blue-100 hover:border-blue-200',
                    )}
                  >
                    {/* Card Header Strip */}
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 via-white to-white min-h-[28px] rounded-t-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="shrink-0 h-5 w-5 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center text-[11px] font-bold shadow-sm">
                          {idx + 1}
                        </div>
                        <p className="font-semibold text-xs text-slate-800 truncate">
                          {row.name.trim() || <span className="italic text-slate-400">New product</span>}
                        </p>
                        {(parseFloat(row.rate) > 0 || parseFloat(row.mrp) > 0 || parseFloat(row.quantity) > 0 || row.finalAmount > 0) && (
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground ml-2 flex-wrap">
                            {parseFloat(row.rate) > 0 && <span>Rate: <strong className="text-slate-700">₹{parseFloat(row.rate).toFixed(2)}</strong></span>}
                            {parseFloat(row.mrp) > 0 && <span>MRP: <strong className="text-slate-700">₹{parseFloat(row.mrp).toFixed(2)}</strong></span>}
                            {parseFloat(row.quantity) > 0 && <span>Qty: <strong className="text-slate-700">{row.quantity}</strong></span>}
                            {row.finalAmount > 0 && <span className="text-emerald-600 font-semibold">Amt: ₹{row.finalAmount.toFixed(2)}</span>}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRow(row.tempId)}
                        disabled={rowsLength === 1}
                        title={rowsLength === 1 ? 'At least one row is required' : 'Remove row'}
                        className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-300 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Card Strip 1: Main Info */}
                    <div className="px-2.5 py-1 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 items-end border-b border-slate-50">
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel required>Product Name</FieldLabel>
                        <ProductPicker
                          inputRef={(el: HTMLInputElement | null) => setFieldRef(row.tempId, 'name', el)}
                          value={row.name}
                          products={allProducts}
                          onChange={(val: string, product?: any) => onProductNameChange(row.tempId, val, row, product)}
                          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleEnterNav(e, idx, 'name')}
                          placeholder="Product name *"
                          className={cn(cardInputCls, 'font-medium text-slate-900', row.rowErrors.name && cellErrCls)}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>Manufacturer</FieldLabel>
                        <Input
                          ref={el => setFieldRef(row.tempId, 'manufacturer', el)}
                          value={row.manufacturer}
                          onChange={e => updateRow(row.tempId, { manufacturer: e.target.value })}
                          onKeyDown={e => handleEnterNav(e, idx, 'manufacturer')}
                          placeholder="Manufacturer"
                          className={cardInputCls}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>Category</FieldLabel>
                        <CategoryPicker
                          inputRef={el => setFieldRef(row.tempId, 'category', el)}
                          value={row.category}
                          onChange={val => updateRow(row.tempId, { category: val })}
                          onKeyDown={e => handleEnterNav(e, idx, 'category')}
                          options={PRESET_CATEGORIES}
                          placeholder="Category"
                          className={cardInputCls}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>HSN</FieldLabel>
                        <Input
                          ref={el => setFieldRef(row.tempId, 'hsn_code', el)}
                          value={row.hsn_code}
                          onChange={e => updateRow(row.tempId, { hsn_code: e.target.value })}
                          onKeyDown={e => handleEnterNav(e, idx, 'hsn_code')}
                          placeholder="—"
                          className={cardInputCls}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel required>Batch</FieldLabel>
                        <Input
                          ref={el => setFieldRef(row.tempId, 'batch_number', el)}
                          value={row.batch_number}
                          onChange={e =>
                            updateRow(row.tempId, {
                              batch_number: e.target.value,
                              rowErrors: { ...row.rowErrors, batch_number: '' },
                            })
                          }
                          onKeyDown={e => handleEnterNav(e, idx, 'batch_number')}
                          placeholder="Batch *"
                          className={cn(cardInputCls, row.rowErrors.batch_number && cellErrCls)}
                        />
                      </div>
                    </div>

                    {/* Card Strip 2: Quantities & Stock */}
                    <div className="px-2.5 py-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 items-end border-b border-slate-50">
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>Expiry</FieldLabel>
                        <Input
                          ref={el => setFieldRef(row.tempId, 'expiry_date', el)}
                          value={row.expiry_date}
                          onChange={e =>
                            updateRow(row.tempId, {
                              expiry_date: formatExpiryInput(e.target.value, row.expiry_date),
                            })
                          }
                          onKeyDown={e => handleEnterNav(e, idx, 'expiry_date')}
                          placeholder="MM/YY"
                          maxLength={5}
                          className={cn(cardInputCls, 'font-mono text-center')}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>Qty</FieldLabel>
                        <Input
                          ref={el => setFieldRef(row.tempId, 'quantity', el)}
                          type="text" inputMode="decimal"
                          value={row.quantity}
                          onChange={e => updateRow(row.tempId, { quantity: e.target.value.replace(/[^0-9.]/g, '') })}
                          onKeyDown={e => handleEnterNav(e, idx, 'quantity')}
                          placeholder="0"
                          className={cn(cardInputCls, 'text-center')}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>Pcs/Strip</FieldLabel>
                        <Input
                          ref={el => setFieldRef(row.tempId, 'pcs_per_unit', el)}
                          type="text" inputMode="decimal"
                          value={row.pcs_per_unit}
                          onChange={e => updateRow(row.tempId, { pcs_per_unit: e.target.value.replace(/[^0-9]/g, '') })}
                          onKeyDown={e => handleEnterNav(e, idx, 'pcs_per_unit')}
                          placeholder="—"
                          className={cn(cardInputCls, 'text-center')}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>Free</FieldLabel>
                        <Input
                          ref={el => setFieldRef(row.tempId, 'free', el)}
                          type="text" inputMode="decimal"
                          value={row.free}
                          onChange={e => updateRow(row.tempId, { free: e.target.value.replace(/[^0-9.]/g, '') })}
                          onKeyDown={e => handleEnterNav(e, idx, 'free')}
                          placeholder="0"
                          className={cn(cardInputCls, 'text-center')}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>Low Stock</FieldLabel>
                        <Input
                          ref={el => setFieldRef(row.tempId, 'low_stock', el)}
                          type="text" inputMode="decimal"
                          value={row.low_stock}
                          onChange={e => updateRow(row.tempId, { low_stock: e.target.value.replace(/[^0-9]/g, '') })}
                          onKeyDown={e => handleEnterNav(e, idx, 'low_stock')}
                          placeholder="10"
                          title="Low Stock Alert Threshold"
                          className={cn(cardInputCls, 'text-center')}
                        />
                      </div>
                    </div>

                    {/* Card Strip 3: Pricing & Tax (preserving exact MRP and Rate names/fields!) */}
                    <div className="px-2.5 py-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 items-end bg-slate-50/40">
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>MRP</FieldLabel>
                        <Input
                          ref={el => setFieldRef(row.tempId, 'mrp', el)}
                          type="text" inputMode="decimal"
                          value={row.mrp}
                          onChange={e => updateRow(row.tempId, { mrp: e.target.value.replace(/[^0-9.]/g, '') })}
                          onKeyDown={e => handleEnterNav(e, idx, 'mrp')}
                          placeholder="0.00"
                          className={cn(cardInputCls, 'text-right')}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>Rate</FieldLabel>
                        <Input
                          ref={el => setFieldRef(row.tempId, 'rate', el)}
                          type="text" inputMode="decimal"
                          value={row.rate}
                          onChange={e => updateRow(row.tempId, { rate: e.target.value.replace(/[^0-9.]/g, '') })}
                          onKeyDown={e => handleEnterNav(e, idx, 'rate')}
                          placeholder="0.00"
                          className={cn(cardInputCls, 'text-right font-medium text-blue-900')}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>Disc %</FieldLabel>
                        <Input
                          ref={el => setFieldRef(row.tempId, 'disc_pct', el)}
                          type="text" inputMode="decimal"
                          value={row.disc_pct}
                          onChange={e => updateRow(row.tempId, { disc_pct: e.target.value.replace(/[^0-9.]/g, '') })}
                          onKeyDown={e => handleEnterNav(e, idx, 'disc_pct')}
                          placeholder="0"
                          className={cn(cardInputCls, 'text-center')}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>GST %</FieldLabel>
                        <Input
                          ref={el => setFieldRef(row.tempId, 'gst', el)}
                          type="text" inputMode="decimal"
                          value={row.gst}
                          onChange={e => updateRow(row.tempId, { gst: e.target.value.replace(/[^0-9.]/g, '') })}
                          onKeyDown={e => handleEnterNav(e, idx, 'gst')}
                          placeholder="18"
                          className={cn(cardInputCls, 'text-center')}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>Margin</FieldLabel>
                        <div
                          className={cn(
                            'h-7 flex items-center justify-center text-xs tabular-nums select-none font-medium border border-transparent rounded bg-white/60',
                            row.marginPct < 0 ? 'text-rose-600' : 'text-slate-700',
                          )}
                        >
                          {row.mrp || row.rate ? `${row.marginPct.toFixed(2)}%` : '—'}
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>Amount</FieldLabel>
                        <div className="h-7 flex items-center justify-end pr-2 text-xs text-slate-900 tabular-nums select-none font-bold border border-transparent rounded bg-white/60">
                          {row.finalAmount > 0 ? `₹${row.finalAmount.toFixed(2)}` : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              
}, (prev, next) => { return prev.row === next.row && prev.idx === next.idx && prev.rowsLength === next.rowsLength; });

export const MultiProductForm = ({
  open,
  onOpenChange,
  allSuppliers,
  allProducts,
  accountId,
  onSaved,
  defaultGstRate = 18,
  gstInclusive = false,
}: MultiProductFormProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────────
  const [header, setHeader] = useState<InvoiceHeader>(blankHeader);
  const [headerErrors, setHeaderErrors] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<ProductRow[]>([makeRow(defaultGstRate)]);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingLockRef = useRef(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [f2ConfirmOpen, setF2ConfirmOpen] = useState(false);
  const f2CancelRef = useRef<HTMLButtonElement>(null);
  const f2ConfirmRef = useRef<HTMLButtonElement>(null);

  // PDF import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importItems, setImportItems] = useState<ParsedInvoiceItem[]>([]);
  const [importSupplier, setImportSupplier] = useState('');
  const [importSelected, setImportSelected] = useState<Set<number>>(new Set());

  // Header field refs for keyboard chaining
  const supplierInputRef = useRef<HTMLInputElement | null>(null);
  const invoiceNumberRef = useRef<HTMLInputElement>(null);
  const invoiceDateRef = useRef<HTMLInputElement>(null);
  const dueDateRef = useRef<HTMLInputElement>(null);

  // Row field refs for Enter-key navigation
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingFocus = useRef<string | null>(null);

  const refKey = (tempId: string, field: string) => `${tempId}::${field}`;
  const setFieldRef = (tempId: string, field: string, el: HTMLElement | null) => {
    fieldRefs.current[refKey(tempId, field)] = el;
  };
  const focusField = (tempId: string, field: string) => {
    const el = fieldRefs.current[refKey(tempId, field)];
    if (el) {
      el.focus();
      (el as HTMLInputElement).select?.();
    }
  };

  // Flush pending focus after render
  useEffect(() => {
    if (pendingFocus.current) {
      const el = fieldRefs.current[pendingFocus.current];
      if (el) {
        el.focus();
        (el as HTMLInputElement).select?.();
        pendingFocus.current = null;
      }
    }
  });

  // Enter-key field order within a row (last field triggers row commit + new row)
  const ENTER_FIELDS = [
    'name', 'manufacturer', 'category', 'hsn_code', 'batch_number', 'expiry_date',
    'quantity', 'pcs_per_unit', 'free', 'low_stock', 'mrp', 'rate', 'disc_pct', 'gst',
  ] as const;

  // ── Effects ────────────────────────────────────────────────────────────────

  // Restore draft on open (survives /suppliers navigation)
  useEffect(() => {
    if (!open) return;
    const draft = loadMultiDraft<DraftShape>();
    if (draft?.rows?.length) {
      setRows(draft.rows);
      if (draft.header) setHeader(draft.header);
      clearMultiDraft();
    } else {
      setRows([makeRow(defaultGstRate)]);
      setHeader(blankHeader());
    }
    setHeaderErrors({});
    setTimeout(() => supplierInputRef.current?.focus(), 50);
  }, [open, defaultGstRate]);

  // Auto-link supplier in header if the list refreshed (e.g. just added one)
  useEffect(() => {
    if (!header.supplierId && header.supplierSearch.trim()) {
      const m = allSuppliers.find(
        s => s.name.toLowerCase() === header.supplierSearch.trim().toLowerCase(),
      );
      if (m) setHeader(h => ({ ...h, supplierId: m.id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSuppliers]);

  const saveAllRef = useRef<((silent?: boolean) => Promise<void>) | null>(null);

  // F2 → new invoice, Ctrl+Enter / Shift+Enter → save
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2' && !isSaving) {
        e.preventDefault();
        setF2ConfirmOpen(true);
      }
      // ponytail: Ctrl+Enter / Shift+Enter triggers saveAll action
      if ((e.ctrlKey || e.metaKey || e.shiftKey) && e.key === 'Enter' && !isSaving) {
        e.preventDefault();
        saveAllRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isSaving]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const goAddSupplier = () => {
    saveMultiDraft({ header, rows } as DraftShape);
    onOpenChange(false);
    navigate('/suppliers?from=add-products');
  };

  const updateRow = (tempId: string, patch: Partial<ProductRow>) =>
    setRows(prev => prev.map(r => (r.tempId === tempId ? { ...r, ...patch } : r)));

  const addRow = () => {
    // Don't add a blank row if the last one is already empty
    const last = rows[rows.length - 1];
    if (rows.length > 0 && !last.name.trim() && !last.batch_number.trim() && !last.quantity && !last.mrp) {
      focusField(last.tempId, 'name');
      return;
    }
    const next = makeRow(defaultGstRate);
    setRows(prev => [...prev, next]);
    pendingFocus.current = refKey(next.tempId, 'name');
  };

  const removeRow = (tempId: string) =>
    setRows(prev => (prev.length === 1 ? prev : prev.filter(r => r.tempId !== tempId)));

  const onProductNameChange = useCallback((tempId: string, val: string, row: any, selectedProduct?: any) => {
    // ponytail: check if it perfectly matches an existing product by name (or selected via dropdown), if so, populate the rest
    const match = selectedProduct || allProducts?.find((p: any) => p.name.toLowerCase() === val.toLowerCase());
    if (match) {
      updateRow(tempId, {
        name: val,
        manufacturer: match.manufacturer || '',
        category: match.category || '',
        hsn_code: match.hsn_code || '',
        pcs_per_unit: match.pcs_per_unit ? String(match.pcs_per_unit) : '',
        low_stock: match.low_stock_threshold ? String(match.low_stock_threshold) : '10',
        mrp: match.selling_price ? String(match.selling_price) : '',
        rate: match.purchase_price ? String(match.purchase_price) : '',
        gst: match.gst ? String(match.gst) : String(defaultGstRate),
        batch_number: match.batch_number || '',
        expiry_date: match.expiry_date ? `${match.expiry_date.substring(5, 7)}/${match.expiry_date.substring(2, 4)}` : '',
        rowErrors: { ...row.rowErrors, name: '' },
      });
    } else {
      updateRow(tempId, {
        name: val,
        rowErrors: { ...row.rowErrors, name: '' },
      });
    }
  }, [allProducts, defaultGstRate]);

  // Move focus within a row; on last field: validate → create next row or skip to existing
  const advanceFrom = (rowIndex: number, field: string) => {
    const fi = ENTER_FIELDS.indexOf(field as (typeof ENTER_FIELDS)[number]);
    if (fi === -1) return;
    if (fi < ENTER_FIELDS.length - 1) {
      focusField(rows[rowIndex].tempId, ENTER_FIELDS[fi + 1]);
      return;
    }
    // Last field (gst) → validate row
    const row = rows[rowIndex];
    const errors: Record<string, string> = {};
    if (!row.name.trim()) errors.name = 'Required';
    if (!row.batch_number.trim()) errors.batch_number = 'Required';
    if (Object.keys(errors).length) {
      updateRow(row.tempId, { rowErrors: errors });
      focusField(row.tempId, Object.keys(errors)[0]);
      return;
    }
    updateRow(row.tempId, { rowErrors: {} });
    if (rowIndex + 1 < rows.length) {
      focusField(rows[rowIndex + 1].tempId, ENTER_FIELDS[0]);
    } else {
      const next = makeRow(defaultGstRate);
      setRows(prev => [...prev, next]);
      pendingFocus.current = refKey(next.tempId, ENTER_FIELDS[0]);
    }
  };

  const handleEnterNav = (
    e: React.KeyboardEvent<HTMLElement>,
    rowIndex: number,
    field: string,
  ) => {
    const target = e.target as HTMLInputElement;
    const fi = ENTER_FIELDS.indexOf(field as (typeof ENTER_FIELDS)[number]);
    if (fi === -1) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      advanceFrom(rowIndex, field);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rowIndex + 1 < rows.length) focusField(rows[rowIndex + 1].tempId, field);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rowIndex > 0) focusField(rows[rowIndex - 1].tempId, field);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      let isAtStart = false;
      let isAtEnd = false;
      try {
        isAtStart = target.selectionStart === 0 && target.selectionEnd === 0;
        isAtEnd = target.selectionStart === target.value.length && target.selectionEnd === target.value.length;
      } catch (err) {
        // Fallback for inputs that don't support selection (like type="number" in some browsers)
        if (!target.value) {
          isAtStart = true;
          isAtEnd = true;
        }
      }

      if (e.key === 'ArrowLeft' && isAtStart) {
        e.preventDefault();
        if (fi > 0) focusField(rows[rowIndex].tempId, ENTER_FIELDS[fi - 1]);
        else if (rowIndex > 0) focusField(rows[rowIndex - 1].tempId, ENTER_FIELDS[ENTER_FIELDS.length - 1]);
      } else if (e.key === 'ArrowRight' && isAtEnd) {
        e.preventDefault();
        if (fi < ENTER_FIELDS.length - 1) focusField(rows[rowIndex].tempId, ENTER_FIELDS[fi + 1]);
        else advanceFrom(rowIndex, field);
      }
    }
  };

  // Header field Enter → focus next header input or first product row
  const headerEnter = (
    e: React.KeyboardEvent<HTMLInputElement>,
    nextFocus: () => void,
  ) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    nextFocus();
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const previousComputedRef = useRef<any[]>([]);
  const computedRows = useMemo(() => {
    const next = rows.map((r, i) => {
      const prev = previousComputedRef.current[i];
      if (prev && prev._sourceRow === r && prev.tempId === r.tempId) return prev;
      const qty = parseFloat(r.quantity) || 0;
      const freeQty = parseFloat(r.free) || 0;
      const rate = parseFloat(r.rate) || 0;
      const mrp = parseFloat(r.mrp) || 0;
      const discPct = parseFloat(r.disc_pct) || 0;
      const gstRate = parseFloat(r.gst) || 0;
      const grossAmount = rate * qty;
      const discountAmount = (grossAmount * discPct) / 100;
      const netDiscounted = grossAmount - discountAmount;
      const { taxableValue: netBeforeGst, gstAmount, totalPrice: finalAmount } = calcGst(netDiscounted, gstRate, gstInclusive);
      const marginPct = mrp > 0 ? ((mrp - rate) / mrp) * 100 : 0;
      const lowStockNum = parseInt(r.low_stock) || 10;
      return { ...r, _sourceRow: r, qty, freeQty, lowStockNum, rateNum: rate, mrpNum: mrp, discPct, gstRate, grossAmount, discountAmount, netBeforeGst, gstAmount, finalAmount, marginPct };
    });
    previousComputedRef.current = next;
    return next;
  }, [rows, gstInclusive]);

  const validRows = computedRows.filter(r => r.name.trim() && r.batch_number.trim());

  const totals = useMemo(() => {
    let totalQty = 0;
    let totalFreeQty = 0;
    let grossPurchase = 0;
    let totalDiscount = 0;
    let totalGst = 0;
    let netPurchaseAmount = 0;

    computedRows.forEach(r => {
      totalQty += r.qty;
      totalFreeQty += r.freeQty;
      grossPurchase += r.grossAmount;
      totalDiscount += r.discountAmount;
      totalGst += r.gstAmount;
      netPurchaseAmount += r.finalAmount;
    });

    return {
      totalQty,
      totalFreeQty,
      grossPurchase,
      totalDiscount,
      totalGst,
      netPurchaseAmount,
      stockValue: grossPurchase,
      units: totalQty + totalFreeQty, // ponytail: total physical shelf units
    };
  }, [computedRows]);

  // ── Reset / new invoice ────────────────────────────────────────────────────

  const resetForm = () => {
    setRows([makeRow(defaultGstRate)]);
    setHeader(blankHeader());
    setHeaderErrors({});
    setTimeout(() => supplierInputRef.current?.focus(), 50);
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  /**
   * @param silent - true when called from F2 "save + start new"; doesn't close dialog.
   */
  const saveAll = async (silent = false) => {
    if (isSavingLockRef.current) return;
    
    if (!accountId) {
      toast({ variant: 'destructive', title: 'Not signed in' });
      return;
    }

    // Validate invoice header
    const hErr: Record<string, string> = {};
    if (!header.supplierId) hErr.supplier = 'Select a valid supplier from the list.';
    if (!header.invoiceNumber.trim()) hErr.invoiceNumber = 'Invoice number is required';
    if (!header.invoiceDate) hErr.invoiceDate = 'Invoice date is required';
    if (Object.keys(hErr).length) {
      setHeaderErrors(hErr);
      if (!silent)
        toast({
          variant: 'destructive',
          title: 'Missing invoice details',
          description: 'Fill all required header fields before saving.',
        });
      return;
    }

    const toSave = validRows;
    if (toSave.length === 0) {
      if (!silent)
        toast({
          variant: 'destructive',
          title: 'No valid products',
          description: 'Each row requires a Product name and Batch number.',
        });
      return;
    }

    // ponytail: block expired products from entry
    const nowStr = new Date().toISOString().substring(0, 7); // "YYYY-MM"
    for (const r of toSave) {
      const expDate = expiryToDate(r.expiry_date);
      if (expDate && expDate.substring(0, 7) < nowStr) {
        if (!silent) toast({ variant: 'destructive', title: 'Cannot save expired product', description: `${r.name} (${r.expiry_date}) is expired.` });
        return;
      }
    }

    isSavingLockRef.current = true;
    setIsSaving(true);
    try {
      const payload = {
        account_id: accountId,
        supplier_id: header.supplierId,
        supplier_name: header.supplierSearch.trim() || null,
        invoice_number: header.invoiceNumber.trim(),
        invoice_date: header.invoiceDate,
        due_date: header.dueDate || null,
        items: toSave.map(r => ({
          name: r.name.trim(),
          hsn_code: r.hsn_code.trim() || null,
          batch_number: r.batch_number.trim() || null,
          expiry_date: expiryToDate(r.expiry_date),
          qty: r.qty,
          pcs_per_unit: parseInt(r.pcs_per_unit) || null,
          freeQty: r.freeQty,
          mrpNum: r.mrpNum || null,
          rateNum: r.rateNum || null,
          discPct: r.discPct || 0,
          gstRate: r.gstRate || 0,
          purchase_price: calcEffectivePurchasePrice(r.rateNum, r.qty, r.freeQty),
          category: r.category.trim() || null,
          manufacturer: r.manufacturer.trim() || null,
          lowStockNum: r.lowStockNum,
        }))
      };

      const { error: rpcErr } = await supabase.rpc('record_purchase' as any, { payload });
      if (rpcErr) throw rpcErr;

      onSaved();
      if (silent) {
        toast({ title: `Invoice ${header.invoiceNumber} saved`, description: `${toSave.length} product(s) recorded.` });
        resetForm();
      } else {
        toast({
          title: `${toSave.length} product${toSave.length !== 1 ? 's' : ''} saved`,
          description: `Invoice ${header.invoiceNumber} recorded.`,
        });
        onOpenChange(false);
      }
    } catch (e: any) {
      const msg = e?.message || e?.details || (e instanceof Error ? e.message : 'Unknown error');
      console.error('Save error details:', e);
      toast({ variant: 'destructive', title: 'Error saving product', description: msg });
    } finally {
      isSavingLockRef.current = false;
      setIsSaving(false);
    }
  };
  saveAllRef.current = saveAll;

  const handleNewInvoice = async () => {
    setF2ConfirmOpen(false);
    if (validRows.length > 0) await saveAll(true);
    else resetForm();
  };

  // ── PDF Import ─────────────────────────────────────────────────────────────

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
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
        setImportError(
          'No products could be read from this PDF. It may be a scanned image or an unsupported layout.',
        );
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

  const toggleImportRow = (i: number) =>
    setImportSelected(prev => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  const applyImport = () => {
    const chosen = importItems.filter((_, i) => importSelected.has(i));
    if (chosen.length === 0) return;

    // Auto-populate header supplier if not yet set
    if (!header.supplierId && importSupplier) {
      const m = allSuppliers.find(
        s => s.name.toLowerCase() === importSupplier.toLowerCase(),
      );
      setHeader(h => ({
        ...h,
        supplierSearch: m ? m.name : importSupplier,
        supplierId: m ? m.id : null,
      }));
    }

    const imported: ProductRow[] = chosen.map(it => ({
      ...makeRow(defaultGstRate),
      name: it.name,
      manufacturer: it.manufacturer || '',
      category: (it as any).category || '',
      hsn_code: it.hsn_code || '',
      batch_number: it.batch_number || '',
      // Convert YYYY-MM from PDF to MM/YY display format
      expiry_date: it.expiry_date
        ? (() => {
          const [y, m] = it.expiry_date.slice(0, 7).split('-');
          return m && y ? `${m}/${y.slice(2)}` : '';
        })()
        : '',
      quantity: it.quantity || '',
      gst: it.gst || String(defaultGstRate),
      rate: it.purchase_price || '',
      mrp: it.selling_price || '',
    }));

    setRows(prev => {
      const meaningful = prev.filter(
        r => r.name.trim() || r.batch_number.trim() || r.quantity || r.mrp,
      );
      return [...meaningful, ...imported];
    });
    setImportOpen(false);
    setImportItems([]);
    setImportSelected(new Set());
    toast({
      title: 'Products imported',
      description: `${imported.length} product(s) added from the invoice.`,
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════════
          MAIN PURCHASE ENTRY DIALOG
      ════════════════════════════════════════════════════════════════════ */}
      <Dialog open={open} onOpenChange={(newOpen) => {
        if (!newOpen) {
          const hasData = header.supplierId !== null || header.invoiceNumber !== '' || rows.length > 1 || rows[0].name !== '';
          if (!hasData) {
            onOpenChange(false);
            return;
          }
          setExitConfirmOpen(true);
          return;
        }
        onOpenChange(newOpen);
      }}>
        <DialogContent
          className="purchase-entry w-[98vw] sm:w-[95vw] sm:max-w-6xl lg:max-w-[92vw] max-h-[94vh] h-[94vh] p-0 overflow-hidden flex flex-col gap-0 border-0"
          onOpenAutoFocus={e => {
            e.preventDefault();
            setTimeout(() => supplierInputRef.current?.focus(), 50);
          }}
          onInteractOutside={e => {
            if (
              (e.target as HTMLElement).closest?.('[data-supplier-menu]') ||
              (e.target as HTMLElement).closest?.('[data-category-menu]')
            ) {
              e.preventDefault();
            }
          }}
        >
          {/* ── TOOLBAR ── */}
          <div className="bg-white border-b border-blue-100 shrink-0">
            <div className="flex items-center justify-between pl-3 sm:pl-4 pr-12 py-2.5 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-1.5 rounded-lg shrink-0">
                  <Receipt className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="font-semibold text-base sm:text-lg text-slate-900 leading-tight">
                    Purchase Entry
                  </h1>
                  <p className="text-[11px] sm:text-xs text-muted-foreground leading-tight truncate">
                    Invoice-first · Enter → next field · F2 → new invoice
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf,.csv,text/csv"
                  className="hidden"
                  onChange={handleImportFile}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-8 gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
                  title="Import products from an invoice PDF or CSV"
                >
                  <FileText className="h-4 w-4" />
                  <span className="hidden sm:inline">Import Invoice (PDF/CSV)</span>
                </Button>
                <div className="hidden md:flex items-center gap-3 px-3 py-1 bg-blue-50 rounded-full border border-blue-100 text-[11px] font-medium text-blue-700">
                  <span className="flex items-center gap-1">
                    <Boxes className="h-3 w-3" />
                    {rows.length} {rows.length === 1 ? 'row' : 'rows'}
                  </span>
                  <span className="w-1 h-1 bg-blue-300 rounded-full" />
                  <span>{validRows.length} ready</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── INVOICE HEADER (always visible, not part of scroll area) ── */}
          <div className="bg-gradient-to-r from-slate-50 to-blue-50/50 border-b border-slate-200 shrink-0 px-3 sm:px-4 py-1.5">
            <div className="flex items-center gap-2 mb-1.5">
              <FileText className="h-3.5 w-3.5 text-blue-600" />
              <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                Invoice Header
              </span>
              <kbd className="ml-auto text-[9px] px-1.5 py-0.5 rounded border border-slate-300 bg-white text-slate-500 font-mono">
                F2 = New Invoice
              </kbd>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {/* Supplier */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                  Supplier <span className="text-rose-500">*</span>
                </label>
                <SupplierPicker
                  value={header.supplierSearch}
                  supplierId={header.supplierId}
                  onChange={(search, id) => {
                    setHeader(h => ({ ...h, supplierSearch: search, supplierId: id }));
                    setHeaderErrors(e => ({ ...e, supplier: '' }));
                  }}
                  suppliers={allSuppliers}
                  onAddNew={goAddSupplier}
                  inputRef={el => { supplierInputRef.current = el; }}
                  onEnterNext={() => invoiceNumberRef.current?.focus()}
                  inputClassName={cn(
                    'h-7 text-xs border-slate-200 bg-white shadow-none px-2 rounded',
                    headerErrors.supplier
                      ? 'border-rose-400 focus-visible:ring-rose-200'
                      : 'focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
                  )}
                />
                {headerErrors.supplier && (
                  <span className="text-[10px] text-rose-500 font-medium leading-none">
                    {headerErrors.supplier}
                  </span>
                )}
              </div>

              {/* Invoice Number */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                  Invoice # <span className="text-rose-500">*</span>
                </label>
                <Input
                  ref={invoiceNumberRef}
                  value={header.invoiceNumber}
                  onChange={e => {
                    setHeader(h => ({ ...h, invoiceNumber: e.target.value }));
                    setHeaderErrors(e => ({ ...e, invoiceNumber: '' }));
                  }}
                  onKeyDown={e => headerEnter(e, () => invoiceDateRef.current?.focus())}
                  placeholder="INV-001"
                  autoComplete="off"
                  className={cn(
                    'h-7 text-xs shadow-none px-2 rounded',
                    headerErrors.invoiceNumber ? 'border-rose-400' : 'border-slate-200',
                  )}
                />
                {headerErrors.invoiceNumber && (
                  <span className="text-[10px] text-rose-500 font-medium leading-none">
                    {headerErrors.invoiceNumber}
                  </span>
                )}
              </div>

              {/* Invoice Date */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                  Invoice Date <span className="text-rose-500">*</span>
                </label>
                <Input
                  ref={invoiceDateRef}
                  type="date"
                  value={header.invoiceDate}
                  onChange={e => {
                    setHeader(h => ({ ...h, invoiceDate: e.target.value }));
                    setHeaderErrors(e => ({ ...e, invoiceDate: '' }));
                  }}
                  onKeyDown={e => headerEnter(e, () => dueDateRef.current?.focus())}
                  className={cn(
                    'h-7 text-xs shadow-none px-2 rounded',
                    headerErrors.invoiceDate ? 'border-rose-400' : 'border-slate-200',
                  )}
                />
                {headerErrors.invoiceDate && (
                  <span className="text-[10px] text-rose-500 font-medium leading-none">
                    {headerErrors.invoiceDate}
                  </span>
                )}
              </div>

              {/* Due Date */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                  Due Date
                  <span className="text-slate-400 font-normal ml-1">(optional)</span>
                </label>
                <Input
                  ref={dueDateRef}
                  type="date"
                  value={header.dueDate}
                  onChange={e => setHeader(h => ({ ...h, dueDate: e.target.value }))}
                  onKeyDown={e =>
                    headerEnter(e, () => {
                      if (rows.length > 0) focusField(rows[0].tempId, 'name');
                    })
                  }
                  className="h-7 text-xs shadow-none border-slate-200 px-2 rounded"
                />
              </div>
            </div>
          </div>

          {/* ── SCROLLABLE BODY: PRODUCT CARDS ── */}
          <div className="flex-1 overflow-auto bg-slate-50/60 px-2 sm:px-4 py-2">
            <div className="max-w-[1500px] mx-auto space-y-1.5">
              {computedRows.map((row, idx) => (<MemoizedRowCard key={row.tempId} row={row} idx={idx} rowsLength={rows.length} removeRow={removeRow} setFieldRef={setFieldRef} updateRow={updateRow} handleEnterNav={handleEnterNav} formatExpiryInput={formatExpiryInput} onProductNameChange={onProductNameChange} allProducts={allProducts} />))}

              {/* Add Item button */}
              <button
                type="button"
                onClick={addRow}
                className="mt-2 w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-blue-200 text-blue-600 hover:border-blue-400 hover:bg-blue-50/40 transition-colors font-medium text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Add another product
                <kbd className="ml-1 px-1.5 py-0.5 rounded border border-blue-200 bg-white text-[9px] font-semibold text-blue-500">
                  Enter
                </kbd>
              </button>
            </div>
          </div>

          {/* ── FOOTER (Invoice Totals) ── */}
          <div className="bg-white border-t border-blue-100 shadow-[0_-8px_24px_rgba(0,0,0,0.04)] shrink-0">
            <div className="px-3 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 max-w-[1500px] mx-auto">
              {/* Left/Middle: Continuously Calculated Invoice Totals (Marg/RetailGraph style) */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <div className="flex flex-col">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Total Qty</span>
                  <span className="text-slate-800 font-bold tabular-nums text-sm">{totals.totalQty}</span>
                </div>
                <div className="h-6 w-px bg-slate-200 hidden sm:block" />
                <div className="flex flex-col">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Free Qty</span>
                  <span className="text-slate-800 font-bold tabular-nums text-sm">{totals.totalFreeQty}</span>
                </div>
                <div className="h-6 w-px bg-slate-200 hidden sm:block" />
                <div className="flex flex-col">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Gross Purchase</span>
                  <span className="text-slate-800 font-bold tabular-nums text-sm">₹{totals.grossPurchase.toFixed(2)}</span>
                </div>
                <div className="h-6 w-px bg-slate-200 hidden sm:block" />
                <div className="flex flex-col">
                  <span className="text-emerald-600 text-[10px] uppercase tracking-wider font-semibold">Discount</span>
                  <span className="text-emerald-700 font-bold tabular-nums text-sm">₹{totals.totalDiscount.toFixed(2)}</span>
                </div>
                <div className="h-6 w-px bg-slate-200 hidden sm:block" />
                <div className="flex flex-col">
                  <span className="text-indigo-500 text-[10px] uppercase tracking-wider font-semibold">
                    GST {gstInclusive ? '(Incl.)' : '(Excl.)'}
                  </span>
                  <span className="text-indigo-700 font-bold tabular-nums text-sm">₹{totals.totalGst.toFixed(2)}</span>
                </div>
              </div>

              {/* Right: Net Purchase Amount + Save Actions */}
              <div className="flex items-center gap-3 justify-between md:justify-end w-full sm:w-auto">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 text-slate-900 px-3.5 py-1.5 rounded-lg border border-blue-200 flex flex-col items-start sm:items-center min-w-[130px]">
                  <span className="text-[10px] font-medium text-blue-600 uppercase tracking-wider flex items-center gap-1">
                    <Wallet className="h-3 w-3" />
                    Net Purchase
                  </span>
                  <div className="flex items-baseline gap-0.5 leading-tight">
                    <span className="text-blue-600 text-xs font-medium">₹</span>
                    <span className="text-lg sm:text-xl font-bold tabular-nums text-blue-950">
                      {totals.netPurchaseAmount.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    className="h-10 px-3.5 text-sm"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => saveAll()}
                    disabled={!validRows.length || isSaving}
                    className="h-10 px-4 sm:px-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium text-sm rounded-md disabled:opacity-50 shadow-sm"
                  >
                    {isSaving ? (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        Saving…
                      </div>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        Save {validRows.length > 0 ? `${validRows.length} ` : ''}
                        {validRows.length === 1 ? 'Product' : 'Products'}
                        <kbd className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded font-mono font-normal tracking-tight">Ctrl+Enter</kbd>
                      </span>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
          F2 — NEW INVOICE CONFIRMATION
      ════════════════════════════════════════════════════════════════════ */}
      <Dialog open={f2ConfirmOpen} onOpenChange={setF2ConfirmOpen}>
        <DialogContent
          className="sm:max-w-md p-0 overflow-hidden"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            f2ConfirmRef.current?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              f2CancelRef.current?.focus();
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              f2ConfirmRef.current?.focus();
            }
          }}
        >
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="bg-blue-100 p-2.5 rounded-xl shrink-0">
                <RotateCcw className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h2 className="font-semibold text-base text-slate-900">Start New Invoice?</h2>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  {validRows.length > 0
                    ? `Current invoice has ${validRows.length} product${validRows.length !== 1 ? 's' : ''}. They will be saved before the screen resets.`
                    : 'This will clear the current invoice details and all product rows.'}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
            <Button
              ref={f2CancelRef}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setF2ConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              ref={f2ConfirmRef}
              type="button"
              size="sm"
              onClick={handleNewInvoice}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Start New Purchase
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
          PDF INVOICE IMPORT PREVIEW
      ════════════════════════════════════════════════════════════════════ */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="w-[98vw] sm:w-[95vw] sm:max-w-4xl max-h-[90vh] p-0 overflow-hidden flex flex-col gap-0">
          <div className="bg-white border-b border-slate-200 shrink-0 px-4 pr-12 py-3">
            <h2 className="font-semibold text-base sm:text-lg text-slate-900 flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Import products from invoice (PDF/CSV)
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Review the products read from the PDF or CSV, then add the ones you want.
            </p>
          </div>

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
                <p className="text-xs text-muted-foreground mt-1">
                  You can still add products manually.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {importSupplier && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Supplier:</span>
                    <span className="font-medium text-slate-800">{importSupplier}</span>
                    {allSuppliers.some(
                      s => s.name.toLowerCase() === importSupplier.toLowerCase(),
                    ) ? (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                        Matched
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-amber-600 border-amber-200">
                        New — will be set in header
                      </Badge>
                    )}
                  </div>
                )}
                <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-500 text-[10px] uppercase tracking-wide">
                        <th className="p-2 w-8" />
                        <th className="p-2 text-left">Product</th>
                        <th className="p-2 text-center">HSN</th>
                        <th className="p-2 text-center">Batch</th>
                        <th className="p-2 text-center">Expiry</th>
                        <th className="p-2 text-center">Qty</th>
                        <th className="p-2 text-center">GST</th>
                        <th className="p-2 text-right">Rate</th>
                        <th className="p-2 text-right">MRP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importItems.map((it, i) => {
                        const selected = importSelected.has(i);
                        return (
                          <tr
                            key={i}
                            className={cn(
                              'cursor-pointer',
                              selected ? 'bg-blue-50/40' : 'opacity-50',
                            )}
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
                              {it.manufacturer && (
                                <div className="text-[10px] text-muted-foreground">{it.manufacturer}</div>
                              )}
                            </td>
                            <td className="p-2 text-center text-slate-600">{it.hsn_code || '—'}</td>
                            <td className="p-2 text-center text-slate-600">{it.batch_number || '—'}</td>
                            <td className="p-2 text-center text-slate-600">
                              {it.expiry_date ? it.expiry_date.slice(0, 7) : '—'}
                            </td>
                            <td className="p-2 text-center font-medium">{it.quantity || '—'}</td>
                            <td className="p-2 text-center">{it.gst ? `${it.gst}%` : '—'}</td>
                            <td className="p-2 text-right text-slate-600">{it.purchase_price || '—'}</td>
                            <td className="p-2 text-right font-semibold text-emerald-700">
                              {it.selling_price || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  MRP is set as the selling price and Rate as the purchase price. Supplier is applied to the invoice header.
                </p>
              </div>
            )}
          </div>

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
                Add {importSelected.size > 0 ? importSelected.size : ''} product
                {importSelected.size === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to exit?</AlertDialogTitle>
            <AlertDialogDescription>
              Your unsaved data will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="transition-none"
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  (e.currentTarget.nextElementSibling as HTMLElement)?.focus();
                }
              }}
            >
              No
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 transition-none"
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  (e.currentTarget.previousElementSibling as HTMLElement)?.focus();
                }
              }}
              onClick={() => {
                setExitConfirmOpen(false);
                onOpenChange(false);
              }}
            >
              Yes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default MultiProductForm;
