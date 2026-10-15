// Saving a bill against a database that is behind on migrations.
//
// The old approach was a single fixed fallback: if the insert failed with any
// message containing the word "column", it re-sent the bill stripped of
// twenty-five optional fields at once. One missing column therefore cost the
// customer's phone number, address and doctor, the whole CGST/SGST/IGST split,
// the HSN code, the buyer's GSTIN and the invoice serial - all of which the
// database had columns for and would have accepted. The bill saved, and the
// invoice printed blank where those values should have been.
//
// This drops exactly the column the database named, then tries again. A
// database missing one column loses one field, not twenty-five.

type InsertError = { code?: string; message?: string } | null;

/** Columns the bill cannot meaningfully be stored without. */
const ESSENTIAL = new Set([
  'account_id', 'product_id', 'bill_id', 'quantity',
  'unit_price', 'total_price', 'customer_name', 'sale_date',
]);

/**
 * The column PostgREST is complaining about, or null if this is not a
 * missing-column error. Both wordings appear in the wild: PostgreSQL's own
 * 42703 text, and PostgREST's PGRST204 schema-cache message.
 */
export function missingColumnFrom(error: InsertError): string | null {
  const msg = error?.message || '';
  const code = error?.code;
  if (code && code !== '42703' && code !== 'PGRST204') return null;

  // column "foo" of relation "sales" does not exist
  // column sales.foo does not exist
  const pg = msg.match(/column "?(?:[\w]+\.)?([\w]+)"?(?: of relation "[\w]+")? does not exist/i);
  if (pg) return pg[1];

  // Could not find the 'foo' column of 'sales' in the schema cache
  const prst = msg.match(/could not find the '([\w]+)' column/i);
  if (prst) return prst[1];

  return null;
}

type Row = Record<string, unknown>;
type Client = {
  from: (table: string) => {
    insert: (rows: Row[]) => Promise<{ error: InsertError }>;
  };
};

export type SalesInsertResult = {
  /** Set when the database already holds these rows (unique violation). */
  alreadySaved: boolean;
  /** Columns this database does not have, which were therefore not stored. */
  droppedColumns: string[];
  error: InsertError;
};

/**
 * Insert bill rows, narrowing the payload one column at a time when the
 * database turns out not to have one of them.
 *
 * A unique violation is reported rather than retried: it means the bill is
 * already stored, and re-sending it is the one thing that would duplicate it.
 */
export async function insertSalesRows(
  client: Client,
  rows: Row[],
  maxAttempts = 16,
): Promise<SalesInsertResult> {
  let payload = rows;
  const droppedColumns: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { error } = await client.from('sales').insert(payload);
    if (!error) return { alreadySaved: false, droppedColumns, error: null };

    if (error.code === '23505') {
      return { alreadySaved: true, droppedColumns, error: null };
    }

    const column = missingColumnFrom(error);
    if (!column) return { alreadySaved: false, droppedColumns, error };

    // Losing one of these would mean storing a bill that cannot be read back
    // as a bill, which is worse than refusing to store it.
    if (ESSENTIAL.has(column)) return { alreadySaved: false, droppedColumns, error };

    // Nothing was dropped and yet the same column is named again: retrying
    // would loop. Report it instead.
    if (droppedColumns.includes(column)) return { alreadySaved: false, droppedColumns, error };

    droppedColumns.push(column);
    payload = payload.map(row => {
      const next = { ...row };
      delete next[column];
      return next;
    });
  }

  return {
    alreadySaved: false,
    droppedColumns,
    error: { message: 'Database needs migration. Please run required updates.' },
  };
}
