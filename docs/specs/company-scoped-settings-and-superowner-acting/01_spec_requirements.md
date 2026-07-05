# Company-scoped Settings + super_owner "Act-as-Company" — Specification

> SPARC Specification phase. Two related capabilities on top of the existing
> multi-tenant model (`accounts` = company/store, `profiles.account_id` +
> `account_role` = membership source of truth):
>
> **A. Settings isolated per company** — every configuration belongs to exactly
> one company and is never readable/writable from another company's context.
>
> **B. super_owner transacts per company** — a platform `super_owner` can enter
> a chosen company's context and perform account-scoped operations (as a
> platform admin, without being a member), fully audited.

## 1. Context (what already exists)

- **Tenancy**: migration `017_account_sharing` introduced `accounts`, the
  `is_account_member(account_id, min_role)` SECURITY DEFINER helper, added
  `account_id` (+ `account_role`) to every domain row, and **replaced every
  `auth.uid() = user_id` RLS policy with membership policies**
  (`is_account_member(account_id, …)`).
- **Store status**: `035_store_status` adds `accounts.status`
  (`active` / `suspended`); suspended stores 403 for members.
- **Config today**: WhatsApp/Meta config is per-account (`whatsapp_config`
  has `UNIQUE(account_id)`; `036_per_store_webhook` added per-store
  `app_id` / encrypted `app_secret`). AI, webhooks, api-keys, automations,
  templates, pipelines, notifications live under `internal/domain/*`.
- **Request context**: `auth.SessionContext.GetAccountID()` returns the
  caller's single account (from `GetMembership(userID)`); all dashboard
  handlers scope by it.
- **super_owner**: `auth.SuperOwnerContext.GetAccountID()` returns the **empty
  UUID** — a super_owner has *no* company context and today can only use the
  `/admin` CRUD (create / suspend / reactivate / grant / revoke).

## 2. Objectives

- **A**: guarantee — by DB (RLS) **and** app (query scoping) — that no
  configuration leaks or is mutated across company boundaries; close any
  residual per-`user_id` scoping.
- **B**: let a verified super_owner obtain a **per-request acting-account
  context** for any existing company and run the same account-scoped
  operations an `owner` could, with every mutation written to an audit log.

## 3. Functional Requirements — A (settings isolation)

- **FR-A1** Every settings/config table has a `NOT NULL account_id`
  referencing `accounts(id)`; no settings row may exist without one (INV-A1).
- **FR-A2** RLS on every settings table uses
  `is_account_member(account_id, <min_role>)` for select/insert/update/delete;
  **no `auth.uid() = user_id` policy remains** on a settings table.
- **FR-A3** Backend reads/writes scope every settings query by the request's
  `GetAccountID()`. A handler MUST NOT accept a caller-supplied account id
  that differs from its context (INV-A2).
- **FR-A4** Uniqueness that was global or per-user becomes **per-account**
  (e.g. one WhatsApp `phone_number_id` per account; api-key name unique per
  account; one AI config per account).
- **FR-A5** A settings GET returns only the current company's values; a member
  of company B, or the same physical user switched to company B, sees a
  disjoint set from company A.
- **FR-A6** Write operations require the minimum role the table declares
  (e.g. `admin`/`owner` for Meta secrets); reads require membership.

## 4. Functional Requirements — B (super_owner acting)

- **FR-B1** A verified super_owner MAY obtain an acting-account context for any
  **existing** account, identified by id (transport in §Interface: header
  `X-Act-As-Account: <uuid>`).
- **FR-B2** The acting context authorizes the account-scoped operations an
  `owner` of that account could perform (or an explicitly listed subset),
  enforced by a **backend guard**, not by membership RLS.
- **FR-B3** A **non**-super_owner presenting `X-Act-As-Account` is ignored: the
  header has effect only after `IsSuperOwner(caller)` passes (INV-B2).
- **FR-B4** Every acting **mutation** writes an audit record: actor
  (super_owner user id), target account id, action, request id, timestamp.
- **FR-B5** Acting on a non-existent account → 404; on a **suspended** account
  → allowed for super_owner (inspection/repair) but audited.
- **FR-B6** Existing protections still apply (admin rate-limit, auth, request
  id); acting does not bypass them.

## 5. Non-Functional Requirements

- **NFR-1 (defense in depth)** Isolation holds even if one layer is bypassed:
  RLS blocks cross-tenant SQL *and* the app never queries by `user_id`.
- **NFR-2 (no secrets in spec/code)** Encrypted config (e.g. `app_secret`)
  stays encrypted at rest; specs/pseudocode carry no secret or config literals.
- **NFR-3 (per-request context)** Acting context is request-scoped; concurrent
  requests with different acting accounts never share state (EC-B3).
- **NFR-4 (loud migration)** Backfills fail closed on ambiguity, never guess.
- **NFR-5 (auditable)** No super_owner acting-mutation is silent (INV-B3).

## 6. Edge Cases

- **EC-A1** Legacy rows scoped only by `user_id` (pre-017) → backfill to
  `account_id`; migration **fails loudly** if a `user_id` maps to 0 or >1
  accounts (NFR-4).
- **EC-A2** User with no account (super_owner without a store) → settings
  endpoints return 403 / empty, **never** a global view.
- **EC-A3** Shared account (multiple members) → all members see the **same
  single** company config; isolation is per-company, not per-user.
- **EC-A4** Suspended company → settings **reads** may render for display;
  **writes** blocked for members (super_owner acting may still write, audited).
- **EC-B1** super_owner who also owns a company → acting context **overrides**
  their own membership for that request; no bleed between the two accounts.
- **EC-B2** Malformed acting id → 400; unknown id → 404.
- **EC-B3** Concurrent acting requests with different targets stay isolated.
- **EC-B4** super_owner status revoked mid-session → next acting request fails
  (re-checked per request, INV-B1).

## 7. Invariants

- **INV-A1** No settings row without `account_id`.
- **INV-A2** No code path selects/writes settings by `user_id`.
- **INV-B1** Acting context is set **only** after `IsSuperOwner(caller)` passes.
- **INV-B2** A regular member can never widen scope via the acting header.
- **INV-B3** Every acting mutation has a matching audit row.

## 8. Out of Scope

- New settings *features* (only isolation of existing config).
- UI redesign of the settings rail (behavior/scoping only).
- Cross-company aggregation/reporting for super_owners.
- Delegated non-super_owner impersonation.

## 9. Traceability

Pseudocode: `02_pseudocode_config_isolation.md` (A),
`03_pseudocode_superowner_acting.md` (B). TDD anchors: `04_test_anchors.md`.
