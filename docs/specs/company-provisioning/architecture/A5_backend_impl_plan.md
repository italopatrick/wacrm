# A5 — Backend Implementation Plan (`ulabchat-backend`)

Concrete, file-by-file plan grounded in the **actual** backend
(`github.com/ulabapps/ulabchat-backend`, Go 1.25, chi v5, pgx v5, sqlc).
Paths, patterns, and the migration number below were read from the repo,
not assumed.

> **Correction to A2/A3 (important — read first).** The backend has an
> `AFTER INSERT ON auth.users` trigger `on_auth_user_created →
> handle_new_user()` (migration `017_account_sharing.sql:659`). It creates
> the `accounts` row **and** the `profiles(account_role='owner')` row
> **synchronously, in the same transaction** as the GoTrue user insert.
> Therefore provisioning must **NOT** manually `INSERT accounts` /
> `INSERT profiles` (that duplicates the account). The corrected flow is:
> **create the auth user → the trigger provisions the company+owner → then
> `UPDATE accounts.name` to the desired company name.** This supersedes
> A2 §1.3 and the `InsertAccount`/`InsertOwnerProfile` queries in A3 §2.

---

## 0. Facts the plan relies on

- **F-a** Backend routes carry **no `/api` prefix** — nginx / the Next
  rewrite strips it (`router.go`; `next.config.ts`). Register `/admin/...`.
- **F-b** The backend connects via `DATABASE_URL` as a privileged role, so
  its queries **bypass RLS**. The `is_super_owner` check is a plain
  `SELECT`; RLS on `super_owners` only guards the browser (defence in depth).
- **F-c** `middleware.AuthSession` resolves a session by `GetMembership`
  and returns **401 when the user has no company** (`auth_session.go`). A
  `super_owner` may have no company → the admin routes need a **dedicated
  middleware**, not `AuthSession`.
- **F-d** JWT verification is `supahttp.JWTVerifier.Verify(ctx, raw) →
  *Claims` (`Claims.Subject` = user id). Reuse it.
- **F-e** There is **no GoTrue Admin client yet** (`internal/supahttp/`
  has only `jwt.go`). One must be added; `config` already exposes
  `SupabaseURL` + `SupabaseServiceRoleKey`.
- **F-f** Schema lives in **two** places: canonical migrations in
  `supabase/migrations/` (applied via `supabase db reset`) **and**
  `store/schema/` which sqlc reads for codegen (`sqlc.yaml`). New DDL goes
  in **both**. Next migration number is **034** (latest is `033`).
- **F-g** Handlers are constructor funcs returning `http.HandlerFunc`,
  taking `*db.Queries` (and `cfg.*`), wired in `NewRouter`. Error envelope
  is `respond.*` (`{ "error": "..." }`).

## 1. Database — migration `034` + sqlc schema

### 1.1 `supabase/migrations/034_super_owners.sql`

```sql
CREATE TABLE super_owners (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_super_owner(uid uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM super_owners WHERE user_id = uid);
  $$;
ALTER FUNCTION public.is_super_owner(uuid) OWNER TO postgres;

ALTER TABLE super_owners ENABLE ROW LEVEL SECURITY;
-- Read-only to super_owners; NO write policy (writes are ops-seed only).
CREATE POLICY super_owners_select ON super_owners
  FOR SELECT USING (is_super_owner(auth.uid()));
```
Mirror the style of `017`/`018`/`032` (SECURITY DEFINER, `OWNER TO
postgres`, explicit grants). **No** browser-facing cross-tenant read policy
on `accounts`/`profiles` (ADR-2) — the console reads through the backend.

### 1.2 `store/schema/02_tables.sql` (append) — for sqlc only

```sql
CREATE TABLE super_owners (
  user_id    uuid PRIMARY KEY,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now()
);
```
(sqlc needs the table shape; the function/RLS are runtime-only, not needed
in the sqlc schema.)

### 1.3 Seed (ops runbook, ADR-5) — not an endpoint

```sql
INSERT INTO super_owners (user_id, granted_by)
VALUES ('<existing-auth-user-uuid>', NULL);
```

## 2. sqlc queries — `store/queries/admin.sql`

