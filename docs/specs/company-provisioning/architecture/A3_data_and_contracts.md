# A3 — Data Model, Migrations & API Contracts

Authoritative schema (backend-owned migrations) and the HTTP contract the
frontend codes against. SQL is pseudocode for the real numbered migrations
in `ulabchat-backend`.

---

## 1. Migrations (owned by the backend repo)

Follow the backend's existing migration numbering. Two migrations:

### M-A `NNN_super_owners.sql`

```sql
CREATE TABLE super_owners (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION is_super_owner(uid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT EXISTS (SELECT 1 FROM super_owners WHERE user_id = uid);
  $$;

ALTER TABLE super_owners ENABLE ROW LEVEL SECURITY;
-- Read-only to super_owners; NO write policy (writes are ops-seed only, ADR-5).
CREATE POLICY super_owners_select ON super_owners
  FOR SELECT USING (is_super_owner(auth.uid()));
```

> Note: the Go backend checks membership with a **direct query**
> (`SELECT ... FROM super_owners WHERE user_id=$1`) over its service-role
> pgx connection — it does not depend on the RLS policy. The policy exists
> only to keep the browser from reading the roster (defense in depth).

### M-B `NNN+1_company_provisioning.sql`

No schema change to `accounts`/`profiles` for must-have (INV-1..3 hold).
Optional Phase-2 column:

```sql
-- Phase 2 only:
-- ALTER TABLE accounts ADD COLUMN status text NOT NULL DEFAULT 'active'
--   CHECK (status IN ('active','suspended'));
```

**Deliberately NOT added** (ADR-2): browser-facing `is_super_owner` read
policies on `accounts`/`profiles`. Cross-tenant reads for the console are
served by the Go backend, keeping the anon/authenticated browser client
scoped to a single tenant as today (NFR-1).

### Bootstrap seed (ADR-5, ops runbook)

```sql
-- Run once, manually, against the target DB. First super_owner only.
INSERT INTO super_owners (user_id, granted_by)
VALUES ('<existing-auth-user-uuid>', NULL);
```

## 2. sqlc queries (backend)

```sql
-- name: IsSuperOwner :one
SELECT EXISTS (SELECT 1 FROM super_owners WHERE user_id = $1);

-- name: InsertAccount :one
INSERT INTO accounts (name, owner_user_id) VALUES ($1, $2)
RETURNING id, name, created_at;

-- name: InsertOwnerProfile :exec
INSERT INTO profiles (user_id, account_id, account_role, full_name, email)
VALUES ($1, $2, 'owner', $3, $4);

-- name: ListCompanies :many
SELECT a.id, a.name, a.created_at, a.owner_user_id,
       (SELECT count(*) FROM profiles p WHERE p.account_id = a.id) AS member_count
FROM accounts a
ORDER BY a.created_at DESC;
```

## 3. HTTP contract (`/api/admin/*`)

All requests carry `Authorization: Bearer <supabase jwt>`. All behind
`RequireSuperOwner` except `GET /api/admin/me`.

### 3.1 `POST /api/admin/companies`

Request:
```json
{ "name": "Acme Ltda", "ownerEmail": "ana@acme.com", "ownerFullName": "Ana Souza" }
```
Validation (mirror of spec Phase 04 §1; pure, unit-tested in Go):
- `name`: trimmed, 1..120 chars.
- `ownerEmail`: valid email, lowercased.
- `ownerFullName`: non-empty.

Responses:
| Status | Body | When |
|--------|------|------|
| 201 | `{ "company": { "id","name","owner": {"user_id","email"} } }` | created |
| 400 | `{ "error":"validation", "fields": { "name":"…" } }` | invalid input (EC-7) |
| 409 | `{ "error":"A user with this email already exists" }` | EC-1 |
| 401 | `{ "error":"unauthorized" }` | no/invalid JWT |
| 403 | `{ "error":"super_owner role required" }` | not super_owner (EC-3) |
| 500 | `{ "error":"internal" }` | unexpected / rolled back (EC-2) |

### 3.2 `GET /api/admin/companies`
```json
200 { "companies": [
  { "id":"…","name":"Acme Ltda",
    "owner": { "user_id":"…","full_name":"Ana Souza","email":"ana@acme.com" },
    "member_count": 3, "created_at":"2026-07-04T…Z" }
] }
```
403 for non-super-owner.

### 3.3 `GET /api/admin/companies/{id}`
```json
200 { "company": { "id","name","created_at",
  "owner": {…},
  "members": [ { "full_name","role","joined_at" } ] } }
```
404 if id unknown. 403 for non-super-owner.

### 3.4 `GET /api/admin/me` (JWT-only introspection)
```json
200 { "isSuperOwner": true|false }
```
Never 403 — it is how the UI decides whether to show the console.

## 4. Invariants asserted by tests

- INV-1 `profiles.account_id` stays scalar & NOT NULL.
- INV-2 `accounts.owner_user_id` NOT NULL — provisioning always supplies it.
- INV-3 `account_role` enum unchanged `{owner,admin,agent,viewer}`.
- INV-4 `super_owners` membership is the sole source of the role.

## 5. Frontend response types (this repo)

```ts
// src/lib/admin/companies.ts
export interface CompanySummary {
  id: string; name: string; created_at: string; member_count: number;
  owner: { user_id: string; full_name: string; email: string | null };
}
export interface CreateCompanyInput {
  name: string; ownerEmail: string; ownerFullName: string;
}
// apiFetch('/api/admin/companies', ...) wrappers return these.
```
