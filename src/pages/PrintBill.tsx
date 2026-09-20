import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/db conn/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, ArrowLeft, Printer, Pencil, Plus, Trash2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

import { db } from '@/lib/supabaseLoose';
import { calcGst, stateNameForCode } from '@/lib/gst';
import { amountInWordsINR } from '@/lib/utils';

interface SaleItem {
    id: string;
    product_id: string;
    quantity: number;
    sub_qty?: number | null;
    pcs_per_unit?: number | null;
    unit_price: number;
    total_price: number;
    gst_amount: number | null;
    product_name: string;
    manufacturer?: string;
    batch_number?: string;
    hsn?: string;
    expiry?: string;
    discount_percentage?: number;
    gst?: number;
    selling_price?: number;
    // Stored GST breakup (added by 20260910200000). Falls back to an even
    // split of gst_amount for bills raised before that migration.
    taxable_value?: number | null;
    gst_rate?: number | null;
    cgst_amount?: number | null;
    sgst_amount?: number | null;
    igst_amount?: number | null;
    hsn_code_stored?: string | null;
    /** Scheme line: given away at ₹0, shown but never added to the invoice value. */
    is_free?: boolean;
}

interface BillData {
    id: string; // bill_id
    date: string;          // sale_date (date only) - used as the canonical bill date
    created_at: string;    // full TIMESTAMPTZ from the first row - frozen at creation
    account_id: string;
    customer_name: string | null;
    customer_phone: string | null;
    customer_address: string | null;
    doctor_name: string | null;
    items: SaleItem[];
    subtotal: number;
    total_gst: number;
    total_discount: number;
    total_amount: number;
    payment_mode: string;
    received_amount: number;
    discount_percentage: number;
    /** 'retail' (default) or 'wholesale' - drives the B2B invoice bits. */
    sale_type?: string | null;
    wholesale_customer_name?: string | null;
    wholesale_customer_gstin?: string | null;
}

// Lightweight product type for the add-item search list
interface AvailableProduct {
    id: string;
    name: string;
    quantity: number;
    selling_price: number;
    gst: number | null;
    pcs_per_unit?: number | null;
    batch_number?: string | null;
}

interface BusinessDetails {
    name: string;
    address: string | null;
    phone: string | null;
    gstin: string | null;
    drug_license: string | null;
    /** Two-digit GST state code - printed as the place of supply on B2B invoices. */
    state_code?: string | null;
}

