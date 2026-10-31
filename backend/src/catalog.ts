import type { Platform, PublicService, RawCidService, ServiceRow } from './types';

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

export function cleanName(value: string) {
  return value
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\[\]]/g, '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function retailRate(providerRate: number, markupPercent: number) {
  return Math.ceil(providerRate * (1 + markupPercent / 100) * 100) / 100;
}

// Provider service kinds, from the standard SMM API v2 type names
// (Perfect Panel / JAP naming). The raw `type` string varies by panel, so
// it is normalized (case, spaces, underscores, hyphens stripped) before
// mapping. Unknown types fall back to 'default' — the link + quantity
// form — so a new upstream type can never break ordering; it just shows
// no extra fields until mapped. The frontend mirrors this map in
// lib/orderFields.ts; keep both in sync.
export type ServiceKind =
  | 'default'
  | 'package'
  | 'customComments'
  | 'mentionsCustomList'
  | 'mentionsHashtag'
  | 'mentionsUserFollowers'
  | 'poll'
  | 'invites'
  | 'seo';

export function normalizeServiceType(raw: string | null | undefined): ServiceKind {
  const key = (raw ?? '').toLowerCase().replace(/[\s_\-]+/g, '');
  switch (key) {
    case '':
    case 'default':
      return 'default';
    case 'package':
      return 'package';
    case 'customcomments':
      return 'customComments';
    case 'mentionscustomlist':
    case 'mentions':
      return 'mentionsCustomList';
    case 'mentionshashtag':
      return 'mentionsHashtag';
    case 'mentionsuserfollowers':
      return 'mentionsUserFollowers';
    case 'poll':
      return 'poll';
    case 'invitesfromgroups':
    case 'invites':
      return 'invites';
    case 'seo':
    case 'webtraffic':
    case 'traffic':
      return 'seo';
    default:
      return 'default';
  }
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
        type: service.type?.trim() || 'Default',
        dripfeed: asBoolean(service.dripfeed),
      } satisfies PublicService;
    })
    .filter((service) => service.rate > 0 && service.max > 0)
    .sort((a, b) => a.category.localeCompare(b.category) || a.rate - b.rate);
}

// --- Milestone 2: D1-backed catalogue ---

export function rowToPublic(row: ServiceRow): PublicService {
  return {
    id: row.id,
    name: row.display_name?.trim() || cleanName(row.provider_name),
    category: row.category,
    platform: row.platform,
    rate: row.retail_rate,
    min: row.min,
    max: row.max,
    refill: row.refill === 1,
    cancel: row.cancel === 1,
    description: row.description ?? undefined,
    type: row.type?.trim() || 'Default',
    dripfeed: row.dripfeed === 1,
  };
}

export function retailFor(providerRate: number, markupPercent: number): number {
  return retailRate(providerRate, markupPercent);
}

/**
 * Upserts the provider catalogue into D1, preserving admin curation
 * (display_name, markup_override, is_active) across syncs. Services that
 * vanish upstream are flagged provider_active = 0 instead of deleted, so
 * order history keeps its context. Returns the number of live services.
 */
