# Phase 05 — Admin Console UI (pseudocode)

Backs FR-4, FR-5, EC-3. A `super_owner`-only console, separate from the
per-company dashboard. Server-authoritative access via
`requireSuperOwner()`; the UI gate (`RequireSuperOwner`, Phase 03 §4) is
UX-only.

> Route-group + layout conventions differ in this Next.js build — read
> `node_modules/next/dist/docs/` before creating the route group.

---

## 1. Route layout (pseudocode)

```
src/app/(admin)/
  layout.tsx            // server: requireSuperOwner() → else redirect /
  admin/
    companies/
      page.tsx          // list (GET /api/admin/companies)
      new/page.tsx      // provisioning form (POST /api/admin/companies)
      [id]/page.tsx     // company detail: members, owner, status
```

`(admin)` is a **separate route group** from `(dashboard)`, so a
`super_owner` with no company never hits the account-scoped dashboard shell
(which calls `getCurrentAccount()` and would 403 them — NFR-2).

```
LAYOUT (admin)/layout.tsx  [server component]:
  try: await requireSuperOwner()
  catch: redirect("/")             // no leak of console existence
  RETURN <AdminShell>{children}</AdminShell>
```

- **TEST:** non-super-owner navigating to `/admin/companies` is redirected (no 200).

## 2. Companies list — `admin/companies/page.tsx`

```
SERVER page():
  { companies } = fetch GET /api/admin/companies
  RENDER:
    Header "Companies"  +  [Button "New company" → /admin/companies/new]
    Table columns: Name | Owner | Members | Created | (Status¹)
    rows → link to /admin/companies/[id]
    emptyState: "No companies yet — provision the first one."
  ¹ Status column Phase 2 only.
```

## 3. Provisioning form — `admin/companies/new/page.tsx`

```
CLIENT form():
  fields: name, ownerFullName, ownerEmail
  onSubmit:
    resp = POST /api/admin/companies { name, ownerFullName, ownerEmail }
    SWITCH resp.status:
      201 → toast "Company created — invite sent to {ownerEmail}"; goto list
      400 → map resp.errors onto field-level messages           (EC-7)
      409 → field error on ownerEmail: "email already in use"   (EC-1)
      403 → toast "Not authorized"                              (EC-3)
      else → toast generic error
```

- **TEST (component):** 409 response renders the email-in-use field error.
- **TEST (component):** 400 with `{errors:{name}}` marks the name field.
- **TEST (component):** 201 clears the form and navigates to the list.

## 4. Company detail — `admin/companies/[id]/page.tsx`

Read-only from the `super_owner` side in must-have scope. Shows:

```
SERVER page(id):
  company = GET /api/admin/companies/:id   // owner + members + counts
  RENDER:
    company.name, owner card (name/email)
    members table: full_name | role | joined_at   (roles: owner/admin/agent/viewer)
    note: "Members are managed by the company's own admins in Settings → Members."
```

This makes FR-5 explicit: **the `super_owner` provisions the company and
its first owner; adding `admin`/`agent`/`viewer` users happens inside the
company** via the existing invite flow (`src/components/settings/
invite-member-dialog.tsx`, `src/lib/auth/invitations.ts`,
`src/app/join/[token]/page.tsx`). No new member-management surface is built
on the `super_owner` side for must-have.

## 5. Navigation

```
- super_owners see an "Admin" entry (gated by <RequireSuperOwner>).
- The entry links to /admin/companies.
- Ordinary company users never see it and are redirected if they deep-link.
```

- **TEST:** sidebar shows "Admin" only when `useSuperOwner()` is true.

## 6. UX copy note (terminology)

Surface the mapping from Phase 01 to end users to avoid the owner/owner
confusion:
- `super_owner` screens say **"Company owner"** for the first provisioned user.
- Company screens keep existing labels ("Owner/Admin/Agent/Viewer").
- The person creating companies is labelled **"Super owner"** in the
  console header — an explicit, unambiguous name distinct from a company's
  own "Owner".
