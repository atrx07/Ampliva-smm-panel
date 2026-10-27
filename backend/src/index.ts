import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { listDbServices, normalizeServiceType, normalizeServices, previewServices, retailFor, rowToPublic, syncCatalogToDb } from './catalog';
import { cidClientFromEnv } from './providers/cid';
import { createSession, destroySession, hashPassword, isResponse, newId, requireAdmin, requireAuth, verifyPassword } from './auth';
import { appendLedger, getBalance } from './wallet';
import { notifyDiscord, notifyOrderPlaced, notifyRefillSubmitted } from './notify';
import { buildOrdersMessage, buildPendingMessage, buildRefillsMessage, buildUsersMessage, notifyTopupRequest, registerDiscordCommands, verifyDiscordSignature } from './discord';
import { createRazorpayOrder, razorpayConfigured, verifyRazorpaySignature } from './razorpay';
import type { Env, OrderRow, RefillRequest, ServiceRow, UserRow } from './types';

const app = new Hono<{ Bindings: Env }>();

// Auth travels in an Authorization: Bearer header (no cookies), so a wide
// CORS origin does not expose ambient credentials. Lock down to the Pages
// origin after deployment if a second frontend is never planned.
app.use('/api/*', cors({ origin: '*' }));

const DEFAULT_CID_URL = 'https://cidgrowthmedia.com/api/v2';