export async function syncCatalogToDb(
  db: D1Database,
  raw: RawCidService[],
  defaultMarkup: number,
): Promise<number> {
  const now = new Date().toISOString();
  const run = await db
    .prepare('INSERT INTO sync_runs (started_at, status) VALUES (?, ?) RETURNING id')
    .bind(now, 'running')
    .first<{ id: number }>();
  const runId = run?.id;

  try {
    const existing = await db
      .prepare('SELECT id, markup_override FROM services')
      .all<{ id: string; markup_override: number | null }>();
    const overrides = new Map((existing.results ?? []).map((r) => [r.id, r.markup_override]));

    // Migration 0003 columns may not exist yet (migrations are pasted
    // into the D1 console on the owner's schedule). Check once and build
    // the upsert around whatever the table actually has, so a sync never
    // fails on unknown columns — it just skips fields it cannot store
    // until the migration lands, and picks them up on the next sync.
    let hasType = false;
    let hasDripfeed = false;
    try {
      const info = await db.prepare('PRAGMA table_info(services)').all<{ name: string }>();
      const cols = new Set((info.results ?? []).map((r) => r.name));
      hasType = cols.has('type');
      hasDripfeed = cols.has('dripfeed');
    } catch {
      // Pre-migration database: sync the old column set.
    }

    const statements: D1PreparedStatement[] = [];
    let live = 0;
    for (const service of raw) {
      const providerRate = asNumber(service.rate);
      const max = asNumber(service.max);
      if (providerRate <= 0 || max <= 0) continue;
      const id = `svc_${service.service}`;
      const markup = overrides.get(id) ?? defaultMarkup;
      const cols: string[] = ['id', 'provider_id', 'provider_name', 'category', 'platform', 'provider_rate', 'retail_rate', 'min', 'max', 'refill', 'cancel', 'description', 'is_active', 'provider_active', 'first_seen_at', 'last_synced_at'];
      const vals: unknown[] = [id, asNumber(service.service), service.name || 'Promotional service', service.category?.trim() || 'Other', detectPlatform(service), providerRate, retailRate(providerRate, markup), asNumber(service.min), max, asBoolean(service.refill) ? 1 : 0, asBoolean(service.cancel) ? 1 : 0, service.description?.trim() || null, 1, 1, now, now];
      if (hasType) {
        cols.push('type');
        vals.push(service.type?.trim() || 'Default');
      }
      if (hasDripfeed) {
        cols.push('dripfeed');
        vals.push(asBoolean(service.dripfeed) ? 1 : 0);
      }
      // On conflict, refresh everything except admin curation
      // (is_active) and first-seen bookkeeping.
      const updateCols = cols.filter((c) => !['id', 'provider_id', 'is_active', 'first_seen_at'].includes(c));
      statements.push(
        db
          .prepare(
            `INSERT INTO services (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${updateCols.map((c) => `${c} = excluded.${c}`).join(', ')}`,
          )
          .bind(...vals),
      );
      live++;
    }

    // D1 batch limits: flush in chunks.
    for (let i = 0; i < statements.length; i += 50) {
      await db.batch(statements.slice(i, i + 50));
    }

    await db
      .prepare('UPDATE services SET provider_active = 0 WHERE last_synced_at < ?')
      .bind(now)
      .run();

    if (runId) {
      await db
        .prepare('UPDATE sync_runs SET finished_at = ?, status = ?, service_count = ? WHERE id = ?')
        .bind(new Date().toISOString(), 'ok', live, runId)
        .run();
    }
    return live;
  } catch (error) {
    if (runId) {
      await db
        .prepare('UPDATE sync_runs SET finished_at = ?, status = ?, error = ? WHERE id = ?')
        .bind(new Date().toISOString(), 'error', error instanceof Error ? error.message : 'unknown', runId)
        .run();
    }
    throw error;
  }
}

export async function listDbServices(db: D1Database): Promise<{ services: PublicService[]; updatedAt: string | null }> {
  const rows = await db
    .prepare(
      `SELECT * FROM services WHERE is_active = 1 AND provider_active = 1 AND retail_rate > 0
       ORDER BY category ASC, retail_rate ASC`,
    )
    .all<ServiceRow>();
  const results = rows.results ?? [];
  const updatedAt = results.length ? results.reduce((max, r) => (r.last_synced_at > max ? r.last_synced_at : max), results[0].last_synced_at) : null;
  return { services: results.map(rowToPublic), updatedAt };
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
    type: 'Default',
    dripfeed: false,
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
    type: 'Default',
    dripfeed: false,
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
    type: 'Default',
    dripfeed: false,
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
    type: 'Default',
    dripfeed: false,
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
    type: 'Default',
    dripfeed: false,
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
    type: 'Default',
    dripfeed: false,
  },
];
