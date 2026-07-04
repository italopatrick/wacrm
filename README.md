# ulabchat — Frontend

> WhatsApp CRM — shared inbox, contacts, sales pipelines, broadcasts,
> no-code automations, and an AI reply assistant.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)

This repository is the **Next.js frontend**. The application is split
across two repos:

| Repo | Stack | Role |
|------|-------|------|
| [ulabchat-frontend](https://github.com/ulabapps/ulabchat-frontend) (this repo) | Next.js 16, React 19, TypeScript, Tailwind v4 | UI, auth session, Supabase reads |
| [ulabchat-backend](https://github.com/ulabapps/ulabchat-backend) | Go (chi), pgx, sqlc | REST API, WhatsApp/Meta integration, automations, webhooks |

Both talk to the same **Supabase** project (Postgres + Auth + Storage).
The browser reads directly from Supabase for auth and simple queries;
all privileged operations go through the Go backend, which the frontend
reaches under `/api/*` (rewritten to the backend in `next.config.ts`).

## Features

- **Shared inbox** on the official WhatsApp Business API — multiple
  agents on one number, per-conversation assignment, status, and notes.
- **Contacts** with tags and custom fields, CSV import, deduplication.
- **Sales pipelines** (Kanban) with deals linked to conversations.
- **Broadcasts** with Meta-approved templates, delivery/read tracking,
  per-recipient variable substitution.
- **No-code automations** — triggers on inbound messages, new contacts,
  keywords, or schedule; conditional branches, waits, tags, webhooks.
- **AI reply assistant** — bring your own OpenAI/Anthropic key (stored
  encrypted). One-click drafted replies, optional auto-reply bot with a
  per-conversation cap, and a knowledge base with hybrid retrieval
  (Postgres full-text or pgvector semantic search).
- **Real-time dashboard** — response times, daily volume, pipeline
  value, activity feed.
- **Team accounts** — invite by link, role-based access
  (owner / admin / agent / viewer), ownership transfer. Every install is
  account-scoped.
- **Public REST API** (`/api/v1`) with scoped, revocable API keys — see
  [docs/public-api.md](./docs/public-api.md).

## Local development

The full stack (frontend + backend + Supabase) runs locally with the
Supabase CLI and PM2. The PM2 config and env live one level up, in the
parent directory that holds both repos.

### Prerequisites

- Node.js 20+
- Go 1.25+
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [PM2](https://pm2.keymetrics.io/) (`npm i -g pm2`)

### 1. Clone both repos side by side

```bash
mkdir ulab && cd ulab
git clone https://github.com/ulabapps/ulabchat-frontend.git ulabchat
git clone https://github.com/ulabapps/ulabchat-backend.git  ulabchat-backend
```

### 2. Start Supabase and apply migrations

```bash
cd ulabchat-backend
supabase start                 # boots Postgres (54322) + API/Auth (54321)
supabase db reset              # applies migrations in supabase/migrations/
supabase status --output json  # copy the anon/service_role JWT keys
```

> Local Supabase issues **ES256** session tokens (verified via JWKS).
> Leave `SUPABASE_JWT_SECRET` unset locally — it is only for Supabase
> Cloud's HS256 tokens.

### 3. Configure env

Create `.env` in the **parent** directory (next to `pm2.config.cjs`)
with the local Supabase URLs/keys, `ENCRYPTION_KEY`, `META_APP_*`, and
`AUTOMATION_CRON_SECRET`. See [`.env.local.example`](./.env.local.example)
for the frontend-facing variables.

### 4. Run both services

```bash
cd ..                          # parent dir with pm2.config.cjs
npm --prefix ulabchat install
pm2 start pm2.config.cjs       # runs `ulabchat` (Next :3009) + `ulabchat-backend` (Go :3001)
pm2 logs                       # tail both
```

Open <http://localhost:3009>. The frontend proxies `/api/*` to the Go
backend on `:3001`.

## Frontend-only workflow

To iterate on the UI against an already-running backend:

```bash
npm install
npm run dev        # Next.js dev server
npm run build      # production build
npx tsc --noEmit   # typecheck
```

`NEXT_PUBLIC_API_URL` controls how API calls are routed: leave it unset
to keep the `/api` prefix (proxy mode, via `next.config.ts` rewrites or
nginx); set it to the backend origin for direct mode.

## Stack

- **Frontend** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Backend** — Go (chi) — see [ulabchat-backend](https://github.com/ulabapps/ulabchat-backend).
- **Data** — Supabase (Postgres + Auth + Storage + RLS).
- **WhatsApp** — Meta Cloud API (official WhatsApp Business API).

## Credits

ulabchat is based on the open-source
[ArnasDon/wacrm](https://github.com/ArnasDon/wacrm) template
([wacrm.tech](https://wacrm.tech)), MIT-licensed.

## License

[MIT](./LICENSE).
