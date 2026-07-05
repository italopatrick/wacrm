# Phase 04 — Provisioning API (pseudocode)

> ⚠️ **Layer correction (see `architecture/A1`, `A2`, `A3`).** These
> endpoints live in the **Go backend** (`ulabchat-backend`), not in
> `src/app/api/admin/` on the frontend. The frontend only calls them via
> `apiFetch('/api/admin/...')`. The request/response **contract, status
> codes, validation rules, and rollback semantics below are authoritative**
> — `architecture/A2 §1.3` and `A3 §3` express them in Go (chi + pgx). The
> `SECURITY DEFINER` RPC note in §2 is superseded by a native pgx
> transaction (ADR-4).

Backs FR-3, FR-4, EC-1, EC-2, EC-5, EC-7, INV-2. All routes require the
`super_owner` role (Phase 03) and use the shared error envelope.

---

## 1. Input validation (module `src/lib/admin/company-input.ts`)

Validate at the boundary (repo rule). Pure + unit-testable, no I/O.

```
FUNCTION parseCreateCompanyInput(body) -> Result<CreateCompanyInput, FieldErrors>:
  name         = trim(body.name)
  ownerEmail   = lowercase(trim(body.ownerEmail))
  ownerFullName= trim(body.ownerFullName)
  errors = {}
  IF name.length == 0 OR name.length > 120:   errors.name = "required, ≤120"
  IF not isValidEmail(ownerEmail):            errors.ownerEmail = "invalid email"
  IF ownerFullName.length == 0:               errors.ownerFullName = "required"
  IF errors not empty: RETURN Err(errors)          // EC-7 → 400
  RETURN Ok({ name, ownerEmail, ownerFullName })
```

- **TEST:** blank name / bad email / blank owner name → Err with that field.
- **TEST:** valid payload → Ok, values trimmed & email lowercased.

## 2. `POST /api/admin/companies` — provision (FR-3)

Rollback-safe ordering: the auth user is created first, then account, then
profile. If any later step fails we **undo** the earlier ones (EC-2). All
writes use `ctx.supabase` (service role).

```
HANDLER POST(request):
  try:
    ctx = await requireSuperOwner()                        // 401/403
    input = parseCreateCompanyInput(await request.json())
    IF input is Err: RETURN 400 { errors: input.errors }   // EC-7

    admin = ctx.supabase                                    // service role

    // --- Step 1: guard against existing user (EC-1) ---
    existing = admin.auth.admin.getUserByEmail(input.ownerEmail)
    IF existing exists:
      RETURN 409 { error: "A user with this email already exists" }  // EC-1

    // --- Step 2: create the owner auth user ---
    { user, error } = admin.auth.admin.createUser({
      email: input.ownerEmail,
      email_confirm: false,          // they'll confirm via the magic link
      user_metadata: { full_name: input.ownerFullName },
    })
    IF error: RETURN 500 (nothing to roll back yet)
    ownerId = user.id

    // --- Step 3: create the company (INV-2: owner supplied up front) ---
    { data: account, error: accErr } = admin.from("accounts").insert({
      name: input.name,
      owner_user_id: ownerId,
    }).select("id, name").single()
    IF accErr:
      admin.auth.admin.deleteUser(ownerId)   // ROLLBACK step 2  (EC-2)
      RETURN 500

    // --- Step 4: create the owner's profile (account_role='owner') ---
    { error: profErr } = admin.from("profiles").insert({
      user_id: ownerId,
      account_id: account.id,
      account_role: "owner",
      full_name: input.ownerFullName,
      email: input.ownerEmail,
    })
    IF profErr:
      admin.from("accounts").delete().eq("id", account.id) // ROLLBACK step 3
      admin.auth.admin.deleteUser(ownerId)                 // ROLLBACK step 2
      RETURN 500

    // --- Step 5: dispatch onboarding link (fire-and-forget) ---
    admin.auth.admin.generateLink({ type: "invite", email: input.ownerEmail })
      → send via existing mail path; log-and-continue on failure
      (company already exists; owner can use password-reset if the mail drops)

    RETURN 201 {
      company: { id: account.id, name: account.name,
                 owner: { user_id: ownerId, email: input.ownerEmail } }
    }
  catch (err):
    RETURN toErrorResponse(err)
```

> **Atomicity caveat for implementers:** Supabase has no single transaction
> spanning `auth.admin.createUser` + table inserts. The compensating-rollback
> sequence above is the contract. **Preferred hardening:** move steps 3–4 into
> a `SECURITY DEFINER` Postgres RPC `provision_company(owner_id, name, ...)`
> so the two table inserts are one real transaction; the handler then only
> compensates the auth-user creation (step 2) if the RPC fails. Consult
> `node_modules/next/dist/docs/` for the correct route-handler signature first.

### TDD anchors — POST
- **TEST:** happy path → 201; `accounts`, `profiles(role=owner)` rows exist,
  owner auth user exists, `owner_user_id` matches (INV-2).
- **TEST:** duplicate email → 409, **no** account/profile created (EC-1).
- **TEST:** account insert fails → owner auth user deleted, no orphan (EC-2).
- **TEST:** profile insert fails → account **and** auth user rolled back (EC-2).
- **TEST:** caller not `super_owner` → 403, zero writes (EC-3).
- **TEST:** invalid body → 400 field errors, zero writes (EC-7).
- **TEST:** duplicate company name allowed → second create also 201 (EC-5).

## 3. `GET /api/admin/companies` — list (FR-4)

```
HANDLER GET(request):
  try:
    ctx = await requireSuperOwner()
    // super_owner read RLS (Phase 02) lets service role / super_owner read all.
    rows = ctx.supabase.from("accounts")
      .select("id, name, created_at, owner_user_id, profiles(count)")
      .order("created_at", desc)
    companies = rows.map(toCompanySummary)   // hydrate owner + member_count
    RETURN 200 { companies }
  catch (err): RETURN toErrorResponse(err)
```

- **TEST:** `super_owner` → 200 with companies across ≥2 accounts.
- **TEST:** `member_count` reflects profiles per account.
- **TEST:** non-super-owner → 403.

## 4. `GET /api/admin/me` — introspection (Phase 03 §4)

```
HANDLER GET():
  ssr = await createClient(); { user } = ssr.auth.getUser()
  IF no user: RETURN 200 { isSuperOwner: false }   // not an authz gate
  isSuper = ssr.rpc("is_super_owner", { uid: user.id })
  RETURN 200 { isSuperOwner: isSuper }
```

## 5. Phase 2 endpoints (design only, not in must-have)
- `POST /api/admin/companies/:id/suspend` → set `status='suspended'` (FR-6).
- `POST /api/admin/super-owners` / `DELETE …/:userId` → grant/revoke
  `super_owner`, with EC-6 "cannot remove the last super_owner" guard.
