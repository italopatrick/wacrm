# Phase 01 — Overview & Requirements

**Feature:** Platform Owner → Company Provisioning
**SPARC phase:** Specification / Pseudocode
**Status:** Draft (pre-implementation)

> ⚠️ Implementation note (from `AGENTS.md`): this project runs a build of
> Next.js with breaking changes vs. public docs. **Before writing any code**
> for this feature, read the relevant guide in `node_modules/next/dist/docs/`.
> This document is spec/pseudocode only — no runnable code.

---

## 1. Problem statement

Today the system is single-tier multi-tenant:

- A tenant is an **`Account`** (a "company"). See `src/types/index.ts:45`.
- Each `Account` has one immutable **`owner`** plus members with
  `account_role ∈ {owner, admin, agent, viewer}` (`src/lib/auth/roles.ts:18`).
- A user (`Profile`) belongs to **exactly one** account
  (`profiles.account_id`, `src/types/index.ts:31`).
- There is **no tier above accounts** — nobody can create companies
  centrally. Accounts are self-serve on signup.

The request adds a **platform tier**: a first-class, explicitly-named
role — **`super_owner`** — who registers companies on behalf of clients,
each company then running the existing per-account role model.

Design decision (per user): the platform tier is a **named role
`super_owner`**, not an implicit/ambiguous flag. It is still stored on its
own authority axis (its own table), but it is referred to everywhere by
that explicit name so there is no confusion with the per-company `owner`.

## 2. Terminology (authoritative mapping)

The words in the request collide with existing role names. This table is
the single source of truth for the rest of the spec:

| Request word            | Spec term          | Maps to existing concept                       |
|-------------------------|--------------------|------------------------------------------------|
| "owner" / "super owner" (creates stores) | **`super_owner`** | **NEW named role**, above tenants (own axis) |
| "store" / "loja" / "empresa" / tenant | **Store / Tenant** | existing `Account` (`accounts` table) |
| store "admin"           | `admin`            | existing `account_role = 'admin'`              |
| "user"                  | `agent`            | existing `account_role = 'agent'`              |
| "abaixo" / below        | `viewer`           | existing `account_role = 'viewer'`             |
| (per-store owner)       | **Store Owner**    | existing `account_role = 'owner'`              |

**Store = Tenant = `Account`.** Each store is one tenant with its own
isolated data registry on the platform — contacts, conversations,
pipelines, templates, automations, etc. are all scoped by `account_id`
(NOT NULL on every domain table since migration 017) and isolated by
Postgres RLS. Provisioning a store creates a new tenant; the store's own
`owner`/`admin`s then manage that tenant's information (FR-5). The
`super_owner` administers the *set of tenants*, reached via the **`/admin`
route** (route group `(admin)`, see `architecture/A6`).

Key rule: **do not rename existing roles.** The per-store `owner` stays.
The new role `super_owner` is orthogonal to `account_role` — it is **not**
added to the `account_role` enum (that would re-introduce ambiguity and
couple a platform-wide role to a single tenant). It lives on its own axis.

## 3. Scope

### In scope (must-have)
- FR-1 The `super_owner` role, stored on its own axis (independent of accounts).
- FR-2 Server + DB authorization guard for `super_owner` actions.
- FR-3 Provision a company: create the `Account` **and** its first
  Company Owner atomically.
- FR-4 List companies (platform-wide) for the admin console.
- FR-5 Within a provisioned company, existing invite flow adds
  `admin` / `agent` / `viewer` users — **reused, not rebuilt**
  (`src/lib/auth/invitations.ts`, `src/app/join/[token]/page.tsx`).

### Phase 2 (explicitly out of this spec's must-have, listed for design fit)
- FR-6 Suspend / reactivate a company.
- FR-7 Grant / revoke `super_owner` to another user (with "last super_owner" guard).
- FR-8 Platform-level audit log.

### Non-goals
- A user belonging to **multiple** companies. The one-profile-one-account
  invariant is preserved. (If needed later, that is a separate N:N spec.)
- Billing / plans / quotas per company.

## 4. Functional requirements (detail)

- **FR-1** A user holds the `super_owner` role iff a row exists in a new
  `super_owners` table keyed by `user_id`. This role is **not** an
  `account_role` and does **not** require the user to belong to any company.
- **FR-2** A server helper `requireSuperOwner()` mirrors `requireRole`
  but resolves the `super_owner` role. A SQL function `is_super_owner(uid)`
  backs RLS policies for platform-scoped tables.
- **FR-3** `POST /api/admin/companies` accepts `{ name, ownerEmail,
  ownerFullName }` and, in one transaction / rollback-safe sequence:
  1. verifies caller is `super_owner`;
  2. creates (or validates) the first owner's auth user;
  3. inserts the `accounts` row with `owner_user_id = <that user>`;
  4. inserts the owner's `profiles` row with `account_role = 'owner'`;
  5. dispatches a set-password / magic link to the owner.
- **FR-4** `GET /api/admin/companies` returns all companies with member
  counts and owner contact — `super_owner` only.
- **FR-5** No new work: after provisioning, the Company Owner/admins use
  the existing Settings → Members invite flow to add `admin`/`agent`/`viewer`.

## 5. Non-functional requirements & constraints

- **NFR-1 Tenant isolation must not regress.** `super_owner` access uses a
  *verified* service-role client (same pattern as `requireApiKey`,
  `src/lib/auth/api-context.ts`). Per-account RLS is **never** widened for
  ordinary users.
- **NFR-2** Every existing `getCurrentAccount()` / `requireRole()` code
  path is unchanged. A `super_owner` who is *not* in any company must not
  break those helpers (they still throw `ForbiddenError` for such a user —
  the admin console does not depend on account context).
- **NFR-3** DB changes ship as the next sequential numbered migration
  (convention: `0NN_super_owners.sql`, `0NN+1_company_provisioning.sql`).
  Do not hard-code the number here; use the next free index at implementation.
- **NFR-4** No hard-coded secrets/config. Service-role key comes from the
  existing env wiring behind `supabaseAdmin()` (`src/lib/flows/admin-client`).
- **NFR-5** Each spec/code module < 500 lines.
- **NFR-6** `super_owner` bootstrap (the very first one) is a manual DB
  seed, **not** an app endpoint — no self-service escalation path.

## 6. Edge cases (drive TDD anchors — see Phase 06)

- EC-1 `ownerEmail` already has an auth user / already belongs to a company
  → reject `409 Conflict` (preserves one-account-per-user). Do **not**
  silently attach.
- EC-2 Auth user created but `accounts` insert fails → **roll back** the
  just-created auth user; leave no orphan.
- EC-3 Non-`super_owner` user (valid session, in a company) hits
  `/api/admin/*` → `403 Forbidden`, no data leak.
- EC-4 Unauthenticated request to `/api/admin/*` → `401`.
- EC-5 Duplicate company `name` → allowed (names are not keys).
- EC-6 (Phase 2) Revoking the last `super_owner` → blocked.
- EC-7 Invalid email / missing `name` → `400` with field errors, no writes.

## 7. Module map

| File | Contents |
|------|----------|
| `02_domain_model.md`            | Tables, enum, RLS, migration pseudocode |
| `03_authorization_pseudocode.md`| `is_super_owner`, `requireSuperOwner`, guards |
| `04_provisioning_api_pseudocode.md` | Create/list company endpoints + rollback flow |
| `05_admin_console_ui_pseudocode.md` | Admin console screens & data flow |
| `06_test_anchors.md`            | Consolidated TDD anchors ↔ requirements/edge cases |
