import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { HsnCode } from '@/hooks/useHsnCodes';

interface HsnPickerProps {
  codes: HsnCode[];
  value: string;
  onChange: (hsn: string) => void;
  /** Fired only when the user picks a code that carries a rate. */
  onRateResolved?: (rate: number) => void;
  id?: string;
  name?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * HSN autocomplete over the account's hsn_codes master.
 *
 * Free text is still accepted: a pharmacy will occasionally stock something
 * whose HSN is not in the master yet, and blocking the sale over that would
 * be worse than an unmatched code. Picking a listed code auto-fills the GST
 * rate through onRateResolved.
 */
export function HsnPicker({
  codes,
  value,
  onChange,
  onRateResolved,
  id = 'hsn_code',
  name = 'hsn_code',
  className,
  placeholder = 'Search HSN or description',
  disabled,
}: HsnPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = (query || value || '').trim().toLowerCase();
    if (!q) return codes.slice(0, 12);
    return codes
      .filter(
        (c) =>
          c.hsn.toLowerCase().includes(q) ||
          (c.description ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [codes, query, value]);

  const selected = codes.find((c) => c.hsn === value);

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        value={value}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Blur is deferred so a click on an option registers first.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />

      {selected && !open && (
        <p className="text-xs text-muted-foreground mt-1">
          {selected.description} · GST {Number(selected.gst_rate)}%
        </p>
      )}

      {open && codes.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {matches.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No match. The code you typed will still be saved.
            </div>
          )}
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cn(
                'w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50',
                c.hsn === value && 'bg-blue-50',
              )}
              onMouseDown={(e) => {
                // onMouseDown, not onClick: the input's blur would close the
                // list before a click could land.
                e.preventDefault();
                onChange(c.hsn);
                onRateResolved?.(Number(c.gst_rate));
                setQuery('');
                setOpen(false);
              }}
            >
              <span>
                <span className="font-mono font-medium">{c.hsn}</span>
                {c.description && (
                  <span className="text-muted-foreground ml-2">{c.description}</span>
                )}
              </span>
              <span className="shrink-0 text-xs font-medium bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                {Number(c.gst_rate)}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
