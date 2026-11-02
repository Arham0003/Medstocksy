import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, GripHorizontal, Delete } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A counter calculator that floats over the billing screen.
 *
 * Opened with F12, or Alt+C. Both are bound because a browser tab keeps F12
 * for its developer tools and a page cannot take it back - the key only
 * reaches us in the installed app, or when dev tools are already closed and
 * the browser allows it. Alt+C always works, and the panel says so.
 *
 * It does not touch the bill. It is a scratch pad for "what do I owe you" -
 * the sort of sum that otherwise happens on a phone beside the till.
 */

const KEYS: string[][] = [
  ['7', '8', '9', '/'],
  ['4', '5', '6', '*'],
  ['1', '2', '3', '-'],
  ['0', '.', '=', '+'],
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function FloatingCalculator({ open, onClose }: Props) {
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // '=' must read the expression as it stands right now, not as it stood when
  // this render's closure was made. Two keys pressed inside one task - a fast
  // operator, or a key repeat - would otherwise evaluate a stale expression.
  const exprRef = useRef('');
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Arithmetic only. The input is restricted to digits, the four operators,
  // brackets and a decimal point before it is evaluated, so nothing else can
  // be smuggled into the expression.
  const evaluate = useCallback((raw: string): string | null => {
    const cleaned = raw.trim();
    if (!cleaned) return null;
    if (!/^[0-9+\-*/().\s]+$/.test(cleaned)) return 'Error';
    try {
      const value = Function(`"use strict"; return (${cleaned});`)();
      if (typeof value !== 'number' || !isFinite(value)) return 'Error';
      return String(Math.round(value * 100) / 100);
    } catch {
      return 'Error';
    }
  }, []);

  // One place that writes the expression, so the ref can never drift from it.
  const writeExpr = useCallback((next: string | ((prev: string) => string)) => {
    // The ref is written here, synchronously, rather than inside the state
    // updater: React runs updaters when it renders, so a ref set in there is
    // still stale for anything that happens later in the same task.
    const value = typeof next === 'function' ? next(exprRef.current) : next;
    exprRef.current = value;
    setExpr(value);
  }, []);

  const press = useCallback((key: string) => {
    if (key === '=') {
      const current = exprRef.current;
      const value = evaluate(current);
      if (value === null) return;
      setResult(value);
      if (value !== 'Error') {
        setHistory(h => [`${current} = ${value}`, ...h].slice(0, 4));
        writeExpr(value);
      }
      return;
    }
    setResult(null);
    writeExpr(e => e + key);
  }, [evaluate, writeExpr]);

  // Closes an open bracket if there is one, otherwise opens a new one.
  const bracket = useCallback(() => {
    setResult(null);
    writeExpr(e => {
      const open = (e.match(/\(/g) || []).length;
      const close = (e.match(/\)/g) || []).length;
      return e + (open > close && /[0-9)]$/.test(e) ? ')' : '(');
    });
  }, [writeExpr]);

  const clearAll = useCallback(() => { writeExpr(''); setResult(null); }, [writeExpr]);
  const backspace = useCallback(() => { setResult(null); writeExpr(e => e.slice(0, -1)); }, [writeExpr]);

  // Keyboard, while the panel has focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel || !panel.contains(document.activeElement)) return;
      if (/^[0-9]$/.test(e.key) || ['+', '-', '*', '/', '.', '(', ')'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation(); press(e.key);
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault(); e.stopPropagation(); press('=');
      } else if (e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation(); backspace();
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); onClose();
      } else if (e.key.toLowerCase() === 'c' && !e.altKey && !e.ctrlKey) {
        e.preventDefault(); e.stopPropagation(); clearAll();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, press, backspace, clearAll, onClose]);

  // Focus the panel when it opens so the keypad responds immediately.
  useEffect(() => {
    if (open) setTimeout(() => panelRef.current?.focus(), 30);
  }, [open]);

  // Dragging, so it can be moved off whatever it is covering.
  useEffect(() => {
    if (!open) return;
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const width = panelRef.current?.offsetWidth ?? 260;
      const height = panelRef.current?.offsetHeight ?? 340;
      setPos({
        x: Math.min(Math.max(8, e.clientX - dragRef.current.dx), window.innerWidth - width - 8),
        y: Math.min(Math.max(8, e.clientY - dragRef.current.dy), window.innerHeight - height - 8),
      });
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [open]);

  if (!open) return null;

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : { right: 20, bottom: 20 };

  return createPortal(
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Calculator"
      className="fixed z-[70] w-[260px] rounded-xl border border-slate-200 bg-white shadow-2xl outline-none select-none"
      style={style}
    >
      {/* Drag handle */}
      <div
        className="flex items-center justify-between gap-2 rounded-t-xl border-b border-slate-100 bg-slate-50 px-3 py-2 cursor-move"
        onMouseDown={e => {
          const rect = panelRef.current!.getBoundingClientRect();
          dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
        }}
      >
        <div className="flex items-center gap-1.5 text-slate-500">
          <GripHorizontal className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wide">Calculator</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close calculator"
          className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Display */}
      <div className="px-3 pt-2.5 pb-2 text-right">
        {history.length > 0 && (
          <div className="mb-1 space-y-0.5">
            {history.slice(0, 2).map((h, i) => (
              <div key={i} className="truncate text-[10px] text-slate-400">{h}</div>
            ))}
          </div>
        )}
        <div className="min-h-[14px] truncate text-[11px] text-slate-400">
          {result && result !== 'Error' ? expr : ''}
        </div>
        <div className={cn(
          'truncate text-2xl font-bold tabular-nums',
          result === 'Error' ? 'text-red-600' : 'text-slate-900',
        )}>
          {result ?? (expr || '0')}
        </div>
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-4 gap-1 p-2 pt-0">
        <button type="button" onClick={clearAll}
          className="col-span-2 h-10 rounded-lg bg-red-50 text-sm font-bold text-red-600 hover:bg-red-100">
          Clear
        </button>
        <button type="button" onClick={backspace} aria-label="Backspace"
          className="h-10 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 grid place-items-center">
          <Delete className="h-4 w-4" />
        </button>
        <button type="button" onClick={bracket}
          className="h-10 rounded-lg bg-slate-100 text-sm font-semibold text-slate-700 hover:bg-slate-200">
          ( )
        </button>

        {KEYS.flat().map(k => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className={cn(
              'h-10 rounded-lg text-sm font-semibold transition-colors',
              k === '='
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : /[0-9.]/.test(k)
                  ? 'bg-slate-50 text-slate-900 hover:bg-slate-100'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
            )}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="border-t border-slate-100 px-3 py-1.5 text-center text-[10px] text-slate-400">
        F12 or Alt+C to toggle · Esc to close
      </div>
    </div>,
    document.body,
  );
}
