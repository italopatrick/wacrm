# A6 — Frontend Implementation Plan (`ulabchat-frontend`, this repo)

Concrete plan for the `super_owner` admin console, grounded in the actual
frontend patterns (Next.js 16 App Router, client-side auth gating via
`AuthProvider`/`useAuth`, `apiFetch` → Go backend, next-intl). Paths and
patterns below were read from the repo.

> **Correction to A2 §3.1 (read first).** A2 proposed a **server-side**
> gate in `(admin)/layout.tsx` calling `apiServer('/api/admin/me')`. This
> repo has **no server-side `apiFetch`** and gates the whole authed app
> **client-side** (`(dashboard)/layout.tsx` is a thin server component that
> only exports noindex metadata and renders a **client** `DashboardShell`
> which redirects via `useAuth`). To stay consistent we mirror that:
> `(admin)/layout.tsx` = server metadata shell → **client `AdminShell`**
> that redirects using `useAuth` + a new `useSuperOwner()` hook. Real
> authorization is still enforced by the Go backend on every `/api/admin/*`
> call (A5 §4); the client gate is UX only.

---

## 0. Facts the plan relies on

- **F-a** `apiFetch('/api/admin/...')` (`src/lib/api/client.ts`) attaches
  the Supabase `Bearer` JWT and is **client-side only**. The rewrite
  (`next.config.ts`) forwards `/api/*` to the Go backend.
- **F-b** Auth gating pattern: server `layout.tsx` (noindex metadata) →
  client `Shell` using `useAuth()` → `router.push('/login')` when no user.
- **F-c** `useAuth()` is **account-scoped**: it fetches the `profiles` row
  and exposes `accountRole`. A `super_owner` **may have no company** →
  `profile`/`accountRole` come back `null`. The admin console must **not**
  depend on `useAuth`'s account fields — only on `user`/`loading`.
- **F-d** `middleware.ts` redirects unauthenticated users only for paths in
  the `protectedPaths` array — which does **not** include `/admin`. Must add it.
- **F-e** i18n via next-intl (`useTranslations`). New UI strings go in
  `src/messages/*` catalogs.
- **F-f** Role UI gating helper exists (`RequireRole`,
  `src/components/auth/require-role.tsx`) — mirror it for `RequireSuperOwner`.

## 1. Route group — `src/app/(admin)/`

Separate group from `(dashboard)`, so a companyless `super_owner` never
loads the account-scoped dashboard shell.

```
src/app/(admin)/
  layout.tsx                        // server: noindex metadata → <AdminShell>
  admin-shell.tsx                   // client: gate + chrome (mirror dashboard-shell.tsx)
  admin/companies/page.tsx          // list
  admin/companies/new/page.tsx      // provisioning form
  admin/companies/[id]/page.tsx     // detail (read-only)
```

### 1.1 `layout.tsx` (server component — mirror dashboard)

```tsx
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true, /* … */ } };
export default function AdminLayout({ children }) {
  return <AdminShell>{children}</AdminShell>;
}
```

### 1.2 `admin-shell.tsx` (client — mirror `DashboardShellInner`)

```tsx
"use client";
function AdminShellInner({ children }) {
  const { user, loading } = useAuth();                 // session only
  const { isSuperOwner, loading: soLoading } = useSuperOwner();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.push("/login");                       // not signed in
    else if (!loading && !soLoading && user && !isSuperOwner) router.push("/dashboard"); // signed in, not super_owner (EC-3 UX)
  }, [user, loading, isSuperOwner, soLoading, router]);
  if (loading || soLoading) return <Spinner/>;
  if (!user || !isSuperOwner) return null;             // fail closed while redirecting
  return <AdminChrome>{children}</AdminChrome>;
}
export function AdminShell({ children }) {
  return (
    <AuthProvider>
      <SuperOwnerProvider>
        <AdminShellInner>{children}</AdminShellInner>
      </SuperOwnerProvider>
    </AuthProvider>
  );
}
```

## 2. Hook + provider — `src/hooks/use-super-owner.tsx` (NEW)

Mirror `AuthProvider`'s "fetch once, share via context" shape, but tiny.

```tsx
"use client";
interface SuperOwnerCtx { isSuperOwner: boolean; loading: boolean; }
// SuperOwnerProvider: on mount, apiFetch('/api/admin/me') -> { isSuperOwner }.
// Caches result; exposes { isSuperOwner, loading }. Fails closed to false.
export function SuperOwnerProvider({ children }: { children: ReactNode }) { /* … */ }
export function useSuperOwner(): SuperOwnerCtx { /* useContext, fail-closed default */ }
```
- **TEST:** `/api/admin/me` 200 `{isSuperOwner:true}` → hook true; network error → false (fail closed).

## 3. Client gate + nav entry

### 3.1 `src/components/auth/require-super-owner.tsx` (NEW — mirror RequireRole)

```tsx
"use client";
export function RequireSuperOwner({ children, fallback = null }) {
  const { isSuperOwner, loading } = useSuperOwner();
  if (loading) return <>{fallback}</>;          // fail closed while unknown
  return isSuperOwner ? <>{children}</> : <>{fallback}</>;
}
```

