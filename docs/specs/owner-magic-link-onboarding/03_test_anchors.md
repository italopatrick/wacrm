# Owner Magic-Link Onboarding — Test Anchors

> Consolidated, traceable TDD anchors. IDs map back to FR/EC/INV in
> `01_spec_requirements.md`. Backend tests live in `ulabchat-backend`;
> frontend anchors are **regression pins** in this repo (INV-1).

## 1. Backend — redirect builder (Module A) → FR-1, FR-2, EC-4, INV-2

| ID | Assertion | Ref |
|----|-----------|-----|
| A-1 | `"https://app.x"` → `.../auth/callback?next=%2Freset-password` | FR-1 |
| A-2 | trailing slash trimmed → identical output | EC-4 |
| A-3 | multiple trailing slashes collapse to one join | EC-4 |
| A-4 | empty/whitespace base → `ConfigError`, no default | FR-2, NFR-2 |
| A-5 | `next` encoded exactly once (idempotent) | INV-2 |

## 2. Backend — invite dispatch (Module B) → FR-1, FR-4, NFR-4

| ID | Assertion | Ref |
|----|-----------|-----|
| B-1 | `generateLink` called with `type:"invite"`, `email`, `options.redirectTo` == A-1 output | FR-1 |
| B-2 | `generateLink` error → logged, returns normally, **no rollback**, provisioning still 201 | NFR-4 |
| B-3 | provisioning happy path still creates account+profile(owner)+auth user (unchanged) | — |

## 3. Backend — resend-invite (Module C) → FR-3

| ID | Assertion | Ref |
|----|-----------|-----|
| C-1 | resend → `generateLink` `redirectTo` equals first-provision `redirectTo` (no drift) | FR-3 |
| C-2 | resend for unknown company id → 404, `generateLink` not called | FR-3 |

## 4. Backend — config (Module D) → FR-2, NFR-2

| ID | Assertion | Ref |
|----|-----------|-----|
| D-1 | start-up with app-base-url env unset → fails loudly with clear message | FR-2 |
| D-2 | start-up with valid url → config populated (stored raw, trimmed by A) | FR-2 |

## 5. Frontend — regression pins (INV-1, INV-3) → EC-1, EC-2, FR-4, FR-5

These lock existing behavior in **this** repo. They must pass **without**
editing `auth/callback/page.tsx` or `reset-password/page.tsx`.

| ID | Assertion | Ref |
|----|-----------|-----|
| F-1 | `safeNext("/reset-password")` returns `"/reset-password"` | FR-4 |
| F-2 | `safeNext("https://evil.tld")` returns `"/dashboard"` (open-redirect blocked) | EC-2 |
| F-3 | `safeNext("//evil.tld")` returns `"/dashboard"` (protocol-relative blocked) | EC-2 |
| F-4 | `safeNext(null)` returns `"/dashboard"` | EC-2 |
| F-5 | callback with a session → `router.replace(next)` fires exactly once | FR-4 |
| F-6 | `/reset-password` with no recovery session → renders "invalid link" state, links to `/forgot-password` | EC-1 |
| F-7 | `/reset-password` valid session + matching passwords → `updateUser({password})` called, success UI shown | FR-5 |
| F-8 | `/reset-password` too-short or mismatched passwords → error, `updateUser` NOT called | FR-5 |

> `safeNext` is currently a private function inside
> `src/app/auth/callback/page.tsx`. To make F-1..F-4 unit-testable without a
> DOM, extract it verbatim into a tiny pure helper (e.g.
> `src/lib/auth/safe-next.ts`) and import it back — this is the **only**
> permitted frontend edit, and it is behavior-preserving (INV-1 intent holds:
> no logic change, just relocation). If extraction is undesired, cover
> F-1..F-4 via the component test instead.

## 6. Manual / integration verification (Inbucket)

| ID | Steps | Expected |
|----|-------|----------|
| M-1 | Provision a store; open the captured invite in Inbucket; click the link | Browser lands on `/reset-password` (not `/` or `/dashboard`) with an active session |
| M-2 | Set a password on that page | Success UI; can then sign in at `/login` with the chosen password |
| M-3 | Let the link expire, then open it | `/reset-password` shows the invalid-link state |
| M-4 | Use "Resend invite" from the store detail; click the new link | Same `/reset-password` landing as M-1 |

## 7. Traceability summary

- FR-1 → A-1, B-1, M-1
- FR-2 → A-4, D-1, D-2
- FR-3 → C-1, C-2, M-4
- FR-4 → F-1, F-5, M-1
- FR-5 → F-7, F-8, M-2
- NFR-4 → B-2
- EC-1 → F-6, M-3
- EC-2 → F-2, F-3, F-4
- EC-4 → A-2, A-3
- INV-1 → §5 header (no edits to callback/reset-password logic)
- INV-3 → whole suite contains no password-generation path
