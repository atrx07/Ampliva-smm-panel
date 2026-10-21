import type { Env } from './types';

/**
 * Best-effort owner notification via a Discord webhook (ADMIN_DISCORD_WEBHOOK
 * secret). Deliberately swallows every failure: a notification must never
 * break the request that triggered it, and a missing webhook is a no-op so
 * the manual top-up flow works identically without it.
 */
export async function notifyDiscord(env: Env, title: string, description: string): Promise<void> {
  const url = env.ADMIN_DISCORD_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Ampliva',
        embeds: [{ title, description, color: 0x7c5cff, timestamp: new Date().toISOString() }],
      }),
    });
  } catch {
    // Intentionally silent — see docblock.
  }
}