function defaultMarkup(env: Env): number {
  const parsed = Number(env.DEFAULT_MARKUP_PERCENT || '35');
  return Number.isFinite(parsed) ? parsed : 35;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------- public ----------

app.get('/api/health', (c) => {
  return c.json({
    ok: true,
    service: 'ampliva-api',
    providerConfigured: Boolean(c.env.CID_API_KEY),
    dbConfigured: Boolean(c.env.DB),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/config', (c) => {
  return c.json({
    currency: c.env.CID_CURRENCY || 'INR',
    upiId: c.env.PUBLIC_UPI_ID || null,
    manualTopupsEnabled: Boolean(c.env.PUBLIC_UPI_ID),
    razorpayEnabled: razorpayConfigured(c.env),
    orderingEnabled: Boolean(c.env.CID_API_KEY && c.env.DB),
  });
});

app.get('/api/services', async (c) => {
  const currency = c.env.CID_CURRENCY || 'INR';
  const updatedAt = new Date().toISOString();

  // Preferred source: the D1 snapshot (Milestone 2) — curated names/prices,
  // no live dependency on the provider for every page view.
  if (c.env.DB) {
    try {
      const { services, updatedAt: syncedAt } = await listDbServices(c.env.DB);
      if (services.length > 0) {
        return c.json({ services, source: 'live' as const, currency, updatedAt: syncedAt ?? updatedAt });
      }
    } catch (error) {
      console.error('D1 catalogue read failed:', error instanceof Error ? error.message : 'unknown');
    }
  }

  if (!c.env.CID_API_KEY) {
    return c.json({
      services: previewServices,
      source: 'preview' as const,
      currency,
      updatedAt,
      warning: 'CID_API_KEY is not configured yet, so Ampliva is showing its safe preview catalogue.',
    });
  }

  try {
    const client = cidClientFromEnv(c.env)!;
    const rawServices = await client.services();
    const services = normalizeServices(rawServices, defaultMarkup(c.env));
    return c.json({ services, source: 'live' as const, currency, updatedAt });
  } catch (error) {
    console.error('CID catalogue fetch failed:', error instanceof Error ? error.message : 'unknown error');
    return c.json({
      services: previewServices,
      source: 'fallback' as const,
      currency,
      updatedAt,
      warning: 'The live provider catalogue is temporarily unavailable. Preview services are shown instead.',
    });
  }
});

// ---------- tools: instagram profile lookup ----------
// Profile lookup via Apify's Instagram Profile Scraper. No Instagram
// session is held anywhere: the Worker calls Apify's API with an APIFY_TOKEN
// dashboard Secret, and Apify absorbs the proxy/blocking problem.
// Flow: POST /api/tools/lookup { username } starts an actor run and returns
// a runId (or a cached profile immediately); the page polls
// GET /api/tools/lookup?runId=...&username=... until the run succeeds.
// Results are cached in D1 for 24h, so repeat lookups cost nothing and
// a stale cache can cover an Apify outage. Until APIFY_TOKEN is set, the
// endpoint answers 503 honestly. When Apify's credit is exhausted, the
// endpoint falls back to cache or answers 402 honestly — it never spends
// money the owner did not approve.
const IG_USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
const APIFY_ACTOR = 'apify~instagram-profile-scraper';
const LOOKUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1000;

interface ApifyPost {
  url?: string;
  displayUrl?: string;
  imageUrl?: string;
  thumbnail?: string;
  caption?: string;
  likesCount?: number;
  likes?: number;
  commentsCount?: number;
  comments?: number;
  id?: string;
}

interface ApifyProfileItem {
  username?: string;
  fullName?: string;
  biography?: string;
  profilePicUrl?: string;
  profilePicUrlHD?: string;
  externalUrl?: string | null;
  businessCategoryName?: string | null;
  postsCount?: number;
  followersCount?: number;
  followsCount?: number;
  verified?: boolean;
  private?: boolean;
  latestPosts?: ApifyPost[];
}

function shortcodeFromUrl(url: string): string {
  const m = url.match(/\/p\/([^/?#]+)/);
  return m ? m[1] : '';
}

function toLookupProfile(item: ApifyProfileItem) {
  const recentPosts = (item.latestPosts ?? []).slice(0, 12).map((p) => {
    const url = p.url ?? '';
    const shortcode = shortcodeFromUrl(url) || p.id || '';
    return {
      shortcode,
      url: url || (shortcode ? `https://www.instagram.com/p/${shortcode}/` : ''),
      thumbnail: p.displayUrl ?? p.imageUrl ?? p.thumbnail ?? '',
      caption: p.caption ?? '',
      likes: p.likesCount ?? p.likes ?? null,
      comments: p.commentsCount ?? p.comments ?? null,
    };
  }).filter((p) => p.url || p.thumbnail);

  return {
    username: item.username ?? '',
    fullName: item.fullName ?? '',
    bio: item.biography ?? '',
    avatar: item.profilePicUrlHD ?? item.profilePicUrl ?? '',
    website: item.externalUrl ?? null,
    category: item.businessCategoryName ?? null,
    posts: item.postsCount ?? 0,
    followers: item.followersCount ?? 0,
    following: item.followsCount ?? 0,
    isVerified: item.verified ?? false,
    isPrivate: item.private ?? false,
    // Private accounts expose no timeline to non-followers: an empty
    // grid there is the provider's own answer, not a gap we fill in.
    recentPosts: item.private ? [] : recentPosts,
  };
}

type LookupProfile = ReturnType<typeof toLookupProfile>;

// Apify echoes the requested username in a stub item even when the account
// does not exist — every other field empty, every count zero. Serving that
// as a card would present a non-existent account as a real one with zero
// stats, so ghosts are treated as "not found" and never cached. A real
// account always has at least a profile picture (Instagram assigns a
// default), so the combination below cannot match a genuine profile.
function isGhostProfile(profile: LookupProfile): boolean {
  return !profile.avatar && !profile.fullName && !profile.bio
    && profile.posts === 0 && profile.followers === 0 && profile.following === 0
    && profile.recentPosts.length === 0;
}

// A cached row is either a real profile (24h TTL) or a recorded not-found
// (1h TTL, stored as a sentinel so repeat typos cost nothing). The shorter
// negative TTL bounds the damage if an account is created under that name
// later — it becomes findable within the hour.
type CachedLookup =
  | { profile: LookupProfile; fresh: boolean; notFound: false }
  | { profile: null; fresh: boolean; notFound: true };

async function getCachedProfile(db: D1Database | undefined, username: string): Promise<CachedLookup | null> {
  if (!db) return null;
  try {
    const row = await db.prepare('SELECT profile, fetched_at FROM lookup_cache WHERE username = ?').bind(username.toLowerCase()).first<{ profile: string; fetched_at: string }>();
    if (!row) return null;
    const parsed = JSON.parse(row.profile) as LookupProfile & { notFound?: boolean };
    const age = Date.now() - Date.parse(row.fetched_at);
    if (parsed.notFound) {
      return { profile: null, fresh: Number.isFinite(age) && age < NEGATIVE_CACHE_TTL_MS, notFound: true };
    }
    return { profile: parsed, fresh: Number.isFinite(age) && age < LOOKUP_CACHE_TTL_MS, notFound: false };
  } catch {
    // Cache table missing (migration not pasted yet) or unreadable:
    // lookups still work, just without caching.
    return null;
  }
}

async function putCachedProfile(db: D1Database | undefined, profile: LookupProfile): Promise<void> {
  if (!db || !profile.username || isGhostProfile(profile)) return;
  try {
    await db.prepare('INSERT INTO lookup_cache (username, profile, fetched_at) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET profile = excluded.profile, fetched_at = excluded.fetched_at')
      .bind(profile.username.toLowerCase(), JSON.stringify(profile), new Date().toISOString()).run();
  } catch {
    // Best-effort: a missing cache table must never break a lookup.
  }
}

async function putNotFoundProfile(db: D1Database | undefined, username: string): Promise<void> {
  if (!db || !username) return;
  try {
    await db.prepare('INSERT INTO lookup_cache (username, profile, fetched_at) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET profile = excluded.profile, fetched_at = excluded.fetched_at')
      .bind(username.toLowerCase(), JSON.stringify({ notFound: true, username: username.toLowerCase() }), new Date().toISOString()).run();
  } catch {
    // Best-effort: a missing cache table must never break a lookup.
  }
}

async function deleteCachedProfile(db: D1Database | undefined, username: string): Promise<void> {
  if (!db || !username) return;
  try {
    await db.prepare('DELETE FROM lookup_cache WHERE username = ?').bind(username.toLowerCase()).run();
  } catch {
    // Best-effort.
  }
}

app.post('/api/tools/lookup', async (c) => {
  const body: { username?: string } = await c.req.json<{ username?: string }>().catch(() => ({}));
  const username = String(body.username ?? '').trim().replace(/^@/, '');
  if (!IG_USERNAME_RE.test(username)) {
    return c.json({ error: 'That does not look like an Instagram username.' }, 400);
  }
  let cached = await getCachedProfile(c.env.DB, username);
  if (cached?.notFound) {
    // Repeat typo within the hour: answer from the negative cache without
    // spending another Apify result. A stale one is dropped so the name is
    // re-checked — an account may have been created under it since.
    if (cached.fresh) {
      return c.json({ error: `No Instagram profile found for @${username}.` }, 404);
    }
    await deleteCachedProfile(c.env.DB, username);
    cached = null;
  }
  if (cached && !cached.notFound && isGhostProfile(cached.profile)) {
    // A ghost cached before this fix must never be served again, including
    // by the fallbacks below — drop it and fall through to a fresh run.
    await deleteCachedProfile(c.env.DB, username);
    cached = null;
  }
  if (cached && !cached.notFound && cached.fresh) {
    return c.json({ ...cached.profile, cached: true });
  }
  const token = c.env.APIFY_TOKEN;
  if (!token) {
    if (cached) return c.json({ ...cached.profile, cached: true });
    return c.json({ error: 'Profile lookup is not connected yet — its data provider still needs to be set up.' }, 503);
  }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let start: Response;
  try {
    start = await fetch(`https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ usernames: [username] }),
    });
  } catch {
    if (cached) return c.json({ ...cached.profile, cached: true });
    return c.json({ error: 'Could not reach the lookup provider. Please try again.' }, 502);
  }
  if (start.status === 401 || start.status === 403) {
    if (cached) return c.json({ ...cached.profile, cached: true });
    return c.json({ error: 'The lookup provider rejected the request. Its access key may be wrong or out of credit.' }, 502);
  }
  if (start.status === 402) {
    if (cached) return c.json({ ...cached.profile, cached: true });
    return c.json({ error: 'This month’s free lookup credit is used up — lookups resume when it resets.' }, 402);
  }
  if (!start.ok) {
    if (cached) return c.json({ ...cached.profile, cached: true });
    return c.json({ error: 'The lookup provider could not start this search. Please try again.' }, 502);
  }
  const started = await start.json().catch(() => null) as { data?: { id?: string } } | null;
  const runId = started?.data?.id;
  if (!runId) {
    if (cached) return c.json({ ...cached.profile, cached: true });
    return c.json({ error: 'The lookup provider could not start this search. Please try again.' }, 502);
  }
  return c.json({ status: 'running' as const, runId });
});

app.get('/api/tools/lookup', async (c) => {
  const runId = (c.req.query('runId') ?? '').trim();
  const username = (c.req.query('username') ?? '').trim().replace(/^@/, '');
  if (!runId) {
    return c.json({ error: 'A lookup run id is required to check a result.' }, 400);
  }
  const token = c.env.APIFY_TOKEN;
  if (!token) {
    return c.json({ error: 'Profile lookup is not connected yet — its data provider still needs to be set up.' }, 503);
  }
  const headers = { Authorization: `Bearer ${token}` };
  let runRes: Response;
  try {
    runRes = await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}`, { headers });
  } catch {
    return c.json({ error: 'Could not reach the lookup provider. Please try again.' }, 502);
  }
  if (!runRes.ok) {
    return c.json({ error: 'The lookup run could not be found. Please start a new search.' }, 502);
  }
  const run = await runRes.json().catch(() => null) as { data?: { status?: string; defaultDatasetId?: string } } | null;
  const status = run?.data?.status;
  if (status === 'RUNNING' || status === 'READY') {
    return c.json({ status: 'running' as const, runId });
  }
  if (status !== 'SUCCEEDED') {
    const cached = username ? await getCachedProfile(c.env.DB, username) : null;
    if (cached && !cached.notFound && !isGhostProfile(cached.profile)) return c.json({ ...cached.profile, cached: true });
    return c.json({ error: 'The lookup run did not finish. Please try again.' }, 502);
  }
  const datasetId = run?.data?.defaultDatasetId;
  if (!datasetId) {
    return c.json({ error: 'The lookup run finished but returned no data.' }, 502);
  }
  let itemsRes: Response;
  try {
    itemsRes = await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`, { headers });
  } catch {
    return c.json({ error: 'Could not reach the lookup provider. Please try again.' }, 502);
  }
  if (!itemsRes.ok) {
    return c.json({ error: 'The lookup run finished but its results could not be read.' }, 502);
  }
  const items = await itemsRes.json().catch(() => []) as ApifyProfileItem[];
  const item = items[0];
  if (!item?.username) {
    if (username) await putNotFoundProfile(c.env.DB, username);
    return c.json({ error: username ? `No Instagram profile found for @${username}.` : 'No Instagram profile found.' }, 404);
  }
  const profile = toLookupProfile(item);
  if (isGhostProfile(profile)) {
    await deleteCachedProfile(c.env.DB, profile.username || username);
    await putNotFoundProfile(c.env.DB, username || profile.username);
    return c.json({ error: username ? `No Instagram profile found for @${username}.` : 'No Instagram profile found.' }, 404);
  }
  await putCachedProfile(c.env.DB, profile);
  return c.json(profile);
});

// Image proxy: Instagram's CDN does not reliably serve its images to every
// browser/network (hotlink and tracker blocks break <img> loads on some
// phones), while the Worker origin itself is proven reachable from the
// storefront. Only Instagram CDN hosts are allowed through, so this cannot
// become an open proxy.
app.get('/api/tools/image', async (c) => {
  const raw = c.req.query('u') || '';
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return c.json({ error: 'A valid image URL is required.' }, 400);
  }
  if (target.protocol !== 'https:' || !target.hostname.endsWith('.cdninstagram.com')) {
    return c.json({ error: 'Only Instagram CDN images can be proxied.' }, 400);
  }
  const res = await fetch(target.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  });
  if (!res.ok || !res.body) {
    return c.json({ error: 'The image could not be loaded from Instagram.' }, 502);
  }
  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

// Giveaway comments TEST harness: flowextract reel comment scraper.
// Input: { urls: [{ url }], maxCommentsPerUrl: 0 } per the actor docs;
// output items carry text, created_at, like_count, user{username, id,
// is_verified, profile_pic_url}, child_comment_count, source_url.
// The actor slug is not confirmed in public docs, so candidate slugs are
// tried in order — a 404 means a wrong slug, never a billable run.
// TEST ONLY: this route takes any reel URL and is ungated. Cap or gate it
// before it becomes a product endpoint.
const REEL_COMMENTS_ACTORS = ['dz_omar~instagram-comment-scraper'];

app.post('/api/tools/test-reel-comments', async (c) => {
  const body: { url?: string } = await c.req.json<{ url?: string }>().catch(() => ({}));
  const url = String(body.url ?? '').trim();
  if (!/^https?:\/\/(www\.)?instagram\.com\/(reel|reels|p)\//.test(url)) {
    return c.json({ error: 'Paste a public Instagram reel URL (/reel/, /reels/ or /p/).' }, 400);
  }
  const token = c.env.APIFY_TOKEN;
  if (!token) {
    return c.json({ error: 'Profile lookup is not connected yet — its data provider still needs to be set up.' }, 503);
  }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let runId: string | null = null;
  let actorUsed: string | null = null;
  for (const actor of REEL_COMMENTS_ACTORS) {
    const start = await fetch(`https://api.apify.com/v2/acts/${actor}/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ urls: [{ url }], maxCommentsPerUrl: 0 }),
    }).catch(() => null);
    if (!start) continue;
    if (start.status === 404) continue;
    if (!start.ok) {
      return c.json({ error: `The comments provider could not start this run (HTTP ${start.status}).` }, 502);
    }
    const started = await start.json().catch(() => null) as { data?: { id?: string } } | null;
    runId = started?.data?.id ?? null;
    actorUsed = actor;
    break;
  }
  if (!runId) {
    return c.json({ error: 'The comments actor could not be found. Its store slug may have changed.' }, 502);
  }
  return c.json({ status: 'running' as const, runId, actor: actorUsed });
});

app.get('/api/tools/test-reel-comments', async (c) => {
  const runId = (c.req.query('runId') ?? '').trim();
  if (!runId) {
    return c.json({ error: 'A test run id is required.' }, 400);
  }
  const token = c.env.APIFY_TOKEN;
  if (!token) {
    return c.json({ error: 'Profile lookup is not connected yet — its data provider still needs to be set up.' }, 503);
  }
  const headers = { Authorization: `Bearer ${token}` };
  const runRes = await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}`, { headers });
  if (!runRes.ok) {
    return c.json({ error: 'The test run could not be found.' }, 502);
  }
  const run = await runRes.json().catch(() => null) as { data?: { status?: string; defaultDatasetId?: string; startedAt?: string; finishedAt?: string; stats?: unknown } } | null;
  const status = run?.data?.status;
  if (status === 'RUNNING' || status === 'READY') {
    return c.json({ status: 'running' as const, runId });
  }
  if (status !== 'SUCCEEDED') {
    return c.json({ error: `The test run did not finish (status: ${status ?? 'unknown'}).` }, 502);
  }
  const datasetId = run?.data?.defaultDatasetId;
  if (!datasetId) {
    return c.json({ error: 'The test run finished but returned no data.' }, 502);
  }
  const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`, { headers });
  if (!itemsRes.ok) {
    return c.json({ error: 'The test results could not be read.' }, 502);
  }
  const items = await itemsRes.json().catch(() => []) as Record<string, unknown>[];
  const hasProfilePic = items.some((it) => {
    const u = it.user as { profile_pic_url?: string } | undefined;
    return Boolean(u?.profile_pic_url);
  });
  return c.json({
    count: items.length,
    sample: items.slice(0, 3),
    hasProfilePic,
    runStats: run?.data?.stats ?? null,
    startedAt: run?.data?.startedAt ?? null,
    finishedAt: run?.data?.finishedAt ?? null,
  });
});

// ---------- auth ----------

function publicUser(user: { id: string; email: string; role: string }) {
  return { id: user.id, email: user.email, role: user.role };
}

app.post('/api/auth/register', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Accounts are not enabled yet (database not configured).' }, 503);
  const body: { email?: string; password?: string } = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Enter a valid email address.' }, 400);
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters.' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'An account with this email already exists. Try logging in.' }, 409);

  const countRow = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const isFirstUser = Number(countRow?.n ?? 0) === 0;
  const adminEmail = (c.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const role = isFirstUser || (adminEmail && email === adminEmail) ? 'admin' : 'user';

  const { hash, salt } = await hashPassword(password);
  const user: UserRow = {
    id: newId('usr'),
    email,
    password_hash: hash,
    password_salt: salt,
    role: role as UserRow['role'],
    created_at: new Date().toISOString(),
  };
  await c.env.DB
    .prepare('INSERT INTO users (id, email, password_hash, password_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, user.email, user.password_hash, user.password_salt, user.role, user.created_at)
    .run();

  const ttl = Number(c.env.SESSION_TTL_DAYS || '30');
  const token = await createSession(c.env.DB, user.id, Number.isFinite(ttl) ? ttl : 30);
  return c.json({ token, user: publicUser(user) }, 201);
});

app.post('/api/auth/login', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Accounts are not enabled yet (database not configured).' }, 503);
  const body: { email?: string; password?: string } = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    return c.json({ error: 'Email or password is incorrect.' }, 401);
  }
  const ttl = Number(c.env.SESSION_TTL_DAYS || '30');
  const token = await createSession(c.env.DB, user.id, Number.isFinite(ttl) ? ttl : 30);
  return c.json({ token, user: publicUser(user) });
});

app.post('/api/auth/logout', async (c) => {
  if (c.env.DB) {
    const header = c.req.header('Authorization') || '';
    const token = header.replace(/^Bearer\s+/i, '').trim();
    if (token) await destroySession(c.env.DB, token);
  }
  return c.json({ ok: true });
});

app.get('/api/auth/me', async (c) => {
  const user = await requireAuth(c);
  if (isResponse(user)) return user;
  const balance = c.env.DB ? await getBalance(c.env.DB, user.id) : 0;
  return c.json({ user, balance, currency: c.env.CID_CURRENCY || 'INR' });
});

// ---------- wallet ----------

app.get('/api/wallet', async (c) => {
  const user = await requireAuth(c);
  if (isResponse(user)) return user;
  const db = c.env.DB!;
  const balance = await getBalance(db, user.id);
  const txns = await db
    .prepare('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
    .bind(user.id)
    .all();
  const topups = await db
    .prepare('SELECT * FROM payment_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
    .bind(user.id)
    .all();
  return c.json({ balance, currency: c.env.CID_CURRENCY || 'INR', transactions: txns.results ?? [], topups: topups.results ?? [] });
});

app.post('/api/wallet/topups', async (c) => {
  const user = await requireAuth(c);
  if (isResponse(user)) return user;
  if (!c.env.PUBLIC_UPI_ID) return c.json({ error: 'Manual top-ups are not enabled yet.' }, 503);
  const body: { amount?: number; txnRef?: string } = await c.req.json<{ amount?: number; txnRef?: string }>().catch(() => ({}));
  const amount = Number(body.amount);
  const txnRef = String(body.txnRef || '').trim();
  if (!Number.isFinite(amount) || amount < 10 || amount > 100000) {
    return c.json({ error: 'Top-up amount must be between ₹10 and ₹1,00,000.' }, 400);
  }
  if (txnRef.length < 6) return c.json({ error: 'Enter the UPI transaction reference (UTR) from your payment app.' }, 400);
  const id = newId('top');
  await c.env.DB!
    .prepare('INSERT INTO payment_requests (id, user_id, amount, method, txn_ref, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, round2(amount), 'upi', txnRef, 'pending', new Date().toISOString())
    .run();
  // Ping the owner immediately — an unnoticed request is a stranded customer.
  // Bot alert carries Approve/Reject buttons; falls back to the webhook text
  // ping (dashboard link) until the Discord app is configured.
  c.executionCtx.waitUntil(
    notifyTopupRequest(c.env, { id, amount: round2(amount), email: user.email, txnRef }),
  );
  return c.json({ id, status: 'pending' }, 201);
});

// ---------- Razorpay instant top-ups ----------
// Order creation is authenticated (a gateway order is always tied to a user);
// the webhook is the only thing that credits, and only after HMAC verification.

app.post('/api/payments/razorpay/order', async (c) => {
  const user = await requireAuth(c);
  if (isResponse(user)) return user;
  if (!razorpayConfigured(c.env)) return c.json({ error: 'Instant payments are not enabled yet.' }, 503);
  const body: { amount?: number } = await c.req.json<{ amount?: number }>().catch(() => ({}));
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 10 || amount > 100000) {
    return c.json({ error: 'Top-up amount must be between ₹10 and ₹1,00,000.' }, 400);
  }
  const id = newId('gw');
  const now = new Date().toISOString();
  try {
    const order = await createRazorpayOrder(c.env, id, round2(amount));
    await c.env.DB!
      .prepare(
        `INSERT INTO gateway_orders (id, user_id, amount, provider, provider_order_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'razorpay', ?, 'created', ?, ?)`,
      )
      .bind(id, user.id, round2(amount), order.id, now, now)
      .run();
    return c.json({ keyId: c.env.RAZORPAY_KEY_ID, orderId: order.id, amount: round2(amount), currency: 'INR' }, 201);
  } catch (error) {
    console.error('Razorpay order failed:', error instanceof Error ? error.message : 'unknown');
    return c.json({ error: 'Could not start the payment. Try again in a moment.' }, 502);
  }
});

app.post('/api/payments/razorpay/webhook', async (c) => {
  const db = c.env.DB;
  if (!db || !c.env.RAZORPAY_WEBHOOK_SECRET) return c.json({ error: 'Webhook not configured' }, 503);
  const signature = c.req.header('x-razorpay-signature') || '';
  const rawBody = await c.req.text();
  const valid = await verifyRazorpaySignature(c.env.RAZORPAY_WEBHOOK_SECRET, rawBody, signature).catch(() => false);
  if (!valid) return c.json({ error: 'Invalid signature' }, 401);

  const event = JSON.parse(rawBody) as {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string } } };
  };
  // Only a captured payment credits. Failures, refunds and other events are ignored.
  if (event.event !== 'payment.captured') return c.json({ ok: true, ignored: event.event ?? 'unknown' });
  const payment = event.payload?.payment?.entity;
  if (!payment?.order_id || !payment.id) return c.json({ error: 'Malformed payment payload' }, 400);

  const order = await db
    .prepare('SELECT * FROM gateway_orders WHERE provider_order_id = ?')
    .bind(payment.order_id)
    .first<{ id: string; user_id: string; amount: number; status: string }>();
  if (!order) return c.json({ error: 'Unknown gateway order' }, 404);
  // Amount must match the order exactly (paise vs rupees) — a tampered event never credits.
  if (payment.amount !== Math.round(order.amount * 100) || payment.currency !== 'INR') {
    return c.json({ error: 'Payment amount mismatch' }, 400);
  }
  // Atomic flip: only the first delivery moves created -> paid, so retries
  // and duplicate webhooks can never double-credit.
  const claimed = await db
    .prepare("UPDATE gateway_orders SET status = 'paid', provider_payment_id = ?, updated_at = ? WHERE provider_order_id = ? AND status = 'created'")
    .bind(payment.id, new Date().toISOString(), payment.order_id)
    .run();
  if (claimed.meta.changes === 0) return c.json({ ok: true, already: true });

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO payment_requests (id, user_id, amount, method, txn_ref, status, created_at, decided_at, decided_by)
       VALUES (?, ?, ?, 'razorpay', ?, 'approved', ?, ?, 'razorpay-webhook')`,
    )
    .bind(newId('top'), order.user_id, order.amount, payment.id, now, now)
    .run();
  const balance = await appendLedger(db, {
    userId: order.user_id, type: 'topup', amount: order.amount,
    refType: 'gateway_order', refId: order.id, note: `Razorpay payment ${payment.id}`,
  });
  const userRow = await db.prepare('SELECT email FROM users WHERE id = ?').bind(order.user_id).first<{ email: string }>();
  c.executionCtx.waitUntil(
    notifyDiscord(
      c.env,
      '⚡ Instant top-up credited',
      `₹${order.amount.toFixed(2)} to ${userRow?.email ?? 'a customer'} via Razorpay (new balance ₹${balance.toFixed(2)})`,
    ),
  );
  return c.json({ ok: true, credited: order.amount });
});

// ---------- orders ----------

// Storage cap for order extras (migration 0006). The provider always
// receives the FULL inputs — this cap is storage-only, so delivery is never
// shorted. 64KB covers ~600 typical comments in full; beyond that the
// earliest lines are kept, and orders.quantity still records the exact
// total line count for comment/username services, so nothing is silently
// lost — the record just stops at the cap.
const ORDER_EXTRAS_MAX_BYTES = 65536;
const ORDER_EXTRAS_MAX_LINES = 1000;
const ORDER_EXTRAS_MAX_LINE_CHARS = 500;

function capOrderExtras(extras: Record<string, string>): string | null {
  if (!Object.keys(extras).length) return null;
  const capped: Record<string, string> = {};
  for (const [key, value] of Object.entries(extras)) {
    const lines = value.split('\n').slice(0, ORDER_EXTRAS_MAX_LINES).map((line) =>
      line.length > ORDER_EXTRAS_MAX_LINE_CHARS ? `${line.slice(0, ORDER_EXTRAS_MAX_LINE_CHARS - 1)}…` : line,
    );
    capped[key] = lines.join('\n');
  }
  const byteLen = (s: string) => new TextEncoder().encode(s).length;
  let json = JSON.stringify(capped);
  // Still over budget (many long fields): halve the largest field's lines
  // until it fits. Terminates: an empty object is 2 bytes.
  while (byteLen(json) > ORDER_EXTRAS_MAX_BYTES) {
    let largestKey = '';
    let largestLen = 0;
    for (const [key, value] of Object.entries(capped)) {
      if (value.length > largestLen) { largestLen = value.length; largestKey = key; }
    }
    if (!largestKey) break;
    const lines = capped[largestKey].split('\n');
    if (lines.length <= 1) delete capped[largestKey];
    else capped[largestKey] = lines.slice(0, Math.max(1, Math.floor(lines.length / 2))).join('\n');
    json = JSON.stringify(capped);
  }
  return json;
}

async function refreshOrderStatus(env: Env, order: OrderRow): Promise<OrderRow> {
  const client = cidClientFromEnv(env);
  if (!client || !order.provider_order_id || !env.DB) return order;
  try {
    const status = await client.status(order.provider_order_id);
    const nextStatus = status.status || order.status;
    const remains = status.remains !== undefined ? Number(status.remains) : order.remains;
    const startCount = status.start_count !== undefined ? Number(status.start_count) : order.start_count;
    const now = new Date().toISOString();

    // Auto-refund the undelivered portion when the provider cancels.
    let refundAmount = order.refund_amount;
    if (nextStatus === 'Canceled' && order.refund_amount === 0) {
      const undelivered = remains !== null && remains !== undefined && Number.isFinite(remains) ? remains : order.quantity;
      const refund = round2((order.charge * undelivered) / order.quantity);
      if (refund > 0) {
        await appendLedger(env.DB, {
          userId: order.user_id,
          type: 'refund',
          amount: refund,
          refType: 'order',
          refId: order.id,
          note: `Refund for canceled order (${undelivered}/${order.quantity} undelivered)`,
        });
        refundAmount = refund;
      }
    }

    await env.DB
      .prepare('UPDATE orders SET status = ?, remains = ?, start_count = ?, refund_amount = ?, updated_at = ? WHERE id = ?')
      .bind(nextStatus, remains, startCount, refundAmount, now, order.id)
      .run();
    return { ...order, status: nextStatus, remains, start_count: startCount, refund_amount: refundAmount, updated_at: now };
  } catch (error) {
    console.error('Order status refresh failed:', error instanceof Error ? error.message : 'unknown');
    return order;
  }
}

app.post('/api/orders', async (c) => {
  const user = await requireAuth(c);
  if (isResponse(user)) return user;
  const db = c.env.DB!;
  const client = cidClientFromEnv(c.env);
  if (!client) return c.json({ error: 'Ordering is not enabled yet (provider not configured).' }, 503);

  const body: {
    serviceId?: string; link?: string; quantity?: number;
    comments?: string; usernames?: string; groups?: string; hashtag?: string;
    username?: string; answerNumber?: number | string; keywords?: string;
    runs?: number | string; interval?: number | string;
  } = await c.req.json().catch(() => ({}));
  const serviceId = String(body.serviceId || '');
  const link = String(body.link || '').trim();

  const service = await db.prepare('SELECT * FROM services WHERE id = ?').bind(serviceId).first<ServiceRow>();
  if (!service || service.is_active !== 1 || service.provider_active !== 1) {
    return c.json({ error: 'This service is not available right now.' }, 404);
  }
  // The link field carries a username for username-only services, so only
  // emptiness is rejected here — the provider validates the format.
  if (!link) return c.json({ error: 'Enter the link (or username) to promote.' }, 400);

  // Type-specific inputs (audit 2026-10-25). The frontend renders these
  // fields per service type, but the backend re-validates everything —
  // a crafted request must never reach CID with missing parameters.
  const kind = normalizeServiceType(service.type);
  const nonEmptyLines = (value: unknown): string[] =>
    String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const extras: Record<string, string> = {};
  let quantity = Math.floor(Number(body.quantity));
  const derived = kind === 'customComments' || kind === 'mentionsCustomList';
  if (kind === 'customComments') {
    const lines = nonEmptyLines(body.comments);
    if (!lines.length) return c.json({ error: 'Add at least one comment (one per line).' }, 400);
    quantity = lines.length; // API rule: quantity = number of lines.
    extras.comments = lines.join('\n');
  } else if (kind === 'mentionsCustomList') {
    const lines = nonEmptyLines(body.usernames);
    if (!lines.length) return c.json({ error: 'Add at least one username (one per line).' }, 400);
    quantity = lines.length;
    extras.usernames = lines.join('\n');
  } else if (kind === 'mentionsHashtag') {
    const tag = String(body.hashtag ?? '').trim();
    if (!tag) return c.json({ error: 'Add the hashtag.' }, 400);
    extras.hashtag = tag;
  } else if (kind === 'mentionsUserFollowers') {
    const donor = String(body.username ?? '').trim();
    if (!donor) return c.json({ error: 'Add the donor username.' }, 400);
    extras.username = donor;
  } else if (kind === 'poll') {
    const answer = Math.floor(Number(body.answerNumber));
    if (!Number.isFinite(answer) || answer < 1) return c.json({ error: 'Choose a poll answer number.' }, 400);
    extras.answer_number = String(answer);
  } else if (kind === 'invites') {
    const lines = nonEmptyLines(body.groups);
    if (!lines.length) return c.json({ error: 'Add at least one group (one per line).' }, 400);
    extras.groups = lines.join('\n');
  } else if (kind === 'seo') {
    const keywords = String(body.keywords ?? '').trim();
    if (keywords) extras.keywords = keywords; // optional for this type
  }
  if (kind === 'package') {
    quantity = service.min; // Package size is fixed; API charges at min.
  }

  // Dripfeed (only when the provider flags the service): total volume =
  // quantity × runs, so the charge scales with runs too.
  let runs = 1;
  if (service.dripfeed === 1) {
    const rawRuns = body.runs === undefined || body.runs === null || body.runs === '' ? undefined : Math.floor(Number(body.runs));
    const rawInterval = body.interval === undefined || body.interval === null || body.interval === '' ? undefined : Math.floor(Number(body.interval));
    if (rawRuns !== undefined) {
      if (!Number.isFinite(rawRuns) || rawRuns < 1) return c.json({ error: 'Runs must be at least 1.' }, 400);
      runs = rawRuns;
      extras.runs = String(rawRuns);
    }
    if (rawInterval !== undefined) {
      if (!Number.isFinite(rawInterval) || rawInterval < 1) return c.json({ error: 'Interval must be at least 1 minute.' }, 400);
      extras.interval = String(rawInterval);
    }
  }

  if (!Number.isFinite(quantity) || quantity < service.min || quantity > service.max) {
    const message = derived
      ? `Add between ${service.min} and ${service.max} lines.`
      : `Quantity must be between ${service.min} and ${service.max} for this service.`;
    return c.json({ error: message }, 400);
  }

  const charge = round2((service.retail_rate * quantity * runs) / 1000);
  const providerCost = round2((service.provider_rate * quantity * runs) / 1000);
  const balance = await getBalance(db, user.id);
  if (balance < charge) {
    return c.json({ error: `Insufficient balance. This order costs ₹${charge.toFixed(2)} and your balance is ₹${balance.toFixed(2)}. Top up first.` }, 402);
  }

  // Provider first: if CID rejects, the customer is never debited.
  let providerOrderId: string;
  try {
    providerOrderId = await client.addOrder(service.provider_id, link, quantity, extras);
  } catch (error) {
    return c.json({ error: `Provider rejected the order: ${error instanceof Error ? error.message : 'unknown error'}` }, 502);
  }

  const orderId = newId('ord');
  const now = new Date().toISOString();
  const publicService = rowToPublic(service);
  const baseColumns = 'id, user_id, service_id, service_name, provider_order_id, link, quantity, charge, provider_cost, status, created_at, updated_at';
  const baseValues = `?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?`;
  const baseBind = [orderId, user.id, service.id, publicService.name, providerOrderId, link, quantity, charge, providerCost, now, now];
  const extrasJson = capOrderExtras(extras);
  try {
    if (extrasJson === null) {
      await db.prepare(`INSERT INTO orders (${baseColumns}) VALUES (${baseValues})`).bind(...baseBind).run();
    } else {
      await db.prepare(`INSERT INTO orders (${baseColumns}, extras) VALUES (${baseValues}, ?)`).bind(...baseBind, extrasJson).run();
    }
  } catch (err) {
    // Pre-migration database (0006 not pasted yet): the extras column does
    // not exist. The order must still go through — it just records no inputs.
    if (extrasJson !== null && err instanceof Error && /no such column/i.test(err.message)) {
      await db.prepare(`INSERT INTO orders (${baseColumns}) VALUES (${baseValues})`).bind(...baseBind).run();
    } else {
      throw err;
    }
  }
  const newBalance = await appendLedger(db, {
    userId: user.id,
    type: 'order_debit',
    amount: -charge,
    refType: 'order',
    refId: orderId,
    note: `${publicService.name} × ${quantity}`,
  });

  // Real-time owner ping on the webhook (#ampliva-alerts). Fire-and-forget:
  // a Discord failure must never slow down or break the order response.
  c.executionCtx.waitUntil(notifyOrderPlaced(c.env, {
    email: user.email, serviceName: publicService.name, orderId, providerOrderId,
    link, quantity, charge, balanceAfter: newBalance, extras,
  }));

  return c.json({ orderId, providerOrderId, charge, balance: newBalance, status: 'Pending' }, 201);
});

app.get('/api/orders', async (c) => {
  const user = await requireAuth(c);
  if (isResponse(user)) return user;
  // Join the service's refill flag so the frontend can hide the Refill
  // button for services that don't allow refills (tapping it used to
  // create Failed rows in the refill log).
  const rows = await c.env.DB!
    .prepare('SELECT o.*, s.refill AS service_refill FROM orders o LEFT JOIN services s ON s.id = o.service_id WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 100')
    .bind(user.id)
    .all<OrderRow>();
  return c.json({ orders: rows.results ?? [] });
});

app.post('/api/orders/:id/refresh', async (c) => {
  const user = await requireAuth(c);
  if (isResponse(user)) return user;
  const order = await c.env.DB!.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id)
    .first<OrderRow>();
  if (!order) return c.json({ error: 'Order not found' }, 404);
  const updated = await refreshOrderStatus(c.env, order);
  return c.json({ order: updated });
});

app.get('/api/refills', async (c) => {
  const user = await requireAuth(c);
  if (isResponse(user)) return user;
  const db = c.env.DB!;
  try {
    const result = await db.prepare(
      `SELECT r.id, r.order_id, o.service_name, o.link, r.provider_refill_id, r.status, r.created_at
       FROM refill_requests r JOIN orders o ON o.id = r.order_id
       WHERE r.user_id = ? ORDER BY r.created_at DESC`,
    ).bind(user.id).all<RefillRequest>();
    return c.json({ refills: result.results ?? [] });
  } catch {
    // Pre-migration database (0004 not pasted yet): no refill table,
    // so the history is empty rather than an error.
    return c.json({ refills: [] });
  }
});

app.post('/api/orders/:id/refill', async (c) => {
  const user = await requireAuth(c);
  if (isResponse(user)) return user;
  const client = cidClientFromEnv(c.env);
  if (!client) return c.json({ error: 'Provider not configured' }, 503);
  const order = await c.env.DB!.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id)
    .first<OrderRow>();
  if (!order?.provider_order_id) return c.json({ error: 'Order not found' }, 404);
  // Refuse before recording anything: services that don't allow refills
  // must never produce Failed rows in the refill log.
  const service = await c.env.DB!.prepare('SELECT refill FROM services WHERE id = ?')
    .bind(order.service_id)
    .first<{ refill: number }>();
  if (!service || service.refill !== 1) {
    return c.json({ error: 'This service does not allow refills.' }, 400);
  }
  // Record the attempt so refill history exists even for failures.
  // Tolerant: if migration 0004 hasn't been pasted yet, the writes fail
  // silently and the refill still proceeds exactly as before.
  const refillRowId = newId('ref');
  const now = new Date().toISOString();
  try {
    await c.env.DB!.prepare('INSERT INTO refill_requests (id, user_id, order_id, provider_refill_id, status, created_at) VALUES (?, ?, ?, NULL, ?, ?)')
      .bind(refillRowId, user.id, order.id, 'pending', now).run();
  } catch { /* history unavailable pre-migration */ }
  try {
    const refillId = await client.refill(order.provider_order_id);
    try {
      await c.env.DB!.prepare("UPDATE refill_requests SET provider_refill_id = ?, status = 'submitted' WHERE id = ?")
        .bind(refillId || null, refillRowId).run();
    } catch { /* history unavailable pre-migration */ }
    // Same webhook channel as orders; only on provider acceptance, never on
    // a failed refill (that row just stays 'failed' in history).
    c.executionCtx.waitUntil(notifyRefillSubmitted(c.env, {
      email: user.email, serviceName: order.service_name, orderId: order.id,
      providerOrderId: order.provider_order_id ?? '', refillId: refillId || '',
      refillRowId, link: order.link, quantity: order.quantity,
    }));
    return c.json({ ok: true, refillId });
  } catch (error) {
    try {
      await c.env.DB!.prepare("UPDATE refill_requests SET status = 'failed' WHERE id = ?").bind(refillRowId).run();
    } catch { /* history unavailable pre-migration */ }
    return c.json({ error: error instanceof Error ? error.message : 'Refill failed' }, 502);
  }
});

app.post('/api/orders/:id/cancel', async (c) => {
  const user = await requireAuth(c);
  if (isResponse(user)) return user;
  const client = cidClientFromEnv(c.env);
  if (!client) return c.json({ error: 'Provider not configured' }, 503);
  const order = await c.env.DB!.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id)
    .first<OrderRow>();
  if (!order?.provider_order_id) return c.json({ error: 'Order not found' }, 404);
  try {
    await client.cancel(order.provider_order_id);
    const updated = await refreshOrderStatus(c.env, order);
    return c.json({ ok: true, order: updated });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Cancel failed' }, 502);
  }
});

// ---------- admin ----------

app.post('/api/admin/sync', async (c) => {
  const admin = await requireAdmin(c);
  if (isResponse(admin)) return admin;
  if (!c.env.DB) return c.json({ error: 'Database not configured' }, 503);
  const client = cidClientFromEnv(c.env);
  if (!client) return c.json({ error: 'CID_API_KEY is not configured' }, 503);
  try {
    const raw = await client.services();
    const count = await syncCatalogToDb(c.env.DB, raw, defaultMarkup(c.env));
    return c.json({ ok: true, serviceCount: count, syncedAt: new Date().toISOString() });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Sync failed' }, 502);
  }
});

app.get('/api/admin/stats', async (c) => {
  const admin = await requireAdmin(c);
  if (isResponse(admin)) return admin;
  const db = c.env.DB!;
  const users = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const services = await db.prepare('SELECT COUNT(*) AS n FROM services WHERE is_active = 1 AND provider_active = 1').first<{ n: number }>();
  const orders = await db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(charge), 0) AS revenue, COALESCE(SUM(provider_cost), 0) AS cost, COALESCE(SUM(refund_amount), 0) AS refunds FROM orders').first<{ n: number; revenue: number; cost: number; refunds: number }>();
  const pendingTopups = await db.prepare("SELECT COUNT(*) AS n FROM payment_requests WHERE status = 'pending'").first<{ n: number }>();
  let providerBalance: number | null = null;
  const client = cidClientFromEnv(c.env);
  if (client) {
    try { providerBalance = (await client.balance()).balance; } catch { providerBalance = null; }
  }
  return c.json({
    users: Number(users?.n ?? 0),
    activeServices: Number(services?.n ?? 0),
    orders: Number(orders?.n ?? 0),
    revenue: round2(Number(orders?.revenue ?? 0)),
    providerCost: round2(Number(orders?.cost ?? 0)),
    refunds: round2(Number(orders?.refunds ?? 0)),
    grossMargin: round2(Number(orders?.revenue ?? 0) - Number(orders?.cost ?? 0) - Number(orders?.refunds ?? 0)),
    pendingTopups: Number(pendingTopups?.n ?? 0),
    providerBalance,
    currency: c.env.CID_CURRENCY || 'INR',
  });
});

app.get('/api/admin/services', async (c) => {
  const admin = await requireAdmin(c);
  if (isResponse(admin)) return admin;
  const rows = await c.env.DB!
    .prepare('SELECT * FROM services ORDER BY category ASC, retail_rate ASC')
    .all<ServiceRow>();
  return c.json({ services: rows.results ?? [] });
});

app.patch('/api/admin/services/:id', async (c) => {
  const admin = await requireAdmin(c);
  if (isResponse(admin)) return admin;
  const db = c.env.DB!;
  const service = await db.prepare('SELECT * FROM services WHERE id = ?').bind(c.req.param('id')).first<ServiceRow>();
  if (!service) return c.json({ error: 'Service not found' }, 404);
  const body: { displayName?: string | null; markupPercent?: number | null; isActive?: boolean } =
    await c.req.json<{ displayName?: string | null; markupPercent?: number | null; isActive?: boolean }>().catch(() => ({}));
  const displayName = body.displayName === undefined ? service.display_name : (body.displayName ? String(body.displayName).trim() : null);
  const markupOverride = body.markupPercent === undefined ? service.markup_override : (body.markupPercent === null ? null : Number(body.markupPercent));
  const isActive = body.isActive === undefined ? service.is_active : (body.isActive ? 1 : 0);
  const retail = retailFor(service.provider_rate, markupOverride ?? defaultMarkup(c.env));
  await db
    .prepare('UPDATE services SET display_name = ?, markup_override = ?, retail_rate = ?, is_active = ? WHERE id = ?')
    .bind(displayName, markupOverride, retail, isActive, service.id)
    .run();
  const updated = await db.prepare('SELECT * FROM services WHERE id = ?').bind(service.id).first<ServiceRow>();
  return c.json({ service: updated });
});

app.get('/api/admin/topups', async (c) => {
  const admin = await requireAdmin(c);
  if (isResponse(admin)) return admin;
  const rows = await c.env.DB!
    .prepare(
      `SELECT p.*, u.email AS user_email FROM payment_requests p JOIN users u ON u.id = p.user_id
       ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC LIMIT 100`,
    )
    .all();
  return c.json({ topups: rows.results ?? [] });
});

// Shared by the dashboard approve/reject routes and the Discord button
// handler below, so a top-up can never be credited twice or decided two
// ways: only a pending request moves, and approval always appends the ledger.
async function decideTopup(
  db: D1Database,
  id: string,
  decision: 'approved' | 'rejected',
  decidedBy: string,
): Promise<{ ok: true; balance?: number } | { error: string; status: 404 | 409 }> {
  const topup = await db.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(id)
    .first<{ id: string; user_id: string; amount: number; status: string }>();
  if (!topup) return { error: 'Top-up request not found', status: 404 };
  if (topup.status !== 'pending') return { error: `Already ${topup.status}`, status: 409 };
  await db.prepare('UPDATE payment_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
    .bind(decision, new Date().toISOString(), decidedBy, id).run();
  if (decision === 'approved') {
    const balance = await appendLedger(db, {
      userId: topup.user_id, type: 'topup', amount: topup.amount,
      refType: 'payment_request', refId: topup.id, note: 'UPI top-up approved',
    });
    return { ok: true, balance };
  }
  return { ok: true };
}

app.post('/api/admin/topups/:id/approve', async (c) => {
  const admin = await requireAdmin(c);
  if (isResponse(admin)) return admin;
  const result = await decideTopup(c.env.DB!, c.req.param('id'), 'approved', admin.id);
  if ('error' in result) return c.json({ error: result.error }, result.status);
  return c.json({ ok: true, userBalance: result.balance });
});

app.post('/api/admin/topups/:id/reject', async (c) => {
  const admin = await requireAdmin(c);
  if (isResponse(admin)) return admin;
  const result = await decideTopup(c.env.DB!, c.req.param('id'), 'rejected', admin.id);
  if ('error' in result) return c.json({ error: result.error }, result.status);
  return c.json({ ok: true });
});

// ---------- Discord app interactions (top-up approve/reject buttons) ----------
// No session auth here by design: the Ed25519 signature IS the auth (it
// proves Discord sent this for our app), and the clicker must be the owner.
app.post('/api/discord/interactions', async (c) => {
  const signature = c.req.header('X-Signature-Ed25519');
  const timestamp = c.req.header('X-Signature-Timestamp');
  const rawBody = await c.req.text();
  if (
    !c.env.DISCORD_PUBLIC_KEY || !signature || !timestamp ||
    !(await verifyDiscordSignature(c.env.DISCORD_PUBLIC_KEY, timestamp, rawBody, signature))
  ) {
    return c.json({ error: 'Invalid signature' }, 401);
  }
  const interaction = JSON.parse(rawBody) as {
    type: number;
    id?: string;
    data?: { custom_id?: string; name?: string; options?: Array<{ name: string; value?: string | number }> };
    member?: { user?: { id?: string } };
    user?: { id?: string };
    message?: { embeds?: Array<{ fields?: Array<{ name: string; value: string }> }> };
  };
  if (interaction.type === 1) return c.json({ type: 1 }); // Discord PING
  // Owner gate first, for commands and buttons alike: nothing below runs for
  // anyone else, and no store data leaks into a stranger's error path.
  const ephemeral = (content: string) => c.json({ type: 4, data: { content, flags: 64 } });
  if (!c.env.ADMIN_DISCORD_USER_ID) return ephemeral('Owner approvals are not configured yet.');
  const clickerId = interaction.member?.user?.id ?? interaction.user?.id;
  if (clickerId !== c.env.ADMIN_DISCORD_USER_ID.trim()) {
    return ephemeral(interaction.type === 2 ? 'Only the store owner can use admin commands.' : 'Only the store owner can decide top-ups.');
  }
  const db = c.env.DB!;

  // ---------- Slash commands (type 2). All replies are ephemeral: customer
  // emails and balances never land in the channel, only in the owner's view.
  if (interaction.type === 2) {
    const options = Object.fromEntries((interaction.data?.options ?? []).map((o) => [o.name, o.value]));
    const name = interaction.data?.name;
    if (name === 'pending') {
      const msg = await buildPendingMessage(db);
      return c.json({ type: 4, data: { ...msg, flags: 64 } });
    }
    if (name === 'users') {
      const msg = await buildUsersMessage(db, String(options.query ?? ''), 0);
      return c.json({ type: 4, data: { ...msg, flags: 64 } });
    }
    if (name === 'orders') {
      const msg = await buildOrdersMessage(db, String(options.user ?? ''), 0);
      return c.json({ type: 4, data: { ...msg, flags: 64 } });
    }
    if (name === 'refills') {
      const msg = await buildRefillsMessage(db, String(options.user ?? ''), 0);
      return c.json({ type: 4, data: { ...msg, flags: 64 } });
    }
    if (name === 'adjust') {
      const email = String(options.user ?? '').trim();
      const amount = Number(options.amount);
      const reason = String(options.reason ?? '').trim() || 'Balance adjusted via Discord';
      if (!email || !Number.isInteger(amount) || Math.abs(amount) > 100000) {
        return ephemeral('Invalid adjustment. Amount must be a whole number between -100000 and 100000.');
      }
      const user = await db.prepare('SELECT id, email FROM users WHERE LOWER(email) = LOWER(?)').bind(email).first<{ id: string; email: string }>();
      if (!user) return ephemeral(`No user found with email ${email}. Find the exact email with /users first.`);
      const balance = await getBalance(db, user.id);
      const newBalance = Math.round((balance + amount) * 100) / 100;
      if (newBalance < 0) return ephemeral(`That would take ${user.email} to ₹${newBalance.toFixed(2)} — balances can't go below zero.`);
      // Reason travels in the confirm embed's Reason field, not the button id
      // (free text can contain ':'), and is read back on confirm.
      return c.json({
        type: 4,
        data: {
          flags: 64,
          embeds: [{
            title: 'Confirm balance adjustment',
            fields: [
              { name: 'User', value: user.email },
              { name: 'Current balance', value: `₹${balance.toFixed(2)}` },
              { name: 'Adjustment', value: `${amount >= 0 ? '+' : ''}₹${amount.toFixed(2)}` },
              { name: 'New balance', value: `₹${newBalance.toFixed(2)}` },
              { name: 'Reason', value: reason },
            ],
            color: 0x7c5cff,
          }],
          components: [{
            type: 1,
            components: [
              { type: 2, style: 3, label: 'Confirm', custom_id: `adjust:confirm:${user.id}:${amount}` },
              { type: 2, style: 4, label: 'Cancel', custom_id: `adjust:cancel:${user.id}` },
            ],
          }],
        },
      });
    }
    return ephemeral('Unknown command.');
  }

  if (interaction.type !== 3) return c.json({ error: 'Unsupported interaction' }, 400);

  // ---------- Buttons (type 3).
  // Pending-queue buttons refresh the whole list after deciding, so the queue
  // stays usable instead of collapsing to one request.
  const pendingMatch = /^pending:(approve|reject):(.+)$/.exec(String(interaction.data?.custom_id || ''));
  if (pendingMatch) {
    const decision = pendingMatch[1] === 'approve' ? 'approved' : 'rejected';
    const result = await decideTopup(db, pendingMatch[2], decision, 'discord');
    if ('error' in result && result.status === 404) return ephemeral('Top-up request not found.');
    const msg = await buildPendingMessage(db);
    return c.json({ type: 7, data: msg });
  }

  const usersMatch = /^users:(\d+):(.*)$/.exec(String(interaction.data?.custom_id || ''));
  if (usersMatch) {
    const msg = await buildUsersMessage(db, usersMatch[2], Number(usersMatch[1]));
    return c.json({ type: 7, data: msg });
  }

  const ordersMatch = /^orders:(\d+):(.*)$/.exec(String(interaction.data?.custom_id || ''));
  if (ordersMatch) {
    const msg = await buildOrdersMessage(db, ordersMatch[2], Number(ordersMatch[1]));
    return c.json({ type: 7, data: msg });
  }

  const refillsMatch = /^refills:(\d+):(.*)$/.exec(String(interaction.data?.custom_id || ''));
  if (refillsMatch) {
    const msg = await buildRefillsMessage(db, refillsMatch[2], Number(refillsMatch[1]));
    return c.json({ type: 7, data: msg });
  }

  const adjustMatch = /^adjust:(confirm|cancel):([^:]+)(?::(-?\d+))?$/.exec(String(interaction.data?.custom_id || ''));
  if (adjustMatch) {
    const userId = adjustMatch[2];
    if (adjustMatch[1] === 'cancel') {
      return c.json({ type: 7, data: { embeds: [{ title: '❌ Adjustment cancelled', description: 'No balance was changed.', color: 0xe74c3c }], components: [] } });
    }
    const amount = Number(adjustMatch[3]);
    const user = await db.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
    if (!user) return ephemeral('User not found.');
    // Re-check the balance at confirm time: it may have moved since the
    // command ran, and a debit must never push it below zero.
    const balance = await getBalance(db, userId);
    if (Math.round((balance + amount) * 100) / 100 < 0) {
      return ephemeral('That adjustment no longer fits this balance — it may have changed since you confirmed.');
    }
    const reasonField = interaction.message?.embeds?.[0]?.fields?.find((f) => f.name === 'Reason');
    const reason = reasonField?.value || 'Balance adjusted via Discord';
    const newBalance = await appendLedger(db, {
      userId, type: 'admin_adjust', amount,
      refType: 'discord_adjust', refId: `discord:${interaction.id ?? ''}`,
      note: reason,
    });
    return c.json({
      type: 7,
      data: {
        embeds: [{
          title: '✅ Balance adjusted',
          description: `${user.email}: ${amount >= 0 ? '+' : ''}₹${amount.toFixed(2)} → new balance ₹${newBalance.toFixed(2)}\nReason: ${reason}`,
          color: 0x2ecc71,
        }],
        components: [],
      },
    });
  }

  const match = /^topup:(approve|reject):(.+)$/.exec(String(interaction.data?.custom_id || ''));
  if (!match) return ephemeral('Unknown button.');
  const decision = match[1] === 'approve' ? 'approved' : 'rejected';
  const result = await decideTopup(db, match[2], decision, 'discord');
  if ('error' in result && result.status === 404) return ephemeral('Top-up request not found.');
  // Converge the message to the request's current state, buttons removed,
  // so a stale or double-tapped message can never decide twice.
  const fresh = await db.prepare(
    `SELECT p.*, u.email AS user_email FROM payment_requests p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
  ).bind(match[2]).first<{ amount: number; txn_ref: string; status: string; user_email: string }>();
  if (!fresh) return ephemeral('Top-up request not found.');
  const decided = fresh.status === 'approved' ? '✅ Top-up approved' : fresh.status === 'rejected' ? '❌ Top-up rejected' : '💰 Top-up request';
  return c.json({
    type: 7,
    data: {
      embeds: [{
        title: decided,
        description: `₹${Number(fresh.amount).toFixed(2)} from ${fresh.user_email}\nUTR: \`${fresh.txn_ref}\``,
        color: fresh.status === 'approved' ? 0x2ecc71 : fresh.status === 'rejected' ? 0xe74c3c : 0x7c5cff,
        timestamp: new Date().toISOString(),
      }],
      components: [],
    },
  });
});

