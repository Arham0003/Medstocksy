import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/db_conn/supabaseClient';
import { cn } from '@/lib/utils';
import {
  Zap, Loader2, PackagePlus, Pill, IndianRupee, Boxes, Info,
  ArrowRight, Minus, Plus, Check, CornerDownLeft, ArrowLeft,
} from 'lucide-react';
import type { Product } from '@/pages/RecordSale';

// Kept in sync with the category presets used in Products.tsx / MultiProductForm.tsx
const PRESET_CATEGORIES = [
  'Tablets', 'Capsules', 'Syrups', 'Ointments', 'Injections', 'Drops',
  'Medical Devices', 'Supplements', 'Ayurveda/Homeopathy', 'Personal Care',
  'Baby Care', 'Surgical', 'Others',
];

const GST_OPTIONS = [0, 5, 12, 18, 28];
const QTY_PRESETS = [1, 5, 10];

interface QuickAddMedicineSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current in-memory product list — used for the live duplicate lookup. */
  existingProducts: Product[];
  /** Called after the medicine is saved to inventory AND a quantity is chosen. */
  onSaved: (product: Product, quantity: number) => void;
  /** Default GST rate from settings — pre-selected in the form. */
  defaultGst?: number | null;
}

const EMPTY_FORM = {
  name: '',
  category: '',
  manufacturer: '',
  selling_price: '',
  purchase_price: '',
  gst: '',
  batch_number: '',
  expiry_date: '', // YYYY-MM
  quantity: '',
  hsn_code: '',
  pcs_per_unit: '',
};

