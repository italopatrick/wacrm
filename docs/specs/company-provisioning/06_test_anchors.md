# Phase 06 — Consolidated TDD Anchors

Traceability from requirements/edge cases (Phase 01) to concrete tests.
Follow the repo convention: co-located `*.test.ts` next to the unit
(as in `src/lib/auth/roles.test.ts`, `account.test.ts`). Integration
tests for RLS run against a Supabase test project.

The platform tier is the **`super_owner`** role (see Phase 01 terminology).

---

## 1. Pure units (no I/O) — fastest, most anchors here

| ID | Test | Ref |
|----|------|-----|
| U-1 | `parseCreateCompanyInput` rejects blank name → `errors.name` | EC-7 |
| U-2 | rejects invalid email → `errors.ownerEmail` | EC-7 |
| U-3 | rejects blank ownerFullName → `errors.ownerFullName` | EC-7 |
| U-4 | valid input → Ok, name trimmed, email lowercased | FR-3 |
| U-5 | `toCompanySummary` maps rows → owner + member_count | FR-4 |
| U-6 | `PlatformContext` / `SuperOwner` types have no `account_id` | INV-3 |

## 2. Authorization guard — `platform.ts` (`super_owner`)

| ID | Test | Ref |
|----|------|-----|
| A-1 | no session → `UnauthorizedError` (401) | EC-4 |
| A-2 | authenticated non-super-owner → `ForbiddenError` (403) | EC-3 |
| A-3 | authenticated `super_owner` → ctx with `userId` + service client | FR-2 |
| A-4 | `super_owner` with no profile/account still resolves | NFR-2 |
| A-5 | `requireSuperOwner` never calls `getCurrentAccount` | NFR-2 |

## 3. Provisioning API — `POST /api/admin/companies`

| ID | Test | Ref |
|----|------|-----|
| P-1 | happy path → 201; account + profile(owner) + auth user exist | FR-3 |
| P-2 | `owner_user_id` == created user id | INV-2 |
| P-3 | duplicate email → 409, zero writes | EC-1 |
| P-4 | account insert fails → auth user deleted (no orphan) | EC-2 |
| P-5 | profile insert fails → account + auth user rolled back | EC-2 |
| P-6 | caller not `super_owner` → 403, zero writes | EC-3 |
| P-7 | invalid body → 400 field errors, zero writes | EC-7 |
| P-8 | duplicate company name → second create still 201 | EC-5 |

## 4. Listing / introspection

| ID | Test | Ref |
|----|------|-----|
| L-1 | `GET /companies` as `super_owner` → companies across ≥2 accounts | FR-4 |
| L-2 | `member_count` per account correct | FR-4 |
| L-3 | `GET /companies` as non-super-owner → 403 | EC-3 |
| L-4 | `GET /admin/me` normal user → 200 `{ isSuperOwner:false }` | Phase 03 |

## 5. RLS / DB (integration)

| ID | Test | Ref |
|----|------|-----|
| R-1 | `is_super_owner(seeded_uid)` true; random uid false | FR-1 |
| R-2 | non-super-owner `SELECT super_owners` → 0 rows | NFR-1 |
| R-3 | end-user `INSERT super_owners` denied (no write policy) | NFR-1/NFR-6 |
| R-4 | `super_owner` reads accounts from ≥2 tenants | FR-4 |
| R-5 | company `agent` still sees only own account (no regression) | NFR-1 |
| R-6 | `profiles.account_id` remains scalar & NOT NULL | INV-1 |
| R-7 | `account_role` enum unchanged `{owner,admin,agent,viewer}` | INV-3 |

## 6. UI components

| ID | Test | Ref |
|----|------|-----|
| C-1 | `(admin)/layout` redirects non-super-owner | EC-3 |
| C-2 | new-company form: 409 → email-in-use field error | EC-1 |
| C-3 | new-company form: 400 → per-field errors | EC-7 |
| C-4 | new-company form: 201 → clears + navigates | FR-3 |
| C-5 | sidebar "Admin" entry visible only when `isSuperOwner` | FR-4 |

## 7. Regression guard (must stay green)

- G-1 Existing `roles.test.ts`, `account.test.ts`, `api-context.test.ts`,
  `invitations.test.ts` unchanged and passing (no account-tier changes).
- G-2 `getCurrentAccount()` behaviour identical for normal users.

## 8. Definition of done (spec exit criteria)

- [ ] All U/A/P/L/R/C anchors implemented and green.
- [ ] No regression in G-1/G-2.
- [ ] Migrations applied with next sequential numbers; RLS verified.
- [ ] First `super_owner` seeded manually (NFR-6); no self-serve escalation.
- [ ] `node_modules/next/dist/docs/` consulted for route-handler + route-group
      APIs before implementation.
