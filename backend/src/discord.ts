import type { Env } from './types';
import { cleanName } from './catalog';
import { formatOrderRef, notifyDiscord } from './notify';
import { cidClientFromEnv } from './providers/cid';

/**
 * Discord app interactions for owner approvals.
 *
 * Why an app, not the plain webhook: a manually created channel webhook has
 * no owning Discord application, so Discord has nowhere to route a button
 * click — the click would just fail. A Discord application (free) owns both
 * the bot that sends the alert and the interactions endpoint that receives
 * the click, which is the documented path for working buttons.
 *
 * Secrets the owner sets in the Worker dashboard:
 *   DISCORD_BOT_TOKEN       — bot token (encrypt)
 *   DISCORD_CHANNEL_ID      — channel the top-up alerts go to
 *   DISCORD_PUBLIC_KEY      — app public key, for Ed25519 verification
 *   ADMIN_DISCORD_USER_ID   — owner's Discord user id; only this user may
 *                             decide top-ups (fail closed when unset)
 * Until the bot token + channel are set, top-up alerts fall back to the
 * existing webhook text ping (dashboard approve link), so nothing breaks
 * before setup is finished.
 */

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) throw new Error('odd hex length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Verify a Discord interaction signature: Ed25519 over timestamp + raw body. */
export async function verifyDiscordSignature(
  publicKeyHex: string,
  timestamp: string,
  rawBody: string,
  signatureHex: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', hexToBytes(publicKeyHex) as BufferSource, 'Ed25519', false, ['verify']);
    const message = new Uint8Array([
      ...new TextEncoder().encode(timestamp),
      ...new TextEncoder().encode(rawBody),
    ]);
    return await crypto.subtle.verify('Ed25519', key, hexToBytes(signatureHex) as BufferSource, message as BufferSource);
  } catch {
    return false;
  }
}

function topupButtons(topupId: string) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Approve', custom_id: `topup:approve:${topupId}` },
        { type: 2, style: 4, label: 'Reject', custom_id: `topup:reject:${topupId}` },
      ],
    },
  ];
}

/**
 * Top-up alert with Approve/Reject buttons via the bot. Falls back to the
 * existing webhook text ping (no buttons, dashboard link) when the bot is
 * not configured or the bot send fails — an alert must never go missing.
 */
export async function notifyTopupRequest(
  env: Env,
  topup: { id: string; amount: number; email: string; txnRef: string },
): Promise<void> {
  const title = '💰 New top-up request';
  const description =
    `₹${topup.amount.toFixed(2)} from ${topup.email}\nUTR: \`${topup.txnRef}\`\n` +
    `Verify the UTR in your bank app, then tap Approve or Reject below.`;
  if (env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID) {
    try {
      const res = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{ title, description, color: 0x7c5cff, timestamp: new Date().toISOString() }],
          components: topupButtons(topup.id),
        }),
      });
      if (res.ok) return;
    } catch {
      // Fall through to the webhook ping below.
    }
  }
  await notifyDiscord(
    env,
    title,
    `${description}\nApprove: https://ampliva-store.pages.dev → Admin → Top-up requests`,
  );
}

// ---------- Admin slash commands ----------
// Commands arrive at the same interactions endpoint as button clicks, so no
// gateway process is needed. They are registered guild-scoped (instant) by
// POST /api/admin/discord/register-commands, which needs two more Worker
// variables: DISCORD_APP_ID (Client ID on the app's OAuth2 page) and
// DISCORD_GUILD_ID (right-click the server with Developer Mode on).

export const DISCORD_COMMANDS = [
  { name: 'pending', description: 'Show pending top-up requests with approve/reject buttons' },
  {
    name: 'users',
    description: 'List users and balances',
    options: [{ name: 'query', description: 'Filter by email', type: 3, required: false }],
  },
  {
    name: 'adjust',
    description: 'Adjust a user balance (asks for confirmation first)',
    options: [
      { name: 'user', description: 'User email (exact)', type: 3, required: true },
      { name: 'amount', description: 'Positive to credit, negative to debit', type: 4, required: true, min_value: -100000, max_value: 100000 },
      { name: 'reason', description: 'Reason recorded in the ledger', type: 3, required: false, max_length: 50 },
    ],
  },
  {
    name: 'orders',
    description: 'Browse order history (10 per page)',
    options: [{ name: 'user', description: 'Filter by customer email', type: 3, required: false }],
  },
  {
    name: 'refills',
    description: 'Browse refill history (10 per page)',
    options: [{ name: 'user', description: 'Filter by customer email', type: 3, required: false }],
  },
  {
    name: 'inspect',
    description: 'Show everything stored about one order or refill',
    options: [{ name: 'id', description: 'Order ID (ord_…), AMP number, CID provider order ID, or refill ID (ref_…)', type: 3, required: true, max_length: 100 }],
  },
  {
    name: 'stats',
    description: 'Show panel stats: users, orders, revenue, margin, CID balance',
  },
  {
    name: 'catalog',
    description: 'Search the live service catalogue (prices, minimums)',
    options: [{ name: 'query', description: 'Search name, category, or platform (empty = platform summary)', type: 3, required: false, max_length: 100 }],
  },
  {
    name: 'user',
    description: 'Show everything about one customer',
    options: [{ name: 'user', description: 'User email (exact)', type: 3, required: true }],
  },
  {
    name: 'recheck',
    description: 'Refresh one order live from CID right now',
    options: [{ name: 'id', description: 'Order ID (ord_…), AMP number, or CID provider order ID', type: 3, required: true, max_length: 100 }],
  },
  {
    name: 'refund',
    description: 'Refund an order (asks for confirmation first)',
    options: [
      { name: 'order', description: 'Order ID (ord_…), AMP number, or CID provider order ID', type: 3, required: true, max_length: 100 },
      { name: 'amount', description: 'Refund amount in ₹', type: 10, required: true, min_value: 0.01, max_value: 100000 },
      { name: 'reason', description: 'Reason recorded in the ledger', type: 3, required: false, max_length: 50 },
    ],
  },
];