### 3.2 Dashboard nav entry (optional, gated)

For a `super_owner` who *also* has a company, add a bottom-nav link to the
console in `src/components/layout/sidebar.tsx`, wrapped so ordinary users
never see it. Because `useSuperOwner` needs its provider, either (a) mount
`SuperOwnerProvider` in `DashboardShell` too, or (b) keep the console
reachable only via `/admin` and skip the nav entry for must-have.
**Recommendation:** (b) for must-have (companyless super_owners are the
common case and reach `/admin` directly); add the gated nav link in a
follow-up if operators want it.

## 4. Data layer — `src/lib/admin/companies.ts` (NEW)

```ts
export interface CompanySummary { id: string; name: string; created_at: string;
  member_count: number; owner: { user_id: string; full_name: string; email: string | null }; }
export interface CreateCompanyInput { name: string; ownerEmail: string; ownerFullName: string; }

export async function listCompanies(): Promise<CompanySummary[]>          // GET  /api/admin/companies
export async function getCompany(id: string): Promise<CompanyDetail>       // GET  /api/admin/companies/{id}
export async function createCompany(in: CreateCompanyInput): Promise<...>  // POST /api/admin/companies
```
Each wraps `apiFetch`, checks `res.ok`, and surfaces status for the
form's 400/409 branches (§5.2). Contract is A3 §3 (authoritative).

## 5. Screens

### 5.1 List — `admin/companies/page.tsx` ("use client")
- `useEffect` → `listCompanies()`; render a table
  `Name | Owner | Members | Created`, row → `/admin/companies/{id}`.
- Header action `New company` → `/admin/companies/new`. Empty state copy.

### 5.2 New — `admin/companies/new/page.tsx` ("use client")
- Fields `name`, `ownerFullName`, `ownerEmail`; submit → `createCompany`.
- Branch on status: `201` toast + `router.push('/admin/companies')`;
  `400` → per-field errors; `409` → email-in-use on `ownerEmail`; `403`
  → toast "Not authorized". Reuse existing form primitives / toast.
- **TEST (component):** 409 renders email-in-use; 400 maps fields; 201 navigates.

### 5.3 Detail — `admin/companies/[id]/page.tsx` ("use client")
- `getCompany(id)`; show owner card + members table
  `Name | Role | Joined`. Note: *"Members are managed by the company's own
  admins in Settings → Members."* (FR-5 — no member CRUD here.)

## 6. Middleware change — `src/middleware.ts`

Add `/admin` to `protectedPaths` so unauthenticated deep-links to the
console redirect to `/login` at the edge (defence in depth; the client
shell also redirects):

```ts
const protectedPaths = ['/dashboard', …, '/notifications', '/admin'];
```
No change needed for `/api/admin/*` — it's rewritten to the Go backend,
which enforces `super_owner` (A5 §4). The matcher already covers `/admin`.

## 7. i18n — `src/messages/*`

Add an `admin` namespace (labels: "Companies", "New company", "Company
owner", field labels, toasts, "Super owner"). Keep the terminology from
spec Phase 01 §6 — surface **"Super owner"** and **"Company owner"**
distinctly to avoid the owner/owner ambiguity.

## 8. Decisions specific to the frontend

- **ADR-F1 — Post-login routing for companyless super_owners.** Middleware
  sends any signed-in user hitting `/login` to `/dashboard`, which is
  account-scoped and would render poorly for a super_owner with no company.
  **Decision:** keep must-have simple — super_owners navigate to `/admin`
  directly (bookmark/entry link). A follow-up may add a redirect: if
  `useSuperOwner` is true and `useAuth` has no `accountId`, route
  `/dashboard → /admin`. Documented so it's a conscious gap, not a bug.
- **ADR-F2 — Client-side gate (not server).** Matches the repo's existing
  pattern (F-b) and avoids inventing a server-side JWT-forwarding fetch.
  Authorization is enforced server-side by the Go backend regardless.

## 9. Rollout order (checklist)

1. [ ] `src/lib/admin/companies.ts` (types + apiFetch wrappers).
2. [ ] `src/hooks/use-super-owner.tsx` (provider + hook) (+ test).
3. [ ] `src/components/auth/require-super-owner.tsx`.
4. [ ] `(admin)/layout.tsx` + `admin-shell.tsx`.
5. [ ] `admin/companies/{page,new/page,[id]/page}.tsx`.
6. [ ] Add `/admin` to `middleware.ts` `protectedPaths`.
7. [ ] `src/messages/*` admin strings.
8. [ ] Component tests (form branches, hook fail-closed); `npm run build && npm test`.
9. [ ] Manual e2e vs a running Go backend (A5) with a seeded super_owner.

## 10. Dependency on the backend

This plan assumes the Go endpoints from **A5** exist:
`POST/GET /api/admin/companies`, `GET /api/admin/companies/{id}`,
`GET /api/admin/me`. Build order: backend (A5) first, then this.
```
