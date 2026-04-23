import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/db conn/supabaseClient';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Printer } from 'lucide-react';

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
    date: string;
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

    useEffect(() => {
        const fetchBillDetails = async () => {
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

                setBillData({
                    id: billId,
                    date: firstItem.sale_date || firstItem.created_at,
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
                });

            } catch (err: any) {
                console.error('Error loading bill:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchBillDetails();
    }, [billId]);

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
    const invoiceDate = new Date(billData.date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const generationTimestamp = new Date().toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

    return (
        <div className="min-h-screen bg-gray-100 p-4 print:p-0 print:bg-white">
            {/* No-print controls */}
            <div className="max-w-[148mm] mx-auto mb-4 flex justify-between items-center print:hidden">
                <Button variant="outline" onClick={() => navigate('/sales')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Sales
                </Button>
                <Button onClick={() => window.print()}>
                    <Printer className="h-4 w-4 mr-2" />
                    Print Bill
                </Button>
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
                        Generated on <span style={{ fontWeight: 600 }}>{generationTimestamp}</span>
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
