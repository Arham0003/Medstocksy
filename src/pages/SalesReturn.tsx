import { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { RotateCcw, Search, ShoppingCart, Wallet, CalendarDays, Plus, Minus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { cn, formatINR } from '@/lib/utils';
import { TableSkeleton } from '@/components/TableSkeleton';

interface Sale {
    id: string;
    product_id: string;
    quantity: number;
    sub_qty?: number | null;
    pcs_per_unit?: number | null;
    unit_price: number;
    total_price: number;
    gst_amount: number | null;
    created_at: string;
    customer_name?: string | null;
    customer_phone?: string | null;
    products: {
        name: string;
    };
    totalReturned?: number;
    remainingQuantity?: number;
}

interface Return {
    id: string;
    original_sale_id: string;
    product_id: string;
    return_quantity: number;
    return_amount: number;
    reason: string;
    created_at: string;
    products: {
        name: string;
    };
    sales: {
        customer_name?: string | null;
    };
}

export default function SalesReturn() {
    const { profile } = useAuth();
    const { toast } = useToast();
    const [sales, setSales] = useState<Sale[]>([]);
    const [returns, setReturns] = useState<Return[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
    const [returnQuantity, setReturnQuantity] = useState(1);
    const [returnReason, setReturnReason] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    const fetchData = async () => {
        try {
            // Fetch all sales (both positive and negative)
            const allSalesRes = await supabase
                .from('sales')
                .select(`
          id, product_id, quantity, sub_qty, pcs_per_unit, unit_price, total_price, gst_amount, created_at,
          customer_name, customer_phone,
          products(name)
        `)
                .eq('account_id', profile?.account_id)
                .order('created_at', { ascending: false });

            if (allSalesRes.error) throw allSalesRes.error;

            // Cast to any[] to bypass TypeScript errors for sub_qty/pcs_per_unit columns
            const allSales = (allSalesRes.data || []) as any[];

            // Separate sales and returns
            const positiveSales = allSales.filter(s => s.quantity > 0);
            const negativeReturns = allSales.filter(s => s.quantity < 0);

            // Simply show all positive sales (actual sales, not returns)
            // Filter out any that have been fully returned by checking if a matching negative entry exists
            setSales(positiveSales as unknown as Sale[]);

            // Transform negative sales to returns format for display
            const transformedReturns = negativeReturns.map(item => ({
                id: item.id,
                original_sale_id: '',
                product_id: item.product_id,
                return_quantity: Math.abs(item.quantity),
                return_amount: Math.abs(item.total_price),
                reason: 'Return',
                created_at: item.created_at,
                products: item.products,
                sales: { customer_name: item.customer_name }
            }));

            setReturns(transformedReturns);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error fetching data",
                description: error.message,
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (profile?.account_id) {
            fetchData();
        }
    }, [profile?.account_id]);

    const handleReturn = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!selectedSale || returnQuantity <= 0 || isProcessing) {
            if (!isProcessing && (!selectedSale || returnQuantity <= 0)) {
                toast({
                    variant: "destructive",
                    title: "Invalid return",
                    description: "Please select a valid quantity to return",
                });
            }
            return;
        }

        setIsProcessing(true);

        // Calculate the effective total quantity (strips + loose tablets as fraction)
        const hasSub = selectedSale.sub_qty && selectedSale.pcs_per_unit && selectedSale.pcs_per_unit > 0;
        const effectiveQty = hasSub
          ? selectedSale.quantity + (selectedSale.sub_qty! / selectedSale.pcs_per_unit!)
          : selectedSale.quantity;
        const maxReturnQty = selectedSale.quantity;

        if (returnQuantity > maxReturnQty) {
            toast({
                variant: "destructive",
                title: "Invalid quantity",
                description: `Cannot return more than ${maxReturnQty} items`,
            });
            return;
        }

        try {
            // Calculate return amount proportionally based on effective quantity
            const hasSub = selectedSale.sub_qty && selectedSale.pcs_per_unit && selectedSale.pcs_per_unit > 0;
            const effectiveQty = hasSub
              ? selectedSale.quantity + (selectedSale.sub_qty! / selectedSale.pcs_per_unit!)
              : selectedSale.quantity;
            const totalReturnAmount = (selectedSale.total_price * returnQuantity) / effectiveQty;
            const returnGstAmount = selectedSale.gst_amount
                ? (selectedSale.gst_amount * returnQuantity) / effectiveQty
                : 0;

            // Create a negative sales entry to represent the return
            const returnEntry = {
                account_id: profile?.account_id,
                product_id: selectedSale.product_id,
                user_id: profile?.id,
                quantity: -returnQuantity, // Negative quantity indicates return
                unit_price: selectedSale.unit_price,
                total_price: -totalReturnAmount, // Negative total
                gst_amount: -returnGstAmount,
                customer_name: selectedSale.customer_name,
                customer_phone: selectedSale.customer_phone,
            };

            const { data, error } = await supabase.from('sales').insert([returnEntry]).select();

            if (error) {
                console.error('Error inserting return:', error);
                throw error;
            }

            console.log('Return inserted successfully:', data);
            console.log('Return entry details:', returnEntry);

            toast({
                title: "Return processed",
                description: `Successfully returned ${returnQuantity} item(s) for ₹${totalReturnAmount.toFixed(2)}. Stock has been updated.`,
            });

            // Reset form and close dialog
            setIsReturnDialogOpen(false);
            setSelectedSale(null);
            setReturnQuantity(1);
            setReturnReason('');

            // Refresh data
            fetchData();
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error processing return",
                description: error.message,
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const deferredSearch = useDeferredValue(searchTerm);

    const filteredSales = useMemo(() => {
        const q = deferredSearch.trim().toLowerCase();
        if (!q) return sales;
        return sales.filter(sale =>
            sale.products?.name.toLowerCase().includes(q) ||
            sale.customer_name?.toLowerCase().includes(q) ||
            sale.id.toLowerCase().includes(q)
        );
    }, [sales, deferredSearch]);

    // Stats for the KPI strip
    const stats = useMemo(() => {
        const totalRefund = returns.reduce((sum, r) => sum + (r.return_amount || 0), 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const returnsToday = returns.filter(r => new Date(r.created_at) >= today).length;
        return {
            eligibleSales: sales.length,
            returnsProcessed: returns.length,
            totalRefund,
            returnsToday,
        };
    }, [sales, returns]);

    // Reason quick-pick chips for the return dialog
    const REASON_PRESETS = ['Damaged', 'Expired', 'Wrong dose', 'Customer changed mind', 'Doctor changed prescription'];
    const reasonIsFromPreset = REASON_PRESETS.includes(returnReason);

    // Refund preview for the currently-selected sale
    const refundPreview = useMemo(() => {
        if (!selectedSale) return { amount: 0, gst: 0 };
        const hasSub = selectedSale.sub_qty && selectedSale.pcs_per_unit && selectedSale.pcs_per_unit > 0;
        const effectiveQty = hasSub
            ? selectedSale.quantity + (selectedSale.sub_qty! / selectedSale.pcs_per_unit!)
            : selectedSale.quantity;
        const safe = Math.max(returnQuantity, 0);
        const amount = (selectedSale.total_price * safe) / effectiveQty;
        const gst = selectedSale.gst_amount ? (selectedSale.gst_amount * safe) / effectiveQty : 0;
        return { amount, gst };
    }, [selectedSale, returnQuantity]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Sales Returns</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Process returns, refund customers, and restore stock automatically.
                    </p>
                </div>
                <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                        placeholder="Search by product, customer, bill…"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 h-9"
                    />
                </div>
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-md border bg-card p-3 flex items-center gap-3">
                    <div className="p-2 rounded-md bg-blue-50 text-blue-600 shrink-0">
                        <ShoppingCart className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Eligible Sales</p>
                        <p className="text-base font-semibold mt-0.5">{loading ? '—' : stats.eligibleSales}</p>
                    </div>
                </div>
                <div className="rounded-md border bg-card p-3 flex items-center gap-3">
                    <div className="p-2 rounded-md bg-amber-50 text-amber-600 shrink-0">
                        <RotateCcw className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Returns Processed</p>
                        <p className="text-base font-semibold mt-0.5">{loading ? '—' : stats.returnsProcessed}</p>
                    </div>
                </div>
                <div className="rounded-md border bg-card p-3 flex items-center gap-3">
                    <div className="p-2 rounded-md bg-red-50 text-red-600 shrink-0">
                        <Wallet className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Refund Amount</p>
                        <p className="text-base font-semibold text-red-700 mt-0.5 truncate">{loading ? '—' : formatINR(stats.totalRefund)}</p>
                    </div>
                </div>
                <div className="rounded-md border bg-card p-3 flex items-center gap-3">
                    <div className="p-2 rounded-md bg-emerald-50 text-emerald-600 shrink-0">
                        <CalendarDays className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Returns Today</p>
                        <p className="text-base font-semibold mt-0.5">{loading ? '—' : stats.returnsToday}</p>
                    </div>
                </div>
            </div>

            {/* Sales available for return — primary action area */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg font-semibold">Sales Available for Return</CardTitle>
                    <CardDescription className="text-sm">
                        {loading ? 'Loading…' : `${filteredSales.length} sale${filteredSales.length === 1 ? '' : 's'} eligible.`}
                    </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                    {loading ? (
                        <TableSkeleton rows={6} cols={['w-24', 'w-40', 'w-16', 'w-24', 'w-20', 'w-16']} />
                    ) : filteredSales.length === 0 ? (
                        <div className="text-center py-12 border border-dashed rounded-md">
                            <div className="bg-muted/50 p-4 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-3">
                                {searchTerm ? <Search className="h-6 w-6 text-muted-foreground" /> : <RotateCcw className="h-6 w-6 text-muted-foreground" />}
                            </div>
                            <h3 className="text-base font-semibold mb-1">{searchTerm ? 'No matches' : 'No sales available'}</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                {searchTerm
                                    ? 'Try a different product, customer, or bill ID.'
                                    : 'Recorded sales will appear here once made.'}
                            </p>
                            {searchTerm && (
                                <Button variant="outline" size="sm" onClick={() => setSearchTerm('')}>
                                    Clear search
                                </Button>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* Mobile: card list */}
                            <div className="md:hidden space-y-2">
                                {filteredSales.map((sale) => (
                                    <div key={sale.id} className="rounded-md border bg-card p-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium truncate">{sale.products?.name}</p>
                                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                                    {sale.customer_name || 'Walk-in customer'} · {new Date(sale.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                                </p>
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-8 text-xs shrink-0 text-red-600 border-red-200 hover:bg-red-50"
                                                onClick={() => {
                                                    setSelectedSale(sale);
                                                    setReturnQuantity(1);
                                                    setReturnReason('');
                                                    setIsReturnDialogOpen(true);
                                                }}
                                            >
                                                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Return
                                            </Button>
                                        </div>
                                        <div className="flex items-end justify-between gap-2 mt-2 pt-2 border-t">
                                            <div className="text-xs text-muted-foreground">
                                                {sale.quantity} {sale.quantity === 1 ? 'strip' : 'strips'}
                                                {sale.sub_qty ? <span className="text-blue-600 ml-1">+{sale.sub_qty} tabs</span> : null}
                                            </div>
                                            <div className="text-sm font-semibold">{formatINR(sale.total_price)}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Desktop: table */}
                            <div className="hidden md:block rounded-md border overflow-hidden">
                                <div className="max-h-[560px] overflow-y-auto">
                                    <Table>
                                        <TableHeader className="bg-muted/40 sticky top-0 z-10">
                                            <TableRow className="hover:bg-transparent">
                                                <TableHead className="font-medium">Product</TableHead>
                                                <TableHead className="hidden lg:table-cell font-medium">Customer</TableHead>
                                                <TableHead className="hidden md:table-cell font-medium text-center">Qty</TableHead>
                                                <TableHead className="font-medium text-right">Amount</TableHead>
                                                <TableHead className="hidden lg:table-cell font-medium">Date</TableHead>
                                                <TableHead className="font-medium text-right w-28"><span className="sr-only">Actions</span></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {filteredSales.map((sale) => (
                                                <TableRow key={sale.id}>
                                                    <TableCell className="py-2.5 font-medium">{sale.products?.name}</TableCell>
                                                    <TableCell className="hidden lg:table-cell py-2.5 text-sm">{sale.customer_name || 'Walk-in'}</TableCell>
                                                    <TableCell className="hidden md:table-cell py-2.5 text-sm text-center">
                                                        {sale.quantity}
                                                        {sale.sub_qty ? <span className="text-[10px] text-blue-600 ml-1">+{sale.sub_qty}</span> : null}
                                                    </TableCell>
                                                    <TableCell className="py-2.5 text-right font-semibold">{formatINR(sale.total_price)}</TableCell>
                                                    <TableCell className="hidden lg:table-cell py-2.5 text-sm">{new Date(sale.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</TableCell>
                                                    <TableCell className="py-2.5 text-right">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50"
                                                            onClick={() => {
                                                                setSelectedSale(sale);
                                                                setReturnQuantity(1);
                                                                setReturnReason('');
                                                                setIsReturnDialogOpen(true);
                                                            }}
                                                        >
                                                            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Return
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Recent Returns — secondary, shown below */}
            {returns.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg font-semibold flex items-center gap-2">
                            <RotateCcw className="h-4 w-4 text-red-600" />
                            Recent Returns
                        </CardTitle>
                        <CardDescription className="text-sm">
                            {returns.length} return{returns.length === 1 ? '' : 's'} processed · total refunded {formatINR(stats.totalRefund)}.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {/* Mobile: card list */}
                        <div className="md:hidden space-y-2">
                            {returns.map((r) => (
                                <div key={r.id} className="rounded-md border bg-card p-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium truncate">{r.products?.name}</p>
                                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                                {r.sales?.customer_name || 'Walk-in'} · {new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                            </p>
                                            {r.reason && (
                                                <p className="text-[11px] text-muted-foreground mt-0.5 italic truncate">"{r.reason}"</p>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-sm font-semibold text-red-600 whitespace-nowrap">−{formatINR(r.return_amount)}</p>
                                            <p className="text-[10px] text-muted-foreground">{r.return_quantity} unit{r.return_quantity === 1 ? '' : 's'}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Desktop: table */}
                        <div className="hidden md:block rounded-md border overflow-hidden">
                            <div className="max-h-[400px] overflow-y-auto">
                                <Table>
                                    <TableHeader className="bg-muted/40 sticky top-0 z-10">
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className="font-medium">Product</TableHead>
                                            <TableHead className="hidden lg:table-cell font-medium">Customer</TableHead>
                                            <TableHead className="font-medium text-center">Qty</TableHead>
                                            <TableHead className="hidden lg:table-cell font-medium">Reason</TableHead>
                                            <TableHead className="font-medium text-right">Refund</TableHead>
                                            <TableHead className="hidden md:table-cell font-medium">Date</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {returns.map((r) => (
                                            <TableRow key={r.id}>
                                                <TableCell className="py-2.5 font-medium">{r.products?.name}</TableCell>
                                                <TableCell className="hidden lg:table-cell py-2.5 text-sm">{r.sales?.customer_name || 'Walk-in'}</TableCell>
                                                <TableCell className="py-2.5 text-sm text-center">{r.return_quantity}</TableCell>
                                                <TableCell className="hidden lg:table-cell py-2.5 text-sm text-muted-foreground italic">{r.reason || '—'}</TableCell>
                                                <TableCell className="py-2.5 text-right font-semibold text-red-600">−{formatINR(r.return_amount)}</TableCell>
                                                <TableCell className="hidden md:table-cell py-2.5 text-sm">{new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Return Dialog */}
            <Dialog open={isReturnDialogOpen} onOpenChange={setIsReturnDialogOpen}>
                <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6">
                    <DialogHeader className="pr-8 space-y-1">
                        <DialogTitle className="text-lg flex items-center gap-2">
                            <RotateCcw className="h-4 w-4 text-red-600" />
                            Process Return
                        </DialogTitle>
                        <DialogDescription className="text-sm">
                            {selectedSale ? `Refunds ${selectedSale.products?.name} and restores stock automatically.` : null}
                        </DialogDescription>
                    </DialogHeader>
                    {selectedSale && (
                        <form onSubmit={handleReturn} className="space-y-4 mt-3">
                            {/* Sale info band */}
                            <div className="rounded-md border bg-muted/30 p-3">
                                <p className="text-sm font-semibold truncate">{selectedSale.products?.name}</p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {selectedSale.customer_name || 'Walk-in customer'}
                                    {selectedSale.customer_phone ? ` · ${selectedSale.customer_phone}` : ''}
                                </p>
                                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border/60">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Sold</p>
                                        <p className="text-sm font-medium mt-0.5">
                                            {selectedSale.quantity}
                                            {selectedSale.sub_qty ? <span className="text-[10px] text-blue-600 ml-1">+{selectedSale.sub_qty}</span> : null}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Unit ₹</p>
                                        <p className="text-sm font-medium mt-0.5">{formatINR(selectedSale.unit_price)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Paid</p>
                                        <p className="text-sm font-medium mt-0.5">{formatINR(selectedSale.total_price)}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Quantity stepper */}
                            <div className="space-y-1.5">
                                <Label htmlFor="returnQuantity" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Return quantity (max {selectedSale.quantity})
                                </Label>
                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-9 w-9 shrink-0"
                                        onClick={() => setReturnQuantity(q => Math.max(1, q - 1))}
                                        disabled={returnQuantity <= 1}
                                        aria-label="Decrease quantity"
                                    >
                                        <Minus className="h-4 w-4" />
                                    </Button>
                                    <Input
                                        id="returnQuantity"
                                        type="number"
                                        inputMode="numeric"
                                        min="1"
                                        max={selectedSale.quantity}
                                        value={returnQuantity}
                                        onChange={(e) => {
                                            const raw = parseInt(e.target.value) || 1;
                                            setReturnQuantity(Math.max(1, Math.min(selectedSale.quantity, raw)));
                                        }}
                                        className="h-9 text-center font-medium"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-9 w-9 shrink-0"
                                        onClick={() => setReturnQuantity(q => Math.min(selectedSale.quantity, q + 1))}
                                        disabled={returnQuantity >= selectedSale.quantity}
                                        aria-label="Increase quantity"
                                    >
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-9 text-xs whitespace-nowrap"
                                        onClick={() => setReturnQuantity(selectedSale.quantity)}
                                        disabled={returnQuantity >= selectedSale.quantity}
                                    >
                                        Return all
                                    </Button>
                                </div>
                            </div>

                            {/* Reason chips + freetext */}
                            <div className="space-y-1.5">
                                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reason (optional)</Label>
                                <div className="flex flex-wrap gap-1.5">
                                    {REASON_PRESETS.map(preset => (
                                        <button
                                            key={preset}
                                            type="button"
                                            onClick={() => setReturnReason(returnReason === preset ? '' : preset)}
                                            className={cn(
                                                'h-7 px-2.5 text-xs rounded-full border transition-colors',
                                                returnReason === preset
                                                    ? 'bg-red-50 border-red-300 text-red-700 font-medium'
                                                    : 'bg-card border-border hover:bg-muted'
                                            )}
                                        >
                                            {preset}
                                        </button>
                                    ))}
                                </div>
                                <Textarea
                                    value={!reasonIsFromPreset ? returnReason : ''}
                                    onChange={(e) => setReturnReason(e.target.value)}
                                    placeholder="Or type a custom reason…"
                                    rows={2}
                                    className="resize-none mt-1"
                                />
                            </div>

                            {/* Refund preview */}
                            <div className="rounded-md border border-red-200 bg-red-50/50 p-3">
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-red-700">Refund</span>
                                    <span className="text-lg font-bold text-red-700">{formatINR(refundPreview.amount)}</span>
                                </div>
                                {refundPreview.gst > 0 && (
                                    <p className="text-[10px] text-muted-foreground mt-0.5 text-right">
                                        incl. {formatINR(refundPreview.gst)} GST reversed
                                    </p>
                                )}
                                <p className="text-[11px] text-muted-foreground mt-2">
                                    Stock for {selectedSale.products?.name} will be restored by {returnQuantity} unit{returnQuantity === 1 ? '' : 's'}.
                                </p>
                            </div>

                            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsReturnDialogOpen(false)}
                                    className="sm:w-auto"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={isProcessing}
                                    className="sm:w-auto sm:min-w-[180px] gap-2 bg-red-600 hover:bg-red-700"
                                >
                                    {isProcessing ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                                            Processing…
                                        </>
                                    ) : (
                                        <>
                                            <RotateCcw className="h-4 w-4" />
                                            Process Return
                                        </>
                                    )}
                                </Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
