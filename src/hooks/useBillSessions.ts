import { useCallback, useEffect, useState } from 'react';

export const MAX_BILL_TABS = 5;

// localStorage keys - the tab list, and one entry per bill's full contents.
const SESSIONS_KEY = 'medstocksy.billSessions';
export const BILL_DATA_PREFIX = 'medstocksy.bill.';

/**
 * Retail and wholesale billing are separate workspaces, so they get separate
 * storage. The retail namespace is undefined and keeps the ORIGINAL keys, so
 * bills already open in a user's browser survive this change untouched.
 */
export type BillNamespace = 'wholesale' | undefined;

const sessionsKey = (ns: BillNamespace) => (ns ? `${SESSIONS_KEY}.${ns}` : SESSIONS_KEY);
export const billDataPrefix = (ns: BillNamespace) =>
  ns ? `${BILL_DATA_PREFIX}${ns}.` : BILL_DATA_PREFIX;

/** Remove a single bill's saved contents (on close / finalize). */
export function clearBillData(id: string, ns?: BillNamespace) {
  try { localStorage.removeItem(billDataPrefix(ns) + id); } catch { /* ignore */ }
}

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

interface PersistedSessions {
  sessions: BillSession[];
  activeId: string;
  seqCounter: number;
}

// Read the saved tab list once at startup; fall back to a single fresh bill.
function loadInitial(ns: BillNamespace): PersistedSessions {
  try {
    const raw = localStorage.getItem(sessionsKey(ns));
    if (raw) {
      const p = JSON.parse(raw) as PersistedSessions;
      if (Array.isArray(p?.sessions) && p.sessions.length) {
        const sanitized: BillSession[] = p.sessions
          .filter(s => s && typeof s.id === 'string')
          .map(s => ({
            id: s.id,
            seq: Number(s.seq) || 1,
            meta: {
              itemCount: Number(s.meta?.itemCount) || 0,
              customerName: String(s.meta?.customerName || ''),
              dirty: Boolean(s.meta?.dirty),
            },
          }));
        if (sanitized.length > 0) {
          const activeId = sanitized.some(s => s.id === p.activeId) ? p.activeId : sanitized[0].id;
          return { sessions: sanitized, activeId, seqCounter: Number(p.seqCounter) || sanitized.length };
        }
      }
    }
  } catch { /* ignore corrupt data */ }
  const s = newSession(1);
  return { sessions: [s], activeId: s.id, seqCounter: 1 };
}

/**
 * Manages the set of parallel billing sessions (tabs).
 * The tab list is persisted to localStorage so open bills survive a refresh
 * or an app reopen; each bill's contents are persisted by its <RecordSale/>.
 */
export function useBillSessions(namespace?: BillNamespace) {
  const [initial] = useState(() => loadInitial(namespace));
  const [seqCounter, setSeqCounter] = useState(initial.seqCounter);
  const [sessions, setSessions] = useState<BillSession[]>(initial.sessions);
  const [activeId, setActiveId] = useState<string>(initial.activeId);

  const canAddMore = sessions.length < MAX_BILL_TABS;

  // Persist the tab list on every change.
  useEffect(() => {
    try {
      localStorage.setItem(sessionsKey(namespace), JSON.stringify({ sessions, activeId, seqCounter }));
    } catch { /* ignore quota errors */ }
  }, [sessions, activeId, seqCounter, namespace]);

  const addSession = useCallback((): boolean => {
    // Decide from the current render's length - a functional-updater side effect
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

  // Create a new tab pre-loaded with bill data (used when editing a finalized
  // bill). The data is written to localStorage BEFORE the tab is added so the
  // freshly-mounted <RecordSale/> hydrates it. Returns the new id, or null if full.
  const addSessionWithData = useCallback((data: unknown): string | null => {
    if (sessions.length >= MAX_BILL_TABS) return null;
    const nextSeq = seqCounter + 1;
    const s = newSession(nextSeq);
    try { localStorage.setItem(billDataPrefix(namespace) + s.id, JSON.stringify(data)); } catch { /* ignore */ }
    setSeqCounter(nextSeq);
    setSessions(prev => (prev.length >= MAX_BILL_TABS ? prev : [...prev, s]));
    setActiveId(s.id);
    return s.id;
  }, [sessions.length, seqCounter, namespace]);

  const closeSession = useCallback((id: string) => {
    clearBillData(id, namespace); // drop this bill's saved contents
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
  }, [namespace]);

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

  return { sessions, activeId, setActiveId, addSession, addSessionWithData, closeSession, updateMeta, canAddMore };
}