export async function registerDiscordCommands(env: Env): Promise<number> {
  if (!env.DISCORD_APP_ID) throw new Error('Set DISCORD_APP_ID in the Worker (Client ID on the app’s OAuth2 page).');
  if (!env.DISCORD_GUILD_ID) throw new Error('Set DISCORD_GUILD_ID in the Worker (right-click the server with Developer Mode on → Copy Server ID).');
  if (!env.DISCORD_BOT_TOKEN) throw new Error('Set DISCORD_BOT_TOKEN in the Worker first.');
  const res = await fetch(
    `https://discord.com/api/v10/applications/${env.DISCORD_APP_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`,
    {
      method: 'PUT',
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(DISCORD_COMMANDS),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord rejected registration (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => [])) as unknown;
  return Array.isArray(data) ? data.length : 0;
}

/** Indian-grouped rupees: 100000 -> ₹1,00,000.00 */
function inr(n: number): string {
  const neg = n < 0;
  const [int, dec] = (Math.round(Math.abs(n) * 100) / 100).toFixed(2).split('.');
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${neg ? '-' : ''}₹${grouped}.${dec}`;
}

function istShort(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
    });
  } catch {
    return iso.slice(0, 16);
  }
}

interface PendingRow {
  id: string;
  amount: number;
  txn_ref: string;
  created_at: string;
  user_email: string;
}

/** Pending queue message (oldest first, max 5 rows of buttons). Shared by the
 *  /pending command and by pending:* taps, which refresh it after deciding. */
export async function buildPendingMessage(db: D1Database) {
  const totalRow = await db.prepare(`SELECT COUNT(*) AS n FROM payment_requests WHERE status = 'pending'`).first<{ n: number }>();
  const total = Number(totalRow?.n ?? 0);
  const rows = await db.prepare(
    `SELECT p.*, u.email AS user_email FROM payment_requests p JOIN users u ON u.id = p.user_id
     WHERE p.status = 'pending' ORDER BY p.created_at ASC LIMIT 5`,
  ).all();
  const list = (rows.results ?? []) as unknown as PendingRow[];
  if (!list.length) {
    return { embeds: [{ title: '⏳ Pending top-ups', description: 'No pending top-up requests.', color: 0x7c5cff }], components: [] };
  }
  const description = list
    .map((t) => `${inr(t.amount)} · ${t.user_email}\nUTR \`${t.txn_ref}\` · ${istShort(t.created_at)}`)
    .join('\n\n');
  return {
    embeds: [{
      title: '⏳ Pending top-ups',
      description: description + (total > list.length ? `\n\nShowing oldest ${list.length} of ${total}.` : ''),
      color: 0x7c5cff,
    }],
    components: list.map((t) => ({
      type: 1,
      components: [
        { type: 2, style: 3, label: `Approve ${inr(t.amount)}`, custom_id: `pending:approve:${t.id}` },
        { type: 2, style: 4, label: `Reject ${inr(t.amount)}`, custom_id: `pending:reject:${t.id}` },
      ],
    })),
  };
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  created_at: string;
  balance: number;
}

const USERS_PAGE_SIZE = 10;

// ---------- History browsers: /orders and /refills (10 per page) ----------
// Header always carries the total count and page count, as asked. Entries
// carry the id, the customer email, and what was paid — plus service, qty,
// status and date, without which a bare id is hard to act on. Refills are
// free, so their "amount" is the original order's charge, labelled as such.

const HISTORY_PAGE_SIZE = 10;

function orderStatusEmoji(status: string): string {
  const s = status.toLowerCase();
  if (s === 'completed') return '✅';
  if (s === 'canceled' || s === 'cancelled') return '❌';
  if (s === 'partial') return '◐';
  if (s === 'refunded') return '↩️';
  return '⏳';
}

