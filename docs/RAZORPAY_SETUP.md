# Razorpay setup for Ampliva (owner checklist)

The code is already live-ready: instant top-ups switch on the moment the
three secrets below exist on the Worker. Nothing is in git, nothing needs
a redeploy when secrets change (only the D1 migration needs a console paste).

## 1. Create the account

1. razorpay.com → Sign Up. As an individual, KYC needs: PAN, bank account
   details (cancelled cheque or statement), and an address proof.
2. Website field: `https://ampliva-store.pages.dev`.
3. Stay in **Test Mode** until step 4 passes — test keys work before KYC
   approval, live keys only after.

## 2. D1 migration (one paste)

Cloudflare dashboard → D1 → `ampliva-db` → Console → paste the whole
contents of `backend/migrations/0002_console_paste.sql` and run it. This
creates `gateway_orders` (order tracking; the webhook credits exactly once
via an atomic `created → paid` flip).

## 3. Secrets (Worker `ampliva-smm-panel` → Settings → Secrets)

| Secret | Where to find it |
| --- | --- |
| `RAZORPAY_KEY_ID` | Razorpay dashboard → Settings → API Keys (starts `rzp_test_` in test mode, `rzp_live_` in live mode) |
| `RAZORPAY_KEY_SECRET` | Same page, next to the Key ID (never share it, never screenshot it) |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay dashboard → Settings → Webhooks → Add New Webhook (step 4) |

## 4. Webhook (the part that actually credits wallets)

Razorpay dashboard → Settings → Webhooks → Add New Webhook:

- **Webhook URL:** `https://ampliva-smm-panel.arppithandrewsee.workers.dev/api/payments/razorpay/webhook`
- **Active events:** only `payment.captured` (nothing else credits)
- Copy the generated webhook secret into `RAZORPAY_WEBHOOK_SECRET`.

The webhook verifies every event with HMAC-SHA256 before crediting, checks
the amount matches the order to the paise, and ignores duplicates — a
forged or replayed event cannot credit a wallet.

## 5. Test end-to-end (test mode)

1. Log in to the store as a regular customer account.
2. Enter an amount, tap **Pay instantly**, and pay with a Razorpay test
   card (e.g. `4111 1111 1111 1111`) or test UPI.
3. Wallet should credit within seconds, the top-up shows as `approved`
   in the dashboard, and Discord gets an "Instant top-up credited" ping.

## 6. Go live

After Razorpay approves KYC: Settings → API Keys → switch to **Live Mode**,
replace the three secrets with the live values, and do one small real
payment yourself. Manual UPI top-ups keep working throughout as fallback.

## Costs (standard plan, verified 2026-10-24)

No setup fee, no annual charge, no minimums. Domestic payments (UPI,
cards, netbanking, wallets): 2% + 18% GST on the fee = 2.36% effective
(₹100 top-up → ₹97.64 settles, typically T+2 business days). Failed
payments cost nothing. New merchants may qualify for a 90-day 0%
platform-fee welcome offer — check the terms at signup.
