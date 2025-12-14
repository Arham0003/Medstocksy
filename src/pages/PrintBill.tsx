import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Printer } from 'lucide-react';

interface SaleItem {
    id: string;
    product_id: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    gst_amount: number | null;
    product_name: string;
    batch_number?: string; // Placeholder
    hsn?: string; // Placeholder
    expiry?: string; // Placeholder
    discount_percentage?: number;
}

interface BillData {
    id: string; // bill_id
    date: string;
    customer_name: string | null;
    customer_phone: string | null;
    customer_address: string | null;
    doctor_name: string | null; // From prescription notes or new field? Using notes for now
    items: SaleItem[];
    subtotal: number;
    total_gst: number;
    total_discount: number;
    total_amount: number;
    payment_mode: string;
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
            id, product_id, quantity, unit_price, total_price, gst_amount, created_at,
            customer_name, customer_phone, customer_address, prescription_notes, payment_mode, account_id, discount_percentage,
            products(name)
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
                const items: SaleItem[] = itemsData.map((item: any) => ({
                    id: item.id,
                    product_id: item.product_id,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    total_price: item.total_price,
                    gst_amount: item.gst_amount,
                    product_name: item.products?.name || 'Unknown Product',
                    discount_percentage: item.discount_percentage || 0,
                }));

                const subtotal = items.reduce((sum, item) => sum + (item.total_price - (item.gst_amount || 0)), 0);
                const total_gst = items.reduce((sum, item) => sum + (item.gst_amount || 0), 0);

                // Calculate total discount
                // The item.unit_price is the discounted price? No, usually unit_price is base price. 
                // Let's check how Sales.tsx saves it.
                // In Sales.tsx: unit_price = productPrices[item.id] || product.selling_price;
                // total_price = finalTotalPrice (which is after discount and GST)

                // To calculate discount amount accurately, we need to reverse engineer or simpler:
                // We know the discount percentage.
                // If disc% > 0, calculate the discount amount for this item.

                const total_discount = items.reduce((sum, item) => {
                    if (!item.discount_percentage || item.discount_percentage <= 0) return sum;

                    // Reconstruct base price before discount
                    // If GST is exclusive: unit_price is base price.
                    // If GST is inclusive: unit_price is base price (Sales.tsx: unit_price = selling_price).

                    // Actually, Sales.tsx saves unit_price as the price BEFORE discount adjustments but AFTER user override.

                    const itemTotalBase = item.unit_price * item.quantity;
                    const discountAmount = (itemTotalBase * item.discount_percentage) / 100;
                    return sum + discountAmount;
                }, 0);

                const total_amount = items.reduce((sum, item) => sum + item.total_price, 0);