function refillStatusEmoji(status: string): string {
  const s = status.toLowerCase();
  if (s === 'submitted') return '✅';
  if (s === 'failed') return '❌';
  return '⏳';
}

function pageButtons(prefix: string, safePage: number, maxPage: number, query: string) {
  const buttons = [];
  const q = query.slice(0, 40);
  if (safePage > 0) buttons.push({ type: 2, style: 2, label: '← Prev', custom_id: `${prefix}:${safePage - 1}:${q}` });
  if (safePage < maxPage) buttons.push({ type: 2, style: 1, label: 'Next →', custom_id: `${prefix}:${safePage + 1}:${q}` });
  return buttons.length ? [{ type: 1, components: buttons }] : [];
}

interface OrderHistoryRow {
  id: string;
  order_number: number | null;
  email: string;
  service_name: string;
  quantity: number;
  charge: number;
  status: string;
  created_at: string;
}

function ordersEmbed(list: OrderHistoryRow[], total: number, safePage: number, maxPage: number, query: string) {
  if (!list.length) {
    return {
      embeds: [{ title: '📦 Order history', description: query ? `No orders matching "${query}".` : 'No orders yet.', color: 0x7c5cff }],
      components: [],
    };
  }
  return {
    embeds: [{
      title: '📦 Order history',
      description: `Total: ${total} orders · Page ${safePage + 1} of ${maxPage + 1}${query ? ` · matching "${query}"` : ''}.`,
      fields: list.map((o) => ({
        name: `${orderStatusEmoji(o.status)} ${formatOrderRef(o.id, o.order_number)}`,
        value: `${o.email}\n${o.service_name} × ${o.quantity} · Paid ${inr(o.charge)} · ${o.status} · ${istShort(o.created_at)}`,
        inline: false,
      })),
      color: 0x7c5cff,
    }],
    components: pageButtons('orders', safePage, maxPage, query),
  };
}