```sql
-- name: IsSuperOwner :one
SELECT EXISTS (SELECT 1 FROM super_owners WHERE user_id = $1);

-- name: SetAccountNameByOwner :exec
UPDATE accounts SET name = $2 WHERE owner_user_id = $1;

-- name: ListCompanies :many
SELECT a.id, a.name, a.created_at, a.owner_user_id,
       po.full_name AS owner_full_name, po.email AS owner_email,
       (SELECT count(*) FROM profiles p WHERE p.account_id = a.id) AS member_count
FROM accounts a
JOIN profiles po ON po.user_id = a.owner_user_id
ORDER BY a.created_at DESC;

-- name: GetCompany :one
SELECT a.id, a.name, a.created_at, a.owner_user_id,
       po.full_name AS owner_full_name, po.email AS owner_email
FROM accounts a
JOIN profiles po ON po.user_id = a.owner_user_id
WHERE a.id = $1;

-- name: ListCompanyMembers :many
SELECT p.full_name, p.account_role, p.created_at AS joined_at
FROM profiles p WHERE p.account_id = $1
ORDER BY p.created_at;
```
Then `make gen-sqlc` to regenerate `store/gen`.

## 3. GoTrue Admin client — `internal/supahttp/gotrue_admin.go` (NEW)

Thin HTTP client over the Supabase Auth admin API, keyed by the service
role. No SDK; use `net/http` like `jwt.go`/`metaapi`.

```go
type AdminClient struct { baseURL, serviceKey string; hc *http.Client }

func NewAdminClient(supabaseURL, serviceKey string) *AdminClient

// CreateUser POSTs /auth/v1/admin/users {email, email_confirm:false,
// user_metadata:{full_name}}. Returns the new user id.
// Maps GoTrue 422 "email exists" → ErrEmailExists (EC-1).
func (c *AdminClient) CreateUser(ctx, email, fullName string) (userID string, err error)

// SendInvite POSTs /auth/v1/admin/generate_link {type:"invite", email}
// (or /auth/v1/invite). Fire-and-forget; caller logs on error.
func (c *AdminClient) SendInvite(ctx, email string) error

var ErrEmailExists = errors.New("gotrue: email already registered")
```
Auth headers on every call: `apikey: <serviceKey>` and
`Authorization: Bearer <serviceKey>`. Unit-test the request shaping +
422→ErrEmailExists mapping with an `httptest.Server`.

> Rollback note (ADR-4 revised): because `accounts.owner_user_id` is
> `ON DELETE RESTRICT` (`017:66`), you **cannot** delete the auth user once
> the trigger has created its account. So there is no "delete user"
> compensation. The only post-create step is the name `UPDATE`, which is
> effectively infallible against the same DB; on the rare failure, log and
> still return 201 (company exists with its default name) — see §5 EC-2'.

## 4. Authorization middleware — `internal/httpx/middleware/auth_super_owner.go` (NEW)

```go
type SuperOwnerQuerier interface {
  IsSuperOwner(ctx context.Context, userID pgtype.UUID) (bool, error)
}

// AuthSuperOwner validates the Bearer JWT and requires super_owner.
// Deliberately does NOT call GetMembership (a super_owner may have no
// company). Mirrors AuthSession's JWT handling.
func AuthSuperOwner(verifier *supahttp.JWTVerifier, q SuperOwnerQuerier) func(http.Handler) http.Handler {
  return func(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
      raw := bearerToken(r)
      if raw == "" { respond.Unauthorized(w); return }        // EC-4 (401)
      claims, err := verifier.Verify(r.Context(), raw)
      if err != nil { respond.Unauthorized(w); return }        // 401
      var uid pgtype.UUID
      if err := uid.Scan(claims.Subject); err != nil { respond.Unauthorized(w); return }
      ok, err := q.IsSuperOwner(r.Context(), uid)
      if err != nil { respond.InternalError(w); return }
      if !ok { respond.Forbidden(w); return }                  // EC-3 (403)
      ctx := auth.WithSuperOwner(r.Context(), uid)             // optional ctx
      next.ServeHTTP(w, r.WithContext(ctx))
    })
  }
}
```
Add a `SuperOwnerContext{UserID}` + `WithSuperOwner`/`SuperOwnerFromContext`
to `internal/auth/context.go` (mirror the existing context types).
`bearerToken` is already package-private in the middleware package — reuse.

- **TEST** (`auth_super_owner_test.go`): missing/invalid token → 401;
  valid non-super-owner → 403; super_owner → next; super_owner with no
  membership → still passes (the differentiator vs `AuthSession`).

## 5. Domain + handlers — `internal/domain/companies/` + `internal/httpx/handlers/admin/`

### 5.1 Input (pure, unit-tested) — `internal/domain/companies/input.go`

```go
type CreateCompanyInput struct { Name, OwnerEmail, OwnerFullName string }
func ParseCreateCompany(raw []byte) (CreateCompanyInput, map[string]string, error)
//  name: trim, 1..120 ; ownerEmail: valid + lowercased ; ownerFullName: non-empty
```
- **TEST:** blank name / bad email / blank owner → field error (EC-7).

### 5.2 Service — `internal/domain/companies/service.go`

