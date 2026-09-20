// Client-side purchase-invoice PDF parser.
//
// Extracts the line-item table from a supplier's GST invoice PDF so products can
// be imported into the "Add Multiple Products" form. It is tuned to the common
// Indian pharma-distributor layout (S. | HSN | Code | Product | Pack | Mfr |
// Batch | Mfg | Exp | MRP | Rate | Dis | Qty | SGST | CGST | Amount | Net) but
// is written defensively - anything it can't confidently read is left blank for
// the user to fill in the preview step.

import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this to a hashed asset URL and serves the worker locally.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export interface ParsedInvoiceItem {
  name: string;
  hsn_code: string;
  manufacturer: string;
  batch_number: string;
  /** YYYY-MM-DD (first of the expiry month) or '' */
  expiry_date: string;
  quantity: string;
  /** GST % (SGST + CGST) */
  gst: string;
  /** M.R.P → selling price */
  selling_price: string;
  /** Rate → purchase price */
  purchase_price: string;
}

export interface ParsedInvoice {
  supplierName: string;
  items: ParsedInvoiceItem[];
}

// One reconstructed visual line of the PDF (text items sharing a y-position).
interface Line {
  y: number;
  text: string;
}

/** Reconstruct visual lines from a page's positioned text items. */
async function pageLines(page: pdfjsLib.PDFPageProxy): Promise<Line[]> {
  const content = await page.getTextContent();
  const rows: { y: number; items: { x: number; str: string }[] }[] = [];

  for (const item of content.items as any[]) {
    const str: string = item.str ?? '';
    if (!str.trim()) continue;
    const x = item.transform[4] as number;
    const y = item.transform[5] as number;
    // Group items whose baselines are within a couple of px of each other.
    let row = rows.find(r => Math.abs(r.y - y) < 3);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, str });
  }

  return rows
    .sort((a, b) => b.y - a.y) // top of page first
    .map(r => ({
      y: r.y,
      text: r.items
        .sort((a, b) => a.x - b.x)
        .map(i => i.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }));
}

/** "2/28" | "02/2028" → "2028-02-01"; returns '' if unparseable. */
function toExpiry(raw: string): string {
  const m = raw.match(/^(\d{1,2})\/(\d{2,4})$/);
  if (!m) return '';
  const month = m[1].padStart(2, '0');
  let year = m[2];
  if (year.length === 2) year = `20${year}`;
  const mi = parseInt(month, 10);
  if (mi < 1 || mi > 12) return '';
  return `${year}-${month}-01`;
}

const num = (s: string) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};

// Item row: S. HSN CODE  <name…>  MFR BATCH MFG EXP MRP RATE DIS QTY SGST CGST AMOUNT NET
// The two m/yy dates + the numeric tail act as anchors so the variable-length
// product name is captured correctly.
const ROW_RE =
  /^(\d+)\.\s+(\d{4,8})\s+(\S+)\s+(.+?)\s+(\S+)\s+(\S+)\s+(\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{2,4})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$/;

function parseItemLine(line: string): ParsedInvoiceItem | null {
  const m = line.match(ROW_RE);
  if (!m) return null;
  const [, , hsn, , name, mfr, batch, , exp, mrp, rate, , qty, sgst, cgst] = m;
  const gst = num(sgst) + num(cgst);
  return {
    name: name.trim(),
    hsn_code: hsn.trim(),
    manufacturer: mfr.trim(),
    batch_number: batch.trim(),
    expiry_date: toExpiry(exp),
    quantity: qty,
    gst: gst > 0 ? String(+gst.toFixed(2)) : '',
    selling_price: String(num(mrp)),
    purchase_price: String(num(rate)),
  };
}

/** Best-effort supplier (seller) name from the invoice header. */
function extractSupplier(lines: Line[]): string {
  for (const l of lines) {
    const t = l.text.trim();
    if (!t) continue;
    // Skip obvious boilerplate; take the first real company-looking line.
    if (/^(gst invoice|tax invoice|original|credit|debit|irn)/i.test(t)) continue;
    if (t.length < 3) continue;
    return t.replace(/\s+/g, ' ').slice(0, 120);
  }
  return '';
}

export async function parseInvoicePdf(file: File): Promise<ParsedInvoice> {
  // ponytail: AS 3 native text/csv parsing alongside PDF so both formats feed purchase entry & bulk import
  if (file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv') {
    const text = await file.text();
    const rows = text.split(/\r?\n/).filter(l => l.trim()).map(line => {
      const out: string[] = [];
      let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else { q = !q; } }
        else if (c === ',' && !q) { out.push(cur.trim()); cur = ''; }
        else { cur += c; }
      }
      out.push(cur.trim());
      return out;
    });
    if (rows.length < 2) return { supplierName: '', items: [] };
    const headers = rows[0].map(h => h.toLowerCase().trim());
    const getCol = (row: string[], ...names: string[]) => {
      for (const n of names) {
        const idx = headers.indexOf(n);
        if (idx >= 0 && row[idx]?.trim()) return row[idx].trim();
      }
      return '';
    };
    const items: ParsedInvoiceItem[] = rows.slice(1).filter(r => r.some(c => c.trim())).map(r => ({
      name: getCol(r, 'name', 'product', 'item'),
      hsn_code: getCol(r, 'hsn_code', 'hsn code', 'hsn'),
      manufacturer: getCol(r, 'manufacturer', 'mfr'),
      batch_number: getCol(r, 'batch_number', 'batch number', 'batch'),
      expiry_date: toExpiry(getCol(r, 'expiry_date', 'expiry date', 'expiry', 'exp')) || getCol(r, 'expiry_date', 'expiry date', 'expiry', 'exp'),
      quantity: String(parseInt(getCol(r, 'quantity', 'qty')) || 0),
      gst: String(parseFloat(getCol(r, 'gst', 'gst_pct', 'tax')) || 0),
      selling_price: String(parseFloat(getCol(r, 'selling_price', 'selling price', 'mrp', 'price')) || 0),
      purchase_price: String(parseFloat(getCol(r, 'purchase_price', 'purchase price', 'rate', 'purchase_rate')) || 0),
    })).filter(it => it.name && parseFloat(it.selling_price) > 0);
    return { supplierName: getCol(rows[1] || [], 'supplier', 'supplier_name') || extractSupplier([]), items };
  }

  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;

  const allLines: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    allLines.push(...(await pageLines(page)));
  }

  const items: ParsedInvoiceItem[] = [];
  for (const line of allLines) {
    if (!/^\d+\.\s/.test(line.text)) continue; // only numbered item rows
    const item = parseItemLine(line.text);
    if (item && item.name) items.push(item);
  }

  return { supplierName: extractSupplier(allLines), items };
}