export async function buildOrdersMessage(db: D1Database, query: string, page: number) {
  const q = query.trim();
  const ampMatch = q.match(/^AMP-(\d+)$/i);
  if (ampMatch) {
    // A customer quoting "AMP-1003": match the friendly number directly.
    const n = Number(ampMatch[1]);
    try {
      const totalRow = await db.prepare(
        'SELECT COUNT(*) AS n FROM orders WHERE order_number = ?',
      ).bind(n).first<{ n: number }>();
      const total = Number(totalRow?.n ?? 0);
      const maxPage = Math.max(0, Math.ceil(total / HISTORY_PAGE_SIZE) - 1);
      const safePage = Math.min(Math.max(0, page), maxPage);
      const rows = await db.prepare(
        `SELECT o.*, u.email AS email FROM orders o JOIN users u ON u.id = o.user_id
         WHERE o.order_number = ? ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      ).bind(n, HISTORY_PAGE_SIZE, safePage * HISTORY_PAGE_SIZE).all();
      const list = (rows.results ?? []) as unknown as OrderHistoryRow[];
      return ordersEmbed(list, total, safePage, maxPage, q);
    } catch (err) {
      if (err instanceof Error && /no such column/i.test(err.message)) {
        return {
          embeds: [{ title: '📦 Order history', description: 'Order numbers need migration 0007 — paste it into the D1 console first.', color: 0x7c5cff }],
          components: [],
        };
      }
      throw err;
    }
  }
  const like = `%${q}%`;
  const totalRow = await db.prepare(
    'SELECT COUNT(*) AS n FROM orders o JOIN users u ON u.id = o.user_id WHERE u.email LIKE ?',
  ).bind(like).first<{ n: number }>();
  const total = Number(totalRow?.n ?? 0);
  const maxPage = Math.max(0, Math.ceil(total / HISTORY_PAGE_SIZE) - 1);
  const safePage = Math.min(Math.max(0, page), maxPage);
  // SELECT o.* so the row carries order_number when migration 0007 is
  // pasted, and the command still works before that (field just undefined).
  const rows = await db.prepare(
    `SELECT o.*, u.email AS email FROM orders o JOIN users u ON u.id = o.user_id
     WHERE u.email LIKE ? ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(like, HISTORY_PAGE_SIZE, safePage * HISTORY_PAGE_SIZE).all();
  const list = (rows.results ?? []) as unknown as OrderHistoryRow[];
  return ordersEmbed(list, total, safePage, maxPage, q);
}

interface RefillHistoryRow {
  id: string;
  provider_refill_id: string | null;
  order_id: string;
  order_number: number | null;
  email: string;
  charge: number;
  status: string;
  created_at: string;
}

export async function buildRefillsMessage(db: D1Database, query: string, page: number) {
  // Tolerant like the refill route itself: a pre-migration database (0004
  // not pasted) has no refill_requests table, and the command should say so
  // instead of dying with "interaction failed".
  try {
    const like = `%${query.trim()}%`;
    const totalRow = await db.prepare(
      'SELECT COUNT(*) AS n FROM refill_requests r JOIN users u ON u.id = r.user_id WHERE u.email LIKE ?',
    ).bind(like).first<{ n: number }>();
    const total = Number(totalRow?.n ?? 0);
    const maxPage = Math.max(0, Math.ceil(total / HISTORY_PAGE_SIZE) - 1);
    const safePage = Math.min(Math.max(0, page), maxPage);
    // Prefer the friendly order number (migration 0007); fall back to the
    // ord_ ID query when 0007 is not pasted yet.
    let rows;
    try {
      rows = await db.prepare(
        `SELECT r.id, r.provider_refill_id, r.order_id, o.order_number, u.email AS email, o.charge, r.status, r.created_at
         FROM refill_requests r JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.user_id
         WHERE u.email LIKE ? ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      ).bind(like, HISTORY_PAGE_SIZE, safePage * HISTORY_PAGE_SIZE).all();
    } catch (err) {
      if (!(err instanceof Error && /no such column/i.test(err.message))) throw err;
      rows = await db.prepare(
        `SELECT r.id, r.provider_refill_id, r.order_id, u.email AS email, o.charge, r.status, r.created_at
         FROM refill_requests r JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.user_id
         WHERE u.email LIKE ? ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      ).bind(like, HISTORY_PAGE_SIZE, safePage * HISTORY_PAGE_SIZE).all();
    }
    const list = (rows.results ?? []) as unknown as RefillHistoryRow[];
    if (!list.length) {
      return {
        embeds: [{ title: '🔁 Refill history', description: query ? `No refills matching "${query}".` : 'No refills yet.', color: 0x7c5cff }],
        components: [],
      };
    }
    return {
      embeds: [{
        title: '🔁 Refill history',
        description: `Total: ${total} refills · Page ${safePage + 1} of ${maxPage + 1}${query ? ` · matching "${query}"` : ''}.`,
        fields: list.map((r) => {
          const displayId = r.provider_refill_id || r.id;
          const lines = [
            `Order ${formatOrderRef(r.order_id, r.order_number)} · ${r.email}`,
            `Order paid ${inr(r.charge)} · ${r.status} · ${istShort(r.created_at)}`,
          ];
          if (r.provider_refill_id) lines.push(`Record ${r.id}`);
          return {
            name: `${refillStatusEmoji(r.status)} ${displayId}`,
            value: lines.join('\n'),
            inline: false,
          };
        }),
        color: 0x7c5cff,
      }],
      components: pageButtons('refills', safePage, maxPage, query),
    };
  } catch {
    return {
      embeds: [{ title: '🔁 Refill history', description: 'Refill history is not available yet (migration 0004 not applied).', color: 0x7c5cff }],
      components: [],
    };
  }
}

// ---------- Inspect: everything stored about one order or refill ----------
// One command for inquiries: a customer quotes an AMP number, a CIDstore
// order id, or a refill id, and the owner needs the full record — including
// the provider order id that ties our order to CID's dashboard. Resolution
// order: ref_… → refill by our id; AMP-n → friendly number; ord_… → our
// id; bare digits → friendly number, then provider order id; anything else
// → provider order id, then our id, then provider refill id.

interface InspectOrderRow {
  id: string;
  order_number: number | null;
  user_id: string;
  email: string;
  service_id: string;
  service_name: string;
  provider_order_id: string | null;
  link: string;
  quantity: number;
  charge: number;
  provider_cost: number;
  extras: string | null;
  status: string;
  start_count: number | null;
  remains: number | null;
  refund_amount: number;
  created_at: string;
  updated_at: string;
}

interface InspectRefillRow {
  id: string;
  provider_refill_id: string | null;
  order_id: string;
  order_number: number | null;
  service_name: string;
  provider_order_id: string | null;
  order_charge: number;
  order_status: string;
  email: string;
  status: string;
  created_at: string;
}

const trunc = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

function inspectColor(status: string): number {
  const s = status.toLowerCase();
  if (s === 'completed') return 0x22c55e;
  if (s === 'canceled' || s === 'cancelled') return 0xef4444;
  return 0x7c5cff;
}

function extrasField(extras: string | null): { name: string; value: string } | null {
  if (!extras) return null;
  let parsed: unknown = null;
  try { parsed = JSON.parse(extras); } catch { /* fall through to raw preview */ }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const lines = Object.entries(parsed as Record<string, string>).map(([key, value]) => {
      const v = String(value ?? '');
      if (v.includes('\n')) {
        const vlines = v.split('\n').filter(Boolean);
        return `${key}: ${vlines.length} lines, first: ${trunc(vlines[0] ?? '', 100)}`;
      }
      return `${key}: ${trunc(v, 200)}`;
    });
    return { name: 'Inputs sent to CID', value: trunc(lines.join('\n'), 900) };
  }
  return { name: 'Inputs sent to CID', value: trunc(extras, 900) };
}

export async function findOrder(db: D1Database, input: string): Promise<InspectOrderRow | null> {
  const q = input.trim();
  const byNumber = async (n: number) => {
    try {
      return await db.prepare(
        `SELECT o.*, u.email AS email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.order_number = ?`,
      ).bind(n).first<InspectOrderRow>();
    } catch (err) {
      // Pre-0007 databases have no order_number column: no match, not a crash.
      if (err instanceof Error && /no such column/i.test(err.message)) return null;
      throw err;
    }
  };
  const byId = (id: string) =>
    db.prepare(`SELECT o.*, u.email AS email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?`).bind(id).first<InspectOrderRow>();
  const byProvider = (pid: string) =>
    db.prepare(`SELECT o.*, u.email AS email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.provider_order_id = ?`).bind(pid).first<InspectOrderRow>();
  const ampMatch = q.match(/^AMP-(\d+)$/i);
  if (ampMatch) return byNumber(Number(ampMatch[1]));
  if (q.startsWith('ord_')) return byId(q);
  if (/^\d+$/.test(q)) {
    return (await byNumber(Number(q))) ?? (await byProvider(q));
  }
  return (await byProvider(q)) ?? (await byId(q));
}

export async function orderEmbed(db: D1Database, o: InspectOrderRow) {
  let runs = 1;
  try {
    const parsed = o.extras ? (JSON.parse(o.extras) as Record<string, string>) : null;
    if (parsed && typeof parsed === 'object' && parsed.runs) runs = Number(parsed.runs) || 1;
  } catch { /* no dripfeed info */ }
  const fields: Array<{ name: string; value: string }> = [
    { name: 'Customer', value: o.email },
    { name: 'Service', value: `${o.service_name} (${o.service_id})` },
    { name: 'Status', value: `${orderStatusEmoji(o.status)} ${o.status}${o.start_count !== null || o.remains !== null ? ` · start ${o.start_count ?? '—'} · remains ${o.remains ?? '—'}` : ''}` },
    { name: 'Provider order ID (CID)', value: o.provider_order_id ? `${o.provider_order_id} · paste this ID into CIDstore to cross-check` : 'Not recorded' },
    { name: 'Link', value: trunc(o.link, 500) },
    { name: 'Quantity', value: runs > 1 ? `${o.quantity} × ${runs} runs = ${o.quantity * runs} total` : `${o.quantity}` },
    { name: 'Money', value: `Paid ${inr(o.charge)} · Provider cost ${inr(o.provider_cost)}${o.refund_amount > 0 ? ` · Refund ${inr(o.refund_amount)}` : ''}` },
    { name: 'Placed', value: `${istShort(o.created_at)} · updated ${istShort(o.updated_at)}` },
  ];
  const inputs = extrasField(o.extras);
  if (inputs) fields.push(inputs);
  const txs = await db.prepare(
    `SELECT type, amount, balance_after, created_at FROM wallet_transactions
     WHERE ref_type = 'order' AND ref_id = ? ORDER BY created_at ASC LIMIT 10`,
  ).bind(o.id).all();
  const txList = (txs.results ?? []) as unknown as Array<{ type: string; amount: number; balance_after: number; created_at: string }>;
  if (txList.length) {
    fields.push({
      name: 'Wallet',
      value: txList.map((t) => `${t.type} ${inr(t.amount)} → balance ${inr(t.balance_after)} · ${istShort(t.created_at)}`).join('\n'),
    });
  }
  try {
    const totalRow = await db.prepare(`SELECT COUNT(*) AS n FROM refill_requests WHERE order_id = ?`).bind(o.id).first<{ n: number }>();
    const total = Number(totalRow?.n ?? 0);
    if (total > 0) {
      const rr = await db.prepare(
        `SELECT id, provider_refill_id, status, created_at FROM refill_requests WHERE order_id = ? ORDER BY created_at DESC LIMIT 5`,
      ).bind(o.id).all();
      const rlist = (rr.results ?? []) as unknown as Array<{ id: string; provider_refill_id: string | null; status: string; created_at: string }>;
      fields.push({
        name: `Refills (${total})`,
        value: rlist.map((r) => `${refillStatusEmoji(r.status)} ${r.id}${r.provider_refill_id ? ` (provider ${r.provider_refill_id})` : ''} · ${r.status} · ${istShort(r.created_at)}`).join('\n'),
      });
    }
  } catch { /* pre-migration: no refill table */ }
  return {
    embeds: [{
      title: `🔍 ${formatOrderRef(o.id, o.order_number)}`,
      description: `Internal ID: ${o.id}`,
      fields,
      color: inspectColor(o.status),
    }],
    components: [],
  };
}

function refillEmbed(r: InspectRefillRow) {
  return {
    embeds: [{
      title: `🔍 Refill ${r.id}`,
      fields: [
        { name: 'Order', value: `${formatOrderRef(r.order_id, r.order_number)} · ${r.service_name}` },
        { name: 'Customer', value: r.email },
        { name: 'Order status', value: `${orderStatusEmoji(r.order_status)} ${r.order_status} · paid ${inr(r.order_charge)}` },
        { name: 'Provider order ID (CID)', value: r.provider_order_id ? `${r.provider_order_id} · paste this ID into CIDstore to cross-check` : 'Not recorded' },
        { name: 'Refill status', value: `${refillStatusEmoji(r.status)} ${r.status}` },
        { name: 'Provider refill ID', value: r.provider_refill_id ?? 'Not returned yet' },
        { name: 'Requested', value: istShort(r.created_at) },
      ],
      color: 0x7c5cff,
    }],
    components: [],
  };
}

async function findRefill(db: D1Database, by: 'id' | 'provider', value: string): Promise<InspectRefillRow | null> {
  try {
    const col = by === 'id' ? 'r.id' : 'r.provider_refill_id';
    return await db.prepare(
      `SELECT r.id, r.provider_refill_id, r.order_id, o.order_number, o.service_name, o.provider_order_id,
       o.charge AS order_charge, o.status AS order_status, u.email AS email, r.status, r.created_at
       FROM refill_requests r JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.user_id
       WHERE ${col} = ?`,
    ).bind(value).first<InspectRefillRow>();
  } catch {
    // Pre-migration: no refill table — no match, not a crash.
    return null;
  }
}

export async function buildInspectMessage(db: D1Database, input: string) {
  const q = input.trim();
  if (!q) {
    return {
      embeds: [{ title: '🔍 Inspect', description: 'Give an ID: an ord_… ID, an AMP number (AMP-1003), a CID provider order ID, or a ref_… ID.', color: 0x7c5cff }],
      components: [],
    };
  }
  const notFound = {
    embeds: [{ title: '🔍 Not found', description: `No order or refill matches "${trunc(q, 100)}". Try an ord_… ID, an AMP number (AMP-1003), a CID provider order ID, or a ref_… ID.`, color: 0x7c5cff }],
    components: [],
  };
  if (q.startsWith('ref_')) {
    const r = await findRefill(db, 'id', q);
    return r ? refillEmbed(r) : notFound;
  }
  const order = await findOrder(db, q);
  if (order) return orderEmbed(db, order);
  const refill = await findRefill(db, 'provider', q);
  return refill ? refillEmbed(refill) : notFound;
}

// ---------- Stats: the admin dashboard as one glanceable embed ----------
// Same aggregates as /api/admin/stats (delivered-share cost, both Cancelled
// spellings), plus the live CID balance. Balance failures degrade to "—"
// instead of failing the command: a CID blip must not hide the dashboard.

export async function buildStatsMessage(db: D1Database, env: Env) {
  const users = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const services = await db.prepare('SELECT COUNT(*) AS n FROM services WHERE is_active = 1 AND provider_active = 1').first<{ n: number }>();
  const orders = await db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(charge), 0) AS revenue,
     COALESCE(SUM(COALESCE(provider_cost * (charge - refund_amount) / NULLIF(charge, 0), provider_cost)), 0) AS cost,
     COALESCE(SUM(refund_amount), 0) AS refunds,
     COALESCE(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0) AS successful,
     COALESCE(SUM(CASE WHEN status IN ('Canceled', 'Cancelled') THEN 1 ELSE 0 END), 0) AS failed,
     COALESCE(SUM(CASE WHEN status = 'Partial' THEN 1 ELSE 0 END), 0) AS partial
     FROM orders`,
  ).first<{ n: number; revenue: number; cost: number; refunds: number; successful: number; failed: number; partial: number }>();
  const pendingTopups = await db.prepare("SELECT COUNT(*) AS n FROM payment_requests WHERE status = 'pending'").first<{ n: number }>();
  let providerBalance: number | null = null;
  const client = cidClientFromEnv(env);
  if (client) {
    try { providerBalance = (await client.balance()).balance; } catch { providerBalance = null; }
  }
  const total = Number(orders?.n ?? 0);
  const successful = Number(orders?.successful ?? 0);
  const failed = Number(orders?.failed ?? 0);
  const partial = Number(orders?.partial ?? 0);
  const open = total - successful - failed - partial;
  const revenue = Number(orders?.revenue ?? 0);
  const cost = Number(orders?.cost ?? 0);
  const refunds = Number(orders?.refunds ?? 0);
  return {
    embeds: [{
      title: '📊 Panel stats',
      fields: [
        { name: 'Users', value: `${Number(users?.n ?? 0)}` },
        { name: 'Active services', value: `${Number(services?.n ?? 0)}` },
        { name: 'Orders', value: `${total} total · ${successful} completed · ${failed} canceled · ${partial} partial · ${open} open` },
        { name: 'Revenue', value: inr(revenue) },
        { name: 'Provider cost (delivered)', value: inr(cost) },
        { name: 'Refunds', value: inr(refunds) },
        { name: 'Gross margin', value: inr(revenue - cost - refunds) },
        { name: 'CID balance', value: providerBalance === null ? '—' : inr(providerBalance) },
        { name: 'Pending top-ups', value: `${Number(pendingTopups?.n ?? 0)}` },
      ],
      color: 0x7c5cff,
    }],
    components: [],
  };
}

// ---------- User dossier: everything about one customer ----------
// Exact email (case-insensitive); /users finds the address when unsure.

export async function buildUserDossier(db: D1Database, email: string) {
  const q = email.trim();
  const user = await db.prepare('SELECT id, email, role, created_at FROM users WHERE LOWER(email) = LOWER(?)').bind(q).first<{ id: string; email: string; role: string; created_at: string }>();
  if (!user) {
    return {
      embeds: [{ title: '👤 User not found', description: `No user with email ${q}. Find the exact email with /users first.`, color: 0x7c5cff }],
      components: [],
    };
  }
  const balanceRow = await db.prepare('SELECT COALESCE(SUM(amount), 0) AS balance FROM wallet_transactions WHERE user_id = ?').bind(user.id).first<{ balance: number }>();
  const orderAgg = await db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(charge), 0) AS spent, COALESCE(SUM(refund_amount), 0) AS refunds,
     COALESCE(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0) AS completed,
     COALESCE(SUM(CASE WHEN status IN ('Canceled', 'Cancelled') THEN 1 ELSE 0 END), 0) AS failed
     FROM orders WHERE user_id = ?`,
  ).bind(user.id).first<{ n: number; spent: number; refunds: number; completed: number; failed: number }>();
  const recentOrders = await db.prepare(
    `SELECT id, order_number, service_name, quantity, charge, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
  ).bind(user.id).all();
  const orderLines = (recentOrders.results ?? []) as unknown as Array<{ id: string; order_number: number | null; service_name: string; quantity: number; charge: number; status: string; created_at: string }>;
  const topupAgg = await db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) AS approved_total,
     COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending
     FROM payment_requests WHERE user_id = ?`,
  ).bind(user.id).first<{ n: number; approved_total: number; pending: number }>();
  const recentTopups = await db.prepare(
    `SELECT amount, status, txn_ref, created_at FROM payment_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 3`,
  ).bind(user.id).all();
  const topupLines = (recentTopups.results ?? []) as unknown as Array<{ amount: number; status: string; txn_ref: string; created_at: string }>;
  let refillCount = 0;
  try {
    const r = await db.prepare('SELECT COUNT(*) AS n FROM refill_requests WHERE user_id = ?').bind(user.id).first<{ n: number }>();
    refillCount = Number(r?.n ?? 0);
  } catch { /* pre-migration: no refill table */ }
  const spent = Number(orderAgg?.spent ?? 0);
  const refunds = Number(orderAgg?.refunds ?? 0);
  const fields: Array<{ name: string; value: string }> = [
    { name: 'Balance', value: inr(Number(balanceRow?.balance ?? 0)) },
    { name: 'Role', value: user.role },
    { name: 'Orders', value: `${Number(orderAgg?.n ?? 0)} total · ${Number(orderAgg?.completed ?? 0)} completed · ${Number(orderAgg?.failed ?? 0)} canceled · spent net ${inr(spent - refunds)} (paid ${inr(spent)}, refunded ${inr(refunds)})` },
    { name: 'Top-ups', value: `${Number(topupAgg?.n ?? 0)} total · ${inr(Number(topupAgg?.approved_total ?? 0))} approved · ${Number(topupAgg?.pending ?? 0)} pending` },
    { name: 'Refills', value: `${refillCount} total` },
    { name: 'Joined', value: istShort(user.created_at) },
  ];
  if (orderLines.length) {
    fields.push({
      name: 'Recent orders',
      value: orderLines.map((o) => `${orderStatusEmoji(o.status)} ${formatOrderRef(o.id, o.order_number)} · ${o.service_name} × ${o.quantity} · ${inr(o.charge)} · ${o.status} · ${istShort(o.created_at)}`).join('\n'),
    });
  }
  if (topupLines.length) {
    fields.push({
      name: 'Recent top-ups',
      value: topupLines.map((t) => `${inr(t.amount)} · ${t.status} · UTR ${t.txn_ref} · ${istShort(t.created_at)}`).join('\n'),
    });
  }
  return {
    embeds: [{ title: `👤 ${user.email}`, fields, color: 0x7c5cff }],
    components: [],
  };
}

