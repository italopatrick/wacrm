# Pseudocode — A. Company-scoped Settings Isolation

> SPARC Pseudocode phase for Feature A. Modular; each module lists its TDD
> anchors (IDs consolidated in `04_test_anchors.md`). No secret/config literals.

## Module A0 — Settings inventory (discovery, precedes code)

Enumerate every table that stores *configuration* (not transactional data) and
record its current scoping. Output feeds A1/A2.

```
SETTINGS_TABLES := [
  whatsapp_config, ai_reply_config, ai_knowledge, webhook_endpoints,
  api_keys, automations, notification_prefs, message_templates,
  pipelines, account_default_currency, ... (verify against migrations)
]

for each T in SETTINGS_TABLES:
  record: has_account_id?(T), rls_policy_kind(T)  // "membership" | "user_id" | "none"
  classify: OK            if has_account_id and rls == membership
            NEEDS_COLUMN  if not has_account_id
            NEEDS_RLS     if rls != membership
```

- **TDD A0-1**: a repo assertion/test lists SETTINGS_TABLES and fails if any is
  classified `NEEDS_COLUMN` or `NEEDS_RLS` (guards against regressions).

## Module A1 — Schema: account_id on every settings table (migration)

```
migration add_account_id_to_settings:
  for each T in SETTINGS_TABLES where not has_account_id(T):
    ALTER TABLE T ADD COLUMN account_id UUID
    -- backfill from the row's user_id → that user's single account
    UPDATE T SET account_id = (
      SELECT p.account_id FROM profiles p WHERE p.id = T.user_id
    )
    -- EC-A1 fail-closed: abort if any row still NULL or user maps to !=1 account
    ASSERT no_row_with_null_account_id(T)
    ASSERT no_user_maps_to_multiple_accounts()
    ALTER TABLE T ALTER COLUMN account_id SET NOT NULL
    ALTER TABLE T ADD FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
```

- **TDD A1-1**: after migration, `SELECT count(*) FROM T WHERE account_id IS NULL`
  == 0 for every settings table.
- **TDD A1-2**: migration on a fixture where `user_id` maps to two accounts →
  **aborts** with a clear message; no partial state (EC-A1 / NFR-4).
- **TDD A1-3**: dropping an account cascades its settings rows (no orphans).

## Module A2 — RLS: membership-only on settings (migration)

```
migration rls_settings_membership:
  for each T in SETTINGS_TABLES:
    DROP POLICY IF EXISTS <legacy user_id policies> ON T
    CREATE POLICY T_select ON T FOR SELECT USING (is_account_member(account_id))
    CREATE POLICY T_insert ON T FOR INSERT WITH CHECK (is_account_member(account_id, write_role(T)))
    CREATE POLICY T_update ON T FOR UPDATE USING     (is_account_member(account_id, write_role(T)))
    CREATE POLICY T_delete ON T FOR DELETE USING     (is_account_member(account_id, write_role(T)))
  // write_role(T): 'admin' for secretful config (Meta app), else 'agent'/'admin' per table
```

- **TDD A2-1**: with RLS on, member of account A `SELECT`ing account B's config
  row returns **0 rows** (cross-tenant read blocked).
- **TDD A2-2**: a `viewer`/`agent` cannot write a table whose `write_role` is
  `admin` (WITH CHECK denies).
- **TDD A2-3**: no settings table retains an `auth.uid() = user_id` policy
  (catalog query over `pg_policies`).

## Module A3 — App layer: scope every settings query by context account

```
// Repository/query rule (sqlc): settings queries take account_id as a param,
// NEVER user_id.
GetSettings(ctx, accountID)          -> row filtered by account_id
UpsertSettings(ctx, accountID, data) -> writes with account_id = accountID

// Handler rule:
handleGetSettings(req):
  accountID := auth.FromContext(req).GetAccountID()
  if isEmpty(accountID): return 403            // EC-A2 (no global view)
  return GetSettings(ctx, accountID)

handleUpsertSettings(req):
  accountID := auth.FromContext(req).GetAccountID()
  if isEmpty(accountID): return 403
  requireRole(req, write_role)                 // FR-A6
  if accountSuspended(accountID) and not actingSuperOwner(req): return 403  // EC-A4
  return UpsertSettings(ctx, accountID, body)
```

- **TDD A3-1**: `GetSettings` filters strictly by the passed account id; a
  handler cannot pass an id other than `GetAccountID()` (no account param in
  the request body/query is honored) (FR-A3 / INV-A2).
- **TDD A3-2**: empty context account → 403, not a global/empty-scoped read
  (EC-A2).
- **TDD A3-3**: agent writing an admin-only settings table → 403 (FR-A6).
- **TDD A3-4**: suspended account, member write → 403; super_owner-acting write
  → allowed + audited (EC-A4, cross-ref Feature B).

## Module A4 — Per-account uniqueness (migration + query)

```
// Replace global/per-user unique constraints with per-account.
UNIQUE (account_id, phone_number_id)          // whatsapp_config
UNIQUE (account_id, name)                       // api_keys
UNIQUE (account_id) where single-row config     // ai_reply_config
```

- **TDD A4-1**: two accounts may each register the **same** logical name /
  number (no cross-account collision).
- **TDD A4-2**: the same account cannot create two rows violating its
  per-account unique key (conflict surfaced as 409).

## Module A5 — Regression fence

- **TDD A5-1**: a table-driven test iterates SETTINGS_TABLES asserting, for
  each: has `account_id NOT NULL`, membership RLS present, no user_id policy —
  a single fence covering INV-A1/INV-A2 as the inventory grows.
