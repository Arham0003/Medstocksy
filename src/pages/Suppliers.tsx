import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Truck, Plus, Search, Eye, CreditCard, Package, IndianRupee,
  Phone, Mail, MapPin, FileText, User, AlertTriangle, CheckCircle2, Clock,
  Wallet, TrendingUp, ChevronRight, Building2, Receipt, Download, Trash2
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';

interface Supplier {
  id: string;
  account_id: string;
  supplier_code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gst_number: string | null;
  created_at: string | null;
}

interface SupplierPayment {
  id: string;
  supplier_id: string;
  amount: number;
  payment_type: string;
  payment_date: string;
  notes: string | null;
  created_at: string | null;
}

interface SupplierProduct {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  purchase_price: number | null;
  selling_price: number;
  created_at: string | null;
}

interface SupplierWithStats extends Supplier {
  totalProducts: number;
  totalPurchaseValue: number;
  totalPaid: number;
  balance: number;
  paymentStatus: 'paid' | 'partial' | 'pending';
}

export default function Suppliers() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [productsBySupplier, setProductsBySupplier] = useState<Record<string, SupplierProduct[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Register dialog
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Detail dialog
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierWithStats | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Payment dialog
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentType, setPaymentType] = useState('partial');
  const [isSavingPayment, setIsSavingPayment] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '', contact_person: '', phone: '', email: '', address: '', gst_number: ''
  });

  const fetchData = async () => {
    if (!profile?.account_id) return;
    setLoading(true);
    try {
      const [suppliersRes, productsRes, paymentsRes] = await Promise.all([
        supabase.from('suppliers').select('*').eq('account_id', profile.account_id).order('created_at', { ascending: false }),
        supabase.from('products').select('id, name, category, quantity, purchase_price, selling_price, supplier_id, created_at').eq('account_id', profile.account_id).not('supplier_id', 'is', null),
        supabase.from('supplier_payments').select('*').eq('account_id', profile.account_id).order('payment_date', { ascending: false }),
      ]);

      if (suppliersRes.error) throw suppliersRes.error;
      if (paymentsRes.error) throw paymentsRes.error;

      const suppData = suppliersRes.data || [];
      const payData = paymentsRes.data || [];
      const prodData = (productsRes.data || []) as any[];

      // Group products by supplier_id
      const grouped: Record<string, SupplierProduct[]> = {};
      prodData.forEach((p: any) => {
        if (!p.supplier_id) return;
        if (!grouped[p.supplier_id]) grouped[p.supplier_id] = [];
        grouped[p.supplier_id].push(p);
      });

      setSuppliers(suppData as unknown as Supplier[]);
      setPayments(payData as unknown as SupplierPayment[]);
      setProductsBySupplier(grouped);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error fetching suppliers', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile?.account_id]);

  // Generate next supplier code
  const generateSupplierCode = (existingSuppliers: Supplier[]) => {
    const nums = existingSuppliers
      .map(s => parseInt(s.supplier_code.replace('SUP-', '')) || 0)
      .filter(n => !isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `SUP-${String(next).padStart(4, '0')}`;
  };

  // Compute supplier stats
  const suppliersWithStats: SupplierWithStats[] = useMemo(() => {
    return suppliers.map(s => {
      const prods = productsBySupplier[s.id] || [];
      const totalPurchaseValue = prods.reduce((sum, p) => sum + ((p.purchase_price ?? 0) * p.quantity), 0);
      const totalPaid = payments.filter(p => p.supplier_id === s.id).reduce((sum, p) => sum + p.amount, 0);
      const balance = Math.max(0, totalPurchaseValue - totalPaid);
      let paymentStatus: 'paid' | 'partial' | 'pending' = 'pending';
      if (totalPurchaseValue > 0) {
        if (totalPaid >= totalPurchaseValue) paymentStatus = 'paid';
        else if (totalPaid > 0) paymentStatus = 'partial';
        else paymentStatus = 'pending';
      } else {
        paymentStatus = totalPaid > 0 ? 'paid' : 'pending';
      }
      return { ...s, totalProducts: prods.length, totalPurchaseValue, totalPaid, balance, paymentStatus };
    });
  }, [suppliers, productsBySupplier, payments]);

  const filteredSuppliers = useMemo(() => {
    if (!searchTerm) return suppliersWithStats;
    const q = searchTerm.toLowerCase();
    return suppliersWithStats.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.supplier_code.toLowerCase().includes(q) ||
      (s.phone || '').includes(q) ||
      (s.contact_person || '').toLowerCase().includes(q)
    );
  }, [suppliersWithStats, searchTerm]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.account_id || isSaving) return;
    if (!formData.name.trim()) {
      toast({ variant: 'destructive', title: 'Name is required' });
      return;
    }
    setIsSaving(true);
    try {
      const supplier_code = generateSupplierCode(suppliers);
      const { error } = await supabase.from('suppliers').insert([{
        account_id: profile.account_id,
        supplier_code,
        name: formData.name.trim(),
        contact_person: formData.contact_person.trim() || null,
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        address: formData.address.trim() || null,
        gst_number: formData.gst_number.trim() || null,
      }]);
      if (error) throw error;
      toast({ title: `Supplier registered!`, description: `ID: ${supplier_code} assigned` });
      setIsRegisterOpen(false);
      setFormData({ name: '', contact_person: '', phone: '', email: '', address: '', gst_number: '' });
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error registering supplier', description: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const openDetail = async (supplier: SupplierWithStats) => {
    setSelectedSupplier(supplier);
    setIsDetailOpen(true);
    setLoadingDetail(true);
    try {
      const [prodsRes, paysRes] = await Promise.all([
        supabase.from('products').select('id, name, category, quantity, purchase_price, selling_price, created_at').eq('supplier_id', supplier.id),
        supabase.from('supplier_payments').select('*').eq('supplier_id', supplier.id).order('payment_date', { ascending: false }),
      ]);
      setSupplierProducts((prodsRes.data || []) as SupplierProduct[]);
      setSupplierPayments(paysRes.data || []);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error loading details', description: err.message });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleAddPayment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedSupplier || !profile?.account_id || isSavingPayment) return;
    const fd = new FormData(e.currentTarget);
    const amount = parseFloat(fd.get('amount') as string);
    if (!amount || amount <= 0) {
      toast({ variant: 'destructive', title: 'Invalid amount' });
      return;
    }
    setIsSavingPayment(true);
    try {
      const { error } = await supabase.from('supplier_payments').insert([{
        account_id: profile.account_id,
        supplier_id: selectedSupplier.id,
        amount,
        payment_type: paymentType,
        payment_date: fd.get('payment_date') as string || new Date().toISOString().split('T')[0],
        notes: (fd.get('notes') as string) || null,
      }]);
      if (error) throw error;
      toast({ title: 'Payment recorded!', description: `₹${amount.toLocaleString()} added successfully` });
      setIsPaymentOpen(false);
      setPaymentType('partial');
      // Refresh detail + list
      await openDetail(selectedSupplier);
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error recording payment', description: err.message });
    } finally {
      setIsSavingPayment(false);
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    if (!window.confirm("Are you sure? This will delete the supplier and their payment history permanently.")) return;
    try {
      const { error } = await supabase.from('suppliers').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'Supplier deleted successfully' });
      setIsDetailOpen(false);
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error deleting supplier', description: err.message });
    }
  };

  const paymentStatusBadge = (status: string) => {
    if (status === 'paid') return <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Paid</Badge>;
    if (status === 'partial') return <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100"><Clock className="h-3.5 w-3.5 mr-1" />Partial</Badge>;
    return <Badge variant="secondary" className="bg-red-100 text-red-700 hover:bg-red-100"><AlertTriangle className="h-3.5 w-3.5 mr-1" />Pending</Badge>;
  };

  const handleDownloadProducts = () => {
    if (!selectedSupplier || supplierProducts.length === 0) return;
    
    // Create CSV header
    const headers = ['Product Name', 'Category', 'Current Stock Quantity', 'Purchase Price', 'Total Value'];
    
    // Create CSV rows
    const rows = supplierProducts.map(p => [
      `"${p.name.replace(/"/g, '""')}"`,
      `"${(p.category || '').replace(/"/g, '""')}"`,
      p.quantity.toString(),
      p.purchase_price?.toString() || '0',
      ((p.purchase_price ?? 0) * p.quantity).toString()
    ]);
    
    // Combine and download
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(e => e.join(','))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${selectedSupplier.name}_Products.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalStats = useMemo(() => ({
    totalSuppliers: suppliers.length,
    totalProducts: Object.values(productsBySupplier).flat().length,
    totalPaid: payments.reduce((s, p) => s + p.amount, 0),
    totalBalance: suppliersWithStats.reduce((s, sup) => s + sup.balance, 0),
  }), [suppliers, productsBySupplier, payments, suppliersWithStats]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Supplier Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage suppliers, track product sources and payment accounts
          </p>
        </div>
        <Dialog open={isRegisterOpen} onOpenChange={setIsRegisterOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Register Supplier
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl">Register New Supplier</DialogTitle>
              <DialogDescription className="text-base">
                A unique Supplier ID will be auto-generated on registration.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleRegister} className="space-y-5 mt-2">
              <div className="space-y-2">
                <Label className="text-base font-semibold">Business / Supplier Name *</Label>
                <Input
                  value={formData.name}
                  onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Sun Pharma Distributors"
                  className="text-base"
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-base font-semibold">Contact Person</Label>
                  <Input
                    value={formData.contact_person}
                    onChange={e => setFormData(p => ({ ...p, contact_person: e.target.value }))}
                    placeholder="Name"
                    className="text-base"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-base font-semibold">Mobile Number</Label>
                  <Input
                    value={formData.phone}
                    onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                    placeholder="9876543210"
                    className="text-base"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-base font-semibold">Email</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                    placeholder="supplier@email.com"
                    className="text-base"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-base font-semibold">GST Number</Label>
                  <Input
                    value={formData.gst_number}
                    onChange={e => setFormData(p => ({ ...p, gst_number: e.target.value }))}
                    placeholder="27AAAPZ0121A1Z3"
                    className="text-base"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-base font-semibold">Address</Label>
                <Input
                  value={formData.address}
                  onChange={e => setFormData(p => ({ ...p, address: e.target.value }))}
                  placeholder="Full address"
                  className="text-base"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={isSaving} className="flex-1">
                  {isSaving ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Saving...</> : <><Plus className="h-4 w-4 mr-2" />Register Supplier</>}
                </Button>
                <Button type="button" variant="outline" onClick={() => setIsRegisterOpen(false)} className="flex-1">Cancel</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Suppliers', value: totalStats.totalSuppliers, icon: Truck, color: 'text-blue-600 bg-blue-100' },
          { label: 'Products Sourced', value: totalStats.totalProducts, icon: Package, color: 'text-violet-600 bg-violet-100' },
          { label: 'Total Paid', value: `₹${totalStats.totalPaid.toLocaleString('en-IN')}`, icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-100' },
          { label: 'Balance Due', value: `₹${totalStats.totalBalance.toLocaleString('en-IN')}`, icon: Wallet, color: 'text-red-600 bg-red-100' },
        ].map((stat, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                </div>
                <div className={`p-3 rounded-lg ${stat.color}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Suppliers Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <CardTitle>All Suppliers</CardTitle>
              <CardDescription>
                {loading ? 'Loading...' : `${filteredSuppliers.length} supplier${filteredSuppliers.length !== 1 ? 's' : ''}`}
              </CardDescription>
            </div>
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search by name, ID, phone..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
              <p className="mt-4 text-muted-foreground">Loading suppliers...</p>
            </div>
          ) : filteredSuppliers.length === 0 ? (
            <div className="text-center py-12 border rounded-lg border-dashed">
              <div className="bg-muted p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <Truck className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-bold mb-1">No Suppliers Yet</h3>
              <p className="text-muted-foreground mb-4">
                Register your first supplier to start tracking purchases and payments.
              </p>
              <Button onClick={() => setIsRegisterOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />Add Supplier
              </Button>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-semibold text-foreground">Supplier ID</TableHead>
                    <TableHead className="font-semibold text-foreground">Name</TableHead>
                    <TableHead className="font-semibold text-foreground">Contact</TableHead>
                    <TableHead className="font-semibold text-foreground text-center">Products</TableHead>
                    <TableHead className="font-semibold text-foreground text-right">Purchase Value</TableHead>
                    <TableHead className="font-semibold text-foreground text-right">Paid</TableHead>
                    <TableHead className="font-semibold text-foreground text-right">Balance</TableHead>
                    <TableHead className="font-semibold text-foreground text-center">Status</TableHead>
                    <TableHead className="font-semibold text-foreground text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSuppliers.map(s => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono bg-muted/50">{s.supplier_code}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold">{s.name}</div>
                        {s.gst_number && <div className="text-xs text-muted-foreground mt-0.5">GST: {s.gst_number}</div>}
                      </TableCell>
                      <TableCell>
                        {s.contact_person && <div className="text-sm font-medium">{s.contact_person}</div>}
                        {s.phone && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Phone className="h-3 w-3" />{s.phone}</div>}
                      </TableCell>
                      <TableCell className="text-center font-medium">
                        {s.totalProducts}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ₹{s.totalPurchaseValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell className="text-right text-emerald-600 font-medium">
                        ₹{s.totalPaid.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell className="text-right text-red-600 font-medium">
                        ₹{s.balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell className="text-center">
                        {paymentStatusBadge(s.paymentStatus)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDetail(s)}
                        >
                          <Eye className="h-4 w-4 mr-2" />View
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

      {/* Supplier Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedSupplier && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-3 rounded-lg">
                    <Building2 className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl">{selectedSupplier.name}</DialogTitle>
                    <DialogDescription className="mt-1 flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">{selectedSupplier.supplier_code}</Badge>
                      {selectedSupplier.gst_number && <span className="text-xs text-muted-foreground">GST: {selectedSupplier.gst_number}</span>}
                    </DialogDescription>
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-red-500 hover:text-red-700 hover:bg-red-50 ml-auto"
                  onClick={() => selectedSupplier && handleDeleteSupplier(selectedSupplier.id)}
                >
                  <Trash2 className="h-5 w-5" />
                </Button>
              </DialogHeader>

              {/* Supplier Info */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
                {selectedSupplier.contact_person && (
                  <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm">{selectedSupplier.contact_person}</span>
                  </div>
                )}
                {selectedSupplier.phone && (
                  <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
                    <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm">{selectedSupplier.phone}</span>
                  </div>
                )}
                {selectedSupplier.email && (
                  <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{selectedSupplier.email}</span>
                  </div>
                )}
                {selectedSupplier.address && (
                  <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3 col-span-2">
                    <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm">{selectedSupplier.address}</span>
                  </div>
                )}
              </div>

              {/* Account Summary */}
              <div className="grid grid-cols-3 gap-4 mt-2">
                <div className="bg-muted p-4 rounded-xl text-center border">
                  <p className="text-sm font-medium text-muted-foreground">Total Purchase Value</p>
                  <p className="text-xl font-bold mt-1">₹{selectedSupplier.totalPurchaseValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                </div>
                <div className="bg-emerald-50 border-emerald-100 p-4 rounded-xl text-center border">
                  <p className="text-sm font-medium text-emerald-700">Total Paid</p>
                  <p className="text-xl font-bold text-emerald-700 mt-1">₹{selectedSupplier.totalPaid.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                </div>
                <div className="bg-red-50 border-red-100 p-4 rounded-xl text-center border">
                  <p className="text-sm font-medium text-red-700">Balance Due</p>
                  <p className="text-xl font-bold text-red-700 mt-1">₹{selectedSupplier.balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                </div>
              </div>

              {loadingDetail ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-violet-600 mx-auto" />
                </div>
              ) : (
                <div className="space-y-5 mt-2">
                  {/* Products from this Supplier */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-bold flex items-center gap-2">
                        <Package className="h-5 w-5 text-muted-foreground" />
                        Recent Products ({supplierProducts.length})
                      </h3>
                      <Button variant="outline" size="sm" onClick={handleDownloadProducts} disabled={supplierProducts.length === 0}>
                        <Download className="h-4 w-4 mr-2" /> Download All
                      </Button>
                    </div>
                    {supplierProducts.length === 0 ? (
                      <div className="text-center py-6 border border-dashed rounded-lg">
                        <p className="text-muted-foreground">No products linked to this supplier yet.</p>
                      </div>
                    ) : (
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader className="bg-muted/50">
                            <TableRow>
                              <TableHead className="font-semibold text-foreground">Product Name</TableHead>
                              <TableHead className="font-semibold text-foreground">Category</TableHead>
                              <TableHead className="font-semibold text-foreground text-center">Stock Qty</TableHead>
                              <TableHead className="font-semibold text-foreground text-right">Purchase Price</TableHead>
                              <TableHead className="font-semibold text-foreground text-right">Total Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {supplierProducts.slice(0, 5).map(p => (
                              <TableRow key={p.id}>
                                <TableCell className="font-medium">{p.name}</TableCell>
                                <TableCell>{p.category || '-'}</TableCell>
                                <TableCell className="text-center">{p.quantity}</TableCell>
                                <TableCell className="text-right">₹{(p.purchase_price ?? 0).toLocaleString('en-IN')}</TableCell>
                                <TableCell className="text-right font-medium">₹{((p.purchase_price ?? 0) * p.quantity).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {supplierProducts.length > 5 && (
                          <div className="text-center py-2 bg-muted/30 text-sm text-muted-foreground border-t">
                            Showing 5 most recent products. Click "Download All" to view {supplierProducts.length} items.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Payment History */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-bold flex items-center gap-2">
                        <Receipt className="h-5 w-5 text-emerald-600" />
                        Payment History ({supplierPayments.length})
                      </h3>
                      <Button
                        size="sm"
                        onClick={() => setIsPaymentOpen(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />Add Payment
                      </Button>
                    </div>
                    {supplierPayments.length === 0 ? (
                      <div className="text-center py-6 border border-dashed rounded-lg">
                        <p className="text-muted-foreground">No payments recorded yet.</p>
                        <Button variant="secondary" size="sm" onClick={() => setIsPaymentOpen(true)} className="mt-3">
                          <CreditCard className="h-4 w-4 mr-2" />Record First Payment
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader className="bg-muted/50">
                            <TableRow>
                              <TableHead className="font-semibold text-foreground">Date</TableHead>
                              <TableHead className="font-semibold text-foreground">Type</TableHead>
                              <TableHead className="font-semibold text-foreground text-right">Amount</TableHead>
                              <TableHead className="font-semibold text-foreground">Notes</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {supplierPayments.map(p => (
                              <TableRow key={p.id} className="hover:bg-emerald-50/30">
                                <TableCell className="text-sm py-3">{new Date(p.payment_date).toLocaleDateString('en-IN')}</TableCell>
                                <TableCell className="text-sm py-3">
                                  <Badge variant="outline" className={
                                    p.payment_type === 'full' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' :
                                      p.payment_type === 'advance' ? 'border-blue-300 text-blue-700 bg-blue-50' :
                                        'border-amber-300 text-amber-700 bg-amber-50'
                                  }>
                                    {p.payment_type.charAt(0).toUpperCase() + p.payment_type.slice(1)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm py-3 text-right font-semibold text-emerald-600">
                                  ₹{p.amount.toLocaleString('en-IN')}
                                </TableCell>
                                <TableCell className="text-sm py-3 text-muted-foreground">{p.notes || '-'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Payment Dialog */}
      <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Record Payment</DialogTitle>
            <DialogDescription className="text-base">
              {selectedSupplier && <>Payment to <strong>{selectedSupplier.name}</strong> — Balance due: <strong className="text-red-600">₹{selectedSupplier.balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong></>}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddPayment} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-base font-semibold">Amount (₹) *</Label>
              <Input name="amount" type="number" step="0.01" min="0.01" placeholder="0.00" className="text-base" required />
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">Payment Type</Label>
              <Select value={paymentType} onValueChange={setPaymentType}>
                <SelectTrigger className="text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full Payment</SelectItem>
                  <SelectItem value="partial">Partial Payment</SelectItem>
                  <SelectItem value="advance">Advance Payment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">Payment Date</Label>
              <Input name="payment_date" type="date" defaultValue={new Date().toISOString().split('T')[0]} className="text-base" />
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">Notes (optional)</Label>
              <Input name="notes" placeholder="Cheque no., bank transfer ref, etc." className="text-base" />
            </div>
            <DialogFooter className="gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setIsPaymentOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSavingPayment}>
                {isSavingPayment ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2" />Saving...</> : <><CreditCard className="h-4 w-4 mr-2" />Record Payment</>}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