app.post('/api/admin/discord/register-commands', async (c) => {
  const admin = await requireAdmin(c);
  if (isResponse(admin)) return admin;
  try {
    const count = await registerDiscordCommands(c.env);
    return c.json({ ok: true, count });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Registration failed' }, 502);
  }
});

app.get('/api/admin/orders', async (c) => {
  const admin = await requireAdmin(c);
  if (isResponse(admin)) return admin;
  const rows = await c.env.DB!
    .prepare(
      `SELECT o.*, u.email AS user_email FROM orders o JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC LIMIT 200`,
    )
    .all();
  return c.json({ orders: rows.results ?? [] });
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => {
  console.error('Unhandled Ampliva API error:', error.message);
  return c.json({ error: 'Internal server error' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (env.DB) {
      // Nag the owner about top-up requests left pending > 4h, so a customer
      // is never stranded just because the dashboard went unchecked.
      ctx.waitUntil((async () => {
        try {
          const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
          const rows = await env.DB!
            .prepare("SELECT pr.amount AS amount, pr.created_at AS created_at, u.email AS email FROM payment_requests pr JOIN users u ON u.id = pr.user_id WHERE pr.status = 'pending' AND pr.created_at < ? ORDER BY pr.created_at ASC LIMIT 10")
            .bind(cutoff)
            .all<{ amount: number; created_at: string; email: string }>();
          const pending = rows.results ?? [];
          if (pending.length) {
            const total = pending.reduce((sum, r) => sum + r.amount, 0);
            const lines = pending.map((r) => `• ₹${r.amount.toFixed(2)} — ${r.email} (since ${r.created_at.slice(0, 16).replace('T', ' ')} UTC)`).join('\n');
            await notifyDiscord(env, '⏰ Top-up requests still waiting', `${pending.length} request(s) pending over 4 hours, ₹${total.toFixed(2)} total:\n${lines}\nApprove them: https://ampliva-store.pages.dev → Admin`);
          }
        } catch (error) {
          console.error('Stale top-up check failed:', error instanceof Error ? error.message : 'unknown');
        }
      })());
    }
    // Daily catalogue sync (see wrangler.toml triggers) once D1 + key exist.
    if (!env.DB || !env.CID_API_KEY) return;
    const client = cidClientFromEnv(env);
    if (!client) return;
    ctx.waitUntil(
      client.services()
        .then((raw) => syncCatalogToDb(env.DB!, raw, defaultMarkup(env)))
        .catch((error) => console.error('Scheduled sync failed:', error instanceof Error ? error.message : 'unknown')),
    );
  },
};
