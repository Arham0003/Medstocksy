import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { RotateCcw, Search, Eye } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Sale {
    id: string;
    product_id: string;
    quantity: number;
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

    const fetchData = async () => {
        try {
            // Fetch all sales (both positive and negative)
            const allSalesRes = await supabase
                .from('sales')
                .select(`
          id, product_id, quantity, unit_price, total_price, gst_amount, created_at,
          customer_name, customer_phone,
          products(name)
        `)
                .eq('account_id', profile?.account_id)
                .order('created_at', { ascending: false });

            if (allSalesRes.error) throw allSalesRes.error;

            const allSales = allSalesRes.data || [];

            // Separate sales and returns
            const positiveSales = allSales.filter(s => s.quantity > 0);
            const negativeReturns = allSales.filter(s => s.quantity < 0);

            // Simply show all positive sales (actual sales, not returns)
            // Filter out any that have been fully returned by checking if a matching negative entry exists
            setSales(positiveSales);

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

        if (!selectedSale || returnQuantity <= 0) {
            toast({
                variant: "destructive",
                title: "Invalid return",
                description: "Please select a valid quantity to return",
            });
            return;
        }

        if (returnQuantity > selectedSale.quantity) {
            toast({
                variant: "destructive",
                title: "Invalid quantity",
                description: `Cannot return more than ${selectedSale.quantity} items`,
            });
            return;
        }

        try {
            // Calculate return amount proportionally
            const returnAmount = (selectedSale.unit_price * returnQuantity);
            const returnGstAmount = selectedSale.gst_amount
                ? (selectedSale.gst_amount * returnQuantity) / selectedSale.quantity
                : 0;
            const totalReturnAmount = returnAmount + returnGstAmount;

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

            // Manually update product stock as a fallback
            // This ensures stock is updated even if the trigger doesn't fire
            try {
                const { data: productData, error: productError } = await supabase
                    .from('products')
                    .select('quantity')
                    .eq('id', selectedSale.product_id)
                    .single();

                if (!productError && productData) {
                    const newQuantity = productData.quantity + returnQuantity;
                    
                    const { error: updateError } = await supabase
                        .from('products')
                        .update({ quantity: newQuantity })
                        .eq('id', selectedSale.product_id);

                    if (updateError) {
                        console.error('Error updating product stock:', updateError);
                    } else {
                        console.log(`Stock updated manually: ${productData.quantity} -> ${newQuantity}`);
                    }
                }
            } catch (stockError) {
                console.error('Error in manual stock update:', stockError);
            }

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
        }
    };

    const filteredSales = sales.filter(sale =>
        sale.products?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sale.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sale.id.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                <div>
                    <h1 className="text-4xl font-bold bg-gradient-to-r from-red-600 to-orange-600 bg-clip-text text-transparent">
                        Sales Returns
                    </h1>
                    <p className="text-muted-foreground text-lg mt-2">
                        Process returns and refunds for sold items
                    </p>
                </div>
                <div className="relative w-full sm:w-80">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
                    <Input
                        placeholder="Search sales..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                    />
                </div>
            </div>

            {/* Recent Returns */}
            {returns.length > 0 && (
                <Card className="shadow-xl border-0 bg-gradient-to-br from-white to-red-50">
                    <CardHeader>
                        <CardTitle className="text-2xl font-bold text-red-700">Recent Returns</CardTitle>
                        <CardDescription className="text-lg">
                            {returns.length} return(s) processed
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-xl border-0 bg-white shadow-lg overflow-hidden">
                            <Table>
                                <TableHeader className="bg-gradient-to-r from-red-50 to-orange-50">
                                    <TableRow>
                                        <TableHead className="text-lg font-bold text-gray-700">Product</TableHead>
                                        <TableHead className="text-lg font-bold text-gray-700">Customer</TableHead>
                                        <TableHead className="text-lg font-bold text-gray-700">Quantity</TableHead>
                                        <TableHead className="text-lg font-bold text-gray-700">Amount</TableHead>
                                        <TableHead className="text-lg font-bold text-gray-700">Date</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {returns.map((returnItem) => (
                                        <TableRow key={returnItem.id} className="hover:bg-red-50">
                                            <TableCell className="font-medium text-lg">{returnItem.products?.name}</TableCell>
                                            <TableCell className="text-lg">{returnItem.sales?.customer_name || 'Walk-in'}</TableCell>
                                            <TableCell className="text-lg">{returnItem.return_quantity}</TableCell>
                                            <TableCell className="text-lg text-red-600">-₹{returnItem.return_amount.toFixed(2)}</TableCell>
                                            <TableCell className="text-lg">{new Date(returnItem.created_at).toLocaleDateString()}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Sales Available for Return */}
            <Card className="shadow-xl border-0 bg-gradient-to-br from-white to-gray-50">
                <CardHeader>
                    <CardTitle className="text-2xl font-bold">Recent Sales</CardTitle>
                    <CardDescription className="text-lg">
                        Select a sale to process a return
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center py-12">
                            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-red-600 mx-auto"></div>
                            <p className="mt-4 text-muted-foreground text-lg">Loading sales...</p>
                        </div>
                    ) : filteredSales.length === 0 ? (
                        <div className="text-center py-16">
                            <RotateCcw className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                            <h3 className="text-2xl font-bold mb-2">No Sales Found</h3>
                            <p className="text-muted-foreground text-lg">
                                No sales available for returns
                            </p>
                        </div>
                    ) : (
                        <div className="rounded-xl border-0 bg-white shadow-lg overflow-hidden">
                            <Table>
                                <TableHeader className="bg-gradient-to-r from-gray-50 to-blue-50">
                                    <TableRow>
                                        <TableHead className="text-lg font-bold text-gray-700">Product</TableHead>
                                        <TableHead className="text-lg font-bold text-gray-700">Customer</TableHead>
                                        <TableHead className="text-lg font-bold text-gray-700">Quantity</TableHead>
                                        <TableHead className="text-lg font-bold text-gray-700">Amount</TableHead>
                                        <TableHead className="text-lg font-bold text-gray-700">Date</TableHead>
                                        <TableHead className="text-lg font-bold text-gray-700">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredSales.map((sale) => (
                                        <TableRow key={sale.id} className="hover:bg-blue-50">
                                            <TableCell className="font-medium text-lg">{sale.products?.name}</TableCell>
                                            <TableCell className="text-lg">{sale.customer_name || 'Walk-in'}</TableCell>
                                            <TableCell className="text-lg">
                                                {sale.quantity}
                                            </TableCell>
                                            <TableCell className="text-lg">₹{sale.total_price.toFixed(2)}</TableCell>
                                            <TableCell className="text-lg">{new Date(sale.created_at).toLocaleDateString()}</TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        setSelectedSale(sale);
                                                        setReturnQuantity(1);
                                                        setReturnReason('');
                                                        setIsReturnDialogOpen(true);
                                                    }}
                                                    className="text-red-600 border-red-200 hover:bg-red-50"
                                                >
                                                    <RotateCcw className="h-4 w-4 mr-1" />
                                                    Return
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Return Dialog */}
            <Dialog open={isReturnDialogOpen} onOpenChange={setIsReturnDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-2xl text-red-700">Process Return</DialogTitle>
                        <DialogDescription className="text-lg">
                            {selectedSale && `Return items for: ${selectedSale.products?.name}`}
                        </DialogDescription>
                    </DialogHeader>
                    {selectedSale && (
                        <form onSubmit={handleReturn} className="space-y-6">
                            <div className="space-y-4">
                                <div className="p-4 bg-gray-50 rounded-lg">
                                    <h4 className="font-medium text-lg mb-2">Sale Details</h4>
                                    <p className="text-sm text-muted-foreground">Product: {selectedSale.products?.name}</p>
                                    <p className="text-sm text-muted-foreground">Quantity Sold: {selectedSale.quantity}</p>
                                    <p className="text-sm text-muted-foreground">Unit Price: ₹{selectedSale.unit_price.toFixed(2)}</p>
                                    <p className="text-sm text-muted-foreground">Total: ₹{selectedSale.total_price.toFixed(2)}</p>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="returnQuantity">Return Quantity (Max: {selectedSale.quantity})</Label>
                                    <Input
                                        id="returnQuantity"
                                        type="number"
                                        min="1"
                                        max={selectedSale.quantity}
                                        value={returnQuantity}
                                        onChange={(e) => setReturnQuantity(parseInt(e.target.value) || 1)}
                                        className="text-lg"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="returnReason">Reason (Optional)</Label>
                                    <Textarea
                                        id="returnReason"
                                        value={returnReason}
                                        onChange={(e) => setReturnReason(e.target.value)}
                                        placeholder="Enter reason for return..."
                                        className="text-lg"
                                    />
                                </div>

                                <div className="p-4 bg-red-50 rounded-lg">
                                    <h4 className="font-medium text-lg mb-2 text-red-700">Return Summary</h4>
                                    <p className="text-sm">Quantity: {returnQuantity}</p>
                                    <p className="text-sm">Refund Amount: ₹{(selectedSale.unit_price * returnQuantity + (selectedSale.gst_amount || 0) * returnQuantity / selectedSale.quantity).toFixed(2)}</p>
                                </div>
                            </div>

                            <div className="flex gap-4">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsReturnDialogOpen(false)}
                                    className="flex-1"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    className="flex-1 bg-red-600 hover:bg-red-700"
                                >
                                    <RotateCcw className="h-4 w-4 mr-2" />
                                    Process Return
                                </Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}