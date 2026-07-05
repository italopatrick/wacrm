# A4 — Architecture Decision Records

Short ADRs capturing the load-bearing choices. Status: **Proposed**
(pending implementation approval).

---

## ADR-1 — `super_owner` is a named role on its own table/axis

**Context.** The request wants an unambiguous "super owner" above
companies. The existing `account_role` enum already has a per-company
`owner`.
**Decision.** Model `super_owner` as membership in a dedicated
`super_owners` table with `is_super_owner()`, **not** as a new value in
`account_role`.
**Consequences.** (+) No ambiguity with a company's `owner`; role is
independent of any account, so a super_owner needs no company. (+)
`account_role` enum and all existing guards untouched (INV-3). (−) A
second authority axis to reason about — mitigated by a single predicate
shared by SQL and Go.
**Rejected.** Adding `super_owner` to `account_role` — couples a global
role to one account and re-introduces the naming ambiguity we were asked
to remove.

## ADR-2 — Cross-tenant reads go through the Go backend, not browser RLS

**Context.** The console lists companies across all tenants. Options:
(a) add `is_super_owner` SELECT policies so the browser's anon client
reads every tenant directly; (b) serve the list from Go.
**Decision.** (b). Do **not** add browser-facing cross-tenant read
policies. The Go backend returns the list via its service-role pgx conn.
**Consequences.** (+) The browser client stays scoped to a single tenant
exactly as today — tightest blast radius (NFR-1). (+) One API surface;
consistent with "all privileged ops via Go" (F-2). (−) A Go endpoint for
reads too (not just writes) — trivial cost.
**Rejected.** (a) — widens what a super_owner's browser session can pull
and spreads authz across RLS + Go.

## ADR-3 — Verify `super_owner` by DB lookup per request (no JWT claim)

**Context.** The Go middleware must know if the caller is a super_owner.
Options: (a) `SELECT is_super_owner($sub)` each request; (b) bake a
`super_owner` claim into the Supabase JWT via a custom access-token hook.
**Decision.** (a) direct lookup per admin request.
**Consequences.** (+) Revocation is immediate (no token-refresh lag).
(+) No dependency on configuring a GoTrue auth hook. (+) One extra indexed
PK lookup on a tiny table — negligible, and only on `/api/admin/*`. (−)
A DB round trip per admin request — acceptable for this low-traffic path.
**Rejected.** (b) — faster but adds revocation lag and auth-hook infra for
no meaningful gain on an admin-only route.

## ADR-4 — Atomicity: pgx transaction + compensating auth-user rollback

**Context.** Provisioning spans an external GoTrue user creation and two
table inserts. Supabase has no single transaction across auth + tables.
The spec suggested a `SECURITY DEFINER` RPC to make the inserts atomic.
**Decision.** In Go: create the auth user first (external), then wrap the
two inserts in **one pgx transaction**; on tx failure, compensate by
deleting the just-created auth user.
**Consequences.** (+) The two table writes are genuinely atomic via pgx —
no RPC/`SECURITY DEFINER` surface to maintain. (+) Single, well-defined
compensation point (delete user) for the one non-transactional step. (−)
A crash between `CreateUser` and the tx could orphan an auth user;
mitigated by a periodic reaper / idempotent retry keyed on email (EC-1
already makes retries safe). 
**Rejected.** Supabase RPC for the inserts — unnecessary once writes are
in Go with direct pgx.

## ADR-5 — First `super_owner` is a manual ops seed, not an endpoint

**Context.** Someone must become the first super_owner. An endpoint to
self-grant would be a privilege-escalation hole.
**Decision.** Seed the first row with manual SQL (A3 §1). No app path
creates the first super_owner. `super_owners` has no write RLS policy.
**Consequences.** (+) No self-service escalation surface (NFR-6). (−)
Bootstrapping is a runbook step — acceptable and auditable.
**Phase 2.** A `super_owner`-only grant/revoke endpoint may add further
super_owners, guarded by "cannot remove the last one" (EC-6).

## ADR-6 — Provisioning creates the company's first `owner` up front

**Context.** `accounts.owner_user_id` is NOT NULL (INV-2); a company
cannot exist ownerless.
**Decision.** `ProvisionCompany` always creates the owner auth user +
`profiles(account_role='owner')` in the same operation as the account.
Further members (`admin`/`agent`/`viewer`) are added later via the
**existing** invitation flow (FR-5), not by the super_owner.
**Consequences.** (+) INV-2 preserved; no nullable-owner state or new RLS
edge cases. (+) Clean separation: super_owner provisions; company owner
staffs. (−) The super_owner must supply an owner email at create time —
intended.

---

### Decision index

| ADR | Title | Status |
|-----|-------|--------|
| 1 | super_owner as own-axis named role | Proposed |
| 2 | Cross-tenant reads via Go, not browser RLS | Proposed |
| 3 | Per-request DB lookup for role (no JWT claim) | Proposed |
| 4 | pgx tx + compensating auth rollback | Proposed |
| 5 | Manual seed for first super_owner | Proposed |
| 6 | Provision creates first company owner up front | Proposed |
