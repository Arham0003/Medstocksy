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
