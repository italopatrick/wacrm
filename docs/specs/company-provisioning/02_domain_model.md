# Phase 02 — Domain Model & Migrations (pseudocode)

Backs FR-1, FR-3, NFR-1, NFR-3. All SQL below is **pseudocode** to guide
the real numbered migrations; column types mirror existing conventions
(`accounts`, `profiles`).

---

## 1. Entities

```
SuperOwner                            (NEW — the `super_owner` role)
  user_id     UUID  PK  → auth.users.id
  granted_by  UUID  NULL → auth.users.id   // who granted (null for seed)
  granted_at  TIMESTAMPTZ  default now()

Account  (existing — "company", unchanged shape)
  id, name, owner_user_id, created_at, updated_at
  // Phase 2 only: status ENUM('active','suspended') default 'active'

Profile  (existing — unchanged)
  user_id, account_id, account_role, full_name, email, ...
```

`SuperOwner` is **orthogonal** to `Account`/`Profile`: a `super_owner`
need not have a profile or belong to any company. This is what lets the
role exist "above" companies without breaking the one-profile-one-account
invariant (NFR-2). Membership in this table **is** the `super_owner` role —
it is a named role, deliberately kept off the `account_role` enum so it is
never ambiguous with a company's own `owner`.

## 2. TypeScript type (add to `src/types/index.ts`)

```ts
// TEST: SuperOwner type is exported and has no account_id field
export interface SuperOwner {
  user_id: string;
  granted_by: string | null;
  granted_at: string;
}

// Admin-console view row (FR-4). Not a table — a query projection.
export interface CompanySummary {
  id: string;
  name: string;
  owner: { user_id: string; full_name: string; email: string | null };
  member_count: number;
  created_at: string;
  // status: 'active' | 'suspended';   // Phase 2
}
```

## 3. Migration A — `0NN_super_owners.sql` (pseudocode)

```sql
CREATE TABLE super_owners (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- Authority predicate, mirrors is_account_member() style so JS + SQL agree.
CREATE FUNCTION is_super_owner(uid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT EXISTS (SELECT 1 FROM super_owners WHERE user_id = uid);
  $$;

ALTER TABLE super_owners ENABLE ROW LEVEL SECURITY;

-- Only super_owners may read the roster; nobody may self-insert.
-- Writes go exclusively through the verified service-role path (FR-2),
-- so there is intentionally NO INSERT/UPDATE/DELETE policy for end users.
CREATE POLICY super_owners_select ON super_owners
  FOR SELECT USING (is_super_owner(auth.uid()));
```

- **TEST:** `is_super_owner(seeded_uid)` → true; random uid → false.
- **TEST:** a non-super-owner `SELECT * FROM super_owners` returns 0 rows (RLS).
- **TEST:** an end-user `INSERT INTO super_owners` is denied (no policy).

### Bootstrap (NFR-6) — seed, not endpoint

```sql
-- Run once, manually, out of band. The FIRST super_owner only.
-- No app code path creates the first super_owner.
INSERT INTO super_owners (user_id, granted_by)
VALUES ('<existing-auth-user-uuid>', NULL);
```

## 4. Migration B — company-provisioning RLS (pseudocode)

Provisioning writes via the **service-role client** after app-level
`super_owner` verification (FR-2 / NFR-1), so it bypasses RLS by design —
the same trust model as `requireApiKey` in `src/lib/auth/api-context.ts`.
We therefore do **not** add "super_owner can write accounts" RLS policies
for the anon/authenticated roles; that would widen the blast radius.
Instead we add only **read** visibility for the admin console:

```sql
-- super_owners can read ALL companies (for the console listing).
-- Ordinary members keep their existing per-account SELECT policy.
CREATE POLICY accounts_super_owner_read ON accounts
  FOR SELECT USING (is_super_owner(auth.uid()));

-- Same for profiles, so the console can show members/owners across companies.
CREATE POLICY profiles_super_owner_read ON profiles
  FOR SELECT USING (is_super_owner(auth.uid()));
```

- **TEST:** super_owner `SELECT` sees companies from ≥2 distinct accounts.
- **TEST:** a company `agent` still sees only their own account (no regression).

### Phase 2 additions (not required now)

```sql
-- ALTER TABLE accounts ADD COLUMN status text NOT NULL DEFAULT 'active'
--   CHECK (status IN ('active','suspended'));
-- Sign-in / API-key middleware would reject when status='suspended'.
```

## 5. Invariants to preserve (assert in tests)

- INV-1 One profile ↔ one account (`profiles.account_id` stays scalar & NOT NULL).
- INV-2 `accounts.owner_user_id` stays NOT NULL — provisioning always
  supplies an owner (Phase 04), never creates an ownerless company.
- INV-3 The `super_owner` role never appears in `account_role`; the enum
  `{owner, admin, agent, viewer}` is unchanged.
- INV-4 `is_super_owner` (backed by the `super_owners` table) is the
  **only** authority source for the role — no `super_owner` string is
  stored on `profiles`.
