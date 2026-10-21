# Ampliva

**Amplify your reach.**

Ampliva is a website-first promotional-services storefront with a provider-agnostic backend. The public catalogue, customer accounts, wallet, ordering and admin panel are built (Milestones 1-3): a Cloudflare Worker API fronts a server-side CID Growth Media adapter, and provider credentials never reach the browser.

## Stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** Cloudflare Worker + Hono + TypeScript
- **Provider:** CID Growth Media through a private server-side adapter
- **Hosting target:** Cloudflare Pages + Workers free tiers
- **Database:** Cloudflare D1 (catalogue snapshots, users, sessions, wallet ledger, top-up requests, orders)

## Repository layout

```text
Ampliva-smm-panel/
├── frontend/             # Public storefront
├── backend/              # Cloudflare Worker API + provider adapters
├── .github/workflows/    # Build/typecheck CI
└── package.json          # npm workspace root
```

## Milestones 1-3 (built)

- Responsive Ampliva storefront with searchable/filterable service catalogue
- `/api/health`, `/api/config`, `/api/services` Worker endpoints
- CID `services` integration with server-side markup (35% default, per-service override)
- Safe preview catalogue when no CID key is configured
- **M2:** D1-backed catalogue - admin-triggered + daily scheduled sync, snapshots keep
  curated display names/markups, services that vanish upstream are flagged, not deleted
- **M3:** customer accounts (PBKDF2 + hashed session tokens), append-only wallet ledger,
  manual UPI top-ups (customer submits UTR, admin approves, wallet credited),
  ordering (balance checked, provider order placed *before* any debit, so a provider
  rejection never charges the customer), status refresh with automatic refund of the
  undelivered portion on provider cancellation, refill/cancel actions
- Admin panel: stats (revenue, provider cost, gross margin, CID balance), catalogue sync,
  service curation (rename, markup, visibility), top-up approvals, all orders

## Payments note

V1 uses manual UPI top-ups on purpose: no gateway KYC/fees before first revenue.
A gateway (e.g. Razorpay) can replace the manual approval step later without
touching the wallet ledger or ordering flow.

## Local development

Requires Node.js 22+.

```bash
npm install
```

Copy the backend secret template and add your CID API key locally:

```bash
cp backend/.dev.vars.example backend/.dev.vars
```

Run the Worker in terminal 1:

```bash
npm run dev:api
```

Run the storefront in terminal 2:

```bash
npm run dev
```

The defaults are:

- Frontend: `http://localhost:5173`
- Worker API: `http://localhost:8787`

If the API lives elsewhere, copy `frontend/.env.example` to `frontend/.env.local` and change `VITE_API_URL`.

## Cloudflare hookup

### Frontend — Cloudflare Pages

Use `frontend` as the project root.

- Build command: `npm run build`
- Build output directory: `dist`
- Node version: `22`

Set `VITE_API_URL` to the deployed Worker URL once the backend exists.

### Backend - database (one-time)

```bash
cd backend
npx wrangler d1 create ampliva-db        # copy the printed database_id into wrangler.toml
npx wrangler d1 migrations apply ampliva-db --remote
```

Then set the `[vars]` in `wrangler.toml`: `ADMIN_EMAIL` (your email - that account
gets admin rights; the first account registered on a fresh database also becomes
admin) and `PUBLIC_UPI_ID` (the UPI ID customers send top-ups to; leave empty to
keep manual top-ups disabled). Deploy the Worker, then log in as admin and hit
**Sync catalogue from CID** once to populate the store.

### Backend — Cloudflare Worker

Use `backend` as the Worker root and deploy with:

```bash
npm install
npm run deploy
```

Add `CID_API_KEY` as a **Cloudflare secret**, never as a public frontend variable and never in Git:

```bash
npx wrangler secret put CID_API_KEY
```

The Worker already contains non-secret defaults for the CID endpoint, INR display currency and a 35% initial catalogue markup. Those are configuration values, not final business pricing rules.

## Security rule

The browser never communicates with CID directly. Provider credentials, provider requests and future order creation stay behind Ampliva's Worker API.

## Next milestone

Milestone 2 will add D1-backed service mapping/snapshots so the customer catalogue no longer depends on raw upstream naming and we can safely track rate changes before checkout exists.
