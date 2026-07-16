import { useMemo, useRef, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
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
import { Zap, Loader2, AlertTriangle, PackagePlus } from 'lucide-react';
import type { Product } from '@/pages/RecordSale';

// Kept in sync with the category presets used in Products.tsx / MultiProductForm.tsx
const PRESET_CATEGORIES = [
  'Tablets', 'Capsules', 'Syrups', 'Ointments', 'Injections', 'Drops',
  'Medical Devices', 'Supplements', 'Ayurveda/Homeopathy', 'Personal Care',
  'Baby Care', 'Surgical', 'Others',
];

const GST_OPTIONS = [0, 5, 12, 18, 28];

interface QuickAddMedicineSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current in-memory product list — used only for the duplicate-name warning. */
  existingProducts: Product[];
  /** Called after the medicine is saved to inventory AND a quantity is chosen. */
  onSaved: (product: Product, quantity: number) => void;
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
}: QuickAddMedicineSheetProps) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Two-step flow: 'form' → fill details, 'qty' → inline quantity prompt after save
  const [step, setStep] = useState<'form' | 'qty'>('form');
  const [savedProduct, setSavedProduct] = useState<Product | null>(null);
  const [billQty, setBillQty] = useState('1');
  const qtyRef = useRef<HTMLInputElement>(null);

  const set = (key: keyof typeof EMPTY_FORM, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  // ── Duplicate name detection (client-side, no query) ──
  const duplicate = useMemo(() => {
    const q = form.name.trim().toLowerCase();
    if (q.length < 2) return null;
    return existingProducts.find(
      p => p.name.toLowerCase() === q || p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()),
    ) ?? null;
  }, [form.name, existingProducts]);

  const resetAndClose = () => {
    setForm({ ...EMPTY_FORM });
    setErrors({});
    setStep('form');
    setSavedProduct(null);
    setBillQty('1');
    onOpenChange(false);
  };

  // ── Validation ──
  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Medicine name must be at least 2 characters.';
    const mrp = parseFloat(form.selling_price);
    if (!form.selling_price || isNaN(mrp) || mrp <= 0) next.selling_price = 'MRP / Sale Price must be a positive number.';
    const stock = parseInt(form.quantity, 10);
    if (form.quantity === '' || isNaN(stock) || stock < 0) next.quantity = 'Opening stock is required (0 or more).';
    if (form.expiry_date) {
      // month input → YYYY-MM ; must be current month or later
      const [y, m] = form.expiry_date.split('-').map(Number);
      const exp = new Date(y, (m || 1), 0); // last day of that month
      if (exp.getTime() < Date.now()) next.expiry_date = 'Expiry date must be in the future.';
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
      const expRaw = form.expiry_date;
      const pcs = form.pcs_per_unit ? parseInt(form.pcs_per_unit, 10) : null;

      const productData = {
        name: form.name.trim(),
        hsn_code: form.hsn_code.trim() || null,
        category: form.category || null,
        batch_number: form.batch_number.trim() || null,
        manufacturer: form.manufacturer.trim() || null,
        expiry_date: expRaw && expRaw.length === 7 ? `${expRaw}-01` : null,
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
      setStep('qty');
      setBillQty('1');
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
    const qty = Math.max(1, parseInt(billQty, 10) || 1);
    onSaved(savedProduct, qty);
    toast({ title: 'Medicine added to inventory and current bill ✓', description: `${savedProduct.name} × ${qty}` });
    resetAndClose();
  };

  // ── "Use existing instead" from the duplicate warning ──
  const useExisting = () => {
    if (!duplicate) return;
    setSavedProduct(duplicate);
    setStep('qty');
    setBillQty('1');
    setTimeout(() => qtyRef.current?.select(), 60);
  };

  return (
    <Sheet open={open} onOpenChange={o => (o ? onOpenChange(true) : resetAndClose())}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col gap-0 p-0"
        onKeyDown={e => {
          if (e.key === 'Enter' && step === 'form' && (e.target as HTMLElement).tagName !== 'BUTTON') {
            e.preventDefault();
            handleSave();
          }
        }}
      >
        <SheetHeader className="p-5 border-b border-gray-100 space-y-1 text-left">
          <SheetTitle className="flex items-center gap-2 text-emerald-800">
            <span className="bg-gradient-to-br from-amber-400 to-orange-500 p-1.5 rounded-lg">
              <Zap className="h-4 w-4 text-white" />
            </span>
            Quick Add Medicine
          </SheetTitle>
          <SheetDescription>
            {step === 'form'
              ? 'Add a new medicine to inventory without leaving billing.'
              : 'Medicine added! How many units for this bill?'}
          </SheetDescription>
        </SheetHeader>

        {step === 'form' ? (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Duplicate warning */}
              {duplicate && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-amber-800 font-medium">Did you mean “{duplicate.name}”?</p>
                    <p className="text-amber-700/80 text-xs mt-0.5">A similar medicine already exists in inventory.</p>
                    <button
                      type="button"
                      onClick={useExisting}
                      className="mt-1.5 text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      Use existing instead →
                    </button>
                  </div>
                </div>
              )}

              <Field label="Medicine Name" required error={errors.name}>
                <Input autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Paracetamol 500mg" className="h-10" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
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
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="MRP / Sale Price" required error={errors.selling_price}>
                  <Input type="number" inputMode="decimal" step="0.01" min="0" value={form.selling_price} onChange={e => set('selling_price', e.target.value)} placeholder="0.00" className="h-10" />
                </Field>
                <Field label="Purchase Price">
                  <Input type="number" inputMode="decimal" step="0.01" min="0" value={form.purchase_price} onChange={e => set('purchase_price', e.target.value)} placeholder="0.00" className="h-10" />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="GST %">
                  <Select value={form.gst} onValueChange={v => set('gst', v)}>
                    <SelectTrigger className="h-10"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {GST_OPTIONS.map(g => <SelectItem key={g} value={String(g)}>{g}%</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Opening Stock" required error={errors.quantity}>
                  <Input type="number" inputMode="numeric" min="0" value={form.quantity} onChange={e => set('quantity', e.target.value)} placeholder="0" className="h-10" />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Batch Number">
                  <Input value={form.batch_number} onChange={e => set('batch_number', e.target.value)} placeholder="e.g. B12345" className="h-10" />
                </Field>
                <Field label="Expiry Date" error={errors.expiry_date}>
                  <Input type="month" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} className="h-10" />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="HSN Code">
                  <Input value={form.hsn_code} onChange={e => set('hsn_code', e.target.value)} placeholder="e.g. 3004" className="h-10" />
                </Field>
                <Field label="Pcs per Unit">
                  <Input type="number" inputMode="numeric" min="0" value={form.pcs_per_unit} onChange={e => set('pcs_per_unit', e.target.value)} placeholder="e.g. 10" className="h-10" />
                </Field>
              </div>
            </div>

            <SheetFooter className="flex-row gap-2 p-5 border-t border-gray-100">
              <Button type="button" variant="outline" className="flex-1" onClick={resetAndClose} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save & Add to Bill'}
              </Button>
            </SheetFooter>
          </>
        ) : (
          /* ── Quantity step ── */
          <>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 mb-5">
                <div className="flex items-center gap-2 text-emerald-800">
                  <PackagePlus className="h-4 w-4" />
                  <span className="font-semibold text-sm">{savedProduct?.name}</span>
                </div>
                <p className="text-xs text-emerald-600/80 mt-1">
                  ₹{savedProduct?.selling_price?.toFixed(2)} · Stock: {savedProduct?.quantity}
                </p>
              </div>
              <Field label="Quantity for this bill" required>
                <Input
                  ref={qtyRef}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={billQty}
                  onChange={e => setBillQty(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleConfirmQty(); } }}
                  className="h-11 text-lg font-semibold text-center"
                />
              </Field>
            </div>
            <SheetFooter className="p-5 border-t border-gray-100">
              <Button
                type="button"
                className="w-full bg-green-600 hover:bg-green-700 text-white"
                onClick={handleConfirmQty}
              >
                Add to Bill
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Small labelled field wrapper ──
function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-gray-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
