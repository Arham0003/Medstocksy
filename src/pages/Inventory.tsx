import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, Package, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  quantity: number;
  selling_price: number;
  low_stock_threshold: number;
  supplier: string;
}

export default function Inventory() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      setProducts(data || []);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error fetching inventory",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  // Memoize filtered products
  const filteredProducts = useMemo(() =>
    products.filter(product =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.category?.toLowerCase().includes(searchTerm.toLowerCase())
    ), [products, searchTerm]);

  const lowStockProducts = useMemo(() =>
    products.filter(product =>
      product.quantity <= product.low_stock_threshold
    ), [products]);

  const outOfStockProducts = useMemo(() =>
    products.filter(product =>
      product.quantity === 0
    ), [products]);

  return (
    <div className="space-y-8">
      <div className="text-center py-6">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
          Inventory Overview
        </h1>
        <p className="text-muted-foreground text-lg mt-2">
          View current stock levels and product information
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-3">
        <Card className="shadow-lg border-0 bg-gradient-to-br from-blue-50 to-blue-100">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-bold">Total Products</CardTitle>
            <div className="bg-blue-100 p-2 rounded-full">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{products.length}</div>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-0 bg-gradient-to-br from-orange-50 to-orange-100">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-bold">Low Stock</CardTitle>
            <div className="bg-orange-100 p-2 rounded-full">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">{lowStockProducts.length}</div>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-0 bg-gradient-to-br from-red-50 to-red-100">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-bold">Out of Stock</CardTitle>
            <div className="bg-red-100 p-2 rounded-full">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{outOfStockProducts.length}</div>
          </CardContent>
        </Card>
      </div>

      {lowStockProducts.length > 0 && (
        <Card className="shadow-lg border-0 bg-gradient-to-r from-orange-50 to-amber-50">
          <CardHeader>
            <CardTitle className="text-2xl font-bold flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-orange-600" />
              Low Stock Alert
            </CardTitle>
            <CardDescription className="text-lg">
              The following products are running low on stock
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {lowStockProducts.map((product) => (
                <div
                  key={product.id}
                  className="flex justify-between items-center p-4 bg-white rounded-xl border border-orange-200 shadow-sm"
                >
                  <div>
                    <h3 className="font-bold text-lg">{product.name}</h3>
                    <p className="text-sm text-muted-foreground">{product.sku}</p>
                  </div>
                  <Badge
                    variant={product.quantity === 0 ? "destructive" : "warning"}
                    className="text-lg py-2 px-3"
                  >
                    {product.quantity === 0 ? "Out of Stock" : `${product.quantity} left`}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-xl border-0 bg-gradient-to-br from-white to-gray-50">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <CardTitle className="text-2xl font-bold">Product Inventory</CardTitle>
              <CardDescription className="text-lg mt-1">
                Current inventory levels and product details
              </CardDescription>
            </div>
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
              <Input
                placeholder="Search products..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 text-lg py-3 px-4 w-full"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-purple-600 mx-auto"></div>
              <p className="mt-4 text-muted-foreground text-lg">Loading inventory...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-16">
              <div className="bg-gray-100 p-6 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                <Package className="h-12 w-12 text-gray-400" />
              </div>
              <h3 className="text-2xl font-bold mb-2">No Products Found</h3>
              <p className="text-muted-foreground text-lg">
                {searchTerm ? 'No products match your search.' : 'No products in inventory.'}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border-0 bg-white shadow-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-gradient-to-r from-purple-50 to-pink-50">
                  <TableRow>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Name</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">SKU</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Category</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Stock</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Price</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Status</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Supplier</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((product) => (
                    <TableRow
                      key={product.id}
                      className="hover:bg-purple-50 transition-colors"
                    >
                      <TableCell className="font-medium text-lg py-4">{product.name}</TableCell>
                      <TableCell className="text-lg py-4">{product.sku}</TableCell>
                      <TableCell className="text-lg py-4">{product.category}</TableCell>
                      <TableCell className="text-lg py-4">{product.quantity}</TableCell>
                      <TableCell className="text-lg py-4">₹{product.selling_price}</TableCell>
                      <TableCell className="py-4">
                        <Badge
                          variant={
                            product.quantity === 0
                              ? "destructive"
                              : product.quantity <= product.low_stock_threshold
                                ? "warning"
                                : "success"
                          }
                          className="text-lg py-2 px-3"
                        >
                          {product.quantity === 0
                            ? "Out of Stock"
                            : product.quantity <= product.low_stock_threshold
                              ? "Low Stock"
                              : "In Stock"
                          }
                        </Badge>
                      </TableCell>
                      <TableCell className="text-lg py-4">{product.supplier}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}