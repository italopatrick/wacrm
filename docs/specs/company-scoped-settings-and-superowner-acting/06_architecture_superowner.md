# Architecture — B. super_owner "Act-as-Company"

> SPARC Architecture phase (Feature B). Builds on `01_spec_requirements.md` +
> `03_pseudocode_superowner_acting.md`, and resolves open questions Q-B1..Q-B3.
> Component boundaries, auth/middleware wiring, elevated execution, audit
> schema, API + runtime sequence, failure modes, ADRs.

## 0. Resolved open questions (decisions)

- **Q-B1 → header `X-Act-As-Account: <uuid>`** (ADR-B1). Backend auth is bearer
  JWT (no ambient cookie) ⇒ no CSRF surface; a custom header requires a CORS
  preflight we control. Stateless, no token lifecycle.
- **Q-B2 → owner-parity minus an explicit denylist** (ADR-B2):
  `delete_account`, `transfer_ownership`, `remove_last_owner`,
  `reveal_secret_plaintext`. Secretful fields stay **write-only** (rotate, not
  read). Destructive lifecycle stays on dedicated `/admin` routes.
- **Q-B3 → audit every acting mutation with `outcome`** (`success|denied|error`)
  **plus** one `acting.context_entered` event per resolution (ADR-B4). Reads are
  not individually audited.

## 1. Overview

```
super_owner (bearer JWT)                 backend
  │  X-Act-As-Account: <uuid>              │
  ├───────────────────────────────────────►│ AuthSuperOwner  (verify IsSuperOwner)
  │                                         │ ResolveActing   (parse header,
  │                                         │                  AccountExists,
  │                                         │                  emit context_entered)
  │                                         │   ctx = SuperOwnerActingContext
  │                                         ▼
  │                        account-scoped handler (unchanged)
  │                        resolveExec(ctx) → ServiceRoleExec(ActingAccountID)
  │                        actingMutation() → account write + audit(outcome)
  ▼
```

**Boundary principle:** member requests flow through **RLS** (Feature A);
super_owner-acting requests flow through a **guarded service-role path** bound
to `ActingAccountID`. RLS is never weakened with an `OR is_super_owner` clause
(ADR-B3) — the elevated surface is small, explicit, and audited.

## 2. Components & responsibilities

| Component | Path | Responsibility | New? |
|-----------|------|----------------|------|
| `SuperOwnerActingContext` | `internal/auth/context.go` | `GetAccountID() → ActingAccountID` | **new** |
| `ResolveActing` middleware | `internal/httpx/middleware/resolve_acting.go` | Header→context, existence check, entered-event | **new** |
| `resolveExec` selector | `internal/httpx/handlers/...` (shared helper) | member RLS path vs guarded service-role path | **new** |
| `ServiceRoleExec` | `internal/store` (elevated conn, bound) | Account-bound queries via service role | **new** |
| Denylist guard | handler/middleware | Block ADR-B2 ops for acting | **new** |
| `platform_audit_log` | `supabase/migrations/NNN_*` + `store/gen` | Append-only audit of acting actions | **new** |
| CORS allow-header | `internal/httpx/middleware/cors.go` | Permit `X-Act-As-Account` | edit |
| Router wiring | `internal/httpx/router.go` | Insert `ResolveActing` after `AuthSuperOwner` on shared routes | edit |

## 3. Auth context contract

```
type SuperOwnerActingContext struct {
  UserID          pgtype.UUID   // the super_owner (actor)
  ActingAccountID pgtype.UUID   // target company
}
func (s *SuperOwnerActingContext) authContext()              {}
func (s *SuperOwnerActingContext) GetAccountID() pgtype.UUID { return s.ActingAccountID }

// Predicate used by handlers/guards.
func IsActing(ac auth.AuthContext) bool  // true only for *SuperOwnerActingContext
```

- Mirrors the existing `AuthContext` interface (`GetAccountID()`), so **every
  account-scoped handler works unchanged** — it just reads a different context
  type (B1-1).
- Distinct from plain `SuperOwnerContext` (which returns empty and keeps the
  `/admin` CRUD semantics).

## 4. Middleware chain (shared account-scoped routes)

