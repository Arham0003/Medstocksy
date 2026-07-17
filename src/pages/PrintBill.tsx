import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
}

interface BillData {
    id: string; // bill_id
    date: string;          // sale_date (date only) — used as the canonical bill date
    created_at: string;    // full TIMESTAMPTZ from the first row — frozen at creation
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
}

export default function PrintBill() {
    const { billId } = useParams<{ billId: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [billData, setBillData] = useState<BillData | null>(null);
    const [businessDetails, setBusinessDetails] = useState<BusinessDetails | null>(null);
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

    // Account-wide tax/currency settings — drives whether new items get GST and how it's calculated
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
        setIsEditOpen(true);
        // Load product list lazily for the add-item search
        if (availableProducts.length === 0) {
            fetchAvailableProducts();
        }
    };

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
            const { data: salesData, error: salesError } = await supabase
                .from('sales')
                .select(`
        id, product_id, quantity, sub_qty, pcs_per_unit, unit_price, total_price, gst_amount, created_at,
        customer_name, customer_phone, customer_address, doctor_name, payment_mode, account_id, discount_percentage, sale_date, received_amount,
        products(name, gst, hsn_code, batch_number, expiry_date, manufacturer, selling_price)
      `)
                .eq('bill_id', billId);

                if (salesError) throw salesError;
                if (!salesData || salesData.length === 0) {
                    throw new Error('Bill not found');
                }

                // Cast to any to bypass strict type checking against current schema which might be outdated
                const itemsData = salesData as any[];

                // Fetch business details
                const accountId = itemsData[0].account_id;
                const { data: accountData, error: accountError } = await supabase
                    .from('accounts')
                    .select('name, address, phone, gstin')
                    .eq('id', accountId)
                    .single();

                if (accountError) console.error('Error fetching business details:', accountError);
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
                        hsn: item.products?.hsn_code || '-',
                        expiry: formattedExpiry,
                        discount_percentage: item.discount_percentage || 0,
                        gst: item.products?.gst || 0,
                        selling_price: item.products?.selling_price || item.unit_price,
                    };
                });

                const subtotal = items.reduce((sum, item) => {
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
                const originalCreatedAt = (salesData ?? []).reduce<string>((earliest, row: any) => {
                    if (!row?.created_at) return earliest;
                    if (!earliest) return row.created_at;
                    return new Date(row.created_at).getTime() < new Date(earliest).getTime() ? row.created_at : earliest;
                }, '');

                setBillData({
                    id: billId,
                    account_id: firstItem.account_id,
                    date: firstItem.sale_date || originalCreatedAt || firstItem.created_at,
                    created_at: originalCreatedAt || firstItem.created_at, // full timestamp — frozen at first save
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
                });

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
            // Compute net + GST + total — respects account-level gst_enabled / gst_type
            const netAmount = Math.round(addRate * addQty * 100) / 100;
            let gstAmount = 0;
            let totalPrice = netAmount;
            if (taxSettings.gst_enabled) {
                gstAmount = Math.round(((netAmount * addGst) / 100) * 100) / 100;
                if (taxSettings.gst_type === 'inclusive') {
                    // Price already includes GST; total stays = net, gst is informational
                    totalPrice = netAmount;
                } else {
                    // Exclusive: GST adds on top
                    totalPrice = Math.round((netAmount + gstAmount) * 100) / 100;
                }
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
                discount_percentage: billData.discount_percentage || 0,
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
    // Use the ORIGINAL creation timestamp (frozen at first save) for both the date and the
    // full date+time. Reprinting days later still shows the moment the bill was first recorded.
    const billCreatedAt = new Date(billData.created_at);
    const invoiceDate = billCreatedAt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const billTimestamp = billCreatedAt.toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

    return (
        <div className="min-h-screen bg-gray-100 p-4 print:p-0 print:bg-white overflow-x-auto print:overflow-visible">
            {/* No-print controls */}
            <div className="max-w-[148mm] mx-auto mb-4 flex flex-wrap justify-between items-center gap-2 print:hidden">
                <Button variant="outline" onClick={() => navigate('/sales')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Sales
                </Button>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => navigate(`/sales/new?edit=${billId}`)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                    </Button>
                    <Button onClick={async () => {
                        // Stamp printed_at so the sale is locked from further edits.
                        // Silently ignored if the migration isn't applied yet.
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
                        Print Bill
                    </Button>
                </div>
            </div>

            {/* Bill Container - A5 Portrait */}
            <div
                id="bill-container"
                style={{
                    width: '148mm',
                    height: '210mm',
                    margin: '0 auto',
                    background: '#fff',
                    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                    fontSize: '8.5pt',
                    lineHeight: '1.3',
                    color: '#1a1a1a',
                    position: 'relative',
                    boxSizing: 'border-box',
                    padding: '4mm 5mm 4mm 5mm',
                    textRendering: 'optimizeLegibility',
                }}
            >
                <style>
                    {`
            @page {
              size: A5 portrait;
              margin: 0;
            }
            @media print {
              body, html {
                width: 148mm;
                height: 210mm;
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
              border: 0.5px solid #444;
              padding: 2px;
              vertical-align: middle;
            }
            .bill-table th {
              background: #f0f0f0;
              font-weight: 700;
              font-size: 9pt;
              text-transform: uppercase;
              letter-spacing: 0.2px;
              text-align: center;
              white-space: nowrap;
            }
            .bill-table td {
              font-size: 8pt;
            }
          `}
                </style>

                <div style={{ border: '1px solid #444' }}>
                {/* ===== HEADER ZONE ===== */}
                <div>
                    {/* Top row: Logo + Business + Invoice */}
                    <div style={{ display: 'flex', borderBottom: '1px solid #444' }}>
                        {/* Left: Logo + Business Info */}
                        <div style={{ flex: '1.2', display: 'flex', borderRight: '1px solid #444', padding: '2mm' }}>
                            {/* Logo */}
                            <div style={{ width: '16mm', minHeight: '16mm', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '3mm' }}>
                                <img
                                    src="/medstocksy-logo.png"
                                    alt="Logo"
                                    style={{ width: '14mm', height: '14mm', objectFit: 'contain' }}
                                />
                            </div>
                            {/* Business details */}
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '6.5pt', color: '#555', fontWeight: 600, marginBottom: '1px', letterSpacing: '0.5px' }}>BILL OF SUPPLY</div>
                                <div style={{ fontSize: '12pt', fontWeight: 800, color: '#1a3a5c', lineHeight: '1.1', textTransform: 'uppercase' }}>
                                    {businessDetails?.name || 'PHARMA'}
                                </div>
                                <div style={{ fontSize: '7pt', marginTop: '2px', color: '#444', lineHeight: '1.4' }}>
                                    {businessDetails?.address && <div>{businessDetails.address}</div>}
                                    {businessDetails?.phone && <div>CONTACT: {businessDetails.phone}</div>}
                                    {businessDetails?.gstin && <div>GSTIN: {businessDetails.gstin}</div>}
                                </div>
                            </div>
                        </div>

                        {/* Right: Invoice Details */}
                        <div style={{ flex: '1', padding: '2mm' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2mm' }}>
                                <div style={{ fontSize: '10pt', fontWeight: 700, color: '#1a3a5c' }}>
                                    Invoice/{invoiceNumber}
                                </div>
                                <div style={{ fontSize: '8pt', fontWeight: 600, textAlign: 'right' }}>
                                    {invoiceDate}
                                </div>
                            </div>
                            <div style={{ fontSize: '7pt', lineHeight: '1.6', color: '#333' }}>
                                <div style={{ display: 'flex' }}>
                                    <span style={{ width: '16mm', fontWeight: 600 }}>PARTY:</span>
                                    <span>{billData.customer_name || 'Walk-in'}</span>
                                </div>
                                {billData.customer_address && (
                                    <div style={{ display: 'flex' }}>
                                        <span style={{ width: '16mm', fontWeight: 600 }}>ADDRESS:</span>
                                        <span>{billData.customer_address}</span>
                                    </div>
                                )}
                                {billData.customer_phone && (
                                    <div style={{ display: 'flex' }}>
                                        <span style={{ width: '16mm', fontWeight: 600 }}>CONTACT:</span>
                                        <span>{billData.customer_phone}</span>
                                    </div>
                                )}
                                {!billData.customer_address && (
                                    <div style={{ display: 'flex' }}>
                                        <span style={{ width: '16mm', fontWeight: 600 }}>ADDRESS</span>
                                        <span>-</span>
                                    </div>
                                )}
                                {!billData.customer_phone && (
                                    <div style={{ display: 'flex' }}>
                                        <span style={{ width: '16mm', fontWeight: 600 }}>CONTACT</span>
                                        <span>-</span>
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

                                // CGST & SGST amounts
                                const cgstAmt = (item.gst_amount || 0) / 2;
                                const sgstAmt = (item.gst_amount || 0) / 2;

                                const mrp = item.selling_price || item.unit_price;
                                const gstPerUnit = (item.gst_amount || 0) / effectiveQty;
                                const rate = mrp - gstPerUnit;

                                return (
                                    <tr key={item.id}>
                                        <td style={{ textAlign: 'center' }}>{index + 1}</td>
                                        <td style={{ textAlign: 'left', fontWeight: 600, wordWrap: 'break-word' }}>{item.product_name}</td>
                                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.hsn}</td>
                                        <td style={{ textAlign: 'center', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.batch_number}</td>
                                        <td style={{ textAlign: 'center' }}>{item.expiry}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            {item.sub_qty ? (
                                                <span>{item.quantity}<span style={{ fontSize: '0.8em', color: '#1565c0' }}>+{item.sub_qty}</span></span>
                                            ) : (
                                                item.quantity
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>{mrp.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right' }}>{rate.toFixed(2)}</td>
                                        <td style={{ textAlign: 'center', fontSize: '6.5pt' }}>{item.discount_percentage ? item.discount_percentage + '%' : '-'}</td>
                                        <td style={{ textAlign: 'right', fontSize: '6.5pt' }}>{cgstAmt > 0 ? cgstAmt.toFixed(2) : '-'}</td>
                                        <td style={{ textAlign: 'right', fontSize: '6.5pt' }}>{sgstAmt > 0 ? sgstAmt.toFixed(2) : '-'}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{item.total_price.toFixed(2)}</td>
                                    </tr>
                                );
                            })}
                            {/* Empty rows to fill minimum space */}
                            {billData.items.length < 5 && Array.from({ length: 5 - billData.items.length }).map((_, i) => (
                                <tr key={`empty-${i}`}>
                                    <td style={{ height: '24px' }}>&nbsp;</td>
                                    <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* ===== FOOTER ZONE - PAYMENT & AUDIT ===== */}
                <div style={{ borderBottom: '1px solid #444' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        {/* Left: Payment Mode + Terms */}
                        <div style={{ flex: '1.3', borderRight: '1px solid #444', padding: '2mm', fontSize: '7pt', lineHeight: '1.5', display: 'flex', justifyContent: 'space-between' }}>
                            <div>
                                <div style={{ marginBottom: '2mm' }}>
                                    <span style={{ fontWeight: 700 }}>Payment Mode: </span>
                                    <span style={{ textTransform: 'lowercase' }}>{billData.payment_mode}</span>
                                    <br />
                                    <span>Received with thanks.</span>
                                </div>
                                <div>
                                    <div style={{ fontWeight: 700, marginBottom: '1px' }}>Terms & Conditions:</div>
                                    <div style={{ fontSize: '6.5pt', lineHeight: '1.4', color: '#333' }}>
                                        Goods once sold will not be taken back.<br />
                                        All GST Taxes are included in MRP.<br />
                                        Subject to local jurisdiction.<br />
                                        <span style={{ color: '#0d6e3a', fontWeight: 600 }}>Get well soon!</span>
                                    </div>
                                </div>
                            </div>
                            {/* Authorized Signatory */}
                            <div style={{ paddingRight: '2mm', paddingTop: '8mm' }}>
                                <div style={{ borderTop: '0.5px solid #666', width: '28mm', textAlign: 'center', paddingTop: '1mm' }}>
                                    <span style={{ fontSize: '6pt', color: '#555' }}>Auth Sign</span>
                                </div>
                            </div>
                        </div>

                        {/* Right: Totals */}
                        <div style={{ flex: '0.7', padding: '2mm', fontSize: '7.5pt' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <tbody>
                                    <tr>
                                        <td style={{ padding: '1.5px 0', fontWeight: 600, textAlign: 'left' }}>Subtotal</td>
                                        <td style={{ padding: '1.5px 0', textAlign: 'right' }}>₹{billData.subtotal.toFixed(2)}</td>
                                    </tr>
                                    <tr>
                                        <td style={{ padding: '1.5px 0', fontWeight: 600, textAlign: 'left', color: '#0d6e3a' }}>Total Savings</td>
                                        <td style={{ padding: '1.5px 0', textAlign: 'right', color: '#0d6e3a' }}>-₹{billData.total_discount.toFixed(2)}</td>
                                    </tr>
                                    <tr>
                                        <td colSpan={2} style={{ padding: 0 }}>
                                            <div style={{ borderTop: '1.5px solid #1a1a1a', margin: '2px 0' }}></div>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style={{ padding: '2px 0', fontWeight: 800, fontSize: '9pt', textAlign: 'left' }}>TOTAL</td>
                                        <td style={{ padding: '2px 0', fontWeight: 800, fontSize: '9pt', textAlign: 'right' }}>₹{billData.total_amount.toFixed(2)}</td>
                                    </tr>
                                </tbody>
                            </table>

                        </div>
                    </div>
                </div>

                {/* ===== CONTROL STRIP ===== */}
                <div style={{
                    background: '#f5f5f5',
                    padding: '1.5mm 3mm',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '6pt',
                    color: '#555',
                }}>
                    <div style={{ fontWeight: 600 }}>
                        PRODUCTS: {totalProducts}, TOTAL QTY: {totalQty}
                    </div>
                    <div>
                        Recorded on <span style={{ fontWeight: 600 }}>{billTimestamp}</span>
                    </div>
                    <div style={{ fontStyle: 'italic' }}>
                        Powered by <span style={{ fontWeight: 600 }}>medstocksy.in</span>
                    </div>
                </div>
                </div>
            </div>
        </div>
    );
}
