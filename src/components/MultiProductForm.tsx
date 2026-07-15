import { useState, useMemo, useRef, useEffect } from 'react';
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
  Users,
  Boxes,
  Wallet,
} from 'lucide-react';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

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
}: {
  value: string;
  supplierId: string | null;
  onChange: (search: string, id: string | null) => void;
  suppliers: SupplierOption[];
  onAddNew: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  return (
    <div className="relative" ref={ref}>
      <Input
        value={value}
        onChange={e => {
          onChange(e.target.value, null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search supplier..."
        className={bareInputCls}
        autoComplete="off"
      />
      {supplierId && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded pointer-events-none">
          {suppliers.find(s => s.id === supplierId)?.supplier_code}
        </span>
      )}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] max-h-64 overflow-y-auto">
          {filtered.map(s => (
            <button
              key={s.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between border-b border-slate-50 last:border-0"
              onMouseDown={e => {
                e.preventDefault();
                onChange(s.name, s.id);
                setOpen(false);
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
              onMouseDown={e => {
                e.preventDefault();
                onAddNew();
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add New Supplier
            </Button>
          </div>
        </div>
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

  // Reset rows each time the dialog opens, picking up any change to the account default GST rate
  useEffect(() => {
    if (open) {
      setRows([makeRow(defaultGstRate)]);
    }
  }, [open, defaultGstRate]);

  const updateRow = (tempId: string, patch: Partial<ProductRow>) => {
    setRows(prev => prev.map(r => (r.tempId === tempId ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    setRows(prev => [...prev, makeRow(defaultGstRate)]);
  };

  const removeRow = (tempId: string) => {
    setRows(prev => (prev.length === 1 ? prev : prev.filter(r => r.tempId !== tempId)));
  };

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

            <div className="hidden sm:flex items-center gap-3 px-3 py-1 bg-blue-50 rounded-full border border-blue-100 text-[11px] font-medium text-blue-700 shrink-0">
              <span className="flex items-center gap-1">
                <Boxes className="h-3 w-3" />
                {rows.length} {rows.length === 1 ? 'row' : 'rows'}
              </span>
              <span className="w-1 h-1 bg-blue-300 rounded-full"></span>
              <span>{validRows.length} ready</span>
            </div>
          </div>
        </div>

        {/* ═══════ BODY: ROW ENTRIES ═══════ */}
        <div className="flex-1 overflow-auto bg-slate-50/60 px-2 sm:px-4 py-3">
          <div className="max-w-[1500px] mx-auto space-y-3">
            {rows.map((row, idx) => {
              const supplierName = row.supplier_id
                ? allSuppliers.find(s => s.id === row.supplier_id)?.name
                : row.supplier_search.trim();
              const hasContent = Boolean(row.name.trim() || row.selling_price || row.quantity);
              const missingRequired = hasContent && (!row.name.trim() || !(parseFloat(row.selling_price) > 0));

              return (
                <div
                  key={row.tempId}
                  className={cn(
                    // No `overflow-hidden` here — it would clip the supplier dropdown when it
                    // opens with several suppliers. The header rounds its own corners instead.
                    'bg-white rounded-xl shadow-sm border transition-all',
                    missingRequired ? 'border-rose-200 ring-1 ring-rose-100' : 'border-blue-100 hover:border-blue-200'
                  )}
                >
                  {/* Row header strip — product number, quick summary, delete */}
                  <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 via-white to-white rounded-t-xl">
                    <div className="shrink-0 h-7 w-7 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center text-xs font-bold shadow-sm">
                      {idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-slate-800 truncate">
                        {row.name.trim() || <span className="italic text-slate-400">New product</span>}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0 flex-wrap">
                        {supplierName ? (
                          <span className="inline-flex items-center gap-1 text-violet-600">
                            <Users className="h-3 w-3" />
                            <span className="truncate max-w-[140px]">{supplierName}</span>
                          </span>
                        ) : (
                          <span className="italic">No supplier</span>
                        )}
                        {row.selling_price && parseFloat(row.selling_price) > 0 && (
                          <span className="text-emerald-600 font-semibold">
                            ₹{parseFloat(row.selling_price).toFixed(2)}
                          </span>
                        )}
                        {row.quantity && parseInt(row.quantity) > 0 && (
                          <span>Qty {row.quantity}</span>
                        )}
                        {missingRequired && (
                          <span className="text-rose-600 font-medium">Missing required</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(row.tempId)}
                      disabled={rows.length === 1}
                      className={cn(
                        "shrink-0 p-1.5 rounded-lg transition-all",
                        rows.length === 1
                          ? 'text-slate-200 cursor-not-allowed'
                          : 'text-slate-300 hover:text-rose-600 hover:bg-rose-50'
                      )}
                      title={rows.length === 1 ? 'At least one product is required' : 'Remove this product'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Primary fields — Name / Category / Supplier */}
                  <div className="px-2 sm:px-3 py-2 grid grid-cols-1 md:grid-cols-[2fr_1fr_1.4fr] gap-2 md:gap-3 items-end border-b border-slate-50">
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel required>Product Name</FieldLabel>
                      <Input
                        value={row.name}
                        onChange={e => updateRow(row.tempId, { name: e.target.value })}
                        placeholder="e.g. Paracetamol 500mg"
                        className={cn(bareInputCls, 'font-semibold text-slate-900')}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel>Category</FieldLabel>
                      <Select
                        value={row.category}
                        onValueChange={v => updateRow(row.tempId, { category: v })}
                      >
                        <SelectTrigger
                          className="h-9 text-sm bg-transparent border-transparent hover:bg-white focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all shadow-none"
                        >
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          {PRESET_CATEGORIES.map(c => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel>Supplier</FieldLabel>
                      <SupplierPicker
                        value={row.supplier_search}
                        supplierId={row.supplier_id}
                        onChange={(search, id) =>
                          updateRow(row.tempId, { supplier_search: search, supplier_id: id })
                        }
                        suppliers={allSuppliers}
                        onAddNew={() => navigate('/suppliers')}
                      />
                    </div>
                  </div>

                  {/* Secondary fields — batch / mfg / expiry / stock / pricing on one strip */}
                  <div className="px-2 sm:px-3 py-2 grid gap-2 grid-cols-2 md:grid-cols-5 lg:grid-cols-10">
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel>HSN</FieldLabel>
                      <Input
                        value={row.hsn_code}
                        onChange={e => updateRow(row.tempId, { hsn_code: e.target.value })}
                        placeholder="—"
                        className={bareInputCls}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel>Batch</FieldLabel>
                      <Input
                        value={row.batch_number}
                        onChange={e => updateRow(row.tempId, { batch_number: e.target.value })}
                        placeholder="—"
                        className={bareInputCls}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5 col-span-2 md:col-span-1">
                      <FieldLabel>Manufacturer</FieldLabel>
                      <Input
                        value={row.manufacturer}
                        onChange={e => updateRow(row.tempId, { manufacturer: e.target.value })}
                        placeholder="—"
                        className={bareInputCls}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel>Expiry</FieldLabel>
                      <Input
                        type="month"
                        value={row.expiry_date}
                        onChange={e => updateRow(row.tempId, { expiry_date: e.target.value })}
                        className={cn(bareInputCls, 'text-[12px] appearance-none')}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel>Qty</FieldLabel>
                      <Input
                        type="number"
                        min="0"
                        value={row.quantity}
                        onChange={e => updateRow(row.tempId, { quantity: e.target.value })}
                        placeholder="0"
                        className={cn(bareInputCls, 'text-center')}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel>Pcs/Strip</FieldLabel>
                      <Input
                        type="number"
                        min="1"
                        value={row.pcs_per_unit}
                        onChange={e => updateRow(row.tempId, { pcs_per_unit: e.target.value })}
                        placeholder="—"
                        className={cn(bareInputCls, 'text-center')}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel>Low&nbsp;Stock</FieldLabel>
                      <Input
                        type="number"
                        min="0"
                        value={row.low_stock_threshold}
                        onChange={e => updateRow(row.tempId, { low_stock_threshold: e.target.value })}
                        placeholder="10"
                        className={cn(bareInputCls, 'text-center')}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel>GST %</FieldLabel>
                      <Input
                        type="number"
                        step="0.01"
                        value={row.gst}
                        onChange={e => updateRow(row.tempId, { gst: e.target.value })}
                        placeholder="18"
                        className={cn(bareInputCls, 'text-center')}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel>Buy ₹</FieldLabel>
                      <Input
                        type="number"
                        step="0.01"
                        value={row.purchase_price}
                        onChange={e => updateRow(row.tempId, { purchase_price: e.target.value })}
                        placeholder="0.00"
                        className={cn(bareInputCls, 'text-right')}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel required>Sell ₹</FieldLabel>
                      <Input
                        type="number"
                        step="0.01"
                        value={row.selling_price}
                        onChange={e => updateRow(row.tempId, { selling_price: e.target.value })}
                        placeholder="0.00"
                        className={cn(bareInputCls, 'text-right font-semibold text-emerald-700')}
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* + Add another row */}
            <button
              type="button"
              onClick={addRow}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-blue-200 text-blue-600 hover:border-blue-400 hover:bg-blue-50/40 transition-colors font-medium text-sm"
            >
              <Plus className="h-4 w-4" />
              Add another product
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
  );
};

export default MultiProductForm;
