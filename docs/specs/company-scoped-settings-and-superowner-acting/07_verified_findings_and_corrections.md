# Architecture — Verified Findings & Corrections

> SPARC Architecture, verification pass. The design in `05` / `06` was written
> from the spec + code reading. This pass validated it against the **running
> database and backend wiring** and found two assumptions that must be
> corrected. Evidence is reproducible (queries below). Corrections are applied
> back into `05` / `06` ADRs.

## 1. Evidence (local stack, project `wacrm-api`)

### F1 — Settings inventory (real)

Tables carrying `account_id` and/or `user_id` (config subset):

| Table | account_id | legacy user_id | RLS | write role |
|-------|:---------:|:--------------:|-----|-----------|
| `whatsapp_config` | ✓ | ✓ (legacy) | membership | `admin` |
| `ai_configs` | ✓ | – | membership | `admin` |
| `ai_knowledge_documents` | ✓ | – | membership | (member+) |
| `ai_knowledge_chunks` | ✓ | – | membership | (member+) |
| `api_keys` | ✓ | – | membership | `admin` |
| `webhook_endpoints` | ✓ | – | membership | `admin` |
| `message_templates` | ✓ | ✓ (legacy) | membership | (member+) |
| `automations` | ✓ | ✓ (legacy) | membership | (member+) |
| `pipelines` | ✓ | ✓ (legacy) | membership | (member+) |
| `flows` | ✓ | ✓ (legacy) | **DISABLED (0 policies)** | — |

> So the DB isolation the spec asked for (`account_id` + membership RLS + admin
> write-role) is **already in place for every settings table except `flows`**,
> which has RLS disabled. Legacy `user_id` columns persist but are **not**
> referenced by any policy.

### F2 — The backend BYPASSES RLS (decisive)

```
DATABASE_URL → role `postgres`
  rolbypassrls = true          (pg_roles)
  owns the tables (relowner = postgres, relforcerowsecurity = false)
store/db.go → single pgxpool; NO `SET LOCAL role authenticated`,
              NO `request.jwt.claims` per request
```

⇒ Every backend query — member OR admin — runs with RLS **not applied**. RLS
only guards a **direct frontend→Supabase** path (the `NEXT_PUBLIC` anon/authed
key), if one is used for settings.

## 2. Correction C-A — Feature A: app layer is load-bearing, DB largely done

**Original framing (05 §1, ADR-A1):** "two independent layers; RLS blocks
cross-tenant SQL." **Reality:** for the API (the backend), RLS is **bypassed**;
the **app-layer `account_id` bind is the sole enforcement**. RLS is real
defense **only** for any direct-Supabase access.

Revised Feature-A scope (replaces the large-migration plan in 05 §5 for most
tables):

- **A-DONE**: `account_id` + membership RLS + `admin` write-role already exist
  on all settings tables except `flows`. No column/backfill migration needed
  there.
- **A-REAL-1 (primary)**: audit every backend settings query — it MUST bind
  `account_id` from `GetAccountID()` and never from request input or `user_id`.
  This is now the load-bearing guarantee; the fence test (ADR-A4) targets **Go
  query call-sites**, not just `pg_policies`.
- **A-REAL-2**: enable RLS + membership policies on `flows` (defense-in-depth
  for the direct path; harmless to the backend).
- **A-REAL-3**: drop legacy `user_id` columns (`whatsapp_config`,
  `message_templates`, `automations`, `pipelines`, `flows`) **after** confirming
  no Go query references them — removes the "which key scopes this?" ambiguity.
- **A-VERIFY → RESOLVED (F3): the frontend DOES use the direct Supabase client
  for settings** (`whatsapp_config`, `pipelines`, `message_templates`,
  `automations`, `ai_configs`, `ai_knowledge_chunks`, `api_keys`, `flows`,
  `flow_runs` — 30+ `.from('<table>')` call-sites in `src`). So **RLS is
  load-bearing for the frontend caller**, while the app-layer bind is
  load-bearing for the backend caller. Both layers are real, each guarding a
  different caller — the original two-layer intent (ADR-A1) holds; only the
  *attribution* changes.

### F3 — flows/flow_runs RLS-off was a LIVE exposure (not just defense-in-depth)

`authenticated` **and `anon`** hold `SELECT` (and write) grants on `flows` /
`flow_runs`. With RLS **disabled** (pre-`037`), a direct PostgREST call with the
anon/authenticated key returned rows **across all accounts** — a cross-tenant
(and even anonymous) read exposure on the path the frontend actually uses.
Migration `037` (enable RLS + membership policies) **closes it**: as `anon`,
`GET /rest/v1/flows` now returns `[]`. The flow execution engine uses
`supabaseAdmin` (service role), so it is unaffected. ⇒ `037` is a **security
fix**, upgrading A-REAL-2 from "defense-in-depth" to "closes a live leak".

The migration machinery in `05 §5` still applies **only** to any table that
turns up as `NEEDS_COLUMN` in a future inventory (none today).

## 3. Correction C-B — Feature B: no RLS/service-role duality

**Original premise (06 ADR-B3, §5 `resolveExec`):** members flow through RLS;
super_owner needs a separate **service-role** path that bypasses RLS. **Reality
(F2):** the backend **already bypasses RLS for everyone** via one `postgres`
pool and binds `account_id` in the app. There is **no** member-RLS path to
contrast with — so there is **no duality**.

Revised Feature-B design:

- **Drop** `MemberExec` vs `ServiceRoleExec`. There is one pool and one exec;
  isolation = the `account_id` the handler binds, which comes from
  `auth.FromContext(ctx).GetAccountID()`.
- `SuperOwnerActingContext.GetAccountID()` returns the acting account. The
  **same** settings handlers, **same** pool, run unchanged — acting differs only
  in the *source* of `account_id` (validated header) vs a member's
  `GetMembership`.
- The **security boundary is purely app-layer**: only a verified super_owner may
  set the acting `account_id` (header gate in `ResolveActing`). This was already
  true for members (RLS was never their backend guard).
- **Unchanged and still required:** `ResolveActing` header gate + existence
  check, the **denylist** guard (Q-B2), and the **audit** of every acting
  mutation with `outcome` (Q-B3). These do the real work.

**Rewritten ADR-B3** — *"Isolation is enforced in the app layer for all
requests; acting is just a validated alternate source of `account_id`."* The
old rationale (don't weaken member RLS) is moot because the backend never used
member RLS; the concrete safeguard is that the header is honored only after
`IsSuperOwner` passes, and every acting mutation is audited.

> Net effect: Feature B shrinks to (1) the acting context type, (2) the
> `ResolveActing` middleware + CORS header, (3) the denylist guard, (4) the
> audit table + wrapper. No separate elevated data path to build.

## 4. Corrections applied

- `05_architecture.md` ADR-A1 amended (app layer load-bearing; RLS bypassed by
  backend). §5 scoped to `NEEDS_COLUMN` tables only.
- `06_architecture_superowner.md` ADR-B3 rewritten; §5 `resolveExec` collapses
  to a single account-bound exec.

## 5. Reproduce

```bash
psql -tAc "SELECT rolbypassrls FROM pg_roles WHERE rolname='postgres';"     # → t
psql -tAc "SELECT relforcerowsecurity FROM pg_class WHERE relname='flows';"  # → f
psql -tAc "SELECT count(*) FROM pg_policies WHERE tablename='flows';"        # → 0
# settings tables already membership-scoped (see F1 query in session log)
```
