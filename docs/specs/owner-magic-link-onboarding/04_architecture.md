# Owner Magic-Link Onboarding — Architecture

> SPARC Architecture phase. Builds on `01_spec_requirements.md` +
> `02_pseudocode.md`. Captures component boundaries, interface contracts,
> the runtime sequence, failure modes, and the decision log (ADRs).

## 1. Architectural overview

This is a **minimal, config-driven** change layered onto the existing
company-provisioning flow. It is deliberately **not** a new service, table, or
state machine — the onboarding "state" already lives in Supabase Auth (the
owner user exists with no confirmed password) and the frontend already owns the
set-password UX. The architecture's job is to connect those two facts with a
single, correct redirect target.

```
┌─────────────────────────────────────────────────────────────────┐
│  ulabchat-backend (Go)                                           │
│                                                                   │
│  Config (start-up) ── appBaseUrl ──►  OnboardingLink (Module A)   │
│        │  validate nonEmpty                    │ pure builder     │
│        ▼                                        ▼                 │
│  Provisioning handler ──► dispatchOwnerOnboarding (Module B)      │
│  Resend handler ────────► (same dispatch, Module C)              │
│                                   │                              │
│                                   ▼  generateLink(redirectTo)    │
└───────────────────────────────────┼──────────────────────────────┘
                                     ▼
                            Supabase Auth  (issues single-use invite token)
                                     ▼  email (existing mail path)
                              owner inbox
                                     ▼  click
┌─────────────────────────────────────────────────────────────────┐
│  ulabchat (Next.js) — UNCHANGED logic (INV-1)                    │
│  /auth/callback  ──(safeNext)──►  /reset-password                │
│                                        │ updateUser({password})   │
│                                        ▼  /login                 │
└─────────────────────────────────────────────────────────────────┘
```

**Boundary principle:** the backend owns *where the link points*; the frontend
owns *what happens when it lands*. This change touches only the first.

## 2. Component responsibilities

| Component | Repo | Responsibility | New? |
|-----------|------|----------------|------|
| `OnboardingLink` builder (Module A) | backend | Pure `appBaseUrl → redirectTo` string | **new** (small pure fn) |
| `dispatchOwnerOnboarding` (Module B) | backend | Call `generateLink` w/ redirectTo, fire-and-forget mail | replaces bare step-5 call |
| Resend handler wiring (Module C) | backend | Reuse Module B for `resend-invite` | edit existing handler |
| Config loader (Module D) | backend | Read + validate `appBaseUrl` at start-up | edit existing config |
| `/auth/callback` | frontend | Session from link, forward to `next` | **unchanged** |
| `/reset-password` | frontend | Set password via `updateUser` | **unchanged** |
| `safeNext` | frontend | Same-origin redirect guard | **relocate only** (ADR-3) |

## 3. Interface contracts

### 3.1 Backend — builder (Module A)

```
// Pure. Deterministic. No I/O. The ONLY place the "/reset-password"
// literal and the "/auth/callback" path are assembled.
ownerOnboardRedirect(appBaseUrl: string) -> string
  precondition:  appBaseUrl non-empty (else ConfigError)
  postcondition: "<trimmed base>/auth/callback?next=%2Freset-password"
  invariant:     output is absolute; next is a same-origin path, encoded once
```

### 3.2 Backend — dispatch (Module B)

```
dispatchOwnerOnboarding(admin, ownerEmail: string, config) -> void
  effects:  generateLink({ type:"invite", email, options:{ redirectTo } })
            → existing mail path
  errors:   never throws to the caller for a mail/link failure
            (log-and-continue; provisioning stays 201) — NFR-4
  depends:  ownerOnboardRedirect(config.appBaseUrl)
```

**Contract with Supabase `generateLink`:** the `redirectTo` value is embedded
in the issued action link's `redirect_to`. After the user verifies, Supabase
redirects to `redirect_to`, appending the session transport
(`#access_token=…` for admin-issued invites). Nested query (`?next=…`) is
preserved through the round-trip. No PKCE verifier is available for
admin-generated invites → implicit transport is expected (already handled by
`/auth/callback`).

### 3.3 Backend — config (Module D)

```
config.appBaseUrl : string   // from an EXISTING public-app-URL env var
                             // (name TBD in ulabchat-backend — see §7 Q1)
start-up assertion: nonEmpty(config.appBaseUrl) else fail fast
storage: raw (trailing slash tolerated; Module A trims lazily)
```

### 3.4 Frontend — stable contract (already implemented)