export default function PrintBill() {
    const { billId } = useParams<{ billId: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [billData, setBillData] = useState<BillData | null>(null);

    /**
     * HSN-wise tax summary - the block a GST invoice must carry and the shape
     * GSTR-1 wants. Taxable value and tax are summed per HSN + rate pair.
     */
    const hsnSummary = useMemo(() => {
        if (!billData) return [];
        const buckets = new Map<string, {
            hsn: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number;
        }>();

        for (const item of billData.items) {
            const hsn = item.hsn && item.hsn !== '-' ? item.hsn : 'Unclassified';
            const rate = Number(item.gst_rate ?? item.gst ?? 0);
            const key = `${hsn}|${rate}`;

            const hasStored =
                item.cgst_amount != null || item.sgst_amount != null || item.igst_amount != null;
            const gstTotal = Math.abs(item.gst_amount || 0);
            const cgst = hasStored ? Math.abs(item.cgst_amount ?? 0) : gstTotal / 2;
            const sgst = hasStored ? Math.abs(item.sgst_amount ?? 0) : gstTotal / 2;
            const igst = hasStored ? Math.abs(item.igst_amount ?? 0) : 0;
            // Pre-migration lines have no taxable_value; derive it from the
            // line total less its tax, which is what was actually charged.
            const taxable = item.taxable_value != null
                ? Math.abs(item.taxable_value)
                : Math.abs(item.total_price) - gstTotal;

            const bucket = buckets.get(key) ?? { hsn, rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
            bucket.taxable += taxable;
            bucket.cgst += cgst;
            bucket.sgst += sgst;
            bucket.igst += igst;
            buckets.set(key, bucket);
        }

        return Array.from(buckets.values()).sort((a, b) => a.hsn.localeCompare(b.hsn));
    }, [billData]);
    const [businessDetails, setBusinessDetails] = useState<BusinessDetails | null>(null);
    // ?format=A4|T80 comes from the wholesale print picker; retail keeps A5.
    const [searchParams] = useSearchParams();
    const [format, setFormat] = useState<'A5' | 'A4' | 'T80'>(() => {
        const requested = searchParams.get('format');
        return requested === 'A4' || requested === 'T80' || requested === 'A5' ? requested : 'A5';
    });
    // A wholesale invoice defaults to A4 (it needs the room), unless the URL
    // already asked for a specific paper.
    const formatAutoSet = useRef(false);
    const [dateOverride, setDateOverride] = useState<string>(''); // YYYY-MM-DD, set once data loads

    // ponytail: @page must live in document.head - browsers ignore it inside DOM nodes
    useEffect(() => {
        const FORMATS_STATIC = {
            A5:  'A5 portrait',
            A4:  'A4 portrait',
            T80: '80mm auto',
        } as const;
        let el = document.getElementById('print-page-size-style') as HTMLStyleElement | null;
        if (!el) {
            el = document.createElement('style');
            el.id = 'print-page-size-style';
            document.head.appendChild(el);
        }
        el.textContent = `@page { size: ${FORMATS_STATIC[format]}; margin: 0; }`;
        return () => { el?.remove(); };
    }, [format]);
    const { toast } = useToast();
    const { profile } = useAuth();

    // Edit dialog state
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editName, setEditName] = useState('');
    const [editPhone, setEditPhone] = useState('');
    const [editAddress, setEditAddress] = useState('');
    const [editDoctor, setEditDoctor] = useState('');
    const [editPaymentMode, setEditPaymentMode] = useState('cash');
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    // Add/remove items state
    const [availableProducts, setAvailableProducts] = useState<AvailableProduct[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [selectedAddProductId, setSelectedAddProductId] = useState<string | null>(null);
    const [addQty, setAddQty] = useState(1);
    const [addRate, setAddRate] = useState(0);
    const [addGst, setAddGst] = useState(0);
    const [isAddingItem, setIsAddingItem] = useState(false);
    const [removingItemId, setRemovingItemId] = useState<string | null>(null);
    const [editGlobalDiscount, setEditGlobalDiscount] = useState(0);

    // Account-wide tax/currency settings - drives whether new items get GST and how it's calculated
    const [taxSettings, setTaxSettings] = useState<{ gst_enabled: boolean; gst_type: 'inclusive' | 'exclusive'; default_gst_rate: number }>({
        gst_enabled: true,
        gst_type: 'exclusive',
        default_gst_rate: 0,
    });

    const openEdit = () => {
        if (!billData) return;
        setEditName(billData.customer_name || '');
        setEditPhone(billData.customer_phone || '');
        setEditAddress(billData.customer_address || '');
        setEditDoctor(billData.doctor_name || '');
        setEditPaymentMode(billData.payment_mode || 'cash');
        // Pre-fill global discount from the bill's stored discount_percentage
        setEditGlobalDiscount(billData.discount_percentage || 0);
        setIsEditOpen(true);
        // Load product list lazily for the add-item search
        if (availableProducts.length === 0) {
            fetchAvailableProducts();
        }
    };

    // ─── Actions (shared by buttons and keyboard shortcuts) ───────────────────
    const doEdit = useCallback(async () => {
        if (!billId || !billData) return;
        // Respect the account's configurable sales-edit window (default 24h).
        let windowHours = 24;
        try {
            const { data } = await (supabase.from('settings') as any)
                .select('sales_edit_window_hours')
                .eq('account_id', billData.account_id)
                .single();
            const v = data?.sales_edit_window_hours;
            if (typeof v === 'number' && v > 0) windowHours = v;
        } catch { /* column may not exist yet → default 24 */ }
        const ageHours = (Date.now() - new Date(billData.created_at).getTime()) / 3600000;
        if (ageHours > windowHours) {
            toast({
                variant: 'destructive',
                title: 'Editing window closed',
                description: `This bill can only be edited within ${windowHours} ${windowHours === 1 ? 'hour' : 'hours'} of creation.`,
            });
            return;
        }
        navigate(`/sales/new?edit=${billId}`);
    }, [billId, billData, navigate, toast]);

    const doPrint = useCallback(async () => {
        // Stamp printed_at so the sale is locked from further edits (ignored if not migrated).
        if (billId) {
            try {
                await (supabase as any)
                    .from('sales')
                    .update({ printed_at: new Date().toISOString() })
                    .eq('bill_id', billId)
                    .is('printed_at', null);
            } catch { /* column may not exist yet */ }
        }
        window.print();
    }, [billId]);

    // P = Print · F2 = Edit · ←/→ = Change paper size
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.altKey || e.metaKey) return; // leave Ctrl+P etc. to the browser
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
            
            if (e.key === 'p' || e.key === 'P') { e.preventDefault(); doPrint(); }
            else if (e.key === 'F2') { e.preventDefault(); doEdit(); }
            else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const formats: ('A5' | 'A4' | 'T80')[] = ['A5', 'A4', 'T80'];
                setFormat(prev => {
                    const idx = formats.indexOf(prev);
                    const dir = e.key === 'ArrowRight' ? 1 : -1;
                    return formats[(idx + dir + formats.length) % formats.length];
                });
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [doPrint, doEdit]);

    const fetchAvailableProducts = async () => {
        if (!billData?.account_id) return;
        const { data, error } = await supabase
            .from('products')
            .select('id, name, quantity, selling_price, gst, pcs_per_unit, batch_number')
            .eq('account_id', billData.account_id)
            .order('name');
        if (!error && data) setAvailableProducts(data as any);

        // Pull account tax settings so Add Item respects gst_enabled / gst_type / default_gst_rate
        const { data: settingsData } = await supabase
            .from('settings')
            .select('gst_enabled, default_gst_rate, gst_type')
            .eq('account_id', billData.account_id)
            .single();
        if (settingsData) {
            const raw: any = settingsData;
            setTaxSettings({
                gst_enabled: raw.gst_enabled !== false,
                gst_type: raw.gst_type === 'inclusive' ? 'inclusive' : 'exclusive',
                default_gst_rate: typeof raw.default_gst_rate === 'number' ? raw.default_gst_rate : 0,
            });
        }
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!billData || !billId || isSavingEdit) return;
        if (editPaymentMode === 'credit' && (!editName.trim() || !editPhone.trim())) {
            toast({
                variant: 'destructive',
                title: 'Customer info required for credit',
                description: 'Name and phone are mandatory when payment mode is Credit / Dues.',
            });
            return;
        }
        setIsSavingEdit(true);
        try {
            const updatePayload: any = {
                customer_name: editName.trim() || 'Walk-in Customer',
                customer_phone: editPhone.trim() || null,
                customer_address: editAddress.trim() || null,
                doctor_name: editDoctor.trim() || null,
                payment_mode: editPaymentMode,
            };
            const { error } = await (supabase.from('sales') as any)
                .update(updatePayload)
                .eq('bill_id', billId);
            if (error) throw error;
            // Optimistic local update so the printable bill reflects the new info immediately
            setBillData(prev => prev ? {
                ...prev,
                customer_name: updatePayload.customer_name,
                customer_phone: updatePayload.customer_phone,
                customer_address: updatePayload.customer_address,
                doctor_name: updatePayload.doctor_name,
                payment_mode: updatePayload.payment_mode,
            } : prev);
            toast({ title: 'Bill updated' });
            setIsEditOpen(false);
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error updating bill', description: err.message });
        } finally {
            setIsSavingEdit(false);
        }
    };

    const fetchBillDetails = useCallback(async () => {
        if (!billId) return;
        try {
            setLoading(true);

            // Fetch sales items for this bill
            // @ts-ignore - bill_id might not exist in types yet
            const BASE_COLS = `
        id, product_id, quantity, sub_qty, pcs_per_unit, unit_price, total_price, gst_amount, created_at,
        customer_name, customer_phone, customer_address, doctor_name, payment_mode, account_id, discount_percentage, sale_date, received_amount,
        products(name, gst, hsn_code, batch_number, expiry_date, manufacturer, selling_price)`;
            // GST-split columns arrive with 20260910200000. Retry without them
            // so a bill still prints on a database that has not been migrated.
            const GST_SPLIT_COLS = ', taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, hsn_code';
            // Wholesale columns arrive with 20260918000000; same degrade-on-miss
            // approach as the GST-split set above.
            const WHOLESALE_COLS = ', sale_type, wholesale_customer_name, wholesale_customer_gstin';

            // db (untyped client): a column list built at runtime defeats
            // PostgREST's generated row typing; rows are re-mapped by hand below.
            let salesData: Record<string, unknown>[] | null = null;
            let salesError: { message?: string } | null = null;
            for (const cols of [
                BASE_COLS + GST_SPLIT_COLS + WHOLESALE_COLS,
                BASE_COLS + GST_SPLIT_COLS,
                BASE_COLS,
            ]) {
                const res = await db.from('sales').select(cols).eq('bill_id', billId);
                salesData = res.data;
                salesError = res.error;
                if (!salesError) break;
            }

                if (salesError) throw salesError;
                if (!salesData || salesData.length === 0) {
                    throw new Error('Bill not found');
                }

                // Cast to any to bypass strict type checking against current schema which might be outdated
                const itemsData = salesData as any[];

                // Fetch business details (drug_license added by migration; retry without it on older DBs)
                const accountId = itemsData[0].account_id;
                let { data: accountData, error: accountError } = await supabase
                    .from('accounts')
                    .select('name, address, phone, gstin, drug_license, state_code')
                    .eq('id', accountId)
                    .single();

                if (accountError) {
                    // Column may not exist yet - fall back to base columns
                    const retry = await supabase
                        .from('accounts')
                        .select('name, address, phone, gstin')
                        .eq('id', accountId)
                        .single();
                    accountData = retry.data;
                    if (retry.error) console.error('Error fetching business details:', retry.error);
                }
                setBusinessDetails(accountData as any);

                // Aggregate bill data
                const firstItem = itemsData[0];
                const items: SaleItem[] = itemsData.map((item: any) => {
                    let formattedExpiry = '-';
                    if (item.products?.expiry_date) {
                        try {
                            const d = new Date(item.products.expiry_date);
                            formattedExpiry = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
                        } catch (e) {
                            formattedExpiry = '-';
                        }
                    }

                    return {
                        id: item.id,
                        product_id: item.product_id,
                        quantity: item.quantity,
                        sub_qty: item.sub_qty || null,
                        pcs_per_unit: item.pcs_per_unit || null,
                        unit_price: item.unit_price,
                        total_price: item.total_price,
                        gst_amount: item.gst_amount,
                        product_name: item.products?.name || 'Unknown Product',
                        manufacturer: item.products?.manufacturer || '-',
                        batch_number: item.products?.batch_number || '-',
                        hsn: item.hsn_code || item.products?.hsn_code || '-',
                        expiry: formattedExpiry,
                        discount_percentage: item.discount_percentage || 0,
                        gst: item.gst_rate ?? item.products?.gst ?? 0,
                        selling_price: item.products?.selling_price || item.unit_price,
                        taxable_value: item.taxable_value ?? null,
                        gst_rate: item.gst_rate ?? null,
                        // A scheme line: zero rate AND zero value. Both checks so a
                        // genuine ₹0-value discounted line is never mistaken for free.
                        is_free: Number(item.unit_price) === 0 && Number(item.total_price) === 0,
                        cgst_amount: item.cgst_amount ?? null,
                        sgst_amount: item.sgst_amount ?? null,
                        igst_amount: item.igst_amount ?? null,
                        hsn_code_stored: item.hsn_code ?? null,
                    };
                });

                const subtotal = items.reduce((sum, item) => {
                    if (item.is_free) return sum; // given away - no invoice value
                    const effectiveQty = item.sub_qty && item.pcs_per_unit && item.pcs_per_unit > 0
                        ? item.quantity + (item.sub_qty / item.pcs_per_unit)
                        : (item.quantity || 1);
                    const mrp = item.selling_price || item.unit_price;
                    return sum + (mrp * effectiveQty);
                }, 0);
                
                const total_gst = items.reduce((sum, item) => sum + (item.gst_amount || 0), 0);
                const total_amount = items.reduce((sum, item) => sum + item.total_price, 0);
                const total_discount = Math.max(0, subtotal - total_amount);

                // Original creation moment = the EARLIEST created_at across all rows of this bill.
                // (Later edits may add new rows with a newer created_at; we always show the first.)
                const originalCreatedAt = (salesData ?? []).reduce((earliest: string, row: any) => {
                    if (!row?.created_at) return earliest;
                    if (!earliest) return row.created_at;
                    return new Date(row.created_at).getTime() < new Date(earliest).getTime() ? row.created_at : earliest;
                }, '');

                setBillData({
                    id: billId,
                    account_id: firstItem.account_id,
                    date: firstItem.sale_date || originalCreatedAt || firstItem.created_at,
                    created_at: originalCreatedAt || firstItem.created_at, // full timestamp - frozen at first save
                    customer_name: firstItem.customer_name,
                    customer_phone: firstItem.customer_phone,
                    customer_address: firstItem.customer_address,
                    doctor_name: firstItem.doctor_name,
                    items,
                    subtotal,
                    total_gst,
                    total_discount,
                    total_amount,
                    payment_mode: firstItem.payment_mode || 'Cash',
                    received_amount: firstItem.received_amount || total_amount,
                    discount_percentage: firstItem.discount_percentage || 0,
                    sale_type: firstItem.sale_type ?? 'retail',
                    wholesale_customer_name: firstItem.wholesale_customer_name ?? null,
                    wholesale_customer_gstin: firstItem.wholesale_customer_gstin ?? null,
                });
                // Seed the date picker with the bill's stored date
                const rawDate = firstItem.sale_date || originalCreatedAt || firstItem.created_at;
                setDateOverride(rawDate ? rawDate.slice(0, 10) : new Date().toISOString().slice(0, 10));

            } catch (err: any) {
                console.error('Error loading bill:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
    }, [billId]);

    useEffect(() => {
        fetchBillDetails();
    }, [fetchBillDetails]);

    // Wholesale bills need the A4 grid (free-qty column + HSN summary).
    const isWholesaleBill = billData?.sale_type === 'wholesale';
    useEffect(() => {
        if (!isWholesaleBill || formatAutoSet.current) return;
        formatAutoSet.current = true;
        if (!searchParams.get('format')) setFormat('A4');
    }, [isWholesaleBill, searchParams]);

    // Remove a single line item: restore stock, then delete the row
    const handleRemoveItem = async (item: SaleItem) => {
        if (!billData || removingItemId) return;
        if (!window.confirm(`Remove "${item.product_name}" from this bill? Stock will be restored.`)) return;

        setRemovingItemId(item.id);
        try {
            // Compute effective units to restore (mirrors the trigger's formula)
            const subQ = item.sub_qty ?? 0;
            const pcs = item.pcs_per_unit ?? 0;
            const restoreUnits = subQ && pcs > 0 ? item.quantity + subQ / pcs : item.quantity;

            // Read current stock and add the restored amount
            const { data: prod, error: readErr } = await supabase
                .from('products')
                .select('quantity')
                .eq('id', item.product_id)
                .single();
            if (readErr) throw readErr;
            const currentQty = (prod as any)?.quantity ?? 0;
            const { error: updErr } = await (supabase.from('products') as any)
                .update({ quantity: currentQty + restoreUnits })
                .eq('id', item.product_id);
            if (updErr) throw updErr;

            // Restore batch ledger so FEFO stays accurate (never throws)
            await db.rpc('adjust_batch_stock', {
                p_account_id: billData.account_id,
                p_product_id: item.product_id,
                p_batch_number: item.batch_number && item.batch_number !== '-' ? item.batch_number : null,
                p_delta: restoreUnits,
            });

            // Delete the sales row
            const { error: delErr } = await supabase.from('sales').delete().eq('id', item.id);
            if (delErr) throw delErr;

            toast({ title: 'Item removed', description: `${item.product_name} removed and stock restored.` });
            await fetchBillDetails();
            await fetchAvailableProducts();
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Could not remove item', description: err.message });
        } finally {
            setRemovingItemId(null);
        }
    };

    // Add a new item to this bill: insert a sales row (DB trigger decrements stock)
    const handleAddItem = async () => {
        if (!billData || isAddingItem) return;
        if (!selectedAddProductId) {
            toast({ variant: 'destructive', title: 'Select a product first' });
            return;
        }
        const product = availableProducts.find(p => p.id === selectedAddProductId);
        if (!product) {
            toast({ variant: 'destructive', title: 'Product not found' });
            return;
        }
        if (addQty < 1) {
            toast({ variant: 'destructive', title: 'Invalid quantity' });
            return;
        }
        if (addQty > product.quantity) {
            toast({ variant: 'destructive', title: 'Exceeds stock', description: `Only ${product.quantity} available.` });
            return;
        }
        if (addRate < 0) {
            toast({ variant: 'destructive', title: 'Invalid rate' });
            return;
        }

        setIsAddingItem(true);
        try {
            // Compute net + GST + total - respects account-level gst_enabled / gst_type
            const gross = Math.round(addRate * addQty * 100) / 100;
            // Apply global discount first
            const discAmt = Math.round((gross * editGlobalDiscount) / 100 * 100) / 100;
            const netAmount = gross - discAmt;
            let gstAmount = 0;
            let totalPrice = netAmount;
            if (taxSettings.gst_enabled) {
                const gstResult = calcGst(netAmount, addGst, taxSettings.gst_type === 'inclusive');
                gstAmount = Math.round(gstResult.gstAmount * 100) / 100;
                totalPrice = Math.round(gstResult.totalPrice * 100) / 100;
            }
            const isSettled = billData.payment_mode !== 'credit';

            const insertPayload: any = {
                account_id: billData.account_id,
                bill_id: billData.id,
                product_id: product.id,
                user_id: profile?.id || null,
                quantity: addQty,
                sub_qty: null,
                pcs_per_unit: product.pcs_per_unit || null,
                unit_price: addRate,
                total_price: totalPrice,
                gst_amount: gstAmount,
                payment_mode: billData.payment_mode,
                customer_name: billData.customer_name || 'Walk-in Customer',
                customer_phone: billData.customer_phone || null,
                customer_address: billData.customer_address || null,
                doctor_name: billData.doctor_name || null,
                discount_percentage: editGlobalDiscount,
                received_amount: isSettled ? totalPrice : 0,
                is_settled: isSettled,
                sale_date: billData.date,
            };

            const { error } = await supabase.from('sales').insert([insertPayload]);
            if (error) throw error;

            toast({ title: 'Item added', description: `${product.name} added to this bill.` });
            // Reset add form
            setSelectedAddProductId(null);
            setProductSearch('');
            setAddQty(1);
            setAddRate(0);
            setAddGst(0);
            await fetchBillDetails();
            await fetchAvailableProducts();
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Could not add item', description: err.message });
        } finally {
            setIsAddingItem(false);
        }
    };

    // When user picks a product from the search list, prefill rate + GST from product defaults
    const onPickAddProduct = (p: AvailableProduct) => {
        setSelectedAddProductId(p.id);
        setAddRate(p.selling_price);
        // Per-product GST first; fall back to the account's default GST rate; last resort 0
        setAddGst(p.gst ?? taxSettings.default_gst_rate ?? 0);
        setAddQty(1);
        setProductSearch('');
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (error || !billData) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen gap-4">
                <p className="text-destructive font-medium">Error loading bill: {error || 'Unknown error'}</p>
                <Button onClick={() => navigate('/sales')}>Back to Sales</Button>
            </div>
        );
    }

    const totalQty = billData.items.reduce((sum, item) => sum + item.quantity, 0);
    const totalProducts = billData.items.length;
    const invoiceNumber = billData.id.slice(0, 8).toUpperCase();
    const billCreatedAt = new Date(billData.created_at);
    // invoiceDate: user-selected date (or original bill date)
    const effectiveDate = dateOverride || billData.date;
    const invoiceDate = (() => {
        const d = new Date(effectiveDate);
        // date-only string → parse as local midnight
        const [y, m, day] = effectiveDate.slice(0, 10).split('-').map(Number);
        const local = new Date(y, m - 1, day);
        return local.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    })();
    // billTimestamp: selected date + current time (wall clock at render)
    const billTimestamp = (() => {
        const [y, m, day] = effectiveDate.slice(0, 10).split('-').map(Number);
        const now = new Date();
        const mixed = new Date(y, m - 1, day, now.getHours(), now.getMinutes(), now.getSeconds());
        return mixed.toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    })();

    // ponytail: single config object drives all format-dependent values
    const FORMATS = {
        A5:  { label: 'A5',  pageSize: 'A5 portrait',  width: '148mm', height: '210mm', minRows: 14 },
        A4:  { label: 'A4',  pageSize: 'A4 portrait',  width: '210mm', height: '297mm', minRows: 28 },
        T80: { label: '80mm Thermal', pageSize: '80mm auto', width: '76mm',  height: 'auto',  minRows: 0  },
    } as const;
    type FormatKey = keyof typeof FORMATS;
    const fmt = FORMATS[format];

    return (
        <div className="min-h-screen bg-gray-100 p-4 print:p-0 print:bg-white overflow-x-auto print:overflow-visible">
            {/* No-print controls */}
            <div className="max-w-[210mm] mx-auto mb-4 flex flex-wrap justify-between items-center gap-2 print:hidden">
                <Button variant="outline" onClick={() => navigate('/sales')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Sales
                </Button>
                {/* Format selector */}
                <div className="flex items-center gap-1 border rounded-md p-1 bg-white">
                    {(Object.keys(FORMATS) as FormatKey[]).map(key => (
                        <button
                            key={key}
                            onClick={() => setFormat(key)}
                            className={cn(
                                'px-3 py-1 rounded text-sm font-medium transition-colors',
                                format === key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
                            )}
                        >
                            {FORMATS[key].label}
                        </button>
                    ))}
                </div>
                {/* Date override - screen only */}
                <div className="flex items-center gap-1.5">
                    <label htmlFor="bill-date-override" className="text-xs text-muted-foreground font-medium">Bill Date:</label>
                    <input
                        id="bill-date-override"
                        type="date"
                        value={dateOverride}
                        onChange={e => setDateOverride(e.target.value)}
                        className="border rounded px-2 py-1 text-sm bg-white h-8"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={doEdit} title="Edit (F2)">
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                        <kbd className="ml-2 hidden sm:inline px-1.5 py-0.5 rounded border text-[10px] font-semibold text-muted-foreground">F2</kbd>
                    </Button>
                    <Button onClick={async () => {
                        if (billId) {
                            try {
                                await (supabase as any)
                                    .from('sales')
                                    .update({ printed_at: new Date().toISOString() })
                                    .eq('bill_id', billId)
                                    .is('printed_at', null);
                            } catch { /* column may not exist yet */ }
                        }
                        window.print();
                    }}>
                        <Printer className="h-4 w-4 mr-2" />
                        Print {fmt.label}
                    </Button>
                </div>
            </div>

            {/* Bill Container */}
            <div
                id="bill-container"
                style={{
                    width: fmt.width,
                    height: fmt.height,
                    margin: '0 auto',
                    background: '#fff',
                    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                    fontSize: format === 'T80' ? '7pt' : '8pt',
                    lineHeight: '1.25',
                    color: '#1a1a1a',
                    position: 'relative',
                    boxSizing: 'border-box',
                    padding: format === 'T80' ? '2mm 2mm' : '2.5mm 4mm 2.5mm 4mm',
                    textRendering: 'optimizeLegibility',
                }}
            >
                <style>
                    {`
            @media print {
              body, html {
                width: ${fmt.width};
                height: ${fmt.height};
                background: white;
                margin: 0;
                padding: 0;
              }
              .print\\:hidden {
                display: none !important;
              }
              #bill-container {
                box-shadow: none !important;
                page-break-inside: avoid;
              }
            }
            @media screen {
              #bill-container {
                box-shadow: 0 2px 16px rgba(0,0,0,0.12);
              }
            }
            #bill-container * {
              box-sizing: border-box;
            }
            .bill-table {
              width: 100%;
              table-layout: fixed;
              border-collapse: collapse;
            }
            .bill-table th, .bill-table td {
              border: none;
              border-left: 0.5px solid #444;
              border-right: 0.5px solid #444;
              padding: 3px 2px;
              vertical-align: middle;
            }
            .bill-table th {
              background: transparent;
              border-top: 1px solid #1a1a1a;
              border-bottom: 1.5px solid #1a1a1a;
              font-weight: 700;
              font-size: 7.5pt;
              text-transform: uppercase;
              letter-spacing: 0.1px;
              text-align: center;
              white-space: nowrap;
            }
            .bill-table td {
              font-size: 7.5pt;
            }
          `}
                </style>

                {/* ===== THERMAL (80mm) LAYOUT ===== */}
                {format === 'T80' ? (
                    <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '8pt', lineHeight: '1.4', color: '#000' }}>
                        {/* Header: centred logo + shop name */}
                        <div style={{ textAlign: 'center', paddingBottom: '2mm' }}>
                            <img src="/medstocksy-logo.png" alt="Logo" style={{ width: '14mm', height: '14mm', objectFit: 'contain', display: 'block', margin: '0 auto 1mm' }} />
                            <div style={{ fontSize: '11pt', fontWeight: 900, letterSpacing: '0.5px' }}>{businessDetails?.name || 'PHARMA'}</div>
                            {businessDetails?.address && <div style={{ fontSize: '7pt', color: '#333' }}>{businessDetails.address}</div>}
                            {businessDetails?.phone && <div style={{ fontSize: '7pt' }}>📞 {businessDetails.phone}</div>}
                            {businessDetails?.gstin && <div style={{ fontSize: '6.5pt', color: '#555' }}>GSTIN: {businessDetails.gstin}</div>}
                            {isWholesaleBill && billData.wholesale_customer_gstin && (
                                <div style={{ fontSize: '6.5pt', color: '#555' }}>
                                    Buyer GSTIN: {billData.wholesale_customer_gstin}
                                </div>
                            )}
                            {businessDetails?.drug_license && <div style={{ fontSize: '6.5pt', color: '#555' }}>DL: {businessDetails.drug_license}</div>}
                        </div>

                        <div style={{ borderTop: '1px dashed #666', margin: '0 0 2mm' }} />

                        {/* Bill meta */}
                        <div style={{ fontSize: '7pt', marginBottom: '1.5mm' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontWeight: 700 }}>TAX INVOICE</span>
                                <span style={{ fontWeight: 700 }}>{invoiceDate}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Invoice: {invoiceNumber}</span>
                                <span style={{ textTransform: 'capitalize' }}>{billData.payment_mode}</span>
                            </div>
                        </div>

                        {/* Customer */}
                        <div style={{ fontSize: '7pt', marginBottom: '1.5mm' }}>
                            <div><span style={{ fontWeight: 700 }}>Party: </span>{billData.customer_name || 'Walk-in Customer'}</div>
                            {billData.customer_phone && <div><span style={{ fontWeight: 700 }}>Ph: </span>{billData.customer_phone}</div>}
                            {billData.customer_address && <div><span style={{ fontWeight: 700 }}>Addr: </span>{billData.customer_address}</div>}
                            {billData.doctor_name && <div><span style={{ fontWeight: 700 }}>Dr: </span>{billData.doctor_name}</div>}
                        </div>

                        <div style={{ borderTop: '1px dashed #666', margin: '0 0 1.5mm' }} />

                        {/* Items table - 5 cols only (name wraps, no HSN/Batch/Exp/GST split) */}
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '7.5pt' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #000' }}>
                                    <th style={{ textAlign: 'left', paddingBottom: '1px', width: '34%' }}>Product</th>
                                    <th style={{ textAlign: 'center', width: '8%' }}>Qty</th>
                                    <th style={{ textAlign: 'right', width: '18%' }}>MRP</th>
                                    <th style={{ textAlign: 'right', width: '10%' }}>Dis%</th>
                                    <th style={{ textAlign: 'right', width: '20%' }}>Amt</th>
                                </tr>
                            </thead>
                            <tbody>
                                {billData.items.map((item, index) => {
                                    const effectiveQty = item.sub_qty && item.pcs_per_unit && item.pcs_per_unit > 0
                                        ? item.quantity + (item.sub_qty / item.pcs_per_unit)
                                        : (item.quantity || 1);
                                    const mrp = item.selling_price || item.unit_price;
                                    return (
                                        <tr key={item.id}>
                                            <td style={{ paddingTop: '1.5px', wordBreak: 'break-word' }}>
                                                <div style={{ fontWeight: 700 }}>
                                                    {index + 1}. {item.product_name}
                                                    {item.is_free && <span style={{ fontSize: '6.5pt', fontWeight: 700 }}> (FREE)</span>}
                                                </div>
                                                {item.batch_number && item.batch_number !== '-' && (
                                                    <div style={{ fontSize: '6.5pt', color: '#555' }}>
                                                        Batch: {item.batch_number}{item.expiry && item.expiry !== '-' ? ` | Exp: ${item.expiry}` : ''}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'center', verticalAlign: 'top', paddingTop: '1.5px' }}>
                                                {item.sub_qty ? `${item.quantity}+${item.sub_qty}` : item.quantity}
                                            </td>
                                            <td style={{ textAlign: 'right', verticalAlign: 'top', paddingTop: '1.5px' }}>₹{mrp.toFixed(2)}</td>
                                            <td style={{ textAlign: 'right', verticalAlign: 'top', paddingTop: '1.5px', fontSize: '6.5pt' }}>
                                                {item.discount_percentage ? item.discount_percentage + '%' : '-'}
                                            </td>
                                            <td style={{ textAlign: 'right', verticalAlign: 'top', paddingTop: '1.5px', fontWeight: 700 }}>₹{item.total_price.toFixed(2)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        <div style={{ borderTop: '1px dashed #666', margin: '2mm 0 1.5mm' }} />

                        {/* Totals */}
                        <div style={{ fontSize: '7.5pt' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Subtotal</span><span>₹{billData.subtotal.toFixed(2)}</span>
                            </div>
                            {billData.total_discount > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0d6e3a' }}>
                                    <span>Savings</span><span>-₹{billData.total_discount.toFixed(2)}</span>
                                </div>
                            )}
                            {billData.total_gst > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555' }}>
                                    <span>GST</span><span>₹{billData.total_gst.toFixed(2)}</span>
                                </div>
                            )}
                        </div>
                        <div style={{ borderTop: '2px solid #000', margin: '1.5mm 0 1mm' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: '10pt' }}>
                            <span>TOTAL</span><span>₹{billData.total_amount.toFixed(2)}</span>
                        </div>

                        <div style={{ borderTop: '1px dashed #666', margin: '2mm 0 1.5mm' }} />

                        {/* HSN-wise Tax Summary */}
                        {hsnSummary.length > 0 && (
                            <>
                                <div style={{ fontSize: '6pt', marginBottom: '2mm' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '0.5mm' }}>GST Summary:</div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px dashed #666' }}>
                                                <th style={{ textAlign: 'left', fontWeight: 600, paddingBottom: '1mm' }}>HSN</th>
                                                <th style={{ textAlign: 'center', fontWeight: 600, paddingBottom: '1mm' }}>%</th>
                                                <th style={{ textAlign: 'right', fontWeight: 600, paddingBottom: '1mm' }}>CGST</th>
                                                <th style={{ textAlign: 'right', fontWeight: 600, paddingBottom: '1mm' }}>SGST</th>
                                                <th style={{ textAlign: 'right', fontWeight: 600, paddingBottom: '1mm' }}>IGST</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {hsnSummary.map(row => (
                                                <tr key={`${row.hsn}-${row.rate}`}>
                                                    <td style={{ textAlign: 'left', paddingTop: '1mm' }}>{row.hsn || '-'}</td>
                                                    <td style={{ textAlign: 'center', paddingTop: '1mm' }}>{row.rate}</td>
                                                    <td style={{ textAlign: 'right', paddingTop: '1mm' }}>{row.cgst.toFixed(2)}</td>
                                                    <td style={{ textAlign: 'right', paddingTop: '1mm' }}>{row.sgst.toFixed(2)}</td>
                                                    <td style={{ textAlign: 'right', paddingTop: '1mm' }}>{row.igst.toFixed(2)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{ borderTop: '1px dashed #666', margin: '0 0 1.5mm' }} />
                            </>
                        )}

                        {/* Payment + T&C */}
                        <div style={{ fontSize: '6.5pt', color: '#333', marginBottom: '2mm' }}>
                            <div><span style={{ fontWeight: 700 }}>Payment: </span><span style={{ textTransform: 'capitalize' }}>{billData.payment_mode}</span> - Received with thanks.</div>
                            <div style={{ marginTop: '1mm', color: '#555', fontSize: '6pt' }}>
                                T&C: Goods once sold will not be taken back. GST incl. in MRP. Subject to local jurisdiction.{' '}
                                <span style={{ color: '#0d6e3a', fontWeight: 700 }}>Get well soon!</span>
                            </div>
                        </div>

                        <div style={{ borderTop: '1px dashed #666', margin: '0 0 2mm' }} />

                        {/* Auth sign centred */}
                        <div style={{ textAlign: 'center', marginBottom: '2mm' }}>
                            <div style={{ display: 'inline-block', borderTop: '0.5px solid #888', width: '28mm', paddingTop: '1mm', fontSize: '6pt', color: '#555' }}>
                                Authorised Signatory
                            </div>
                        </div>

                        <div style={{ borderTop: '1px dashed #666', margin: '0 0 1.5mm' }} />

                        {/* Footer */}
                        <div style={{ textAlign: 'center', fontSize: '6pt', color: '#555' }}>
                            <div>Items: {totalProducts} | Qty: {totalQty} | {billTimestamp}</div>
                            <div style={{ marginTop: '1mm', fontStyle: 'italic', fontWeight: 600 }}>medstocksy.in</div>
                            <div style={{ marginTop: '1mm', fontSize: '5.5pt' }}>Thank you for your purchase!</div>
                        </div>
                    </div>
                ) : (
                /* ===== A5 / A4 BORDERED LAYOUT ===== */
                <div style={{ border: '1px solid #444' }}>
                {/* ===== HEADER ZONE ===== */}
                <div>
                    {/* Top row: Logo + Business + Invoice */}
                    <div style={{ display: 'flex', borderBottom: '1px solid #444' }}>
                        {/* Left: Logo + Business Info */}
                        <div style={{ flex: '1.2', display: 'flex', borderRight: '1px solid #444', padding: '1.5mm' }}>
                            {/* Logo */}
                            <div style={{ width: '12mm', minHeight: '12mm', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '2mm' }}>
                                <img
                                    src="/medstocksy-logo.png"
                                    alt="Logo"
                                    style={{ width: '11mm', height: '11mm', objectFit: 'contain' }}
                                />
                            </div>
                            {/* Business details */}
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '6pt', color: '#555', fontWeight: 600, marginBottom: '0px', letterSpacing: '0.3px' }}>TAX INVOICE</div>
                                <div style={{ fontSize: '10pt', fontWeight: 800, color: '#1a3a5c', lineHeight: '1.1', textTransform: 'uppercase' }}>
                                    {businessDetails?.name || 'PHARMA'}
                                </div>
                                <div style={{ fontSize: '6.5pt', marginTop: '1px', color: '#444', lineHeight: '1.3' }}>
                                    {businessDetails?.address && <div>{businessDetails.address}</div>}
                                    {businessDetails?.phone && <span>📞 {businessDetails.phone}</span>}
                                    {businessDetails?.gstin && <span style={{ marginLeft: businessDetails?.phone ? '4px' : 0 }}>| GSTIN: {businessDetails.gstin}</span>}
                                    {businessDetails?.drug_license && <span style={{ marginLeft: '4px' }}>| DL: {businessDetails.drug_license}</span>}
                                    {isWholesaleBill && businessDetails?.state_code && (
                                        <div>
                                            State: {businessDetails.state_code}
                                            {stateNameForCode(businessDetails.state_code)
                                                ? ` - ${stateNameForCode(businessDetails.state_code)}`
                                                : ''}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Right: Invoice Details */}
                        <div style={{ flex: '1', padding: '1.5mm' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1mm' }}>
                                <div style={{ fontSize: '9pt', fontWeight: 700, color: '#1a3a5c' }}>
                                    Invoice/{invoiceNumber}
                                </div>
                                <div style={{ fontSize: '7.5pt', fontWeight: 600, textAlign: 'right' }}>
                                    {invoiceDate}
                                </div>
                            </div>
                            <div style={{ fontSize: '6.5pt', lineHeight: '1.4', color: '#333' }}>
                                <div style={{ display: 'flex' }}>
                                    <span style={{ width: '14mm', fontWeight: 600 }}>NAME:</span>
                                    <span>{billData.customer_name || 'Walk-in'}</span>
                                </div>
                                {billData.customer_address && (
                                    <div style={{ display: 'flex' }}>
                                        <span style={{ width: '14mm', fontWeight: 600 }}>ADDR:</span>
                                        <span>{billData.customer_address}</span>
                                    </div>
                                )}
                                {billData.customer_phone && (
                                    <div style={{ display: 'flex' }}>
                                        <span style={{ width: '14mm', fontWeight: 600 }}>PH:</span>
                                        <span>{billData.customer_phone}</span>
                                    </div>
                                )}
                                {billData.doctor_name && (
                                    <div style={{ display: 'flex' }}>
                                        <span style={{ width: '14mm', fontWeight: 600 }}>DR:</span>
                                        <span>{billData.doctor_name}</span>
                                    </div>
                                )}
                                {/* Buyer GSTIN - mandatory on a B2B tax invoice */}
                                {isWholesaleBill && billData.wholesale_customer_gstin && (
                                    <div style={{ display: 'flex' }}>
                                        <span style={{ width: '14mm', fontWeight: 600 }}>GSTIN:</span>
                                        <span style={{ fontWeight: 600 }}>{billData.wholesale_customer_gstin}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ===== ITEMIZED TRANSACTION GRID ===== */}
                <div style={{ borderBottom: '1px solid #444' }}>
                    <table className="bill-table">
                        <thead>
                            <tr>
                                <th style={{ width: '3%' }}>#</th>
                                <th style={{ textAlign: 'left', width: '29%' }}>Products</th>
                                <th style={{ width: '10%' }}>HSN</th>
                                <th style={{ width: '10%' }}>Batch</th>
                                <th style={{ width: '6%' }}>Exp</th>
                                <th style={{ width: '5%' }}>Qty</th>
                                {isWholesaleBill && <th style={{ width: '4%' }}>Free</th>}
                                <th style={{ width: '7%' }}>MRP</th>
                                <th style={{ width: '7%' }}>Rate</th>
                                <th style={{ width: '5%', fontSize: '7pt' }}>Dis%</th>
                                <th style={{ width: '5%', fontSize: '7pt' }}>CGST</th>
                                <th style={{ width: '5%', fontSize: '7pt' }}>SGST</th>
                                <th style={{ width: '8%' }}>Amt</th>
                            </tr>
                        </thead>
                        <tbody>
                            {billData.items.map((item, index) => {
                                const effectiveQty = item.sub_qty && item.pcs_per_unit && item.pcs_per_unit > 0
                                    ? item.quantity + (item.sub_qty / item.pcs_per_unit)
                                    : (item.quantity || 1);

                                // Calculate GST rates
                                const grossAmount = item.unit_price * effectiveQty;
                                const discountAmt = (grossAmount * (item.discount_percentage || 0)) / 100;
                                const netAmount = grossAmount - discountAmt;

                                // CGST & SGST: prefer the amounts frozen on the sale line.
                                // Bills raised before the GST-split migration have none,
                                // so an even split of gst_amount stands in.
                                const hasStoredSplit =
                                    item.cgst_amount != null || item.sgst_amount != null || item.igst_amount != null;
                                const cgstAmt = hasStoredSplit ? Math.abs(item.cgst_amount ?? 0) : Math.abs(item.gst_amount || 0) / 2;
                                const sgstAmt = hasStoredSplit ? Math.abs(item.sgst_amount ?? 0) : Math.abs(item.gst_amount || 0) / 2;
                                const igstAmt = hasStoredSplit ? Math.abs(item.igst_amount ?? 0) : 0;

                                const mrp = item.selling_price || item.unit_price;
                                const gstPerUnit = (item.gst_amount || 0) / effectiveQty;
                                const rate = mrp - gstPerUnit;

                                return (
                                    <tr key={item.id}>
                                        <td style={{ textAlign: 'center' }}>{index + 1}</td>
                                        <td style={{ textAlign: 'left', fontWeight: 600, wordWrap: 'break-word' }}>
                                            {item.product_name}
                                            {item.is_free && (
                                                <span style={{ marginLeft: '2mm', fontSize: '5.5pt', fontWeight: 700, color: '#6d28d9', border: '0.5px solid #6d28d9', borderRadius: '2px', padding: '0 1mm' }}>
                                                    FREE
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.hsn}</td>
                                        <td style={{ textAlign: 'center', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.batch_number}</td>
                                        <td style={{ textAlign: 'center' }}>{item.expiry}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            {item.is_free ? '-' : item.sub_qty ? (
                                                <span>{item.quantity}<span style={{ fontSize: '0.8em', color: '#1565c0' }}>+{item.sub_qty}</span></span>
                                            ) : (
                                                item.quantity
                                            )}
                                        </td>
                                        {isWholesaleBill && (
                                            <td style={{ textAlign: 'center', fontWeight: 700, color: '#6d28d9' }}>
                                                {item.is_free ? item.quantity : '-'}
                                            </td>
                                        )}
                                        <td style={{ textAlign: 'right' }}>{mrp.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right' }}>{item.is_free ? '0.00' : rate.toFixed(2)}</td>
                                        <td style={{ textAlign: 'center', fontSize: '6.5pt' }}>{item.discount_percentage ? item.discount_percentage + '%' : '-'}</td>
                                        <td style={{ textAlign: 'right', fontSize: '6.5pt' }}>{igstAmt > 0 ? igstAmt.toFixed(2) : (cgstAmt > 0 ? cgstAmt.toFixed(2) : '-')}</td>
                                        <td style={{ textAlign: 'right', fontSize: '6.5pt' }}>{igstAmt > 0 ? '-' : (sgstAmt > 0 ? sgstAmt.toFixed(2) : '-')}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{item.total_price.toFixed(2)}</td>
                                    </tr>
                                );
                            })}
                            {/* Empty rows to fill minimum space */}
                            {fmt.minRows > 0 && billData.items.length < fmt.minRows && Array.from({ length: fmt.minRows - billData.items.length }).map((_, i) => (
                                <tr key={`empty-${i}`}>
                                    <td style={{ height: '14px' }}>&nbsp;</td>
                                    <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                                    {isWholesaleBill && <td></td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* ===== HSN-WISE TAX SUMMARY (GST invoice requirement) ===== */}
                {hsnSummary.length > 0 && (
                    <div style={{ borderBottom: '1px solid #444', padding: '1.5mm 2mm' }}>
                        <div style={{ fontWeight: 700, fontSize: '7pt', marginBottom: '1mm' }}>
                            HSN-wise Tax Summary
                        </div>
                        <table className="bill-table" style={{ fontSize: '6.5pt' }}>
                            <thead>
                                <tr>
                                    <th style={{ textAlign: 'left', width: '20%' }}>HSN</th>
                                    <th style={{ width: '10%' }}>Rate</th>
                                    <th style={{ width: '20%' }}>Taxable Value</th>
                                    <th style={{ width: '17%' }}>CGST</th>
                                    <th style={{ width: '17%' }}>SGST</th>
                                    <th style={{ width: '16%' }}>IGST</th>
                                </tr>
                            </thead>
                            <tbody>
                                {hsnSummary.map(row => (
                                    <tr key={`${row.hsn}-${row.rate}`}>
                                        <td style={{ textAlign: 'left' }}>{row.hsn}</td>
                                        <td style={{ textAlign: 'center' }}>{row.rate}%</td>
                                        <td style={{ textAlign: 'right' }}>{row.taxable.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right' }}>{row.cgst.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right' }}>{row.sgst.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right' }}>{row.igst.toFixed(2)}</td>
                                    </tr>
                                ))}
                                <tr style={{ fontWeight: 700 }}>
                                    <td style={{ textAlign: 'left' }}>Total</td>
                                    <td></td>
                                    <td style={{ textAlign: 'right' }}>
                                        {hsnSummary.reduce((n, r) => n + r.taxable, 0).toFixed(2)}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        {hsnSummary.reduce((n, r) => n + r.cgst, 0).toFixed(2)}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        {hsnSummary.reduce((n, r) => n + r.sgst, 0).toFixed(2)}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        {hsnSummary.reduce((n, r) => n + r.igst, 0).toFixed(2)}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )}

                {/* ===== FOOTER ZONE - PAYMENT & AUDIT ===== */}
                <div style={{ borderBottom: '1px solid #444' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        {/* Left: Payment Mode + Terms */}
                        <div style={{ flex: '1.3', borderRight: '1px solid #444', padding: '1.5mm', fontSize: '6.5pt', lineHeight: '1.4', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                            <div>
                                {/* Total in words - a tax invoice has to state it */}
                                {isWholesaleBill && (
                                    <div style={{ marginBottom: '1mm', fontSize: '6.5pt', lineHeight: '1.3' }}>
                                        <span style={{ fontWeight: 700 }}>Amount in words: </span>
                                        <span style={{ fontStyle: 'italic' }}>{amountInWordsINR(billData.total_amount)}</span>
                                    </div>
                                )}
                                <div style={{ marginBottom: '1mm' }}>
                                    <span style={{ fontWeight: 700 }}>Payment: </span>
                                    <span style={{ textTransform: 'capitalize' }}>{billData.payment_mode}</span>
                                    <span style={{ marginLeft: '4px', color: '#555' }}>- Received with thanks.</span>
                                </div>
                                <div style={{ fontSize: '6pt', lineHeight: '1.35', color: '#444' }}>
                                    <span style={{ fontWeight: 700 }}>T&C: </span>
                                    {isWholesaleBill ? (
                                        <>Goods once sold will not be taken back. Subject to local jurisdiction. E&amp;OE.</>
                                    ) : (
                                        <>
                                            Goods once sold will not be taken back. GST included in MRP. Subject to local jurisdiction.{' '}
                                            <span style={{ color: '#0d6e3a', fontWeight: 600 }}>Get well soon!</span>
                                        </>
                                    )}
                                </div>
                            </div>
                            {/* Authorized Signatory */}
                            <div style={{ paddingRight: '1mm' }}>
                                <div style={{ borderTop: '0.5px solid #666', width: isWholesaleBill ? '30mm' : '24mm', textAlign: 'center', paddingTop: '1mm' }}>
                                    <span style={{ fontSize: '6pt', color: '#555' }}>
                                        {isWholesaleBill ? 'Authorised Signatory' : 'Auth Sign'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Right: Totals */}
                        <div style={{ flex: '0.7', padding: '1.5mm', fontSize: '7pt' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <tbody>
                                    <tr>
                                        <td style={{ padding: '1px 0', fontWeight: 600, textAlign: 'left' }}>Subtotal</td>
                                        <td style={{ padding: '1px 0', textAlign: 'right' }}>₹{billData.subtotal.toFixed(2)}</td>
                                    </tr>
                                    {billData.total_discount > 0 && (
                                        <tr>
                                            <td style={{ padding: '1px 0', fontWeight: 600, textAlign: 'left', color: '#0d6e3a' }}>Savings</td>
                                            <td style={{ padding: '1px 0', textAlign: 'right', color: '#0d6e3a' }}>-₹{billData.total_discount.toFixed(2)}</td>
                                        </tr>
                                    )}
                                    <tr>
                                        <td colSpan={2} style={{ padding: 0 }}>
                                            <div style={{ borderTop: '1.5px solid #1a1a1a', margin: '1px 0' }}></div>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style={{ padding: '1px 0', fontWeight: 800, fontSize: '8.5pt', textAlign: 'left' }}>TOTAL</td>
                                        <td style={{ padding: '1px 0', fontWeight: 800, fontSize: '8.5pt', textAlign: 'right' }}>₹{billData.total_amount.toFixed(2)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* ===== CONTROL STRIP ===== */}
                <div style={{
                    background: '#f5f5f5',
                    padding: '1mm 2.5mm',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '5.5pt',
                    color: '#555',
                }}>
                    <div style={{ fontWeight: 600 }}>Items: {totalProducts} | Qty: {totalQty}</div>
                    <div>Recorded: <span style={{ fontWeight: 600 }}>{billTimestamp}</span></div>
                    <div style={{ fontStyle: 'italic' }}>medstocksy.in</div>
                </div>
                </div>
                )}
            </div>

            {/* Edit Bill Dialog - never shown in print */}
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 print:hidden">
                    <DialogHeader className="pr-8 space-y-1">
                        <DialogTitle className="text-lg">Edit Bill</DialogTitle>
                        <DialogDescription className="text-sm">
                            Update customer info, payment mode, or modify the medicines on this bill. Stock is adjusted automatically when you add or remove items.
                        </DialogDescription>
                    </DialogHeader>

                    {/* === Items section === */}
                    <div className="space-y-3 mt-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Medicines on this bill ({billData?.items.length ?? 0})</h3>
                        </div>

                        {/* Existing items */}
                        {billData && billData.items.length > 0 ? (
                            <div className="rounded-md border bg-card overflow-hidden">
                                <div className="max-h-56 overflow-y-auto divide-y">
                                    {billData.items.map((item) => (
                                        <div key={item.id} className="flex items-center gap-2 px-3 py-2">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium truncate">{item.product_name}</p>
                                                <p className="text-[11px] text-muted-foreground">
                                                    Qty {item.quantity}{item.sub_qty ? ` +${item.sub_qty}` : ''} · ₹{item.unit_price.toFixed(2)} each
                                                </p>
                                            </div>
                                            <div className="text-sm font-semibold whitespace-nowrap">₹{item.total_price.toFixed(2)}</div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                                onClick={() => handleRemoveItem(item)}
                                                disabled={removingItemId === item.id}
                                                title="Remove from bill"
                                                aria-label="Remove from bill"
                                            >
                                                {removingItemId === item.id
                                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    : <Trash2 className="h-3.5 w-3.5" />}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground italic">No items on this bill.</p>
                        )}

                        {/* Add medicine form */}
                        <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Add medicine</p>

                            {/* Search */}
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                                <Input
                                    value={productSearch}
                                    onChange={(e) => setProductSearch(e.target.value)}
                                    placeholder="Search by name…"
                                    className="h-9 pl-8"
                                />
                                {productSearch && (
                                    <div className="mt-1 max-h-40 overflow-y-auto rounded-md border bg-card">
                                        {availableProducts
                                            .filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()) && p.quantity > 0)
                                            .slice(0, 25)
                                            .map(p => (
                                                <button
                                                    type="button"
                                                    key={p.id}
                                                    onClick={() => onPickAddProduct(p)}
                                                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between gap-2 border-b last:border-0"
                                                >
                                                    <span className="truncate">{p.name}</span>
                                                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                                                        Stk {p.quantity} · ₹{p.selling_price.toFixed(2)}
                                                    </span>
                                                </button>
                                            ))}
                                        {availableProducts.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()) && p.quantity > 0).length === 0 && (
                                            <p className="text-xs text-muted-foreground italic px-3 py-2">No matches in stock.</p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Selected product & inputs */}
                            {selectedAddProductId && (() => {
                                const p = availableProducts.find(x => x.id === selectedAddProductId);
                                if (!p) return null;
                                return (
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-card rounded border">
                                            <p className="text-sm font-medium truncate">{p.name}</p>
                                            <button
                                                type="button"
                                                className="text-xs text-muted-foreground hover:text-foreground"
                                                onClick={() => { setSelectedAddProductId(null); setProductSearch(''); }}
                                            >
                                                Change
                                            </button>
                                        </div>
                                        <div className={cn('grid gap-2', taxSettings.gst_enabled ? 'grid-cols-4' : 'grid-cols-3')}>
                                            <div className="space-y-0.5">
                                                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Qty</Label>
                                                <Input
                                                    type="number"
                                                    inputMode="numeric"
                                                    min="1"
                                                    max={p.quantity}
                                                    value={addQty}
                                                    onChange={(e) => setAddQty(Math.max(1, Math.min(p.quantity, parseInt(e.target.value) || 1)))}
                                                    className="h-8 text-sm text-center"
                                                />
                                            </div>
                                            <div className="space-y-0.5">
                                                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Rate ₹</Label>
                                                <Input
                                                    type="number"
                                                    inputMode="decimal"
                                                    step="0.01"
                                                    min="0"
                                                    value={addRate}
                                                    onChange={(e) => setAddRate(Math.max(0, parseFloat(e.target.value) || 0))}
                                                    className="h-8 text-sm text-right"
                                                />
                                            </div>
                                            {taxSettings.gst_enabled && (
                                                <div className="space-y-0.5">
                                                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                                        GST %{taxSettings.gst_type === 'inclusive' ? ' (incl.)' : ''}
                                                    </Label>
                                                    <Input
                                                        type="number"
                                                        inputMode="decimal"
                                                        step="0.01"
                                                        min="0"
                                                        value={addGst}
                                                        onChange={(e) => setAddGst(Math.max(0, parseFloat(e.target.value) || 0))}
                                                        className="h-8 text-sm text-center"
                                                    />
                                                </div>
                                            )}
                                            <div className="space-y-0.5">
                                                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Disc %</Label>
                                                <Input
                                                    type="number"
                                                    inputMode="decimal"
                                                    step="0.01"
                                                    min="0"
                                                    max="100"
                                                    value={editGlobalDiscount}
                                                    onChange={(e) => setEditGlobalDiscount(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                                                    className="h-8 text-sm text-center"
                                                />
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            onClick={handleAddItem}
                                            disabled={isAddingItem}
                                            className="w-full h-9 gap-2"
                                        >
                                            {isAddingItem ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                            Add to Bill
                                        </Button>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>

                    <div className="border-t my-4" />

                    {/* === Customer + payment section === */}
                    <h3 className="text-sm font-semibold mb-2">Customer & payment</h3>
                    <form onSubmit={handleSaveEdit} className="space-y-3">
                        <div className="space-y-1">
                            <Label htmlFor="editName" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Customer Name</Label>
                            <Input
                                id="editName"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                placeholder="Walk-in Customer"
                                className="h-9"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label htmlFor="editPhone" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Phone</Label>
                                <Input
                                    id="editPhone"
                                    type="tel"
                                    inputMode="tel"
                                    value={editPhone}
                                    onChange={(e) => {
                                        let value = e.target.value;
                                        if (value && !value.startsWith('+')) {
                                            const cleaned = value.replace(/\D/g, '');
                                            if (cleaned.length === 10) value = '+91' + cleaned;
                                            else if (cleaned.length === 12 && cleaned.startsWith('91')) value = '+' + cleaned;
                                            else if (cleaned.length > 0) value = '+91' + cleaned;
                                        }
                                        setEditPhone(value);
                                    }}
                                    placeholder="+91 9876543210"
                                    className="h-9"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="editPaymentMode" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Payment</Label>
                                <Select value={editPaymentMode} onValueChange={setEditPaymentMode}>
                                    <SelectTrigger id="editPaymentMode" className="h-9">
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
                        <div className="space-y-1">
                            <Label htmlFor="editAddress" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Address</Label>
                            <Input
                                id="editAddress"
                                value={editAddress}
                                onChange={(e) => setEditAddress(e.target.value)}
                                placeholder="Customer address"
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="editDoctor" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Doctor</Label>
                            <Input
                                id="editDoctor"
                                value={editDoctor}
                                onChange={(e) => setEditDoctor(e.target.value)}
                                placeholder="Prescribing doctor (optional)"
                                className="h-9"
                            />
                        </div>
                        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                            <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} className="sm:w-auto">
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isSavingEdit} className="sm:w-auto sm:min-w-[160px] gap-2">
                                {isSavingEdit ? (
                                    <><Loader2 className="h-4 w-4 animate-spin" />Saving...</>
                                ) : (
                                    <>Save Changes</>
                                )}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
