import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { AlertTriangle, MessageCircle, Search, ChevronDown, ChevronUp, Stethoscope, CalendarDays, FileText, Filter } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  prescription_notes: string | null;
  bill_id?: string | null;
  account_id?: string | null;
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
  notes: string | null;
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

  useEffect(() => {
    const fetchCrm = async () => {
      try {
        const { data, error } = await supabase
          .from('sales')
          .select('id, created_at, bill_id, customer_name, customer_phone, customer_address, doctor_name, sale_date, prescription_months, months_taken, prescription_notes, account_id')
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
              .select('id, created_at, customer_name, customer_phone, customer_address, doctor_name, sale_date, prescription_months, months_taken, prescription_notes, account_id')
              .eq('account_id', profile?.account_id)
              .not('customer_phone', 'is', null)
              .neq('customer_phone', '')
              .order('created_at', { ascending: false });
            
            if (fallbackError) throw fallbackError;
            setSales((fallbackData as any[]) || []);
          } else {
            throw error;
          }
        } else {
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

    if (profile?.account_id) fetchCrm();
  }, [profile?.account_id]);

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
      const notes = s.prescription_notes || null;

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
        notes,
        allBills: [],
      };

      // keep the most recent sale info
      if (!existing || new Date(existing.lastPurchase || 0) < lastDate) {
        byKey.set(key, { ...candidate, allBills: [...(existing?.allBills || []), s] });
      } else {
        existing.allBills.push(s);
      }
    });

    let list = Array.from(byKey.values());

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
      `${customer.notes ? `%0ANotes: ${encodeURIComponent(customer.notes)}` : ''}%0A` +
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
                        <TableCell className="py-4">
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); shareWhatsapp(c); }}
                              className="text-lg py-2 px-4"
                              disabled={!c.phone}
                            >
                              <MessageCircle className="h-5 w-5 mr-1" />
                              WhatsApp
                            </Button>
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
                                      <div className="space-y-2">
                                        {visits.map(bill => (
                                          <div key={bill.id} className="bg-white rounded-xl border border-emerald-100 p-4 text-sm shadow-sm">
                                            <div className="flex flex-wrap gap-4 items-start">
                                              <div className="flex items-center gap-1 text-gray-500">
                                                <CalendarDays className="h-4 w-4" />
                                                <span className="font-medium">{bill.sale_date ? new Date(bill.sale_date).toLocaleDateString() : new Date(bill.created_at).toLocaleDateString()}</span>
                                              </div>
                                              {bill.doctor_name && (
                                                <div className="flex items-center gap-1 text-emerald-700">
                                                  <Stethoscope className="h-4 w-4" />
                                                  <span className="font-medium">Dr. {bill.doctor_name}</span>
                                                </div>
                                              )}
                                              {(bill.prescription_months != null || bill.months_taken != null) && (
                                                <div className="text-gray-600">
                                                  Course: <span className="font-medium">{Math.max(1, bill.months_taken ?? 1)}/{bill.prescription_months ?? 0} months</span>
                                                </div>
                                              )}
                                              {bill.prescription_notes && (
                                                <div className="text-gray-600 flex-1">
                                                  Notes: <span className="font-medium italic">{bill.prescription_notes}</span>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        ))}
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
    </div>
  );
}