```
safeNext(raw: string|null) -> string
  "/reset-password"      -> "/reset-password"
  "https://evil.tld"     -> "/dashboard"     (absolute rejected)
  "//evil.tld"           -> "/dashboard"     (protocol-relative rejected)
  null                   -> "/dashboard"
```

## 4. Runtime sequence

```
super_owner            backend                 Supabase Auth        owner browser
    │  POST /companies    │                          │                   │
    ├────────────────────►│ createUser(confirm:false)│                   │
    │                     ├─────────────────────────►│                   │
    │                     │ accounts + profiles(owner)│                  │
    │                     │ dispatchOwnerOnboarding() │                   │
    │                     ├── generateLink(redirectTo)►│                  │
    │  201 {company}      │◄── action_link ───────────┤                   │
    │◄────────────────────┤ send email (existing)     │                   │
    │                     │                           │   email w/ link   │
    │                     │                           ├──────────────────►│
    │                     │                           │   click ◄─────────┤
    │                     │                    /verify │◄──────────────────┤
    │                     │        302 → APP/auth/callback?next=/reset-password#access_token
    │                     │                           ├──────────────────►│
    │                     │            /auth/callback: setSession → replace("/reset-password")
    │                     │            /reset-password: updateUser({password}) → /login
```

## 5. Failure modes & handling

| Failure | Detection | Behavior | Spec ref |
|---------|-----------|----------|----------|
| `appBaseUrl` unset | start-up assertion | process fails to boot (loud) | FR-2 / D-1 |
| `generateLink` errors | Module B result check | logged, provisioning still 201 | NFR-4 / B-2 |
| Mail send fails | existing mail path | log-and-continue; use resend or password-reset | NFR-4 |
| Link expired / reused | frontend `getSession()` empty | `/reset-password` invalid-link state → `/forgot-password` | EC-1 / F-6 |
| Tampered `next` | `safeNext` guard | falls back to `/dashboard` (no off-origin) | EC-2 / F-2..4 |
| Base URL trailing slash | Module A trim | normalized before join | EC-4 / A-2 |

**Design consequence:** provisioning is **never** blocked by the onboarding
link. The company is durable after step 4; step 5 is best-effort. Recovery
paths (resend, forgot-password) fully cover a dropped link.

## 6. Decision log (ADRs)

**ADR-1 — Magic link over temporary password.**
Chosen. No plaintext secret in email, native token expiry, reuses existing
`/auth/callback` + `/reset-password`, no first-login gate to build. Rejected
temp-password (weaker; requires `must_change_password` flag + middleware +
cleanup endpoint). See conversation analysis.

**ADR-2 — `redirectTo` in code, not only in the Supabase template.**
Chosen. Passing `options.redirectTo` to `generateLink` keeps the target
versioned and reproducible across environments (avoids the manual-config trap
in `company-provisioning/TASKS.md:59-62`). The email template stays default;
allow-list config is still required but is a coarse gate, not the source of the
path.

**ADR-3 — Extract `safeNext` to `src/lib/auth/safe-next.ts`.**
Recommended. Currently private inside `auth/callback/page.tsx`. Extraction is
behavior-preserving (verbatim move + re-import) and makes F-1..F-4 unit-testable
without a DOM, hardening the open-redirect guard that this feature now depends
on. This is the **only** permitted frontend edit and does not alter runtime
logic (honors INV-1's intent). *Pending user confirmation — see §7 Q2.*

**ADR-4 — Reuse one dispatch for provision + resend.**
Chosen. `dispatchOwnerOnboarding` is the single call site for both paths so the
`redirectTo` cannot drift between first invite and re-invite (FR-3 / C-1).

**ADR-5 — Validate config at start-up, not at dispatch.**
Chosen. A missing `appBaseUrl` is a deployment error; failing at boot prevents
step 5 from throwing after account/profile inserts have committed.

## 7. Open questions (block implementation)

- **Q1:** Exact env var name in `ulabchat-backend` holding the public app URL
  (Module D binds to it; do not introduce a duplicate).
- **Q2:** Approve ADR-3 (extract `safeNext`) vs. cover F-1..F-4 via a component
  test with no file move.
- **Q3:** Confirm the backend mail path + `generateLink` SDK signature so
  Module B maps to real calls.

## 8. What this architecture explicitly avoids

- No new DB columns, tables, or migrations.
- No `must_change_password` flag, middleware gate, or cleanup endpoint.
- No change to member invites (`/join/<token>`).
- No new backend service or queue — dispatch stays inline + fire-and-forget.
