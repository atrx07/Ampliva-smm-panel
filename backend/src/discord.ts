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
