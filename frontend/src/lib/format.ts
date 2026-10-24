import type { Platform } from '../types';

export const platformLabels: Record<Platform | 'all', string> = {
  all: 'All services',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  telegram: 'Telegram',
  x: 'X',
  other: 'Other',
};

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN', { notation: value >= 100000 ? 'compact' : 'standard' }).format(value);
}

export function formatMoney(value: number, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

type View = 'shop' | 'dashboard' | 'admin';
