/**
 * Razorpay helpers: Orders API + webhook signature verification.
 * Keys live only as Cloudflare dashboard Secrets (RAZORPAY_KEY_ID,
 * RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET) — never in git.
 * The Key ID is publishable by design (it ships to the browser checkout),
 * but keeping it a Secret means swapping test <-> live needs no redeploy.
 */

export function razorpayConfigured(env: { RAZORPAY_KEY_ID?: string; RAZORPAY_KEY_SECRET?: string }): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
}

/** Create a Razorpay order for a wallet top-up. Amount is in rupees. */
export async function createRazorpayOrder(
  env: { RAZORPAY_KEY_ID?: string; RAZORPAY_KEY_SECRET?: string },
  receipt: string,
  amountRupees: number,
): Promise<RazorpayOrderResponse> {
  const credentials = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(amountRupees * 100), // paise
      currency: 'INR',
      receipt,
      notes: { purpose: 'ampliva-wallet-topup' },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Razorpay order failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return response.json<RazorpayOrderResponse>();
}

/** Verify an x-razorpay-signature header against the raw request body. */
export async function verifyRazorpaySignature(
  webhookSecret: string,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
