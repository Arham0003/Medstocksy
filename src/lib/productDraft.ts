// Session-scoped drafts so in-progress product entry survives a trip to the
// Suppliers page (to register a new supplier) without losing any data.

const MULTI_KEY = 'medstocksy:multiProductDraft'; // "Add Products" dialog rows
const BULK_KEY = 'medstocksy:bulkProductDraft';   // CSV/PDF bulk-import preview
const SALE_KEY = 'medstocksy:saleDraft';          // in-progress "New Sale" cart

function save(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
function load<T>(key: string): T | null {
  try {
    const s = sessionStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function clear(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}

export const saveMultiDraft = (rows: unknown) => save(MULTI_KEY, rows);
export const loadMultiDraft = <T>() => load<T>(MULTI_KEY);
export const clearMultiDraft = () => clear(MULTI_KEY);

export const saveBulkDraft = (products: unknown) => save(BULK_KEY, products);
export const loadBulkDraft = <T>() => load<T>(BULK_KEY);
export const clearBulkDraft = () => clear(BULK_KEY);

export const saveSaleDraft = (sale: unknown) => save(SALE_KEY, sale);
export const loadSaleDraft = <T>() => load<T>(SALE_KEY);
export const clearSaleDraft = () => clear(SALE_KEY);
