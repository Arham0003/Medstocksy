import { useState, useEffect, useMemo } from 'react';
import CSVUpload from '@/components/CSVUpload';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Edit, Trash2, Package, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Product {
  id: string;
  name: string;
  hsn_code: string;
  category: string;
  batch_number: string;
  manufacturer: string;
  expiry_date: string | null;
  quantity: number;
  purchase_price: number;
  selling_price: number;
  gst: number;
  supplier: string;
  low_stock_threshold: number;
  created_at: string;
}

// Preset product categories for pharmacy/medical store
const PRESET_CATEGORIES = [
  "Tablets",
  "Capsules",
  "Syrups",
  "Ointments",
  "Injections",
  "Drops",
  "Medical Devices",
  "Supplements",
  "Ayurveda/Homeopathy",
  "Personal Care",
  "Baby Care",
  "Surgical",
  "Others"
];

export default function Products() {
  const { isOwner, profile } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [uploadedData, setUploadedData] = useState<string[][]>([]);
  const [parsedProducts, setParsedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  // State for category selection
  const [selectedCategory, setSelectedCategory] = useState<string>("");

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProducts(data || []);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error fetching products",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  // Function to download sample CSV
  const downloadSampleCSV = () => {
    const headers = [
      'name',
      'hsn_code',
      'category',
      'batch_number',
      'manufacturer',
      'expiry_date',
      'quantity',
      'purchase_price',
      'selling_price',
      'gst',
      'supplier',
      'low_stock_threshold'
    ];

    const sampleData = [
      ['Paracetamol 500mg', '30049099', 'Tablets', 'BATCH001', 'ABC Pharma', '2025-12-31', '100', '5.50', '10.00', '12', 'Medical Suppliers Ltd', '20'],
      ['Amoxicillin 250mg', '30042090', 'Capsules', 'BATCH002', 'XYZ Pharma', '2026-06-30', '150', '8.00', '15.00', '12', 'Health Distributors', '25'],
      ['Cough Syrup 100ml', '30049011', 'Syrups', 'BATCH003', 'DEF Pharma', '2025-09-15', '75', '45.00', '75.00', '18', 'Pharma Wholesale', '15'],
      ['Antiseptic Cream 50g', '30039000', 'Ointments', 'BATCH004', 'GHI Pharma', '2026-03-20', '200', '25.00', '40.00', '18', 'Medical Suppliers Ltd', '30'],
      ['Vitamin D3 Tablets', '21069000', 'Supplements', 'BATCH005', 'JKL Nutrition', '2026-12-31', '120', '15.00', '25.00', '12', 'Health Distributors', '20'],
      ['Digital Thermometer', '90251180', 'Medical Devices', 'DEV001', 'MNO Medical', '2027-01-01', '50', '150.00', '250.00', '18', 'Medical Equipment Co', '10'],
      ['Insulin Injection 10ml', '30043100', 'Injections', 'BATCH006', 'PQR Pharma', '2025-08-30', '80', '200.00', '350.00', '12', 'Pharma Wholesale', '15'],
      ['Eye Drops 10ml', '30049031', 'Drops', 'BATCH007', 'STU Pharma', '2025-11-15', '90', '35.00', '60.00', '12', 'Medical Suppliers Ltd', '20'],
      ['Baby Diaper Pack', '96190010', 'Baby Care', 'PACK001', 'VWX Baby Care', '2026-05-01', '60', '180.00', '250.00', '18', 'Baby Products Inc', '15'],
      ['Hand Sanitizer 500ml', '38089400', 'Personal Care', 'BATCH008', 'YZA Healthcare', '2025-10-20', '100', '45.00', '75.00', '18', 'Health Distributors', '25']
    ];

    // Create CSV content
    const csvContent = [
      headers.join(','),
      ...sampleData.map(row => row.map(cell => {
        // Escape cells that contain commas or quotes
        if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      }).join(','))
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'sample-products.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Sample CSV downloaded",
      description: "Use this template to prepare your product data",
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    if (!profile?.account_id) {
      toast({
        variant: "destructive",
        title: "Cannot save product",
        description: "Account context not loaded. Please re-login or try again in a moment.",
      });
      return;
    }

    const productData = {
      name: formData.get('name') as string,
      hsn_code: formData.get('hsn_code') as string,
      category: formData.get('category') as string,
      batch_number: formData.get('batch_number') as string,
      manufacturer: formData.get('manufacturer') as string,
      expiry_date: (formData.get('expiry_date') as string) || null,
      quantity: parseInt(formData.get('quantity') as string),
      purchase_price: parseFloat(formData.get('purchase_price') as string),
      selling_price: parseFloat(formData.get('selling_price') as string),
      gst: parseFloat(formData.get('gst') as string),
      supplier: formData.get('supplier') as string,
      low_stock_threshold: parseInt(formData.get('low_stock_threshold') as string),
      account_id: profile?.account_id,
    };

    try {
      let error;

      if (editingProduct) {
        ({ error } = await supabase
          .from('products')
          .update(productData)
          .eq('id', editingProduct.id));
      } else {
        ({ error } = await supabase
          .from('products')
          .insert([productData]));
      }

      if (error) throw error;

      toast({
        title: editingProduct ? "Product updated" : "Product added",
        description: editingProduct ? "Product has been updated successfully." : "Product has been added successfully.",
      });

      setIsDialogOpen(false);
      setEditingProduct(null);
      setSelectedCategory(""); // Reset category selection
      fetchProducts();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error saving product",
        description: error.message,
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Product deleted",
        description: "Product has been deleted successfully.",
      });

      fetchProducts();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error deleting product",
        description: error.message,
      });
    } finally {
      setDeleteDialogOpen(false);
      setProductToDelete(null);
    }
  };

  const confirmDelete = (product: Product) => {
    setProductToDelete(product);
    setDeleteDialogOpen(true);
  };

  // Memoize filtered products to prevent unnecessary recalculations
  const filteredProducts = useMemo(() =>
    products.filter(product =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.hsn_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.manufacturer?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.batch_number?.toLowerCase().includes(searchTerm.toLowerCase())
    ), [products, searchTerm]);

  // Parse CSV data when uploaded
  useEffect(() => {
    if (uploadedData.length > 0) {
      try {
        const headers = uploadedData[0].map(h => h.toLowerCase().trim());
        const body = uploadedData.slice(1).filter(row => row.some(cell => cell.trim()));

        // Check for required columns
        const requiredColumns = ['name', 'selling_price'];
        const missingColumns = requiredColumns.filter(col => !headers.includes(col));

        if (missingColumns.length > 0) {
          toast({
            variant: "destructive",
            title: "Invalid CSV format",
            description: `Missing required columns: ${missingColumns.join(', ')}. Please check your CSV file.`,
          });
          setParsedProducts([]);
          return;
        }

        const products: Product[] = body.map((row, index) => {
          const getColumnValue = (columnName: string) => {
            const colIndex = headers.indexOf(columnName);
            return colIndex >= 0 ? row[colIndex]?.trim() : '';
          };

          return {
            id: crypto.randomUUID(),
            name: getColumnValue('name') || '',
            hsn_code: getColumnValue('hsn_code') || getColumnValue('hsn code') || '',
            category: getColumnValue('category') || '',
            batch_number: getColumnValue('batch_number') || getColumnValue('batch number') || '',
            manufacturer: getColumnValue('manufacturer') || '',
            expiry_date: getColumnValue('expiry_date') || getColumnValue('expiry date') || null,
            quantity: parseInt(getColumnValue('quantity')) || 0,
            purchase_price: parseFloat(getColumnValue('purchase_price') || getColumnValue('purchase price')) || 0,
            selling_price: parseFloat(getColumnValue('selling_price') || getColumnValue('selling price')) || 0,
            gst: parseFloat(getColumnValue('gst')) || 0,
            supplier: getColumnValue('supplier') || '',
            low_stock_threshold: parseInt(getColumnValue('low_stock_threshold') || getColumnValue('low stock threshold')) || 10,
            created_at: new Date().toISOString()
          };
        }).filter(product => product.name && product.selling_price > 0);

        setParsedProducts(products);

        if (products.length > 0) {
          toast({
            title: `Successfully parsed ${products.length} products`,
            description: "Click 'Save All Products' to add them to your inventory",
          });
        } else {
          toast({
            variant: "destructive",
            title: "No valid products found",
            description: "Please ensure your CSV has valid product data with name and selling price.",
          });
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Error parsing CSV",
          description: "There was an error processing your CSV file. Please check the format.",
        });
        setParsedProducts([]);
      }
    }
  }, [uploadedData, toast]);

  const saveAllProducts = async () => {
    if (parsedProducts.length === 0) return;
    if (!profile?.account_id) {
      toast({
        variant: "destructive",
        title: "Cannot add products",
        description: "Account context not loaded. Please re-login or try again in a moment.",
      });
      return;
    }

    try {
      const productsToInsert = parsedProducts.map(product => ({
        ...product,
        account_id: profile?.account_id
      }));

      const { error } = await supabase
        .from('products')
        .insert(productsToInsert);

      if (error) throw error;

      toast({
        title: `Successfully added ${parsedProducts.length} products`,
        description: "All products have been added to your inventory",
      });

      setUploadedData([]);
      setParsedProducts([]);
      fetchProducts();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error adding products",
        description: error.message,
      });
    }
  };

  // Reset selected category when dialog opens/closes or when editing product changes
  useEffect(() => {
    if (isDialogOpen && editingProduct) {
      setSelectedCategory(editingProduct.category || "");
    } else if (!isDialogOpen) {
      setSelectedCategory("");
    }
  }, [isDialogOpen, editingProduct]);

  if (!isOwner) {
    return (
      <div className="text-center py-12">
        <div className="bg-red-100 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="h-8 w-8 text-red-600" />
        </div>
        <h2 className="text-2xl font-bold text-red-600 mb-2">Access Denied</h2>
        <p className="text-muted-foreground text-lg">You don't have permission to access this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
          <div>
            <div className="flex items-center gap-4">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Product Management
              </h1>
              <button
                onClick={downloadSampleCSV}
                className="text-sm text-blue-600 hover:text-blue-800 underline cursor-pointer bg-transparent border-none"
              >
                Download Sample CSV
              </button>
            </div>
            <p className="text-muted-foreground text-lg mt-2">
              Manage your inventory products and stock levels
            </p>
          </div>
        </div>
        <CSVUpload onFileUpload={setUploadedData} />

        {parsedProducts.length > 0 && (
          <Card className="shadow-lg border-0 bg-gradient-to-r from-green-50 to-emerald-50">
            <CardHeader>
              <CardTitle className="text-xl font-bold">Parsed Products</CardTitle>
              <CardDescription>Found {parsedProducts.length} products in your CSV file</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Button
                  onClick={saveAllProducts}
                  className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                >
                  Save All Products
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setUploadedData([]);
                    setParsedProducts([]);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setSelectedCategory("");
            setEditingProduct(null);
          }
        }}>
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                setEditingProduct(null);
                setSelectedCategory("");
              }}
              className="text-lg py-3 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Product
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg md:max-w-xl max-h-[90vh] overflow-y-auto w-[95vw]">
            <DialogHeader>
              <DialogTitle className="text-2xl">
                {editingProduct ? 'Edit Product' : 'Add New Product'}
              </DialogTitle>
              <DialogDescription className="text-lg">
                {editingProduct ? 'Update product information' : 'Enter product details to add to your inventory'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-lg font-medium">Product Name</Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    defaultValue={editingProduct?.name}
                    className="text-lg py-3 px-4"
                    placeholder="Enter product name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hsn_code" className="text-lg font-medium">HSN Code</Label>
                  <Input
                    id="hsn_code"
                    name="hsn_code"
                    defaultValue={editingProduct?.hsn_code}
                    className="text-lg py-3 px-4"
                    placeholder="Enter HSN Code"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="category" className="text-lg font-medium">Category</Label>
                  <Select
                    name="category"
                    value={selectedCategory || editingProduct?.category || ""}
                    onValueChange={(value) => setSelectedCategory(value)}
                  >
                    <SelectTrigger className="text-lg py-3 px-4">
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRESET_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Hidden input to capture the selected value for form submission */}
                  <input
                    type="hidden"
                    name="category"
                    value={selectedCategory || editingProduct?.category || ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supplier" className="text-lg font-medium">Supplier</Label>
                  <Input
                    id="supplier"
                    name="supplier"
                    defaultValue={editingProduct?.supplier}
                    className="text-lg py-3 px-4"
                    placeholder="Enter supplier"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="batch_number" className="text-lg font-medium">Batch Number</Label>
                  <Input
                    id="batch_number"
                    name="batch_number"
                    defaultValue={editingProduct?.batch_number}
                    className="text-lg py-3 px-4"
                    placeholder="Enter batch number"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manufacturer" className="text-lg font-medium">Manufacturer</Label>
                  <Input
                    id="manufacturer"
                    name="manufacturer"
                    defaultValue={editingProduct?.manufacturer}
                    className="text-lg py-3 px-4"
                    placeholder="Enter manufacturer"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expiry_date" className="text-lg font-medium">Expiry Date</Label>
                  <Input
                    id="expiry_date"
                    name="expiry_date"
                    type="date"
                    defaultValue={editingProduct?.expiry_date ? editingProduct.expiry_date.substring(0, 10) : ''}
                    className="text-lg py-3 px-4"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="quantity" className="text-lg font-medium">Quantity</Label>
                  <Input
                    id="quantity"
                    name="quantity"
                    type="number"
                    required
                    defaultValue={editingProduct?.quantity}
                    className="text-lg py-3 px-4"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="low_stock_threshold" className="text-lg font-medium">Low Stock Alert</Label>
                  <Input
                    id="low_stock_threshold"
                    name="low_stock_threshold"
                    type="number"
                    defaultValue={editingProduct?.low_stock_threshold || 10}
                    className="text-lg py-3 px-4"
                    placeholder="10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gst" className="text-lg font-medium">GST %</Label>
                  <Input
                    id="gst"
                    name="gst"
                    type="number"
                    step="0.01"
                    defaultValue={editingProduct?.gst || 18}
                    className="text-lg py-3 px-4"
                    placeholder="18"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="purchase_price" className="text-lg font-medium">Purchase Price (₹)</Label>
                  <Input
                    id="purchase_price"
                    name="purchase_price"
                    type="number"
                    step="0.01"
                    defaultValue={editingProduct?.purchase_price}
                    className="text-lg py-3 px-4"
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="selling_price" className="text-lg font-medium">Selling Price (₹)</Label>
                  <Input
                    id="selling_price"
                    name="selling_price"
                    type="number"
                    step="0.01"
                    required
                    defaultValue={editingProduct?.selling_price}
                    className="text-lg py-3 px-4"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Button
                  type="submit"
                  className="flex-1 text-lg py-3 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                >
                  {editingProduct ? 'Update Product' : 'Add Product'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    setSelectedCategory("");
                  }}
                  className="flex-1 text-lg py-3 px-6"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-xl">Confirm Product Deletion</DialogTitle>
              <DialogDescription className="text-lg">
                Are you sure you want to delete this product? This action cannot be undone and the item will be permanently removed from your inventory.
              </DialogDescription>
            </DialogHeader>
            {productToDelete && (
              <div className="py-4">
                <div className="flex items-center gap-4 p-4 bg-red-50 rounded-lg">
                  <div className="bg-red-100 p-3 rounded-full">
                    <AlertTriangle className="h-6 w-6 text-red-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{productToDelete.name}</h3>
                    <p className="text-muted-foreground">HSN: {productToDelete.hsn_code || 'N/A'}</p>
                  </div>
                </div>
                <p className="mt-4 text-red-600 font-medium">
                  Warning: This action is irreversible. Once deleted, the product cannot be recovered.
                </p>
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteDialogOpen(false);
                  setProductToDelete(null);
                }}
                className="text-lg py-3 px-6"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => productToDelete && handleDelete(productToDelete.id)}
                className="text-lg py-3 px-6"
              >
                <Trash2 className="h-5 w-5 mr-2" />
                Delete Permanently
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>

      <Card className="shadow-xl border-0 bg-gradient-to-br from-white to-gray-50">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <CardTitle className="text-2xl font-bold">Product Inventory</CardTitle>
              <CardDescription className="text-lg mt-1">
                Total: {products.length} products
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2 w-full md:w-auto">
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
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-muted-foreground text-lg">Loading products...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-16">
              <div className="bg-gray-100 p-6 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                <Package className="h-12 w-12 text-gray-400" />
              </div>
              <h3 className="text-2xl font-bold mb-2">No Products Found</h3>
              <p className="text-muted-foreground text-lg mb-6">
                {searchTerm ? 'No products match your search.' : 'Your inventory is empty.'}
              </p>
              <Button
                onClick={() => {
                  setSearchTerm('');
                  setIsDialogOpen(true);
                  setEditingProduct(null);
                  setSelectedCategory("");
                }}
                className="text-lg py-3 px-8 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
              >
                <Plus className="h-5 w-5 mr-2" />
                Add Your First Product
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border-0 bg-white shadow-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
                  <TableRow>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Name</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">HSN Code</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Category</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Batch</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Manufacturer</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Expiry</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Quantity</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Price</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Status</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((product) => (
                    <TableRow
                      key={product.id}
                      className="hover:bg-blue-50 transition-colors"
                    >
                      <TableCell className="font-medium text-lg py-4">{product.name}</TableCell>
                      <TableCell className="text-lg py-4">{product.hsn_code}</TableCell>
                      <TableCell className="text-lg py-4">{product.category}</TableCell>
                      <TableCell className="text-lg py-4">{product.batch_number}</TableCell>
                      <TableCell className="text-lg py-4">{product.manufacturer}</TableCell>
                      <TableCell className="text-lg py-4">{product.expiry_date ? new Date(product.expiry_date).toLocaleDateString() : '-'}</TableCell>
                      <TableCell className="text-lg py-4">
                        <Badge
                          variant={product.quantity === 0 ? "destructive" : product.quantity <= product.low_stock_threshold ? "warning" : "success"}
                          className="text-lg py-2 px-3"
                        >
                          {product.quantity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-lg py-4">₹{product.selling_price}</TableCell>
                      <TableCell className="py-4">
                        <div className="flex flex-wrap gap-2">
                          <Badge
                            variant={product.quantity === 0 ? "destructive" : product.quantity <= product.low_stock_threshold ? "warning" : "success"}
                            className="text-lg py-2 px-3"
                          >
                            {product.quantity === 0 ? "Out of Stock" : product.quantity <= product.low_stock_threshold ? "Low Stock" : "In Stock"}
                          </Badge>
                          {(() => {
                            if (!product.expiry_date) return null;
                            const today = new Date();
                            const exp = new Date(product.expiry_date);
                            const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                            if (diffDays < 0) {
                              return <Badge variant="default" className="text-lg py-2 px-3">Expired</Badge>;
                            }
                            if (diffDays <= 30) {
                              return <Badge variant="destructive" className="text-lg py-2 px-3">Expiring Soon</Badge>;
                            }
                            return null;
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingProduct(product);
                              setSelectedCategory(product.category || "");
                              setIsDialogOpen(true);
                            }}
                            className="text-lg py-2 px-4"
                          >
                            <Edit className="h-5 w-5 mr-1" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => confirmDelete(product)}
                            className="text-lg py-2 px-4 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                          >
                            <Trash2 className="h-5 w-5 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
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