# Ampliva

**Amplify your reach.**

Ampliva is a website-first promotional-services storefront with a provider-agnostic backend. Milestone 1 connects a polished public catalogue to a server-side CID Growth Media adapter without exposing provider credentials to the browser.

## Stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** Cloudflare Worker + Hono + TypeScript
- **Provider:** CID Growth Media through a private server-side adapter
- **Hosting target:** Cloudflare Pages + Workers free tiers
- **Database:** Cloudflare D1 planned for Milestone 2

## Repository layout

```text
Ampliva-smm-panel/
├── frontend/             # Public storefront
├── backend/              # Cloudflare Worker API + provider adapters
├── .github/workflows/    # Build/typecheck CI
└── package.json          # npm workspace root
```

## Milestone 1

- Responsive Ampliva storefront shell
- Searchable/filterable service catalogue
- `/api/health` Worker endpoint
- `/api/services` Worker endpoint
- Read-only CID `services` integration
- Server-side default markup calculation
- Safe preview catalogue when no CID key is configured
- No purchasing, payments, wallets or customer auth yet

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
