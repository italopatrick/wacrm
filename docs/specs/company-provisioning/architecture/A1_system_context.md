# A1 — System Context & Topology

**Feature:** `super_owner` → Company Provisioning
**SPARC phase:** Architecture
**Supersedes:** the layering assumption in spec Phase 03/04 (see §4).

---

## 1. The real topology (grounded in the repo)

This is a **two-repo + Supabase** system (README.md §Architecture,
`src/lib/api/client.ts`, `next.config.ts` `rewrites()`):

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js 16 UI\n(this repo: ulabchat-frontend)]
  end
  subgraph Edge
    NGINX[nginx / Next rewrite\n/api/* -> :3001]
  end
  subgraph Backend
    GO[ulabchat-backend\nGo chi + pgx + sqlc]
  end
  DB[(Supabase\nPostgres + Auth + Storage)]

  UI -- "reads (auth session, simple selects)\nRLS-scoped anon client" --> DB
  UI -- "apiFetch('/api/*') + Bearer JWT" --> NGINX --> GO
  GO -- "pgx (service-role DB conn)\n+ GoTrue Admin API" --> DB
```

Key facts that drive every decision below:

- **F-1** The browser reads Supabase **directly** with the user's session
  (RLS-enforced). `apiFetch` (`src/lib/api/client.ts`) only carries
  **privileged** operations to Go via `Authorization: Bearer <supabase jwt>`.
- **F-2** "**All privileged operations go through the Go backend**"
  (README.md). Creating auth users, writing across tenants, and anything
  needing the service role therefore live in **Go**, not the frontend.
- **F-3** The Go backend already owns the DB migrations, sqlc queries, and
  JWT-validating middleware for every existing `/api/*` route (contacts,
  flows, automations, invitations…). Company provisioning is one more
  route group there.
- **F-4** The TS helpers in `src/lib/auth/` (`requireRole`,
  `getCurrentAccount`, `requireApiKey`) are **frontend/library** code for
  server components and the public-API story — they are **not** the
  mutation API for the dashboard. They must not be mistaken for the place
  provisioning runs.

## 2. Where each responsibility lands

| Concern | Owner | Artifact |
|--------|-------|----------|
| `super_owners` table, `is_super_owner()`, RLS | **Backend repo** (migrations) | `A3` |
| `super_owner` auth middleware | **Backend** (Go chi) | `A2` |
| `POST/GET /api/admin/companies` | **Backend** (Go chi + pgx tx) | `A2`, `A3` |
| GoTrue Admin API calls (create/delete owner user) | **Backend** | `A2` |
| Admin console UI, nav gating | **Frontend** (this repo) | `A2` |
| First `super_owner` seed | **Ops** (manual SQL) | `A3`, ADR-5 |

## 3. Trust & data-flow for provisioning (happy path)

```mermaid
sequenceDiagram
  participant SO as super_owner (browser)
  participant FE as Frontend UI
  participant GO as Go backend
  participant AU as Supabase Auth (GoTrue Admin)
  participant PG as Postgres (pgx tx)

  SO->>FE: fill "New company" form
  FE->>GO: POST /api/admin/companies (Bearer JWT)
  GO->>GO: validate JWT -> sub; is_super_owner(sub)?  (else 401/403)
  GO->>AU: admin.getUserByEmail(ownerEmail)
  alt already exists
    GO-->>FE: 409 Conflict
  else new
    GO->>AU: admin.createUser(ownerEmail) -> ownerId
    GO->>PG: BEGIN; INSERT accounts; INSERT profiles(role=owner); COMMIT
    alt tx fails
      GO->>AU: admin.deleteUser(ownerId)   %% compensating rollback
      GO-->>FE: 500
    else ok
      GO->>AU: generateLink(invite) -> email owner
      GO-->>FE: 201 { company }
    end
  end
```

## 4. Correction to spec Phase 03/04 (important)

The spec's Phase 03/04 pseudocode placed `requireSuperOwner()` and the
route handlers in the **frontend** (`src/lib/auth/super-owner.ts`,
`src/app/api/admin/...`). Given F-2/F-3 that is the wrong layer. The
**intent and contract are unchanged** — the *implementation* moves:

| Spec Phase 03/04 (frontend framing) | Architecture (correct layer) |
|-------------------------------------|------------------------------|
| TS `requireSuperOwner()` guard | Go middleware `RequireSuperOwner` (`A2`) |
| Next.js `route.ts` handlers | Go chi handlers (`A2`) |
| Supabase `SECURITY DEFINER` RPC for atomic inserts | native **pgx transaction** (simpler; `A3` ADR-4) |
| Browser-facing cross-tenant read RLS policies | **not added** — reads go through Go (ADR-2) |

The frontend keeps only: the admin console UI + `apiFetch` calls + nav
gating (`A2 §3`). The pure input-validation module (spec Phase 04 §1) is
re-expressed as a Go validator; its rules/tests carry over verbatim.

## 5. Non-functionals inherited (unchanged)

NFR-1 tenant isolation, NFR-2 no regression to existing `/api/*`, NFR-6
manual `super_owner` seed — all still hold, now enforced in the Go layer.