```
Recover → RequestID → CORS → AuthSuperOwner → ResolveActing → [RateLimitAdmin] → handler
                                    │              │
                     verifies IsSuperOwner    if header present & account exists:
                     (single source, EC-B4)   set SuperOwnerActingContext,
                                              else pass through unchanged (FR-B3)
```

```
ResolveActing(q).handle(req):
  sc := SuperOwnerFromContext(ctx)          // nil for non-super_owner → no-op (FR-B3/INV-B2)
  if sc == nil: return next(req)
  raw := header("X-Act-As-Account")
  if raw == "": return next(req)            // plain super_owner admin flow
  id, ok := parseUUID(raw); if !ok: return 400            // EC-B2
  if !q.AccountExists(ctx, id): return 404                 // FR-B5
  audit(ctx, "acting.context_entered", sc.UserID, id, outcome=success)  // ADR-B4
  return next(withActing(ctx, sc.UserID, id))
```

- **Ordering:** `ResolveActing` runs *after* `AuthSuperOwner`, which is the sole
  place `IsSuperOwner` is verified (per request ⇒ mid-session revoke fails next
  request, EC-B4/INV-B1).
- Regular member routes do **not** include this middleware, so a member's header
  is inert (INV-B2).

## 5. Elevated execution + denylist

```
resolveExec(ctx) -> Executor:
  switch ac := auth.FromContext(ctx):
    *SessionContext:           MemberExec(ac.AccountID)          // RLS
    *SuperOwnerActingContext:  ServiceRoleExec(ac.ActingAccountID)
    default:                   Deny                              // B3-2/INV-B1

ServiceRoleExec(accountID):
  // Uses the service-role pool already used by /admin. EVERY statement is
  // parameterised `WHERE account_id = $accountID`; the pool is never handed a
  // query without that bind (enforced by wrapping repo, not raw access).

guardDenylist(ctx, action):
  if IsActing(ctx) && action ∈ {delete_account, transfer_ownership,
                                remove_last_owner, reveal_secret_plaintext}:
      audit(ctx, action, outcome=denied); return 403           // ADR-B2 / B4-4
```

- Secretful reads: acting responses **mask** secret fields (write-only), so
  `reveal_secret_plaintext` never occurs via normal reads either.

## 6. Audit schema

```
CREATE TABLE platform_audit_log (
  id                bigserial PRIMARY KEY,
  actor_user_id     uuid NOT NULL REFERENCES auth.users(id),
  target_account_id uuid NOT NULL REFERENCES accounts(id),
  action            text NOT NULL,              -- e.g. settings.whatsapp.update
  outcome           text NOT NULL,              -- success | denied | error
  request_id        text,
  metadata          jsonb NOT NULL DEFAULT '{}',-- redacted; ids + field names only
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- append-only: no UPDATE/DELETE policy; service-role INSERT only.
CREATE INDEX ON platform_audit_log (target_account_id, created_at DESC);
CREATE INDEX ON platform_audit_log (actor_user_id, created_at DESC);
```

```
actingMutation(ctx, action, fn):
  guardDenylist(ctx, action)
  res := fn()                                   // account-bound write
  audit(ctx, action, outcome = res.ok ? success : error, metadata = redact(res))
  return res
```

- `redact()` strips secret values, keeps field names + row ids (NFR-2 / B4-2).
- Member (non-acting) mutations write **no** row here (B4-3) — audit is the
  elevated surface only.

## 7. API contract

```
# Discovery (exists)
GET  /api/admin/companies            → list companies (super_owner)
GET  /api/admin/companies/{id}       → company detail (target id for acting)

# Acting: reuse existing account-scoped dash routes with the header
GET  /api/dash/settings              Header X-Act-As-Account: <id>  → target config
PUT  /api/dash/settings              Header X-Act-As-Account: <id>  → audited write

# Errors
400 malformed header · 404 unknown account · 403 denylisted op / under-priv
```

- No route duplication (ADR-B5): the same handler serves member and acting; the
  context type decides the data path and audit behavior (B5-1).

## 8. Runtime sequence (acting settings update)

