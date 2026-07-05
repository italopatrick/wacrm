# Owner Magic-Link Onboarding — Pseudocode

> Backend-only change (repo `ulabchat-backend`). Frontend is already wired;
> see Phase 03 for the regression anchors that keep it that way.
>
> Language-neutral pseudocode. Actual signatures for `generateLink` /
> route handlers must be confirmed against the backend SDK before coding.

---

## Module A — build the onboarding redirect target

Pure, unit-testable string builder. No I/O.

```
CONST OWNER_ONBOARD_NEXT = "/reset-password"        // same-origin path only

FUNCTION ownerOnboardRedirect(appBaseUrl) -> string:
  // appBaseUrl comes from config (Module C). Tolerate a trailing slash
  // the same way inviteUrl() does in the frontend.
  trimmed = stripTrailingSlashes(appBaseUrl)         // "https://app.x/" -> "https://app.x"
  IF trimmed is empty:
    RAISE ConfigError("APP_BASE_URL is required for owner onboarding links")

  encodedNext = urlEncode(OWNER_ONBOARD_NEXT)        // "/reset-password" -> "%2Freset-password"
  RETURN trimmed + "/auth/callback?next=" + encodedNext
```

**TDD anchors — Module A**
- TEST: `"https://app.x"` → `"https://app.x/auth/callback?next=%2Freset-password"`.
- TEST: trailing slash `"https://app.x/"` → same result (slash trimmed).
- TEST: multiple trailing slashes `"https://app.x///"` → single, correct join.
- TEST: empty / whitespace base → raises `ConfigError` (no silent default).
- TEST: `next` is URL-encoded exactly once (no double-encoding on re-call).

---

## Module B — dispatch the invite (provisioning, step 5)

Replaces the bare `generateLink({ type: "invite", email })` call. Stays
**fire-and-forget**: log-and-continue on failure (FR/NFR-4).

```
FUNCTION dispatchOwnerOnboarding(admin, ownerEmail, config):
  redirectTo = ownerOnboardRedirect(config.appBaseUrl)     // Module A

  result = admin.auth.admin.generateLink({
    type: "invite",
    email: ownerEmail,
    options: { redirectTo: redirectTo },
  })

  IF result is Error:
    log.warn("owner onboarding link failed; company already provisioned",
             email=ownerEmail, err=result.error)
    RETURN                                                  // do NOT roll back
  // send via the existing mail path (unchanged)
  sendOnboardingEmail(ownerEmail, result.actionLink)
```

Call site (unchanged control flow around it):

```
// docs/specs/company-provisioning/04_provisioning_api_pseudocode.md, step 5
// BEFORE: admin.auth.admin.generateLink({ type: "invite", email: input.ownerEmail })
// AFTER:
dispatchOwnerOnboarding(admin, input.ownerEmail, config)
```

**TDD anchors — Module B**
- TEST: happy path → `generateLink` invoked with
  `type:"invite"`, `email:ownerEmail`, `options.redirectTo` == Module A output.
- TEST: `generateLink` returns error → logged, function returns normally,
  **no rollback / no thrown error** (provisioning still 201).
- TEST: `config.appBaseUrl` missing → `ConfigError` surfaces from Module A
  (fail loud at dispatch; provisioning writes already committed — see caveat).

> **Caveat for implementers:** if `appBaseUrl` can be absent at runtime,
> validate it at process start-up (config load), not at dispatch — a missing
> base URL is a deployment error, and step 5 must never throw after the
> account/profile inserts have committed. Prefer start-up validation so
> Module B's `ConfigError` path is unreachable in production.

---

## Module C — resend-invite reuses the same dispatch (FR-3)

```
// POST /api/admin/companies/{id}/resend-invite
HANDLER resendInvite(id):
  ctx   = requireSuperOwner()
  owner = loadOwnerEmailForCompany(id)          // existing lookup
  IF owner not found: RETURN 404

  dispatchOwnerOnboarding(ctx.admin, owner.email, ctx.config)   // Module B
  RETURN 204
```

**TDD anchors — Module C**
- TEST: resend for an existing company → `generateLink` called with the same
  `redirectTo` as first-time provisioning (no drift between the two paths).
- TEST: resend for unknown company id → 404, `generateLink` not called.

---

## Module D — configuration surface (Module A input)

```
// Backend config load (start-up). Reuse an EXISTING public-app-URL env if one
// is already defined; do not introduce a redundant variable.
config.appBaseUrl = env("<EXISTING_PUBLIC_APP_URL_VAR>")     // confirm name in backend
ASSERT nonEmpty(config.appBaseUrl)                           // fail start-up if unset
```

**Operational (not code) — checklist, tracked in TASKS:**
- Supabase **redirect allow-list** includes `<APP_BASE_URL>/auth/callback`
  (wildcard acceptable per Supabase rules).
- Supabase **Site URL** is the real app origin.
- Invite email template's action URL routes through the generated action link
  (default `{{ .ConfirmationURL }}` is fine — the `redirectTo` is embedded).

**TDD anchors — Module D**
- TEST: config load with the env unset → start-up fails with a clear message.
- TEST: config load with a valid URL → `config.appBaseUrl` populated, trimmed
  lazily by Module A (Module D stores raw).

---

## Data / control flow (end to end)

```
super_owner
   │  POST /api/admin/companies { name, ownerEmail, ownerFullName }
   ▼
backend: createUser(email_confirm:false) → accounts → profiles(owner)
   │
   ▼  step 5
dispatchOwnerOnboarding()
   │  generateLink(type:"invite", redirectTo = APP/auth/callback?next=%2Freset-password)
   ▼
owner's inbox: action link  ──click──►  Supabase /verify  ──redirect──►
   │
   ▼  APP/auth/callback?next=/reset-password  (#access_token=… implicit)
frontend /auth/callback  → setSession → router.replace("/reset-password")
   │
   ▼
frontend /reset-password  → updateUser({ password })  → success → /login
```
