# Pseudocode — B. super_owner "Act-as-Company"

> SPARC Pseudocode phase for Feature B. Lets a verified super_owner obtain a
> per-request acting-account context and run account-scoped operations, audited.
> Modular; TDD anchors consolidated in `04_test_anchors.md`. No secret literals.

## Design decision (ADR-B)

RLS stays **membership-only** (Feature A). A super_owner is not a member, so
their acting operations do **not** flow through member RLS. Instead:

- The backend verifies `IsSuperOwner(caller)` and, for acting requests, runs the
  account-scoped queries through the **service-role** path already used by
  `/admin`, explicitly bound to the acting account id.
- This keeps member RLS clean (no `OR is_super_owner` weakening) and confines
  the elevated path to a small, audited surface.

## Module B1 — Acting-account context (auth)

```
// New auth context type; GetAccountID returns the acting account so existing
// account-scoped handlers work unchanged.
type SuperOwnerActingContext:
  UserID          uuid   // the super_owner
  ActingAccountID uuid   // target company
  authContext()
  GetAccountID() -> ActingAccountID

WithSuperOwnerActing(ctx, userID, actingAccountID) -> ctx
```

- **TDD B1-1**: `SuperOwnerActingContext.GetAccountID()` returns the acting id
  (not empty, unlike plain `SuperOwnerContext`).

## Module B2 — Resolve acting context (middleware, runs AFTER AuthSuperOwner)

```
middleware ResolveActing(q):
  handle(req):
    sc := SuperOwnerFromContext(req.ctx)      // requires prior AuthSuperOwner
    if sc == nil: next(req); return           // not a super_owner → no-op (FR-B3)

    raw := req.header["X-Act-As-Account"]
    if raw == "": next(req); return           // plain super_owner (admin CRUD)

    actingID, ok := parseUUID(raw)
    if not ok: return 400                      // EC-B2

    // Re-check super_owner per request (EC-B4) — sc came from AuthSuperOwner,
    // which already verified; keep the check there as the single source.
    exists := q.AccountExists(ctx, actingID)
    if not exists: return 404                  // FR-B5 / EC-B2

    ctx2 := WithSuperOwnerActing(ctx, sc.UserID, actingID)
    next(req.with(ctx2))
```

- **TDD B2-1**: verified super_owner + valid existing `X-Act-As-Account` →
  downstream `GetAccountID()` == acting id (FR-B1).
- **TDD B2-2**: **non**-super_owner + `X-Act-As-Account` → header ignored,
  context unchanged (FR-B3 / INV-B2).
- **TDD B2-3**: malformed header → 400; unknown account → 404 (EC-B2 / FR-B5).
- **TDD B2-4**: super_owner who owns a store, acting on another → context is the
  acting account, not their own membership account (EC-B1).
- **TDD B2-5**: suspended target account → acting still resolves (FR-B5).

## Module B3 — Elevated account-scoped execution guard

```
// Handlers reused between members and super_owner-acting call this to pick the
// data path. Members → member queries (RLS). Acting → service-role queries
// bound to ActingAccountID.
resolveExec(ctx):
  a := auth.FromContext(ctx)
  switch a:
    case SessionContext:            return MemberExec(a.AccountID)      // RLS path
    case SuperOwnerActingContext:   return ServiceRoleExec(a.ActingAccountID) // guarded
    default:                        return Deny

ServiceRoleExec(accountID):
  // every query is explicitly `WHERE account_id = accountID`; the elevated
  // connection is never used without this bound (INV-B2 at the data layer).
```

- **TDD B3-1**: acting write lands on the **target** account's rows only; a
  second account's rows are untouched (scope bound).
- **TDD B3-2**: `resolveExec` for an anonymous/plain context → Deny (no elevated
  path without a recognized context).

## Module B4 — Audit log (mutations)

```
table platform_audit_log:
  id, actor_user_id, target_account_id, action, request_id, created_at,
  metadata jsonb    // no secrets — redact values, keep field names/ids

writeAudit(ctx, action):
  a := SuperOwnerActingContext(ctx)
  INSERT platform_audit_log(a.UserID, a.ActingAccountID, action,
                            RequestID(ctx), now(), redacted(metadata))

// Wrap acting mutations:
actingMutation(ctx, action, fn):
  result := fn()                 // the account-scoped write
  if result.ok: writeAudit(ctx, action)   // FR-B4 / INV-B3
  return result
```

- **TDD B4-1**: an acting settings update writes exactly one audit row with
  actor, target account, action, request id (FR-B4).
- **TDD B4-2**: audit metadata contains **no** secret values (e.g. app_secret
  redacted) (NFR-2).
- **TDD B4-3**: a member (non-acting) mutation writes **no** platform audit row
  (audit is for the elevated path only).
- **TDD B4-4**: a failed acting mutation writes no audit row (only successful
  effects are recorded), or writes an explicit `*_failed` action — pick one and
  test it (decision D-B4).

## Module B5 — Endpoint surface

```
// Option 1 (chosen): reuse existing account-scoped dashboard routes; a
// super_owner calls them with X-Act-As-Account. No route duplication.
GET  /api/dash/settings         (member OR acting)   -> current/acting company
PUT  /api/dash/settings         (member OR acting)   -> audited if acting

// Discovery for the console:
GET  /api/admin/companies/{id}  -> already exists; UI uses id as acting target
```

- **TDD B5-1**: the same `/dash/settings` route serves a member (own account)
  and a super_owner-acting (target account) and returns each one's disjoint
  config (ties FR-A5 + FR-B2).
- **TDD B5-2**: acting request still subject to admin rate-limit / auth (FR-B6).

## Open questions (block implementation)

- **Q-B1** Transport: header `X-Act-As-Account` (chosen) vs. a minted
  scoped token. Confirm header is acceptable given CSRF/proxy setup.
- **Q-B2** Operation scope (FR-B2): full `owner` parity, or an explicit subset
  (e.g. exclude destructive ops like delete-account)? Needs product sign-off.
- **Q-B3** D-B4: audit successful-only vs. also record failed attempts.
