# Test Anchors — Company-scoped Settings + super_owner Acting

> Consolidated, traceable TDD anchors. IDs map back to FR/EC/INV in
> `01_spec_requirements.md`. Backend tests live in `ulabchat-backend`
> (Go unit + integration against local Postgres); RLS anchors run against the
> DB with a member JWT / service role as noted.

## A. Settings isolation

| ID | Assertion | Ref |
|----|-----------|-----|
| A0-1 | Inventory test fails if any settings table is `NEEDS_COLUMN`/`NEEDS_RLS` | FR-A1/A2 |
| A1-1 | Post-migration, `account_id IS NULL` count == 0 for every settings table | FR-A1/INV-A1 |
| A1-2 | Migration aborts (no partial state) when a `user_id` maps to ≠1 account | EC-A1/NFR-4 |
| A1-3 | Deleting an account cascades its settings rows (no orphans) | FR-A1 |
| A2-1 | Member of A selecting B's config row → 0 rows (cross-tenant read blocked) | FR-A2/A5 |
| A2-2 | `agent`/`viewer` write to an `admin`-write table → denied (WITH CHECK) | FR-A6 |
| A2-3 | No settings table retains an `auth.uid() = user_id` policy | INV-A2 |
| A3-1 | Query scopes strictly by passed account id; no request-supplied id honored | FR-A3/INV-A2 |
| A3-2 | Empty context account → 403, never a global view | EC-A2 |
| A3-3 | Agent writing admin-only settings → 403 | FR-A6 |
| A3-4 | Suspended account: member write 403; super_owner-acting write ok+audited | EC-A4 |
| A4-1 | Two accounts may register the same logical name/number | FR-A4 |
| A4-2 | Same account violating its per-account unique key → 409 | FR-A4 |
| A5-1 | Table-driven fence over SETTINGS_TABLES (account_id + membership RLS) | INV-A1/A2 |

## B. super_owner acting

| ID | Assertion | Ref |
|----|-----------|-----|
| B1-1 | `SuperOwnerActingContext.GetAccountID()` == acting id (not empty) | FR-B1 |
| B2-1 | super_owner + valid `X-Act-As-Account` → downstream account == acting id | FR-B1 |
| B2-2 | non-super_owner + header → ignored, context unchanged | FR-B3/INV-B2 |
| B2-3 | Malformed header → 400; unknown account → 404 | EC-B2/FR-B5 |
| B2-4 | super_owner owning a store acts on another → context = acting, not own | EC-B1 |
| B2-5 | Suspended target → acting still resolves | FR-B5 |
| B3-1 | Acting write touches only the target account's rows | INV-B2 |
| B3-2 | `resolveExec` with unrecognized context → Deny | INV-B1 |
| B4-1 | Acting mutation → exactly one audit row (actor, target, action, req id) | FR-B4/INV-B3 |
| B4-2 | Audit metadata carries no secret values (redacted) | NFR-2 |
| B4-3 | Member (non-acting) mutation → no platform audit row | FR-B4 |
| B4-4 | Failed acting mutation → per decision D-B4 (no row, or `*_failed`) | D-B4 |
| B5-1 | Same `/dash/settings` route serves member vs acting, disjoint config | FR-A5/B2 |
| B5-2 | Acting request still subject to admin rate-limit / auth | FR-B6 |

## Cross-feature

| ID | Assertion | Ref |
|----|-----------|-----|
| X-1 | A super_owner with no store gets no settings via member path, but does via acting | EC-A2/FR-B1 |
| X-2 | Revoking super_owner mid-session → next acting request fails | EC-B4/INV-B1 |

## Traceability summary

- FR-A1 → A0-1, A1-1, A1-3, A5-1
- FR-A2 → A0-1, A2-1, A2-3, A5-1
- FR-A3 → A3-1
- FR-A4 → A4-1, A4-2
- FR-A5 → A2-1, B5-1
- FR-A6 → A2-2, A3-3
- FR-B1 → B1-1, B2-1, X-1
- FR-B2 → B3-1, B5-1
- FR-B3 → B2-2
- FR-B4 → B4-1, B4-3
- FR-B5 → B2-3, B2-5
- FR-B6 → B5-2
- EC-A1 → A1-2 · EC-A2 → A3-2, X-1 · EC-A4 → A3-4
- EC-B1 → B2-4 · EC-B2 → B2-3 · EC-B4 → X-2
- INV-A1 → A1-1, A5-1 · INV-A2 → A2-3, A3-1, A5-1
- INV-B1 → B3-2, X-2 · INV-B2 → B2-2, B3-1 · INV-B3 → B4-1
- NFR-2 → B4-2 · NFR-4 → A1-2
