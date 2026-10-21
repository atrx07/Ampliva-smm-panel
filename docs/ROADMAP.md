# Ampliva roadmap

## Done
- **M1** — Storefront + read-only CID catalogue, preview fallback, 35% default markup.
- **M2** — D1 catalogue snapshots: sync (admin button + daily cron), admin curation
  (display name, per-service markup, visibility), vanished services flagged not deleted.
- **M3** — Accounts (PBKDF2, hashed session tokens), append-only wallet ledger,
  manual UPI top-ups with admin approval, ordering (provider-first, debit only on
  provider acceptance), status refresh, auto-refund for the undelivered portion on
  provider cancellation, refill/cancel, admin stats/orders.

## Deploy checklist (one-time, needs the owner's Cloudflare account)
1. ~~`npx wrangler d1 create ampliva-db`~~ DONE 2026-10-21 in the dashboard; real `database_id` is in `backend/wrangler.toml`, schema applied via D1 console (`migrations/0001_console_paste.sql` — comment-free variant for console pasting).
2. `npx wrangler d1 migrations apply ampliva-db --remote`.
3. Set `[vars]`: `ADMIN_EMAIL`, `PUBLIC_UPI_ID`.
4. `npx wrangler secret put CID_API_KEY` (owner's CID Growth Media key).
5. Deploy Worker (`npm run deploy` in `backend/`), deploy Pages (`frontend/`,
   build `npm run build`, output `dist`, env `VITE_API_URL` = Worker URL).
6. Register the owner's account first (becomes admin), then **Admin → Sync catalogue**.

## Next (post-launch, in order)
1. Razorpay/UPI gateway top-ups to replace manual approval once volume justifies KYC + fees.
2. Order status auto-polling cron (refresh stale Pending/In progress orders every ~15 min).
3. Email notifications (order placed/completed, top-up approved) via a free-tier sender.
4. Reseller API (standard SMM v2 surface) so other panels can resell Ampliva.
5. Tighten CORS to the Pages origin; add rate limiting on auth routes.