```go
func Provision(ctx, admin AdminAPI, q Querier, in CreateCompanyInput) (Company, error) {
  ownerID, err := admin.CreateUser(ctx, in.OwnerEmail, in.OwnerFullName)
  if errors.Is(err, supahttp.ErrEmailExists) { return Company{}, ErrConflict } // EC-1
  if err != nil { return Company{}, err }
  // Trigger already created account+owner profile. Rename to company name:
  if err := q.SetAccountNameByOwner(ctx, ownerID, in.Name); err != nil {
    slog.Error("provision: rename failed (company persists w/ default name)", "err", err)
    // EC-2': non-fatal — see §3 rollback note. Still return the company.
  }
  go admin.SendInvite(context.WithoutCancel(ctx), in.OwnerEmail) // fire-and-forget
  return loadCompanyByOwner(ctx, q, ownerID, in), nil
}
```

### 5.3 Handlers — `internal/httpx/handlers/admin/handler.go`

```go
func CreateCompany(admin *supahttp.AdminClient, q *db.Queries) http.HandlerFunc
func ListCompanies(q *db.Queries) http.HandlerFunc          // 200 {companies:[…]}
func GetCompany(q *db.Queries) http.HandlerFunc             // 200 {company:{…}} / 404
func Me(verifier *supahttp.JWTVerifier, q *db.Queries) http.HandlerFunc // {isSuperOwner}
```
Status mapping (respond.*): 201 create, 200 list/get, 400 validation (EC-7),
409 conflict (EC-1), 404 unknown id, 401/403 from middleware, 500 else.
Contract details in `A3 §3` (authoritative).

### 5.4 `GET /admin/me` — introspection (JWT-only)

Validates the JWT itself (not behind `AuthSuperOwner`), returns
`{ "isSuperOwner": bool }`; never 403 — it's how the UI decides to render
the console. Missing/invalid token → `{ "isSuperOwner": false }` (200).

## 6. Wiring — `internal/httpx/router.go` + `Deps` + `main.go`

1. Add `AdminAPI *supahttp.AdminClient` to `httpx.Deps`.
2. In `main.go`, construct it:
   `supahttp.NewAdminClient(cfg.SupabaseURL, cfg.SupabaseServiceRoleKey)`
   and set `deps.AdminAPI`.
3. In `NewRouter`, inside the `deps.Queries != nil && deps.JWTVerifier != nil`
   block, add:

```go
superOwnerMW := middleware.AuthSuperOwner(deps.JWTVerifier, deps.Queries)
r.Route("/admin", func(r chi.Router) {
  r.With(superOwnerMW).Post("/companies", handlersadmin.CreateCompany(deps.AdminAPI, deps.Queries))
  r.With(superOwnerMW).Get("/companies", handlersadmin.ListCompanies(deps.Queries))
  r.With(superOwnerMW).Get("/companies/{id}", handlersadmin.GetCompany(deps.Queries))
  // introspection — JWT only, no super_owner requirement:
  r.Get("/me", handlersadmin.Me(deps.JWTVerifier, deps.Queries))
})
```
`*db.Queries` already satisfies `middleware.SuperOwnerQuerier` and the
domain `Querier` once `admin.sql` is generated.

## 7. Tests (mirror existing conventions)

- Unit: `input_test.go` (validation), `auth_super_owner_test.go`
  (401/403/pass + no-membership pass), `gotrue_admin_test.go`
  (`httptest` request shaping + 422→ErrEmailExists).
- Integration (`test/integration`, `-tags integration`, needs
  `supabase start`): provision happy path → account renamed + owner profile
  present + `member_count=1`; duplicate email → 409, no new account;
  list/get across ≥2 accounts; non-super-owner → 403.
- Golden (`test/golden`): response envelopes for 201/200/400/409/403.

## 8. Rollout order (checklist)

1. [ ] `034_super_owners.sql` + append `store/schema/02_tables.sql`.
2. [ ] `store/queries/admin.sql`; `make gen-sqlc`; `make build`.
3. [ ] `supahttp/gotrue_admin.go` (+ test).
4. [ ] `auth/context.go` SuperOwner types; `middleware/auth_super_owner.go` (+ test).
5. [ ] `domain/companies/{input,service}.go` (+ input test).
6. [ ] `handlers/admin/handler.go`.
7. [ ] Wire `Deps.AdminAPI` + `/admin` routes; `main.go`.
8. [ ] `make test lint vet`; integration + golden.
9. [ ] Apply migration to the shared Supabase; **seed the first
       `super_owner`** (ADR-5).
10. [ ] Frontend `(admin)` route group consumes `/api/admin/*` (separate plan).

## 9. Env / config

No new secrets. Uses existing `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
(`internal/config/config.go`). Confirm the deployed backend has the
service-role key set (it does today — used elsewhere).
```
