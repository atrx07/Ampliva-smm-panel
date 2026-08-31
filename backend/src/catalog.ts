import type { Platform, PublicService, RawCidService } from './types';

function asNumber(value: string | number | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: boolean | string | undefined) {
  return value === true || value === 'true' || value === '1';
}

function detectPlatform(service: RawCidService): Platform {
  const haystack = `${service.category ?? ''} ${service.name ?? ''}`.toLowerCase();
  if (haystack.includes('instagram')) return 'instagram';
  if (haystack.includes('youtube')) return 'youtube';
  if (haystack.includes('tiktok')) return 'tiktok';
  if (haystack.includes('facebook')) return 'facebook';
  if (haystack.includes('telegram')) return 'telegram';
  if (haystack.includes('twitter') || /(^|\s)x(\s|$)/.test(haystack)) return 'x';
  return 'other';
}

function cleanName(value: string) {
  return value
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\[\]]/g, '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function retailRate(providerRate: number, markupPercent: number) {
  return Math.ceil(providerRate * (1 + markupPercent / 100) * 100) / 100;
}

export function normalizeServices(raw: RawCidService[], markupPercent: number): PublicService[] {
  return raw
    .map((service) => {
      const providerRate = asNumber(service.rate);
      return {
        id: `svc_${service.service}`,
        name: cleanName(service.name || 'Promotional service'),
        category: service.category?.trim() || 'Other',
        platform: detectPlatform(service),
        rate: retailRate(providerRate, markupPercent),
        min: asNumber(service.min),
        max: asNumber(service.max),
        refill: asBoolean(service.refill),
        cancel: asBoolean(service.cancel),
        description: service.description?.trim() || undefined,
      } satisfies PublicService;
    })
    .filter((service) => service.rate > 0 && service.max > 0)
    .sort((a, b) => a.category.localeCompare(b.category) || a.rate - b.rate);
}

export const previewServices: PublicService[] = [
  {
    id: 'preview_ig_followers',
    name: 'Instagram Followers · Fast Delivery',
    category: 'Instagram Followers',
    platform: 'instagram',
    rate: 99,
    min: 100,
    max: 100000,
    refill: true,
    cancel: false,
  },
  {
    id: 'preview_ig_views',
    name: 'Instagram Reels Views · High Speed',
    category: 'Instagram Views',
    platform: 'instagram',
    rate: 29,
    min: 100,
    max: 1000000,
    refill: false,
    cancel: true,
  },
  {
    id: 'preview_yt_views',
    name: 'YouTube Views · Standard Delivery',
    category: 'YouTube Views',
    platform: 'youtube',
    rate: 149,
    min: 100,
    max: 500000,
    refill: false,
    cancel: false,
  },
  {
    id: 'preview_tt_views',
    name: 'TikTok Video Views · Fast',
    category: 'TikTok Views',
    platform: 'tiktok',
    rate: 39,
    min: 100,
    max: 1000000,
    refill: false,
    cancel: true,
  },
  {
    id: 'preview_fb_reactions',
    name: 'Facebook Post Reactions',
    category: 'Facebook Engagement',
    platform: 'facebook',
    rate: 89,
    min: 50,
    max: 50000,
    refill: false,
    cancel: false,
  },
  {
    id: 'preview_tg_members',
    name: 'Telegram Channel Members',
    category: 'Telegram Members',
    platform: 'telegram',
    rate: 129,
    min: 100,
    max: 100000,
    refill: true,
    cancel: false,
  },
];