/** Paged user list with balances (one aggregate query, no per-user N+1). */
export async function buildUsersMessage(db: D1Database, query: string, page: number) {
  const like = `%${query.trim()}%`;
  const totalRow = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE email LIKE ?').bind(like).first<{ n: number }>();
  const total = Number(totalRow?.n ?? 0);
  const maxPage = Math.max(0, Math.ceil(total / USERS_PAGE_SIZE) - 1);
  const safePage = Math.min(Math.max(0, page), maxPage);
  const rows = await db.prepare(
    `SELECT u.id, u.email, u.role, u.created_at, COALESCE(SUM(t.amount), 0) AS balance
     FROM users u LEFT JOIN wallet_transactions t ON t.user_id = u.id
     WHERE u.email LIKE ? GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(like, USERS_PAGE_SIZE, safePage * USERS_PAGE_SIZE).all();
  const list = (rows.results ?? []) as unknown as UserRow[];
  if (!list.length) {
    return {
      embeds: [{ title: '👥 Users', description: query ? `No users matching "${query}".` : 'No users yet.', color: 0x7c5cff }],
      components: [],
    };
  }
  const buttons = [];
  const q = query.slice(0, 40);
  if (safePage > 0) buttons.push({ type: 2, style: 2, label: '← Prev', custom_id: `users:${safePage - 1}:${q}` });
  if (safePage < maxPage) buttons.push({ type: 2, style: 1, label: 'Next →', custom_id: `users:${safePage + 1}:${q}` });
  return {
    embeds: [{
      title: '👥 Users',
      description: `Showing ${safePage * USERS_PAGE_SIZE + 1}–${safePage * USERS_PAGE_SIZE + list.length} of ${total}${query ? ` matching "${query}"` : ''}.`,
      fields: list.map((u) => ({
        name: u.email,
        value: `Balance ${inr(u.balance)} · ${u.role} · since ${String(u.created_at).slice(0, 10)}`,
        inline: false,
      })),
      color: 0x7c5cff,
    }],
    components: buttons.length ? [{ type: 1, components: buttons }] : [],
  };
}

// ---------- Catalogue: search the live service list from Discord ----------
// Owner-only and read-only, like every other command here (the dispatcher
// gates on ADMIN_DISCORD_USER_ID before any command runs). Same name rule
// as the store (display_name override, else cleanName) and same active
// filter, so Discord answers match what customers see in the store. Search
// matches name, category, and platform, cheapest first; no pagination in
// v1 — the count line says how many matched, so a narrower query pages it.

const CATALOG_PAGE_SIZE = 10;

interface CatalogServiceRow {
  provider_name: string;
  display_name: string | null;
  category: string;
  platform: string;
  retail_rate: number;
  min: number;
  max: number;
  refill: number;
}

export async function buildCatalogMessage(db: D1Database, query: string) {
  const q = query.trim();
  const active = 'is_active = 1 AND provider_active = 1 AND retail_rate > 0 AND max > 0';
  if (!q) {
    const rows = await db.prepare(
      `SELECT platform, COUNT(*) AS n FROM services WHERE ${active} GROUP BY platform ORDER BY n DESC`,
    ).all();
    const list = (rows.results ?? []) as Array<{ platform: string; n: number }>;
    if (!list.length) {
      return {
        embeds: [{ title: '🛍️ Catalogue', description: 'No active services right now.', color: 0x7c5cff }],
        components: [],
      };
    }
    return {
      embeds: [{
        title: '🛍️ Catalogue',
        description: 'Search with /catalog <text> — matches name, category, and platform.',
        fields: list.map((p) => ({ name: p.platform, value: `${Number(p.n)} services`, inline: true })),
        color: 0x7c5cff,
      }],
      components: [],
    };
  }
  const like = `%${q}%`;
  const where = `${active} AND (provider_name LIKE ? OR display_name LIKE ? OR category LIKE ? OR platform LIKE ?)`;
  const totalRow = await db.prepare(`SELECT COUNT(*) AS n FROM services WHERE ${where}`).bind(like, like, like, like).first<{ n: number }>();
  const total = Number(totalRow?.n ?? 0);
  if (!total) {
    return {
      embeds: [{ title: '🛍️ Catalogue', description: `No services matching "${trunc(q, 100)}".`, color: 0x7c5cff }],
      components: [],
    };
  }
  const rows = await db.prepare(
    `SELECT provider_name, display_name, category, platform, retail_rate, min, max, refill
     FROM services WHERE ${where} ORDER BY retail_rate ASC LIMIT ?`,
  ).bind(like, like, like, like, CATALOG_PAGE_SIZE).all();
  const list = (rows.results ?? []) as unknown as CatalogServiceRow[];
  return {
    embeds: [{
      title: '🛍️ Catalogue',
      description: `Showing ${list.length} of ${total} matching "${trunc(q, 100)}" — cheapest first.`,
      fields: list.map((s) => ({
        name: trunc(s.display_name?.trim() || cleanName(s.provider_name), 100),
        value: `${inr(s.retail_rate)} /1K · min ${s.min} – max ${s.max}${s.refill === 1 ? ' · refill' : ''} · ${s.platform} · ${s.category}`,
        inline: false,
      })),
      color: 0x7c5cff,
    }],
    components: [],
  };
}
