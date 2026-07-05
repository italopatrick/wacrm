# Phase 03 — Authorization (pseudocode)

> ⚠️ **Layer correction (see `architecture/A1_system_context.md`).** This
> system's privileged operations run in a **separate Go backend**
> (`ulabchat-backend`: chi + pgx + sqlc), not in Next.js route handlers.
> The `requireSuperOwner()` guard below is therefore implemented as **Go
> middleware `RequireSuperOwner`** (`architecture/A2 §1.1`), not a TS helper
> in `src/lib/auth/`. The **contract is unchanged** — the pseudocode here
> documents the intended behaviour that the Go middleware realises.

Backs FR-2, NFR-1, NFR-2, EC-3, EC-4. Guard that resolves the
`super_owner` role from an authenticated request; mirrors the existing
account guards' 401/403 semantics.

---

## 1. Design

Two distinct authority axes — never conflated:

```
Account axis   : getCurrentAccount() / requireRole(min)   → account_role
super_owner axis: requireSuperOwner()                     → super_owners
```

`requireSuperOwner()` does **not** call `getCurrentAccount()`. A
`super_owner` may have no company, so requiring account context would
wrongly 403 them (NFR-2). It only needs an authenticated session + a
`super_owners` hit.

## 2. New module — `src/lib/auth/super-owner.ts` (pseudocode)

```
IMPORT createClient       FROM "@/lib/supabase/server"   // RLS SSR client
IMPORT supabaseAdmin      FROM "@/lib/flows/admin-client" // service role
IMPORT UnauthorizedError, ForbiddenError FROM "./api-context"

INTERFACE SuperOwnerContext:
  supabase : SupabaseClient   // service-role client for cross-tenant writes
  userId   : string           // auth.uid() of the verified super_owner

FUNCTION requireSuperOwner() -> SuperOwnerContext:
  ssr = await createClient()
  { user } = await ssr.auth.getUser()
  IF no user: THROW UnauthorizedError            // EC-4 → 401

  // Verify via RLS-scoped client so a probe can't read others' rows,
  // OR call the SQL predicate directly. Prefer the predicate: single
  // source of truth shared with RLS (INV-4).
  isSuper = await ssr.rpc("is_super_owner", { uid: user.id })
  IF not isSuper: THROW ForbiddenError("super_owner role required")  // EC-3 → 403

  // Verified. Hand back a service-role client for cross-tenant writes
  // (creating companies touches multiple accounts' rows). Account is
  // fixed by the operation, not by the caller's session — same trust
  // model as requireApiKey().
  RETURN { supabase: supabaseAdmin(), userId: user.id }
```

- **TEST:** no session → throws `UnauthorizedError` (401).
- **TEST:** authenticated non-super-owner → throws `ForbiddenError` (403).
- **TEST:** authenticated `super_owner` → returns ctx with `userId` set
  and a service-role `supabase` client.
- **TEST:** a `super_owner` with **no** profile/account still resolves
  (does not depend on `getCurrentAccount`).

## 3. Error mapping

Reuse the existing `toErrorResponse(err)` from
`src/lib/auth/api-context.ts` — it already maps `UnauthorizedError`→401,
`ForbiddenError`→403, unknown→500. No new error types needed.

```
// in every /api/admin route:
try {
  ctx = await requireSuperOwner()
  ...
} catch (err) {
  return toErrorResponse(err)
}
```

## 4. Optional client gate — `src/components/auth/require-super-owner.tsx`

Mirror the existing `require-role.tsx` pattern for hiding the admin-console
nav entry. Server-authoritative check still happens in the API (defence in
depth); the client gate is UX only.

```
COMPONENT RequireSuperOwner({ children, fallback }):
  { isSuperOwner, loading } = useSuperOwner()   // hook below
  IF loading: RETURN <Skeleton/>
  IF not isSuperOwner: RETURN fallback ?? null
  RETURN children

HOOK useSuperOwner():
  // Reads a lightweight GET /api/admin/me → { isSuperOwner: boolean }
  // Cached in context like use-auth.tsx. Never trusted for authorization.
```

- **TEST:** `RequireSuperOwner` renders children only when hook returns true.
- **TEST:** `GET /api/admin/me` returns `{ isSuperOwner: false }` for a
  normal user (200, not 403 — it's an introspection endpoint).

## 5. Guard selection cheat-sheet (for implementers)

| Action                                   | Guard to call            |
|------------------------------------------|--------------------------|
| Create / list / suspend a company        | `requireSuperOwner()`    |
| Invite `admin`/`agent`/`viewer` in a company | `requireRole("admin")` (existing) |
| Any per-company data (contacts, inbox…)  | `requireRole(min)` (existing) |
| Public API (machine)                     | `requireApiKey()` (existing) |
