import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { listDbServices, normalizeServiceType, normalizeServices, previewServices, retailFor, rowToPublic, syncCatalogToDb } from './catalog';
import { cidClientFromEnv } from './providers/cid';
import { createSession, destroySession, hashPassword, isResponse, newId, requireAdmin, requireAuth, verifyPassword } from './auth';
import { appendLedger, getBalance } from './wallet';
import { notifyDiscord } from './notify';
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
  c.executionCtx.waitUntil(
    notifyDiscord(
      c.env,
      '💰 New top-up request',
      `₹${round2(amount).toFixed(2)} from ${user.email}\nUTR: \`${txnRef}\`\nVerify the UTR in your bank app, then approve: https://ampliva-store.pages.dev → Admin → Top-up requests`,
    ),
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
  await db
    .prepare(
      `INSERT INTO orders (id, user_id, service_id, service_name, provider_order_id, link, quantity, charge, provider_cost, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`,
    )
    .bind(orderId, user.id, service.id, publicService.name, providerOrderId, link, quantity, charge, providerCost, now, now)
    .run();
  const newBalance = await appendLedger(db, {
    userId: user.id,
    type: 'order_debit',
    amount: -charge,
    refType: 'order',
    refId: orderId,
    note: `${publicService.name} × ${quantity}`,
  });

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

app.post('/api/admin/topups/:id/approve', async (c) => {
  const admin = await requireAdmin(c);
  if (isResponse(admin)) return admin;
  const db = c.env.DB!;
  const topup = await db.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(c.req.param('id')).first<{ id: string; user_id: string; amount: number; status: string }>();
  if (!topup) return c.json({ error: 'Top-up request not found' }, 404);
  if (topup.status !== 'pending') return c.json({ error: `Already ${topup.status}` }, 409);
  await db.prepare('UPDATE payment_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
    .bind('approved', new Date().toISOString(), admin.id, topup.id).run();
  const balance = await appendLedger(db, {
    userId: topup.user_id, type: 'topup', amount: topup.amount,
    refType: 'payment_request', refId: topup.id, note: 'UPI top-up approved',
  });
  return c.json({ ok: true, userBalance: balance });
});

app.post('/api/admin/topups/:id/reject', async (c) => {
  const admin = await requireAdmin(c);
  if (isResponse(admin)) return admin;
  const db = c.env.DB!;
  const topup = await db.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(c.req.param('id')).first<{ id: string; status: string }>();
  if (!topup) return c.json({ error: 'Top-up request not found' }, 404);
  if (topup.status !== 'pending') return c.json({ error: `Already ${topup.status}` }, 409);
  await db.prepare('UPDATE payment_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
    .bind('rejected', new Date().toISOString(), admin.id, topup.id).run();
  return c.json({ ok: true });
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
