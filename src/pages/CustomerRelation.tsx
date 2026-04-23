import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { AlertTriangle, MessageCircle, Search, ChevronDown, ChevronUp, Stethoscope, CalendarDays, FileText, Filter, DollarSign, MoreVertical, Trash2, UserMinus } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Banknote, CreditCard } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type CrmSale = {
  id: string;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  doctor_name: string | null;
  sale_date: string | null;
  prescription_months: number | null;
  months_taken: number | null;
  bill_id?: string | null;
  account_id?: string | null;
  total_price?: number;
  payment_mode?: string;
  received_amount?: number;
  is_settled?: boolean;
};

type CustomerSummary = {
  key: string; // phone or name fallback
  name: string;
  phone: string | null;
  address: string | null;
  doctorName: string | null;
  lastPurchase: string | null;
  prescriptionMonths: number | null;
  monthsTaken: number | null;
  nextDueDate: Date | null;
  status: 'due' | 'active' | 'completed' | 'unknown';
  totalBalance: number;
  allBills: CrmSale[]; // all sales for this customer
};

export default function CustomerRelation() {
  const { profile } = useAuth();
  const [sales, setSales] = useState<CrmSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [customNote, setCustomNote] = useState<string>('');
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'smart' | 'newest'>('smart');
  
  // Settlement states
  const [isSettleDialogOpen, setIsSettleDialogOpen] = useState(false);
  const [settlementCustomer, setSettlementCustomer] = useState<CustomerSummary | null>(null);
  const [settlementAmount, setSettlementAmount] = useState<number>(0);
  const [isSettling, setIsSettling] = useState(false);

  // Deletion states
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<CustomerSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchCrm = async () => {
    if (!profile?.account_id) return;
      try {
        const { data, error } = await supabase
          .from('sales')
          .select('id, created_at, bill_id, customer_name, customer_phone, customer_address, doctor_name, sale_date, prescription_months, months_taken, account_id, total_price, payment_mode, received_amount, is_settled')
          .eq('account_id', profile?.account_id)
          .not('customer_phone', 'is', null)
          .neq('customer_phone', '')
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching regular CRM data:', error);
          if (error.message?.includes('column')) {
            console.log('Falling back to basic CRM query');
            const { data: fallbackData, error: fallbackError } = await supabase
              .from('sales')
              .select('id, created_at, bill_id, customer_name, customer_phone, customer_address, doctor_name, sale_date, prescription_months, months_taken, prescription_notes, account_id, total_price, payment_mode, received_amount, is_settled')
              .eq('account_id', profile?.account_id)
              .not('customer_phone', 'is', null)
              .neq('customer_phone', '')
              .order('created_at', { ascending: false });
            
            if (fallbackError) throw fallbackError;
            console.log('Fallback data count:', fallbackData?.length);
            setSales((fallbackData as any[]) || []);
          } else {
            throw error;
          }
        } else {
          console.log('CRM Data fetched:', data?.length, 'rows');
          if (data && data.length > 0) {
            console.log('Sample sale:', data[0]);
          }
          setSales((data as any[]) || []);
        }

        // fetch custom note from settings
        const settingsRes = await supabase
          .from('settings')
          .select('whatsapp_custom_note')
          .eq('account_id', profile?.account_id)
          .single();
        if (!settingsRes.error) {
          setCustomNote((settingsRes.data as any)?.whatsapp_custom_note || '');
        }
      } catch (e) {
        console.error('Error fetching CRM data:', e);
      } finally {
        setLoading(false);
      }
    };

  useEffect(() => {
    fetchCrm();
  }, [profile?.account_id]);

  const handleDeleteCustomer = async () => {
    if (!customerToDelete || !profile?.account_id) return;
    setIsDeleting(true);
    try {
      // In this app, customers are derived from the sales table.
      // Deleting a customer means deleting all sales associated with their phone number.
      const { error } = await supabase
        .from('sales')
        .delete()
        .eq('account_id', profile.account_id)
        .eq('customer_phone', customerToDelete.phone);

      if (error) throw error;

      toast({
        title: "Customer Deleted",
        description: `Successfully removed all records for ${customerToDelete.name}`,
      });
      setIsDeleteDialogOpen(false);
      setCustomerToDelete(null);
      fetchCrm();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: e.message,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSettlePayments = async () => {
    if (!settlementCustomer || settlementAmount <= 0) return;
    setIsSettling(true);
    try {
      // Find all unpaid sales for this customer, oldest first
      const unpaidSales = settlementCustomer.allBills
        .filter(s => !s.is_settled && (s.total_price || 0) > (s.received_amount || 0))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      let remaining = settlementAmount;
      const updates = [];

      for (const sale of unpaidSales) {
        if (remaining <= 0) break;
        
        const due = (sale.total_price || 0) - (sale.received_amount || 0);
        const paymentForThis = Math.min(remaining, due);
        const newReceived = (sale.received_amount || 0) + paymentForThis;
        
        updates.push(
          supabase
            .from('sales')
            .update({
              received_amount: newReceived,
              is_settled: newReceived >= (sale.total_price || 0)
            } as any)
            .eq('id', sale.id)
        );
        
        remaining -= paymentForThis;
      }

      await Promise.all(updates);
      
      toast({
        title: "Payment Recorded",
        description: `Successfully recorded ₹${settlementAmount.toFixed(2)} for ${settlementCustomer.name}`,
      });
      
      setIsSettleDialogOpen(false);
      setSettlementAmount(0);
      // Wait a bit for DB to catch up then refresh
      setTimeout(fetchCrm, 500);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Settlement Failed",
        description: e.message,
      });
    } finally {
      setIsSettling(false);
    }
  };

  const customers: CustomerSummary[] = useMemo(() => {
    const byKey = new Map<string, CustomerSummary>();

    sales.forEach((s) => {
      const key = (s.customer_phone || s.customer_name || `anonymous-${s.id}`).trim();
      if (!s.customer_phone) return; // only include with phone
      const existing = byKey.get(key);
      const name = s.customer_name || 'Walk-in Customer';
      const phone = s.customer_phone || null;
      const address = s.customer_address || null;
      const lastDate = new Date(s.created_at);
      const prescriptionMonths = s.prescription_months;
      const monthsTaken = s.months_taken;

      let nextDueDate: Date | null = null;
      let status: CustomerSummary['status'] = 'unknown';
      if (prescriptionMonths != null && monthsTaken != null) {
        // approximate months to 30 days windows from purchase
        const start = lastDate; // last purchase as baseline
        const elapsedWindows = monthsTaken; // completed windows
        const nextWindowStart = new Date(start.getTime() + elapsedWindows * 30 * 24 * 60 * 60 * 1000);
        nextDueDate = nextWindowStart;

        if (monthsTaken >= prescriptionMonths) {
          status = 'completed';
        } else {
          const today = new Date();
          status = today >= nextWindowStart ? 'due' : 'active';
        }
      }

      const candidate: CustomerSummary = {
        key,
        name,
        phone,
        address,
        doctorName: s.doctor_name || null,
        lastPurchase: lastDate.toISOString(),
        prescriptionMonths: prescriptionMonths ?? existing?.prescriptionMonths ?? null,
        monthsTaken: monthsTaken ?? existing?.monthsTaken ?? null,
        nextDueDate: nextDueDate ?? existing?.nextDueDate ?? null,
        status,
        totalBalance: 0, // Will be recomputed from allBills after collection
        allBills: [],
      };

      // keep the most recent sale info; accumulate all bills
      if (!existing || new Date(existing.lastPurchase || 0) < lastDate) {
        byKey.set(key, { 
          ...candidate, 
          totalBalance: 0, // placeholder — recalculated after loop
          allBills: [...(existing?.allBills || []), s] 
        });
      } else {
        existing.allBills.push(s);
      }
    });

    let list = Array.from(byKey.values());

    // Recompute totalBalance from allBills to avoid incremental accumulation bugs
    list.forEach(c => {
      const rawBalance = c.allBills.reduce((sum, bill) => {
        return sum + Number(bill.total_price || 0) - Number(bill.received_amount || 0);
      }, 0);
      // Use tolerance: treat anything < 0.01 as fully settled (floating point dust)
      c.totalBalance = rawBalance > 0.01 ? Math.round(rawBalance * 100) / 100 : 0;
    });

    // Apply Sorting
    if (sortBy === 'smart') {
      list.sort((a, b) => {
        // 1. Status priority: due > active > others
        const statusPriority = { due: 0, active: 1, completed: 2, unknown: 3 };
        const pA = statusPriority[a.status] ?? 3;
        const pB = statusPriority[b.status] ?? 3;
        if (pA !== pB) return pA - pB;

        // 2. Proximity of nextDueDate
        if (a.nextDueDate && b.nextDueDate) {
          return a.nextDueDate.getTime() - b.nextDueDate.getTime();
        }
        if (a.nextDueDate) return -1;
        if (b.nextDueDate) return 1;

        // 3. Fallback to months left (course remaining)
        const aLeft = (a.prescriptionMonths || 0) - (a.monthsTaken || 0);
        const bLeft = (b.prescriptionMonths || 0) - (b.monthsTaken || 0);
        return aLeft - bLeft;
      });
    } else if (sortBy === 'newest') {
      list.sort((a, b) => {
        const dateA = new Date(a.lastPurchase || 0).getTime();
        const dateB = new Date(b.lastPurchase || 0).getTime();
        return dateB - dateA; // Newest first
      });
    }

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [sales, searchTerm, sortBy]);

  const shareWhatsapp = (customer: CustomerSummary) => {
    let phone = customer.phone ? customer.phone.replace(/\D/g, '') : '';
    
    // Ensure phone number has country code for WhatsApp
    if (phone) {
      if (phone.length === 10) {
        // Indian 10-digit number, add 91
        phone = '91' + phone;
      } else if (phone.length === 12 && phone.startsWith('91')) {
        // Already has 91 prefix
        phone = phone;
      } else if (!phone.startsWith('91') && phone.length > 10) {
        // Other country codes, keep as is
        phone = phone;
      }
    }
    
    const due = customer.nextDueDate ? customer.nextDueDate.toLocaleDateString() : 'N/A';
    const prefix = customNote ? `${encodeURIComponent(customNote)}%0A%0A` : '';
    const msg = prefix + `Hello ${encodeURIComponent(customer.name || '')}%0A` +
      `This is a friendly reminder regarding your prescription.%0A` +
      `Prescribed months: ${encodeURIComponent(String(customer.prescriptionMonths ?? 'N/A'))}%0A` +
      `Months taken: ${encodeURIComponent(String(customer.monthsTaken ?? 'N/A'))}%0A` +
      `Next due date: ${encodeURIComponent(due)}%0A` +
      `- ${window.location.host}`;
    const url = `https://wa.me/${phone}?text=${msg}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
              Customer Relation
            </h1>
            <p className="text-muted-foreground text-lg mt-1">
              View customer prescriptions, reminders, and contact them directly
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-lg border border-emerald-100 text-emerald-700">
              <Filter className="h-4 w-4" />
              <span className="text-sm font-semibold">Sort By:</span>
            </div>
            <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
              <SelectTrigger className="w-[200px] h-10 border-emerald-100 focus:ring-emerald-500">
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="smart">Upcoming Due (Smart)</SelectItem>
                <SelectItem value="newest">Newest to Oldest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
          <Input
            placeholder="Search by name, phone, or address"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 h-12 text-lg shadow-sm border-gray-200"
          />
        </div>
      </div>

      <Card className="shadow-xl border-0 bg-gradient-to-br from-white to-gray-50">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold">Customers</CardTitle>
              <CardDescription className="text-lg mt-1">
                {loading ? 'Loading...' : `${customers.length} customers`}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-emerald-600 mx-auto"></div>
              <p className="mt-4 text-muted-foreground text-lg">Loading customers...</p>
            </div>
          ) : customers.length === 0 ? (
            <div className="text-center py-16">
              <div className="bg-gray-100 p-6 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                <AlertTriangle className="h-12 w-12 text-gray-400" />
              </div>
              <h3 className="text-2xl font-bold mb-2">No Customer Records</h3>
              <p className="text-muted-foreground text-lg mb-6">
                Customer information will appear when you record sales with customer details.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border-0 bg-white shadow-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-gradient-to-r from-emerald-50 to-teal-50">
                  <TableRow>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Name</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Phone</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Address</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Doctor</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Last Purchase</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Course</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Next Due</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Status</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Balance</TableHead>
                    <TableHead className="text-lg font-bold text-gray-700 py-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((c) => {
                    const dueStr = c.nextDueDate ? c.nextDueDate.toLocaleDateString() : '-';
                    const isExpanded = expandedCustomer === c.key;
                    return (
                      <>
                      <TableRow
                        key={c.key}
                        className="hover:bg-emerald-50 transition-colors cursor-pointer"
                        onClick={() => setExpandedCustomer(isExpanded ? null : c.key)}
                      >
                        <TableCell className="font-medium text-lg py-4">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronUp className="h-4 w-4 text-emerald-600" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                            {c.name}
                          </div>
                        </TableCell>
                        <TableCell className="text-lg py-4">{c.phone || '-'}</TableCell>
                        <TableCell className="text-lg py-4 truncate max-w-[180px]">{c.address || '-'}</TableCell>
                        <TableCell className="text-lg py-4">
                          {c.doctorName ? (
                            <span className="flex items-center gap-1 text-emerald-700">
                              <Stethoscope className="h-4 w-4" />
                              {c.doctorName}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-lg py-4">{c.lastPurchase ? new Date(c.lastPurchase).toLocaleDateString() : '-'}</TableCell>
                        <TableCell className="text-lg py-4">
                          {c.prescriptionMonths != null || c.monthsTaken != null ? (
                            <span>{Math.max(1, c.monthsTaken ?? 1)} / {c.prescriptionMonths ?? 0} months</span>
                          ) : (
                            <span>-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-lg py-4">{dueStr}</TableCell>
                        <TableCell className="py-4">
                          <Badge
                            variant={c.status === 'due' ? 'destructive' : c.status === 'active' ? 'default' : 'secondary'}
                            className="text-lg py-2 px-3"
                          >
                            {c.status === 'due' ? 'Due' : c.status === 'active' ? 'Active' : c.status === 'completed' ? 'Completed' : 'Unknown'}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4 font-bold">
                          {c.totalBalance > 0 ? (
                            <span className="text-orange-600">₹{c.totalBalance.toFixed(2)}</span>
                          ) : (
                            <span className="text-gray-400">₹0.00</span>
                          )}
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); shareWhatsapp(c); }}
                              className="h-12 w-12 hover:border-emerald-500 hover:bg-emerald-50 shadow-sm flex items-center justify-center p-0"
                              disabled={!c.phone}
                              title="WhatsApp"
                            >
                              <img src="/assets/whatsapp.png" alt="WhatsApp" className="h-10 w-10 object-contain" />
                            </Button>

                            {c.totalBalance > 0 && (
                              <div className="relative">
                                {/* Pulse ring to draw attention to outstanding dues */}
                                <span className="absolute inset-0 rounded-md animate-ping bg-orange-400 opacity-20 pointer-events-none" />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setSettlementCustomer(c);
                                    setSettlementAmount(c.totalBalance);
                                    setIsSettleDialogOpen(true);
                                  }}
                                  className="relative h-12 w-12 border-2 border-orange-400 text-orange-600 bg-orange-50 hover:bg-orange-100 hover:border-orange-500 shadow-md flex items-center justify-center p-0"
                                  title={`Pay Dues — ₹${c.totalBalance.toFixed(2)} outstanding`}
                                >
                                  <img 
                                    src="/assets/cash-stack.png" 
                                    alt="Pay Dues" 
                                    className="h-8 w-8 object-contain"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} 
                                  />
                                  <DollarSign className="h-5 w-5 absolute opacity-0 peer-[img:not([src])]:opacity-100" />
                                </Button>
                              </div>
                            )}

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-12 w-12 hover:bg-gray-100 p-0"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreVertical className="h-6 w-6 text-gray-400" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56 bg-white shadow-2xl border border-gray-100 p-2">
                                <DropdownMenuItem 
                                  className="text-red-600 focus:text-white focus:bg-red-600 cursor-pointer py-3 rounded-lg transition-all duration-200"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCustomerToDelete(c);
                                    setIsDeleteDialogOpen(true);
                                  }}
                                >
                                  <Trash2 className="mr-3 h-5 w-5" />
                                  <span className="font-bold">Delete Customer</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expanded prescription history */}
                      {isExpanded && (
                        <TableRow key={`${c.key}-expanded`}>
                          <TableCell colSpan={9} className="p-0 bg-emerald-50/50">
                            <div className="px-6 py-4">
                              {/* Group items by bill_id to show unique visits */}
                              <div className="space-y-2">
                                {(() => {
                                  const grouped = new Map<string, CrmSale>();
                                  c.allBills.forEach(b => {
                                    // Group by bill_id or created_at (transaction timestamp)
                                    const bid = b.bill_id || b.created_at;
                                    if (!grouped.has(bid)) {
                                      grouped.set(bid, b);
                                    }
                                  });
                                  const visits = Array.from(grouped.values()).sort((a, b) => 
                                    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                                  );

                                  return (
                                    <>
                                      <div className="flex items-center gap-2 mb-3">
                                        <FileText className="h-5 w-5 text-emerald-600" />
                                        <h4 className="font-bold text-emerald-800 text-base">
                                          Prescription History ({visits.length} visit{visits.length !== 1 ? 's' : ''})
                                        </h4>
                                      </div>
                                      <div className="bg-white rounded-xl border border-emerald-100 shadow-sm overflow-hidden">
                                        <Table>
                                          <TableHeader>
                                            <TableRow className="bg-emerald-50/50 hover:bg-emerald-50/50">
                                              <TableHead className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Date</TableHead>
                                              <TableHead className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Doctor</TableHead>
                                              <TableHead className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Mode</TableHead>
                                              <TableHead className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Refill</TableHead>
                                              <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider text-emerald-700">Bill Amt</TableHead>
                                              <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider text-emerald-700">Bal</TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {visits.map((bill) => {
                                              const billItems = c.allBills.filter(b => (b.bill_id || b.created_at) === (bill.bill_id || bill.created_at));
                                              const billTotal = billItems.reduce((sum, item) => sum + Number(item.total_price || 0), 0);
                                              const billReceived = billItems.reduce((sum, item) => sum + Number(item.received_amount || 0), 0);
                                              const billBalance = billTotal - billReceived;
                                              
                                              return (
                                                <TableRow key={bill.id} className="hover:bg-emerald-50/30">
                                                  <TableCell>
                                                    <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                                                      <CalendarDays className="h-3.5 w-3.5" />
                                                      {new Date(bill.sale_date || bill.created_at).toLocaleDateString()}
                                                    </div>
                                                  </TableCell>
                                                  <TableCell>
                                                    {bill.doctor_name ? (
                                                      <div className="flex items-center gap-1 text-blue-700 font-medium text-xs">
                                                        <Stethoscope className="h-3 w-3" />
                                                        {bill.doctor_name}
                                                      </div>
                                                    ) : (
                                                      <span className="text-gray-400 text-xs">-</span>
                                                    )}
                                                  </TableCell>
                                                  <TableCell>
                                                    <Badge 
                                                      variant={bill.payment_mode === 'credit' ? 'destructive' : 'outline'}
                                                      className={`text-[9px] font-bold uppercase ${
                                                        bill.payment_mode === 'credit' 
                                                          ? 'bg-orange-50 text-orange-600 border-orange-200' 
                                                          : 'text-gray-400'
                                                      }`}
                                                    >
                                                      {bill.payment_mode || 'cash'}
                                                    </Badge>
                                                  </TableCell>
                                                  <TableCell className="text-gray-600 text-xs">
                                                    {Math.max(1, bill.months_taken ?? 1)}/{bill.prescription_months || 0}m
                                                  </TableCell>
                                                  <TableCell className="text-right font-medium text-xs text-gray-900">₹{billTotal.toFixed(2)}</TableCell>
                                                  <TableCell className={`text-right font-bold text-xs ${billBalance > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>
                                                    ₹{billBalance.toFixed(2)}
                                                  </TableCell>
                                                </TableRow>
                                              );
                                            })}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settlement Dialog */}
      <Dialog open={isSettleDialogOpen} onOpenChange={setIsSettleDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <img src="/assets/cash-stack.png" alt="Dues" className="h-6 w-6 object-contain" />
              Settle Dues - {settlementCustomer?.name}
            </DialogTitle>
            <DialogDescription>
              Record a payment to reduce or clear the outstanding balance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 flex justify-between items-center">
              <div>
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wider">Total Outstanding</p>
                <p className="text-2xl font-black text-orange-900">₹{settlementCustomer?.totalBalance.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-orange-400 uppercase">Customer Phone</p>
                <p className="text-sm font-medium text-orange-700">{settlementCustomer?.phone || 'No Phone'}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="paymentAmount" className="text-sm font-bold">Payment Amount (₹)</Label>
                <div className="relative">
                  <img src="/assets/cash-stack.png" alt="Dues" className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 object-contain opacity-70" />
                  <Input
                    id="paymentAmount"
                    type="number"
                    value={settlementAmount || ''}
                    onChange={(e) => setSettlementAmount(parseFloat(e.target.value) || 0)}
                    className="pl-10 text-xl font-bold py-6 focus:ring-orange-500 border-gray-200"
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setSettlementAmount(settlementCustomer?.totalBalance || 0)}
                    className="text-[10px] h-6 px-2 bg-orange-100 text-orange-700 hover:bg-orange-200"
                  >
                    Pay Full Amount
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setSettlementAmount((settlementCustomer?.totalBalance || 0) / 2)}
                    className="text-[10px] h-6 px-2 bg-gray-100 text-gray-600 hover:bg-gray-200"
                  >
                    Pay Half
                  </Button>
                </div>
              </div>
            </div>

            <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100 space-y-1">
              <p className="text-[10px] font-bold text-blue-600 uppercase">Action Result</p>
              <div className="flex justify-between items-center">
                <span className="text-sm text-blue-700">Remaining Balance:</span>
                <span className="text-sm font-bold text-blue-800">
                  ₹{Math.max(0, (settlementCustomer?.totalBalance || 0) - settlementAmount).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsSettleDialogOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSettlePayments}
              className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
              disabled={isSettling || settlementAmount <= 0}
            >
              {isSettling ? 'Processing...' : 'Confirm Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <UserMinus className="h-5 w-5" />
              Delete Customer - {customerToDelete?.name}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base py-2">
              Are you absoluteley sure? This will delete <strong>all sales history</strong> and <strong>outstanding balances</strong> for this customer.
              <br /><br />
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0 font-bold">
            <AlertDialogCancel disabled={isDeleting} className="border-gray-200">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCustomer}
              className="bg-destructive hover:bg-destructive/90 text-white"
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}



