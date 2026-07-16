import { useCallback, useState } from 'react';

export const MAX_BILL_TABS = 5;

export interface BillSessionMeta {
  itemCount: number;
  customerName: string;
  dirty: boolean;
}

export interface BillSession {
  id: string;
  seq: number; // stable number for the "Bill N" label (never renumbered)
  meta: BillSessionMeta;
}

const EMPTY_META: BillSessionMeta = { itemCount: 0, customerName: '', dirty: false };

function newSession(seq: number): BillSession {
  return { id: crypto.randomUUID(), seq, meta: { ...EMPTY_META } };
}

/**
 * Manages the set of parallel billing sessions (tabs).
 * Each session is just an id + a display-seq + lightweight meta for the tab
 * badge. The heavy per-bill state lives inside each mounted <RecordSale/>.
 */
export function useBillSessions() {
  const [seqCounter, setSeqCounter] = useState(1);
  const [sessions, setSessions] = useState<BillSession[]>(() => [newSession(1)]);
  const [activeId, setActiveId] = useState<string>(() => sessions[0].id);

  const canAddMore = sessions.length < MAX_BILL_TABS;

  const addSession = useCallback((): boolean => {
    // Decide from the current render's length — a functional-updater side effect
    // is NOT reliable to read back synchronously, which previously made this
    // always report failure (spurious "limit reached").
    if (sessions.length >= MAX_BILL_TABS) return false;
    const nextSeq = seqCounter + 1;
    const s = newSession(nextSeq);
    setSeqCounter(nextSeq);
    setSessions(prev => (prev.length >= MAX_BILL_TABS ? prev : [...prev, s]));
    setActiveId(s.id);
    return true;
  }, [sessions.length, seqCounter]);

  const closeSession = useCallback((id: string) => {
    setSessions(prev => {
      if (prev.length <= 1) return prev; // always keep at least one
      const idx = prev.findIndex(s => s.id === id);
      const next = prev.filter(s => s.id !== id);
      // If we closed the active tab, activate a neighbour
      setActiveId(cur => {
        if (cur !== id) return cur;
        const fallback = next[Math.max(0, idx - 1)] ?? next[0];
        return fallback.id;
      });
      return next;
    });
  }, []);

  const updateMeta = useCallback((id: string, meta: BillSessionMeta) => {
    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx === -1) return prev;
      const cur = prev[idx].meta;
      if (cur.itemCount === meta.itemCount && cur.customerName === meta.customerName && cur.dirty === meta.dirty) {
        return prev; // no change → avoid re-render storm
      }
      const next = [...prev];
      next[idx] = { ...next[idx], meta };
      return next;
    });
  }, []);

  return { sessions, activeId, setActiveId, addSession, closeSession, updateMeta, canAddMore };
}
