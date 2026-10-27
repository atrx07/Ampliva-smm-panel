import type { Env } from './types';
import { notifyDiscord } from './notify';

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

// ---------- Admin slash commands (v1: /pending, /users, /adjust) ----------
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