export default function QuickAddMedicineSheet({
  open,
  onOpenChange,
  existingProducts,
  onSaved,
  defaultGst,
}: QuickAddMedicineSheetProps) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [step, setStep] = useState<'form' | 'qty'>('form');
  const [savedProduct, setSavedProduct] = useState<Product | null>(null);
  const [addedToInventory, setAddedToInventory] = useState(false); // false when reusing an existing product
  const [billQty, setBillQty] = useState(1);
  const qtyRef = useRef<HTMLInputElement>(null);

  // Fresh form every time the sheet opens (GST pre-filled from settings).
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_FORM, gst: defaultGst != null ? String(defaultGst) : '' });
      setErrors({});
      setStep('form');
      setSavedProduct(null);
      setAddedToInventory(false);
      setBillQty(1);
    }
  }, [open, defaultGst]);

  const set = (key: keyof typeof EMPTY_FORM, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  // ── Live duplicate matches (top 3) ──
  const matches = useMemo(() => {
    const q = form.name.trim().toLowerCase();
    if (q.length < 2) return [];
    return existingProducts.filter(p => p.name.toLowerCase().includes(q)).slice(0, 3);
  }, [form.name, existingProducts]);

  // ── Live margin from MRP vs purchase price ──
  const margin = useMemo(() => {
    const mrp = parseFloat(form.selling_price);
    const pp = parseFloat(form.purchase_price);
    if (!isFinite(mrp) || !isFinite(pp) || pp <= 0 || mrp <= 0) return null;
    return ((mrp - pp) / pp) * 100;
  }, [form.selling_price, form.purchase_price]);

  const resetAndClose = () => onOpenChange(false);

  // ── Validation ──
  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Name must be at least 2 characters.';
    const mrp = parseFloat(form.selling_price);
    if (!form.selling_price || isNaN(mrp) || mrp <= 0) next.selling_price = 'Enter a positive price.';
    const stock = parseInt(form.quantity, 10);
    if (form.quantity === '' || isNaN(stock) || stock < 0) next.quantity = 'Enter opening stock.';
    if (form.expiry_date) {
      const [y, m] = form.expiry_date.split('-').map(Number);
      const exp = new Date(y, (m || 1), 0); // last day of that month
      if (exp.getTime() < Date.now()) next.expiry_date = 'Expiry must be in the future.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  // ── Save to inventory, then move to qty step ──
  const handleSave = async () => {
    if (isSaving) return;
    if (!profile?.account_id) {
      toast({ variant: 'destructive', title: 'Not ready', description: 'No pharmacy account found. Please re-login.' });
      return;
    }
    if (!validate()) return;

    setIsSaving(true);
    try {
      const pcs = form.pcs_per_unit ? parseInt(form.pcs_per_unit, 10) : null;
      const productData = {
        name: form.name.trim(),
        hsn_code: form.hsn_code.trim() || null,
        category: form.category || null,
        batch_number: form.batch_number.trim() || null,
        manufacturer: form.manufacturer.trim() || null,
        expiry_date: form.expiry_date && form.expiry_date.length === 7 ? `${form.expiry_date}-01` : null,
        quantity: parseInt(form.quantity, 10),
        purchase_price: form.purchase_price ? parseFloat(form.purchase_price) : null,
        selling_price: parseFloat(form.selling_price),
        gst: form.gst !== '' ? parseFloat(form.gst) : null,
        pcs_per_unit: pcs && pcs > 0 ? pcs : null,
        account_id: profile.account_id,
      };

      const { data, error } = await supabase
        .from('products')
        .insert([productData])
        .select('id, name, quantity, selling_price, gst, hsn_code, batch_number, expiry_date, pcs_per_unit, category, manufacturer')
        .single();

      if (error) throw error;

      setSavedProduct(data as unknown as Product);
      setAddedToInventory(true);
      setStep('qty');
      setBillQty(1);
      setTimeout(() => qtyRef.current?.select(), 60);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not add medicine', description: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Confirm quantity → push into the active bill ──
  const handleConfirmQty = () => {
    if (!savedProduct) return;
    const qty = Math.max(1, billQty || 1);
    onSaved(savedProduct, qty);
    toast({
      title: addedToInventory ? 'Added to inventory & bill ✓' : 'Added to bill ✓',
      description: `${savedProduct.name} × ${qty}`,
    });
    resetAndClose();
  };

  // ── "Use existing" — skip creating a duplicate, go straight to qty ──
  const useExisting = (p: Product) => {
    setSavedProduct(p);
    setAddedToInventory(false);
    setStep('qty');
    setBillQty(1);
    setTimeout(() => qtyRef.current?.select(), 60);
  };

  const lineTotal = savedProduct ? (savedProduct.selling_price || 0) * Math.max(1, billQty || 1) : 0;

  return (
    <Sheet open={open} onOpenChange={o => (o ? onOpenChange(true) : resetAndClose())}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        {/* Header */}
        <SheetHeader className="p-5 border-b border-gray-100 space-y-1 text-left">
          <SheetTitle className="flex items-center gap-2.5 text-gray-900">
            <span className="grid place-items-center h-8 w-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 shadow-sm">
              <Zap className="h-4 w-4 text-white" />
            </span>
            Quick Add Medicine
          </SheetTitle>
          <SheetDescription>
            {step === 'form'
              ? 'Create a medicine and drop it into the current bill — without leaving billing.'
              : `${addedToInventory ? 'Saved to inventory.' : 'Using existing item.'} How many for this bill?`}
          </SheetDescription>
        </SheetHeader>

        {step === 'form' ? (
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={e => { e.preventDefault(); handleSave(); }}
          >
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* ── Medicine ── */}
              <Section icon={Pill} title="Medicine">
                <Field label="Medicine Name" required error={errors.name} className="col-span-2">
                  <Input autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Paracetamol 500mg" className="h-10" />
                </Field>

                {/* Live duplicate matches */}
                {matches.length > 0 && (
                  <div className="col-span-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2 space-y-1">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 px-1">
                      <Info className="h-3.5 w-3.5" /> Similar medicine already exists — use it instead?
                    </p>
                    {matches.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => useExisting(m)}
                        className="w-full flex items-center justify-between gap-2 rounded-md bg-white px-2.5 py-1.5 text-left hover:bg-emerald-50 border border-transparent hover:border-emerald-200 transition-colors"
                      >
                        <span className="truncate text-xs font-medium text-gray-700">{m.name}</span>
                        <span className="flex items-center gap-1 shrink-0 text-[11px] font-semibold text-emerald-700">
                          ₹{m.selling_price?.toFixed(2)} <ArrowRight className="h-3 w-3" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <Field label="Category">
                  <Select value={form.category} onValueChange={v => set('category', v)}>
                    <SelectTrigger className="h-10"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {PRESET_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Manufacturer">
                  <Input value={form.manufacturer} onChange={e => set('manufacturer', e.target.value)} placeholder="e.g. Cipla" className="h-10" />
                </Field>
              </Section>

              {/* ── Pricing ── */}
              <Section icon={IndianRupee} title="Pricing" aside={margin != null && (
                <span className={cn('text-[11px] font-semibold px-1.5 py-0.5 rounded-full',
                  margin >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600')}>
                  Margin {margin >= 0 ? '+' : ''}{margin.toFixed(1)}%
                </span>
              )}>
                <Field label="MRP / Sale Price" required error={errors.selling_price}>
                  <Input type="number" inputMode="decimal" step="0.01" min="0" value={form.selling_price} onChange={e => set('selling_price', e.target.value)} placeholder="0.00" className="h-10" />
                </Field>
                <Field label="Purchase Price">
                  <Input type="number" inputMode="decimal" step="0.01" min="0" value={form.purchase_price} onChange={e => set('purchase_price', e.target.value)} placeholder="0.00" className="h-10" />
                </Field>
                <Field label="GST %">
                  <Select value={form.gst} onValueChange={v => set('gst', v)}>
                    <SelectTrigger className="h-10"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {GST_OPTIONS.map(g => <SelectItem key={g} value={String(g)}>{g}%</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="HSN Code">
                  <Input value={form.hsn_code} onChange={e => set('hsn_code', e.target.value)} placeholder="e.g. 3004" className="h-10" />
                </Field>
              </Section>

              {/* ── Stock & Batch ── */}
              <Section icon={Boxes} title="Stock & Batch">
                <Field label="Opening Stock" required error={errors.quantity}>
                  <Input type="number" inputMode="numeric" min="0" value={form.quantity} onChange={e => set('quantity', e.target.value)} placeholder="0" className="h-10" />
                </Field>
                <Field label="Pcs per Unit">
                  <Input type="number" inputMode="numeric" min="0" value={form.pcs_per_unit} onChange={e => set('pcs_per_unit', e.target.value)} placeholder="e.g. 10" className="h-10" />
                </Field>
                <Field label="Batch Number">
                  <Input value={form.batch_number} onChange={e => set('batch_number', e.target.value)} placeholder="e.g. B12345" className="h-10" />
                </Field>
                <Field label="Expiry Date" error={errors.expiry_date}>
                  <Input type="month" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} className="h-10" />
                </Field>
              </Section>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-100 bg-gray-50/50">
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={resetAndClose} disabled={isSaving}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-[2] bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white gap-1.5"
                  disabled={isSaving}
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                    <>Save &amp; Add to Bill <CornerDownLeft className="h-3.5 w-3.5 opacity-80" /></>
                  )}
                </Button>
              </div>
              <p className="text-[10px] text-center text-gray-400 mt-2">Press Enter to save · Esc to cancel</p>
            </div>
          </form>
        ) : (
          /* ── Quantity step ── */
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-emerald-800">
                  <PackagePlus className="h-4 w-4 shrink-0" />
                  <span className="font-semibold text-sm truncate">{savedProduct?.name}</span>
                </div>
                <p className="text-xs text-emerald-600/80 mt-1">
                  ₹{savedProduct?.selling_price?.toFixed(2)} each · In stock: {savedProduct?.quantity}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium text-gray-600">Quantity for this bill</Label>
                {/* Stepper */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setBillQty(q => Math.max(1, q - 1))}
                    className="grid place-items-center h-11 w-11 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 shrink-0"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <Input
                    ref={qtyRef}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={billQty}
                    onChange={e => setBillQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleConfirmQty(); } }}
                    className="h-11 text-center text-lg font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => setBillQty(q => q + 1)}
                    className="grid place-items-center h-11 w-11 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 shrink-0"
                    aria-label="Increase quantity"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {/* Presets */}
                <div className="flex gap-2">
                  {QTY_PRESETS.map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setBillQty(p)}
                      className={cn('flex-1 h-8 rounded-md text-xs font-semibold border transition-colors',
                        billQty === p ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Line total */}
              <div className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
                <span className="text-xs font-medium text-gray-500">Line total</span>
                <span className="text-lg font-bold text-emerald-700">₹{lineTotal.toFixed(2)}</span>
              </div>
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50/50 flex gap-2">
              <Button type="button" variant="outline" className="gap-1.5" onClick={() => setStep('form')}>
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button type="button" className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-1.5" onClick={handleConfirmQty}>
                <Check className="h-4 w-4" /> Add to Bill
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Section wrapper: header + 2-col grid ──
function Section({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">
          <Icon className="h-3.5 w-3.5" /> {title}
        </h3>
        {aside}
      </div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

// ── Labelled field ──
function Field({
  label,
  required,
  error,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-xs font-medium text-gray-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
