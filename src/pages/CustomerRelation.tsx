import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, MessageCircle, Search } from 'lucide-react';

type CrmSale = {
  id: string;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  prescription_months: number | null;
  months_taken: number | null;
  prescription_notes: string | null;
};

type CustomerSummary = {
  key: string; // phone or name fallback
  name: string;
  phone: string | null;
  address: string | null;
  lastPurchase: string | null;
  prescriptionMonths: number | null;
  monthsTaken: number | null;
  nextDueDate: Date | null;
  status: 'due' | 'active' | 'completed' | 'unknown';
  notes: string | null;
};

export default function CustomerRelation() {
  const { profile } = useAuth();
  const [sales, setSales] = useState<CrmSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [customNote, setCustomNote] = useState<string>('');

  useEffect(() => {
    const fetchCrm = async () => {
      try {
        const { data, error } = await supabase
          .from('sales')
          .select('id, created_at, customer_name, customer_phone, customer_address, prescription_months, months_taken, prescription_notes, account_id')
          .eq('account_id', profile?.account_id)
          .not('customer_phone', 'is', null)
          .neq('customer_phone', '')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setSales(data || []);

        // fetch custom note from settings
        const settingsRes = await supabase
          .from('settings')
          .select('whatsapp_custom_note')
          .eq('account_id', profile?.account_id)
          .single();
        if (!settingsRes.error) {
          setCustomNote(settingsRes.data?.whatsapp_custom_note || '');
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
        lastPurchase: lastDate.toISOString(),
        prescriptionMonths: prescriptionMonths ?? existing?.prescriptionMonths ?? null,
        monthsTaken: monthsTaken ?? existing?.monthsTaken ?? null,
        nextDueDate: nextDueDate ?? existing?.nextDueDate ?? null,
        status,
        notes,
      };

      // keep the most recent sale info
      if (!existing || new Date(existing.lastPurchase || 0) < lastDate) {
        byKey.set(key, candidate);
      }
    });

    let list = Array.from(byKey.values());
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [sales, searchTerm]);

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
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
            Customer Relation
          </h1>
          <p className="text-muted-foreground text-lg mt-2">
            View customer prescriptions, reminders, and contact them directly
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
          <Input
            placeholder="Search by name, phone, or address"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
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
                    return (
                      <TableRow key={c.key} className="hover:bg-emerald-50 transition-colors">
                        <TableCell className="font-medium text-lg py-4">{c.name}</TableCell>
                        <TableCell className="text-lg py-4">{c.phone || '-'}</TableCell>
                        <TableCell className="text-lg py-4 truncate max-w-[220px]">{c.address || '-'}</TableCell>
                        <TableCell className="text-lg py-4">{c.lastPurchase ? new Date(c.lastPurchase).toLocaleDateString() : '-'}</TableCell>
                        <TableCell className="text-lg py-4">
                          {c.prescriptionMonths != null || c.monthsTaken != null ? (
                            <span>{c.monthsTaken ?? 0} / {c.prescriptionMonths ?? 0} months</span>
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
                              onClick={() => shareWhatsapp(c)}
                              className="text-lg py-2 px-4"
                              disabled={!c.phone}
                            >
                              <MessageCircle className="h-5 w-5 mr-1" />
                              WhatsApp
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
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


