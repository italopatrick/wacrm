# Architecture — A. Company-scoped Settings Isolation

> SPARC Architecture phase (Feature A). Builds on `01_spec_requirements.md` +
> `02_pseudocode_config_isolation.md`. Component boundaries, DB schema, RLS,
> app-layer contracts, migration strategy, failure modes, ADRs. Feature B is in
> `06_architecture_superowner.md`.

## 1. Overview

Isolation is enforced in **two independent layers** (NFR-1, defense in depth):

```
┌───────────────────────────────────────────────────────────────┐
│ App layer (Go)                                                 │
│   handler → auth.FromContext(ctx).GetAccountID()  ── accountID │
│           → repo query bound to accountID (never user_id)      │
├───────────────────────────────────────────────────────────────┤
│ DB layer (Postgres RLS)                                        │
│   every settings table: is_account_member(account_id, role)    │
│   the member JWT sets auth.uid(); RLS re-derives membership     │
└───────────────────────────────────────────────────────────────┘
```

If the app layer has a bug, RLS still blocks cross-tenant SQL; if RLS is ever
run with an elevated role, the app-layer `accountID` bind still confines scope.

**Boundary principle:** the *identity of the tenant for a request* is owned by
the auth context (`GetAccountID()`), already the single source used by every
dashboard handler. Feature A does not introduce a new source of tenancy — it
makes **every settings table** obey the one that exists.

## 2. Components & responsibilities

| Component | Repo/path | Responsibility | New? |
|-----------|-----------|----------------|------|
| Settings inventory | `docs/.../02` §A0 + a Go fence test | Canonical list of settings tables + their scoping status | **new** (test) |
| `account_id` migrations | `supabase/migrations/NNN_*` | Add column + backfill + FK + NOT NULL | **new** |
| RLS migrations | `supabase/migrations/NNN_*` | Membership policies; drop user_id policies | **new** |
| Per-account unique keys | same migrations | Rescope global/per-user unique → per-account | **new** |
| Repo queries (sqlc) | `store/queries/*.sql` → `store/gen` | Every settings read/write takes `account_id` param | edit |
| Settings handlers | `internal/httpx/handlers/dash/*` | Bind to `GetAccountID()`; role + suspend guards | edit |
| Fence test | `internal/store/...` or migration test | Assert invariants over the inventory | **new** |

## 3. Data model

### 3.1 Column contract (every settings table T)

```
T.account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
```

- `ON DELETE CASCADE`: deleting a company removes its settings (A1-3). Domain
  *transactional* data keeps its existing policy; this rule is for *config*.
- Secret columns (e.g. `whatsapp_config.app_secret`) remain **encrypted at
  rest** via the existing `crypto` domain; the column type/handling is
  unchanged — only its row scoping is asserted.

### 3.2 RLS policy contract (per table, by write role)

```
T_select  USING       ( is_account_member(account_id) )
T_insert  WITH CHECK  ( is_account_member(account_id, write_role(T)) )
T_update  USING       ( is_account_member(account_id, write_role(T)) )
T_delete  USING       ( is_account_member(account_id, write_role(T)) )
```

`write_role(T)` table (initial; refine during inventory A0):

| Table (config) | write_role | Why |
|----------------|-----------|-----|
| `whatsapp_config` (Meta app/secret) | `admin` | secretful, store-critical |
| `webhook_endpoints`, `api_keys` | `admin` | security-sensitive |
| `ai_reply_config`, `ai_knowledge` | `admin` | behavioral config |
| `automations`, `message_templates`, `pipelines` | `agent`/`admin` | operational |
| `account_default_currency` | `admin` | store-wide |

### 3.3 Uniqueness contract

```
UNIQUE (account_id, phone_number_id)   -- whatsapp_config (was global)
UNIQUE (account_id, name)              -- api_keys
UNIQUE (account_id)                     -- single-row configs (ai_reply_config)
```

## 4. App-layer contract