```
super_owner            backend                         db
   │ PUT /dash/settings   │                             │
   │ X-Act-As-Account:B   │                             │
   ├─────────────────────►│ AuthSuperOwner: IsSuperOwner│
   │                      ├────────────────────────────►│ true
   │                      │ ResolveActing: AccountExists │
   │                      ├────────────────────────────►│ true
   │                      │ audit context_entered        │
   │                      │ guardDenylist(update): ok     │
   │                      │ ServiceRoleExec(B): UPDATE …  │
   │                      ├────────────────────────────►│ WHERE account_id=B
   │                      │ audit update outcome=success  │
   │  200 {settings}      │◄─────────────────────────────┤
   │◄─────────────────────┤                              │
```

## 9. Failure modes

| Failure | Detection | Behavior | Ref |
|---------|-----------|----------|-----|
| Non-super_owner + header | `SuperOwnerFromContext==nil` | header ignored | FR-B3/INV-B2 |
| Malformed header | `parseUUID` | 400 | EC-B2 |
| Unknown account | `AccountExists` | 404 | FR-B5 |
| Suspended target | allowed, audited | proceeds (super_owner repair) | FR-B5 |
| Denylisted op while acting | `guardDenylist` | 403 + audit `denied` | ADR-B2/B4-4 |
| super_owner revoked mid-session | next `AuthSuperOwner` | 403 | EC-B4/INV-B1 |
| Elevated query without account bind | wrapped `ServiceRoleExec` | impossible by construction | INV-B2 |
| Own-store bleed | context override per request | acting id wins | EC-B1/B2-4 |

## 10. Decision log (ADRs)

**ADR-B1 — Header transport.** See Q-B1. Bearer-JWT auth ⇒ no CSRF; stateless.
Rejected minted scoped token (lifecycle/rotation cost) for now; revisit if
acting must persist across a UI session server-side.

**ADR-B2 — Owner-parity minus denylist.** See Q-B2. Denylist (not allowlist) so
new owner features are usable by support by default; a small dangerous set is
blocked and destructive lifecycle stays on `/admin`.

**ADR-B3 — App-layer isolation for all requests; acting is an alternate
`account_id` source.** ⚠️ **Rewritten per `07_verified_findings…` (F2/C-B):**
the backend already **bypasses RLS for every request** (single `postgres` pool,
`rolbypassrls`) and binds `account_id` in the app. There is **no** member-RLS
path to contrast with, so the `MemberExec` vs `ServiceRoleExec` duality in §5 is
**dropped** — there is one pool and one account-bound exec. Super_owner-acting
differs only in that `GetAccountID()` comes from a **validated header** instead
of `GetMembership`. The safeguards that matter are entirely app-layer: the
header is honored only after `IsSuperOwner` passes (`ResolveActing`), the
denylist (ADR-B2) blocks dangerous ops, and every acting mutation is audited
(ADR-B4). §5 `resolveExec` should be read as "resolve the bound `account_id`
from context," not "pick RLS vs service-role."

**ADR-B4 — Audit all mutations + entered event, with `outcome`.** See Q-B3.
Denied/error rows are the security-review signal; append-only table, redacted
metadata.

**ADR-B5 — Reuse account-scoped routes, no duplication.** One handler, context
decides path. Prevents drift between "member settings" and "acting settings".

**ADR-B6 — `IsSuperOwner` verified once per request in `AuthSuperOwner`.**
Single source; `ResolveActing` trusts it. Gives per-request revocation for free.

## 11. Build order (implementation hand-off)

1. `platform_audit_log` migration + sqlc queries.
2. `SuperOwnerActingContext` + `IsActing` in `auth`.
3. `ResolveActing` middleware + CORS header + router wiring (after AuthSuperOwner).
4. `resolveExec`/`ServiceRoleExec` wrapper + `guardDenylist`.
5. `actingMutation` audit wrapper; wire into settings write handlers.
6. Tests per `04_test_anchors.md` (B-series + X-series).

> Feature A (settings isolation) and Feature B (acting) are independently
> shippable; B depends on A only for the `is_account_member` substrate, which
> already exists. Ship A first (closes leaks), then B (adds the elevated path).
