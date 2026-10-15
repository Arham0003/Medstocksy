import { describe, it, expect } from 'vitest';
import { missingColumnFrom, insertSalesRows } from '../salesInsert';

// A fake PostgREST that only knows about the columns it was given, and
// complains about the first unknown one it meets - the way the real thing does.
function fakeClient(knownColumns: string[], opts: { uniqueViolation?: boolean } = {}) {
  const stored: Record<string, unknown>[] = [];
  let calls = 0;
  const client = {
    from: () => ({
      insert: async (rows: Record<string, unknown>[]) => {
        calls++;
        if (opts.uniqueViolation) {
          return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        for (const row of rows) {
          const bad = Object.keys(row).find(c => !knownColumns.includes(c));
          if (bad) {
            return { error: { code: '42703', message: `column sales.${bad} does not exist` } };
          }
        }
        stored.push(...rows);
        return { error: null };
      },
    }),
  };
  return { client, stored, calls: () => calls };
}

const BILL = {
  account_id: 'acc', product_id: 'p1', bill_id: 'b1', quantity: 2,
  unit_price: 100, total_price: 200, customer_name: 'Ramesh',
  customer_phone: '+919876543210', customer_address: 'Lucknow',
  cgst_amount: 5, sgst_amount: 5, hsn_code: '3004',
  salesman_name: 'Arun', client_line_id: 'line-1',
};

describe('missingColumnFrom', () => {
  it('reads the column out of both wordings the stack produces', () => {
    expect(missingColumnFrom({ code: '42703', message: 'column sales.salesman_name does not exist' }))
      .toBe('salesman_name');
    expect(missingColumnFrom({ code: '42703', message: 'column "client_line_id" of relation "sales" does not exist' }))
      .toBe('client_line_id');
    expect(missingColumnFrom({ code: 'PGRST204', message: "Could not find the 'customer_type' column of 'sales' in the schema cache" }))
      .toBe('customer_type');
  });

  it('is not fooled by errors that merely mention a column', () => {
    expect(missingColumnFrom({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBeNull();
    expect(missingColumnFrom({ code: '23514', message: 'new row violates check constraint on column foo' })).toBeNull();
    expect(missingColumnFrom(null)).toBeNull();
  });
});

describe('insertSalesRows', () => {
  it('keeps every field the database does have', async () => {
    // This database is two migrations behind: no salesman_name, no client_line_id.
    const known = Object.keys(BILL).filter(c => c !== 'salesman_name' && c !== 'client_line_id');
    const { client, stored } = fakeClient(known);

    const res = await insertSalesRows(client, [{ ...BILL }]);

    expect(res.error).toBeNull();
    expect(res.droppedColumns.sort()).toEqual(['client_line_id', 'salesman_name']);

    // The point of the whole exercise: one missing column must not cost the
    // customer's phone number or the tax breakdown.
    expect(stored[0].customer_name).toBe('Ramesh');
    expect(stored[0].customer_phone).toBe('+919876543210');
    expect(stored[0].customer_address).toBe('Lucknow');
    expect(stored[0].cgst_amount).toBe(5);
    expect(stored[0].sgst_amount).toBe(5);
    expect(stored[0].hsn_code).toBe('3004');
  });

  it('sends one call when the database is up to date', async () => {
    const { client, stored, calls } = fakeClient(Object.keys(BILL));
    const res = await insertSalesRows(client, [{ ...BILL }]);
    expect(res.droppedColumns).toEqual([]);
    expect(calls()).toBe(1);
    expect(stored).toHaveLength(1);
  });

  it('reports a duplicate instead of retrying it', async () => {
    const { client, stored, calls } = fakeClient(Object.keys(BILL), { uniqueViolation: true });
    const res = await insertSalesRows(client, [{ ...BILL }]);
    expect(res.alreadySaved).toBe(true);
    expect(res.error).toBeNull();
    expect(calls()).toBe(1);      // never re-sent
    expect(stored).toHaveLength(0);
  });

  it('refuses to store a bill stripped of something essential', async () => {
    // A database with no customer_name is not one to quietly write a bill into.
    const known = Object.keys(BILL).filter(c => c !== 'customer_name');
    const { client, stored } = fakeClient(known);
    const res = await insertSalesRows(client, [{ ...BILL }]);
    expect(res.error).not.toBeNull();
    expect(res.droppedColumns).not.toContain('customer_name');
    expect(stored).toHaveLength(0);
  });

  it('narrows every row of a multi-line bill the same way', async () => {
    const known = Object.keys(BILL).filter(c => c !== 'client_line_id');
    const { client, stored } = fakeClient(known);
    await insertSalesRows(client, [{ ...BILL }, { ...BILL, product_id: 'p2' }]);
    expect(stored).toHaveLength(2);
    expect(stored.every(r => !('client_line_id' in r))).toBe(true);
    expect(stored.every(r => r.customer_phone === '+919876543210')).toBe(true);
  });

  it('gives up rather than looping forever', async () => {
    const client = {
      from: () => ({
        insert: async () => ({ error: { code: '42703', message: 'column sales.ghost does not exist' } }),
      }),
    };
    const res = await insertSalesRows(client, [{ ghost: 1, account_id: 'a' }]);
    expect(res.error).not.toBeNull();
  });
});
