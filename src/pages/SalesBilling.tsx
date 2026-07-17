import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/db_conn/supabaseClient';
import { cn } from '@/lib/utils';
import { X, Plus } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import RecordSale, { type Product, type Settings } from './RecordSale';
import { useBillSessions, type BillSession } from '@/hooks/useBillSessions';

/**
 * Multi-customer parallel billing.
 *
 * Renders ONE <RecordSale/> per open tab, keeping them all mounted so each
 * tab keeps its full independent state; only the active one is visible.
 * Product + settings data is fetched ONCE here and shared across every tab,
 * which also lets a Quick-Add'd medicine appear in all tabs instantly.
 */
export default function SalesBilling() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // ─── Shared data (fetched once, passed to every tab) ─────────────────────
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  // ─── Tab sessions ────────────────────────────────────────────────────────
  const { sessions, activeId, setActiveId, addSession, addSessionWithData, closeSession, updateMeta } = useBillSessions();
  const [pendingClose, setPendingClose] = useState<BillSession | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const editHandled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [prodRes, settingsRes] = await Promise.all([
          supabase
            .from('products')
            .select('id, name, quantity, selling_price, gst, hsn_code, batch_number, expiry_date, pcs_per_unit, category, manufacturer')
            .gt('quantity', 0),
          profile?.account_id
            ? supabase.from('settings').select('gst_enabled, default_gst_rate, gst_type').eq('account_id', profile.account_id).single()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (cancelled) return;
        if (prodRes.error) throw prodRes.error;
        setProducts((prodRes.data as any) || []);
        if (settingsRes.data) setSettings(settingsRes.data as any);
      } catch (err: any) {
        if (!cancelled) toast({ variant: 'destructive', title: 'Error loading data', description: err.message });
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [profile?.account_id, toast]);

  // ─── Edit a finalized bill: ?edit=<billId> opens it here, pre-filled ───────
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || editHandled.current || dataLoading) return;
    editHandled.current = true;
    (async () => {
      try {
        const { data: saleRows, error } = await (supabase.from('sales') as any)
          .select('*')
          .eq('bill_id', editId);
        if (error) throw error;
        if (!saleRows || saleRows.length === 0) {
          toast({ variant: 'destructive', title: 'Bill not found', description: 'Could not load this bill for editing.' });
          return;
        }
        const first: any = saleRows[0];
        const ids = Array.from(new Set(saleRows.map((r: any) => r.product_id)));
        const { data: prods } = await supabase
          .from('products')
          .select('id, name, quantity, selling_price, gst, hsn_code, batch_number, expiry_date, pcs_per_unit')
          .in('id', ids as any);
        const pmap = new Map((prods || []).map((p: any) => [p.id, p]));

        const rows = saleRows.map((r: any) => {
          const p: any = pmap.get(r.product_id) || {};
          return {
            uid: crypto.randomUUID(),
            productId: r.product_id,
            productName: p.name || 'Product',
            stock: Number(p.quantity) || 0,
            qty: Number(r.quantity) || 0,
            subQty: r.sub_qty ?? '',
            pcsPerUnit: Number(r.pcs_per_unit || p.pcs_per_unit || 10),
            batch: p.batch_number || '',
            expiry: p.expiry_date ? String(p.expiry_date).substring(0, 7) : '',
            hsn: p.hsn_code || '',
            mrp: Number(p.selling_price ?? r.unit_price ?? 0),
            rate: Number(r.unit_price) || 0,
            gst: Number(p.gst ?? 0),
            discount: Number(r.discount_percentage) || 0,
            amount: Number(r.total_price) || 0,
          };
        });

        const draft = {
          customerName: first.customer_name === 'Walk-in Customer' ? '' : (first.customer_name || ''),
          customerPhone: first.customer_phone || '',
          customerAddress: first.customer_address || '',
          doctorName: first.doctor_name || '',
          billDate: first.sale_date || new Date().toISOString().split('T')[0],
          prescriptionMonths: first.prescription_months ?? '',
          monthsTaken: first.months_taken ?? 1,
          rows,
          paymentMode: first.payment_mode || 'cash',
          receivedAmount: '',
          globalDiscount: 0,
          editBillId: editId,
        };

        const id = addSessionWithData(draft);
        if (!id) {
          toast({ variant: 'destructive', title: 'Close a bill first', description: 'You have the maximum number of bills open.' });
        }
      } catch (err: any) {
        toast({ variant: 'destructive', title: 'Error loading bill', description: err.message });
      } finally {
        // Drop the query param so a refresh doesn't re-load it.
        searchParams.delete('edit');
        setSearchParams(searchParams, { replace: true });
      }
    })();
  }, [searchParams, setSearchParams, dataLoading, addSessionWithData, toast]);

  // (No refresh warning needed -every open bill is saved to localStorage and
  //  restored automatically, so a refresh or app reopen loses nothing.)

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleAddTab = useCallback(() => {
    if (!addSession()) {
      toast({ variant: 'destructive', title: 'Limit reached', description: 'Maximum 5 parallel bills allowed at a time.' });
    }
  }, [addSession, toast]);

  const requestClose = useCallback((s: BillSession) => {
    if (sessions.length <= 1) return; // always keep at least one tab
    if (s.meta.itemCount > 0) setPendingClose(s);
    else closeSession(s.id);
  }, [sessions.length, closeSession]);

  const handleCompleted = useCallback((sessionId: string, billId: string) => {
    if (sessions.length <= 1) {
      // Only bill open → identical to the original single-bill flow.
      navigate(`/print-bill/${billId}`);
    } else {
      // Other bills are open → don't unmount them. Print in a new tab, close this one.
      window.open(`/print-bill/${billId}`, '_blank', 'noopener');
      closeSession(sessionId);
      toast({ title: 'Bill completed ✓', description: 'Print opened in a new tab. Your other bills are preserved.' });
    }
  }, [sessions.length, navigate, closeSession, toast]);

  const handleProductCreated = useCallback((p: Product) => {
    setProducts(prev => (prev.some(x => x.id === p.id) ? prev : [p, ...prev]));
  }, []);

  // ─── Switch bills: number keys 1–5 and arrow keys ───────────────────────
  // Guarded so it never fires while typing in a form field (so entering a
  // quantity like "2" isn't hijacked). Tab / Shift+Tab still work natively.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return; // don't steal keystrokes from form fields
      }

      // 1–5 → jump straight to that bill
      if (/^[1-5]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (sessions[idx]) { e.preventDefault(); setActiveId(sessions[idx].id); }
        return;
      }

      // ← ↑ previous · → ↓ next
      if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
        if (sessions.length < 2) return;
        const idx = sessions.findIndex(s => s.id === activeId);
        if (idx === -1) return;
        e.preventDefault();
        const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
        const nextIdx = forward
          ? (idx + 1) % sessions.length
          : (idx - 1 + sessions.length) % sessions.length;
        setActiveId(sessions[nextIdx].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sessions, activeId, setActiveId]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-100">
      {/* ══════ TAB BAR -browser-style tabs (active tab connects to content below) ══════ */}
      <div className="shrink-0 flex items-end gap-1 bg-muted px-1.5 pt-1.5 border-b border-border">
        {/* Tab strip -tabs shrink to fit, no scrollbar */}
        <div role="tablist" aria-label="Open bills" className="flex items-end gap-0.5 overflow-hidden flex-1 min-w-0">
          {sessions.map((s, i) => {
            const isActive = s.id === activeId;
            const label = s.meta.customerName || `Bill ${s.seq}`;
            return (
              <div
                key={s.id}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                title={`${label} -Tab / Shift+Tab to switch bills`}
                onClick={() => setActiveId(s.id)}
                onFocus={() => setActiveId(s.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveId(s.id); }
                  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); requestClose(s); }
                }}
                className={cn(
                  'group relative flex items-center gap-1.5 h-8 pl-2.5 pr-1.5 rounded-t-lg cursor-pointer select-none whitespace-nowrap max-w-[190px] min-w-0 outline-none transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400',
                  isActive
                    ? 'bg-background text-foreground shadow-[0_-1px_4px_rgba(0,0,0,0.06)] -mb-px' // white tab meets the white content below
                    : 'bg-transparent text-muted-foreground hover:bg-background/50',
                )}
              >
                {/* Bill number -sits where a browser favicon would */}
                <span className={cn('grid place-items-center h-4 w-4 rounded shrink-0 text-[9px] font-bold tabular-nums', isActive ? 'bg-emerald-600 text-white' : 'bg-muted-foreground/15 text-muted-foreground')}>
                  {i + 1}
                </span>

                {s.meta.dirty && (
                  <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-amber-500" title="Unsaved" />
                )}

                <span className="truncate text-xs font-medium flex-1 min-w-0">{label}</span>

                {s.meta.itemCount > 0 && (
                  <span className={cn('text-[9px] font-bold px-1 h-3.5 grid place-items-center rounded-full shrink-0 tabular-nums', isActive ? 'bg-emerald-600 text-white' : 'bg-muted-foreground/15 text-muted-foreground')}>
                    {s.meta.itemCount}
                  </span>
                )}

                {/* Close -always shown on active, on hover otherwise (browser behaviour) */}
                {sessions.length > 1 && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={e => { e.stopPropagation(); requestClose(s); }}
                    className={cn(
                      'shrink-0 grid place-items-center h-5 w-5 min-h-0 p-0 rounded-md text-muted-foreground/60 hover:bg-red-100 hover:text-red-500 transition-all',
                      isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                    aria-label={`Close ${label}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* New tab -matches the tab cells' height, padding, font & radius */}
          <button
            type="button"
            onClick={handleAddTab}
            title="New parallel bill (Alt+N)"
            aria-label="New parallel bill"
            className={cn(
              'group relative flex items-center gap-1.5 h-7 min-h-0 py-0 px-2.5 rounded-t-lg whitespace-nowrap shrink-0 outline-none transition-colors',
              'bg-transparent text-muted-foreground hover:bg-background/50 hover:text-foreground',
              'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400',
            )}
          >
            <span className="grid place-items-center h-4 w-4 rounded shrink-0 bg-muted-foreground/15 text-muted-foreground">
              <Plus className="h-3 w-3" strokeWidth={2.5} />
            </span>
            <span className="text-xs font-medium">New</span>
          </button>
        </div>
      </div>

      {/* ══════ BILL INSTANCES (all mounted, only active visible) ══════ */}
      <div className="relative flex-1">
        {sessions.map(s => {
          const isActive = s.id === activeId;
          return (
            <div key={s.id} className={cn('absolute inset-0', !isActive && 'hidden')} aria-hidden={!isActive}>
              <RecordSale
                embedded
                isActive={isActive}
                persistKey={s.id}
                injectedProducts={products}
                injectedSettings={settings}
                dataLoading={dataLoading}
                onMetaChange={meta => updateMeta(s.id, meta)}
                onCompleted={billId => handleCompleted(s.id, billId)}
                onProductCreated={handleProductCreated}
              />
            </div>
          );
        })}
      </div>

      {/* ══════ CLOSE CONFIRMATION ══════ */}
      <AlertDialog open={!!pendingClose} onOpenChange={o => { if (!o) setPendingClose(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this bill?</AlertDialogTitle>
            <AlertDialogDescription>
              This will discard {pendingClose?.meta.itemCount ?? 0} item(s) for{' '}
              <strong>{pendingClose?.meta.customerName || `Bill ${pendingClose?.seq}`}</strong>. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (pendingClose) closeSession(pendingClose.id);
                setPendingClose(null);
              }}
            >
              Discard bill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