                setBillData({
                    id: billId,
                    date: firstItem.created_at,
                    customer_name: firstItem.customer_name,
                    customer_phone: firstItem.customer_phone,
                    customer_address: firstItem.customer_address,
                    doctor_name: firstItem.prescription_notes,
                    items,
                    subtotal,
                    total_gst,
                    total_discount,
                    total_amount,
                    payment_mode: firstItem.payment_mode || 'Cash',
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

    return (
        <div className="min-h-screen bg-gray-100 p-4 print:p-0 print:bg-white">
            {/* No-print controls */}
            <div className="max-w-[210mm] mx-auto mb-4 flex justify-between items-center print:hidden">
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
            <div className="mx-auto bg-white p-[10mm] print:shadow-none print:p-[10mm] w-[148mm] min-h-[210mm] text-[10pt] leading-tight font-sans">
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
              /* Hide any potential headers/footers injected by browser if possible, 
                 though margin: 0 usually handles it */
            }
          `}
                </style>

                {/* Business Header */}
                <div className="text-center border-b pb-4 mb-4">
                    <h1 className="text-xl font-bold uppercase">{businessDetails?.name || 'Pharmacy Name'}</h1>
                    <p className="whitespace-pre-wrap text-sm">{businessDetails?.address || 'Address Line 1, City'}</p>
                    <div className="flex justify-center gap-4 text-xs mt-1">
                        <span>Ph: {businessDetails?.phone || 'N/A'}</span>
                        <span>GSTIN: {businessDetails?.gstin || 'N/A'}</span>
                    </div>
                </div>

                {/* Bill Meta */}
                <div className="flex justify-between text-xs mb-4">
                    <div className="space-y-1">
                        <p><span className="font-semibold">Patient:</span> {billData.customer_name || 'Walk-in'}</p>
                        {billData.customer_phone && <p><span className="font-semibold">Ph:</span> {billData.customer_phone}</p>}
                        {billData.doctor_name && <p><span className="font-semibold">Dr:</span> {billData.doctor_name}</p>}
                    </div>
                    <div className="space-y-1 text-right">
                        <p><span className="font-semibold">Bill No:</span> {billData.id.slice(0, 8).toUpperCase()}</p>
                        <p><span className="font-semibold">Date:</span> {new Date(billData.date).toLocaleDateString()}</p>
                        <p><span className="font-semibold">Time:</span> {new Date(billData.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                </div>

                {/* Items Table */}
                <div className="mb-4">
                    <table className="w-full text-[9px]">
                        <thead>
                            <tr className="border-b-2 border-black">
                                <th className="text-left py-1 w-6">S.No</th>
                                <th className="text-left py-1">Particulars</th>
                                <th className="text-left py-1 w-12">Batch</th>
                                <th className="text-left py-1 w-10">HSN</th>
                                <th className="text-left py-1 w-12">Exp</th>
                                <th className="text-center py-1 w-8">Qty</th>
                                <th className="text-right py-1 w-12">MRP</th>
                                <th className="text-right py-1 w-10">Disc%</th>
                                <th className="text-right py-1 w-10">CGST</th>
                                <th className="text-right py-1 w-10">SGST</th>
                                <th className="text-right py-1 w-14">Net</th>
                            </tr>
                        </thead>
                        <tbody>
                            {billData.items.map((item, index) => {
                                // Calculate GST split (assuming intra-state for now, so 50-50 CGST/SGST)
                                const gstRate = (item.gst_amount && item.total_price)
                                    ? ((item.gst_amount / (item.total_price - item.gst_amount)) * 100)
                                    : 0;
                                const halfGstRate = gstRate / 2;

                                return (
                                    <tr key={item.id} className="border-b border-gray-200">
                                        <td className="py-2">{index + 1}</td>
                                        <td className="py-2 font-medium">{item.product_name}</td>
                                        <td className="py-2">-</td> {/* Batch Placeholder */}
                                        <td className="py-2">-</td> {/* HSN Placeholder */}
                                        <td className="py-2">-</td> {/* Expiry Placeholder */}
                                        <td className="py-2 text-center">{item.quantity}</td>
                                        <td className="py-2 text-right">{item.unit_price.toFixed(2)}</td>
                                        <td className="py-2 text-right">{item.discount_percentage ? item.discount_percentage + '%' : '0'}</td>
                                        <td className="py-2 text-right text-[8px]">{halfGstRate > 0 ? `${halfGstRate.toFixed(1)}%` : '-'}</td>
                                        <td className="py-2 text-right text-[8px]">{halfGstRate > 0 ? `${halfGstRate.toFixed(1)}%` : '-'}</td>
                                        <td className="py-2 text-right font-medium">{(item.total_price).toFixed(2)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Summary */}
                <div className="flex justify-end mb-6">
                    <div className="w-48 space-y-1 text-xs">
                        <div className="flex justify-between">
                            <span>Subtotal:</span>
                            <span>{billData.subtotal.toFixed(2)}</span>
                        </div>
                        {billData.total_gst > 0 && (
                            <div className="flex justify-between">
                                <span>GST:</span>
                                <span>{billData.total_gst.toFixed(2)}</span>
                            </div>
                        )}
                        {billData.total_discount > 0 && (
                            <div className="flex justify-between text-green-600">
                                <span>Discount:</span>
                                <span>- {billData.total_discount.toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between font-bold border-t border-black pt-1 text-sm">
                            <span>Net Amount:</span>
                            <span>₹{billData.total_amount.toFixed(2)}</span>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-auto pt-4 border-t border-black text-[10px] text-gray-600">
                    <div className="flex justify-between mb-2">
                        <div>
                            <p className="font-semibold">Payment Mode: {billData.payment_mode}</p>
                            <p>Received with thanks.</p>
                        </div>
                        <div className="text-right">
                            {/* Placeholder for now */}
                            <p>Authorized Signatory</p>
                        </div>
                    </div>

                    <div className="text-xs font-medium mt-4">
                        <p>Terms & Conditions:</p>
                        <ul className="list-disc pl-4 mt-1 text-[9px]">
                            <li>Goods once sold will not be taken back.</li>
                            <li>All GST Taxes are included in MRP.</li>
                            <li>Subject to local jurisdiction.</li>
                        </ul>
                    </div>

                    <div className="text-center mt-6 text-[8px] text-gray-400">
                        <p>Get well soon!</p>
                        <p>Computer Generated Invoice</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
