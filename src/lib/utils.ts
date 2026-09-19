import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// INR formatter — adds Indian-style separators (1,23,456.78) and the ₹ symbol
const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const formatINR = (n: number | null | undefined) => inrFormatter.format(Number(n) || 0);

// Format a YYYY-MM-DD expiry: "15 Dec 2026" if within 60 days, "MM/YYYY" otherwise
export const formatExpiry = (raw: string | null | undefined) => {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const days = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 60) {
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export function calcEffectivePurchasePrice(rate: number, qty: number, free: number): number {
  return (qty + free) > 0 ? Number(((rate * qty) / (qty + free)).toFixed(2)) : rate;
}

// ── Amount in words (Indian system) ─────────────────────────────────────────
// A tax invoice has to state its total in words. Indian grouping is
// crore/lakh/thousand, so Intl can't do it and this stays hand-rolled.
const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0–99 → words. */
const twoDigitsToWords = (n: number): string => {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return TENS[tens] + (ones ? ` ${ONES[ones]}` : '');
};

/** 0–999 → words. */
const threeDigitsToWords = (n: number): string => {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigitsToWords(rest));
  return parts.join(' ');
};

/** Whole number → Indian-system words. Returns '' for 0. */
export const numberToWordsIndian = (value: number): string => {
  let n = Math.floor(Math.abs(Number(value) || 0));
  if (n === 0) return '';

  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  if (crore) { parts.push(`${numberToWordsIndian(crore)} Crore`); n %= 10000000; }
  const lakh = Math.floor(n / 100000);
  if (lakh) { parts.push(`${twoDigitsToWords(lakh)} Lakh`); n %= 100000; }
  const thousand = Math.floor(n / 1000);
  if (thousand) { parts.push(`${twoDigitsToWords(thousand)} Thousand`); n %= 1000; }
  if (n) parts.push(threeDigitsToWords(n));

  return parts.join(' ');
};

/**
 * Rupee amount → the phrase printed on an invoice, e.g.
 * `amountInWordsINR(1250.5)` → "Rupees One Thousand Two Hundred Fifty and Fifty Paise Only".
 */
export const amountInWordsINR = (amount: number | null | undefined): string => {
  const value = Number(amount) || 0;
  const absolute = Math.abs(value);
  // Round to paise FIRST: rounding the remainder on its own can land on 100
  // (e.g. 99.999), which is one rupee, not "Hundred Paise".
  const totalPaise = Math.round(absolute * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';

  const parts = ['Rupees'];
  if (value < 0) parts.push('Minus');
  if (rupees > 0) parts.push(numberToWordsIndian(rupees));
  if (paise > 0) parts.push(`${rupees > 0 ? 'and ' : ''}${twoDigitsToWords(paise)} Paise`);
  parts.push('Only');

  return parts.join(' ').replace(/\s+/g, ' ').trim();
};