```
// Handler skeleton for any settings resource.
readHandler(req):
  accountID := auth.FromContext(req.ctx).GetAccountID()
  if isEmpty(accountID): 403                      // EC-A2
  return repo.GetSettings(ctx, accountID)          // account_id param ONLY

writeHandler(req):
  ac := auth.FromContext(req.ctx)
  accountID := ac.GetAccountID()
  if isEmpty(accountID): 403
  requireRole(ac, write_role)                       // FR-A6
  if accountSuspended(accountID) && !isActing(ac): 403   // EC-A4 (B cross-ref)
  return repo.UpsertSettings(ctx, accountID, body)  // body carries NO account id
```

**Contract invariants:**
- Repo functions accept `account_id` as a parameter; there is **no** settings
  query keyed by `user_id` (INV-A2). A `grep`/fence test enforces this.
- The request body/query never supplies an account id that is honored; the only
  source is `GetAccountID()` (FR-A3).

## 5. Migration strategy (safe, reversible-per-step)

```
Step 1  (additive)  ADD COLUMN account_id NULLable on each settings table
Step 2  (backfill)  UPDATE ... FROM profiles p WHERE p.id = T.user_id
Step 3  (assert)    ABORT if any NULL remains OR any user_id maps to !=1 account
Step 4  (tighten)   SET NOT NULL + ADD FK + per-account UNIQUE
Step 5  (rls)       drop user_id policies; create membership policies
Step 6  (cleanup)   later migration drops the now-unused user_id column
```

- Steps 1–4 are one migration per table group; step 5 a dedicated RLS
  migration (mirrors how `017` batched its RLS rewrite).
- **Fail-closed** at step 3 (EC-A1/NFR-4): the migration raises, leaving the
  additive column in place but not enforced — re-runnable after the operator
  fixes ambiguous rows.
- `user_id` column retained until step 6 so the change is bisectable and the
  old code path keeps working during rollout.

## 6. Failure modes

| Failure | Detection | Behavior | Ref |
|---------|-----------|----------|-----|
| user_id → 0/≥2 accounts | step-3 assert | migration aborts, names the rows | EC-A1 |
| Residual user_id RLS policy | fence test / `pg_policies` scan | CI fails | INV-A2 |
| Handler reads with empty account | `isEmpty` guard | 403, never global | EC-A2 |
| Cross-tenant read attempt | RLS | 0 rows | A2-1 |
| Under-privileged write | RLS WITH CHECK + `requireRole` | 403 | FR-A6 |
| New settings table added w/o scoping | fence test A5-1 | CI fails | INV-A1/A2 |

## 7. Decision log (ADRs)

**ADR-A1 — App-layer bind is load-bearing; RLS is defense-in-depth.**
⚠️ **Corrected by `07_verified_findings…` (F2):** the Go backend connects as
`postgres` (`rolbypassrls=true`, table owner, no `FORCE ROW LEVEL SECURITY`, no
per-request `SET ROLE`/`request.jwt`), so **RLS does NOT apply to backend
queries**. The **app-layer `account_id` bind is the sole enforcement for the
API**; membership RLS only guards a direct frontend→Supabase path. The fence
test therefore targets **Go query call-sites** (never `user_id`, always
`GetAccountID()`), with `pg_policies` as a secondary check.

**ADR-A2 — Reuse `is_account_member`, add no new tenancy source.** The helper
and membership model from `017` are the substrate; Feature A closes gaps rather
than inventing scoping. Keeps one mental model.

**ADR-A3 — `ON DELETE CASCADE` for config (not RESTRICT).** Config is derived
per company; when a company is deleted its config should vanish. Contrast
`accounts.owner_user_id` which is RESTRICT (protect the tenant root).

**ADR-A4 — Fence test as the durable guarantee.** A table-driven test over the
inventory (A0/A5-1) is what keeps isolation true as new settings tables land —
more reliable than review vigilance.

**ADR-A5 — Keep `user_id` until a later migration.** Bisectable rollout; old and
new code coexist during deploy. Drop only after the app no longer references it.

## 8. What this explicitly avoids

- No per-user settings anywhere (single company config shared by members, EC-A3).
- No global/cross-company settings view.
- No change to transactional-data RLS (only *config* tables).
- No new tenancy identifier — `GetAccountID()` stays the sole source.
