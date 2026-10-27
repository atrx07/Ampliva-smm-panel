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

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Fresh-order alert, fired via waitUntil right after the order is recorded
 * (provider already accepted, customer already debited). `extras` are the
 * type-specific inputs from the order request — comments/usernames/groups
 * are long lists, so each block is capped to keep the embed readable.
 */
export async function notifyOrderPlaced(
  env: Env,
  order: {
    email: string; serviceName: string; orderId: string; providerOrderId: string;
    link: string; quantity: number; charge: number; balanceAfter: number;
    extras: Record<string, string>;
  },
): Promise<void> {
  const lines = [
    `**${order.email}**`,
    `Service: ${order.serviceName}`,
    `Order ID: \`${order.orderId}\``,
    `Provider order: \`${order.providerOrderId}\``,
    `Count: ${order.quantity}`,
    `Charge: ₹${order.charge.toFixed(2)}`,
    `Balance after: ₹${order.balanceAfter.toFixed(2)}`,
    `Link: ${truncate(order.link, 200)}`,
  ];
  const extraLabels: Record<string, string> = {
    comments: 'Comments', usernames: 'Usernames', hashtag: 'Hashtag',
    username: 'Donor username', answer_number: 'Poll answer',
    groups: 'Groups', keywords: 'Keywords',
  };
  for (const [key, label] of Object.entries(extraLabels)) {
    const value = order.extras[key];
    if (value) lines.push(`${label}: ${truncate(value, 500)}`);
  }
  if (order.extras.runs) {
    lines.push(`Dripfeed: ${order.extras.runs} runs${order.extras.interval ? ` every ${order.extras.interval} min` : ''}`);
  }
  await notifyDiscord(env, '🛒 New order', lines.join('\n'));
}

/** Refill alert, fired only once the provider accepts the refill. */
export async function notifyRefillSubmitted(
  env: Env,
  refill: {
    email: string; serviceName: string; orderId: string; providerOrderId: string;
    refillId: string; refillRowId: string; link: string; quantity: number;
  },
): Promise<void> {
  await notifyDiscord(env, '🔁 Refill submitted', [
    `**${refill.email}**`,
    `Service: ${refill.serviceName}`,
    `Order ID: \`${refill.orderId}\``,
    `Refill ID: \`${refill.refillId || '—'}\``,
    `Refill record: \`${refill.refillRowId}\``,
    `Provider order: \`${refill.providerOrderId}\``,
    `Count: ${refill.quantity}`,
    `Link: ${truncate(refill.link, 200)}`,
  ].join('\n'));
}
