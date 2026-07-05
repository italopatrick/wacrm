# TASKS — owner magic-link onboarding

Pendências técnicas da sub-feature *owner magic-link* (o invite do owner
aterrissa na página de definir senha). **Ambiente de teste/dev — não há
produção.** Marque `[x]` conforme concluir e **atualize este arquivo a cada
task feita** (status + referência de arquivo/teste).

> **Legenda:** 🔴 necessário para a feature rodar · 🟡 recomendado · 🟢 follow-up

Specs de referência nesta pasta: `01_spec_requirements.md`,
`02_pseudocode.md`, `03_test_anchors.md`, `04_architecture.md`.

---

## 0. Estado atual (o que já está pronto)

- [x] **Núcleo do fluxo** — `SendInvite` envia o invite com
  `redirect_to=<SITE_URL>/auth/callback?next=/reset-password`
  (`ulabchat-backend/internal/supahttp/gotrue_admin.go:91`). FR-1, FR-2, FR-4.
- [x] **Provisão** usa `SendInvite`; **resend** usa `SendRecovery` (mesmo
  builder de redirect) — `companies/service.go`, `admin/handler.go`. FR-3.
- [x] Fire-and-forget: falha de e-mail não desfaz a store. NFR-4.
- [x] Config `SITE_URL` lida e injetada no client (`cmd/api/main.go:46`).
- [x] Testes unitários do `SendInvite`/`SendRecovery` (endpoint + redirect) —
  `internal/supahttp/gotrue_admin_test.go`.
- [x] **BUGFIX resend-invite (2026-07-05):** o resend usava `POST /auth/v1/invite`,
  que retorna **422 `email_exists`** para o owner (que já existe desde o
  provisionamento) → handler 500 → UI "Could not send the invite". Corrigido:
  resend agora usa **recovery** (`POST /auth/v1/recover`, `SendRecovery`), que
  envia "Reset your password" com o **mesmo** `redirect_to` → cai em
  `/reset-password` (spec EC-3). Verificado ponta a ponta pelo endpoint real:
  `POST /admin/companies/{id}/resend-invite` → 200 + e-mail no Mailpit.

---

## 1. 🔴 Necessário para a feature rodar (ambiente de teste)

- [x] **`SITE_URL` com default de teste.** Deixou de ser obrigatório; default
  `http://localhost:3000` (`internal/config/config.go` — const `defaultSiteURL`).
  Sem env extra o redirect já funciona.
  - Testes: `TestLoad_SiteURLDefault`, `TestLoad_SiteURLFromEnv`
    (`internal/config/config_test.go`).
- [x] **Allow-list de redirect do Supabase.** No Supabase local a allow-list
  padrão já inclui `localhost:3000` → nada a configurar em teste. *Para deploy
  real:* incluir `<SITE_URL>/auth/callback` na allow-list + Site URL correta.

## 2. 🟡 Validação

- [x] **Teste do handler `ResendInvite`** (C-1, C-2 + owner sem email) —
  `internal/httpx/handlers/admin/resend_invite_test.go`.
- [x] **Smoke automatizado (backend)** do fluxo M-1/M-4: default config →
  client → landing em `http://localhost:3000/auth/callback?next=/reset-password`
  (`internal/supahttp/onboarding_smoke_test.go`).
- [x] **Frontend:** `safeNext` extraído para `src/lib/auth/safe-next.ts`
  (ADR-3, sem mudança de lógica) + teste F-1..F-4
  (`src/lib/auth/safe-next.test.ts`). `tsc --noEmit` limpo.
- [x] **Ambiente PM2 preparado** para o smoke (origem `http://localhost:3009`):
  - `ecosystem.config.js` (raiz `ulab/`) gerencia backend + frontend; secrets
    em `.env` gitignored por app (`ulabchat-backend/.env`, `ulabchat/.env.local`).
  - `SITE_URL`/`NEXT_PUBLIC_SITE_URL`/`FRONTEND_ORIGINS` alinhados a `:3009`
    (antes estavam em `http://localhost` sem porta → redirect ia para :80).
  - `ulabchat-backend/supabase/config.toml` criado com `site_url` +
    `additional_redirect_urls` = `http://localhost:3009(/auth/callback)`
    (antes o GoTrue só permitia `https://127.0.0.1:3000`).
- [x] **Config aplicada + redirect verificado ponta a ponta** (2026-07-05):
  `supabase stop/start` + `pm2 restart --update-env` rodados. GoTrue agora expõe
  `GOTRUE_SITE_URL=http://localhost:3009` e a allow-list correta; o backend/PM2
  emite `SITE_URL=http://localhost:3009`. Um invite real via `/auth/v1/invite`
  gerou link com `redirect_to=http://localhost:3009/auth/callback?next=/reset-password`,
  e o `/auth/v1/verify` respondeu `Location:
  http://localhost:3009/auth/callback?next=/reset-password#access_token=…` — o
  GoTrue **honra** o redirect (não cai no fallback). Usuário/store de teste limpos.
  > Nota: o capturador de e-mails desta stack é **Mailpit** v1.30 (não Inbucket).
  > UI `http://127.0.0.1:54324`; API REST `.../api/v1/messages`.
- [x] **Smoke manual pelo browser** — validado na UI (2026-07-05):
  - [x] M-1: `/admin/companies` → criar store → abrir o invite no **Mailpit**
    (`http://127.0.0.1:54324`) → clicar → cair em `http://localhost:3009/reset-password`
    (não `/` nem `/dashboard`) com sessão ativa.
  - [x] M-2: definir senha → tela de sucesso → login em `/login`.
  - [x] M-3: deixar o link expirar → `/reset-password` mostra "link inválido".
  - [x] M-4: "Resend invite" no detalhe da store → novo link cai igual ao M-1.

## 3. 🟢 Follow-ups / dívidas conhecidas

- [ ] **Deploy real:** definir `SITE_URL` explícito + allow-list do Supabase
  (ver 1). Fora do escopo de teste.
- [x] **Pins de regressão do frontend F-5..F-8** (component tests, jsdom):
  - `src/app/auth/callback/callback.test.tsx` — F-5: callback com sessão →
    `router.replace(next)` exatamente 1× (guarda `done` dedupe); F-5b: sem
    `next` → `/dashboard`.
  - `src/app/(auth)/reset-password/reset-password.test.tsx` — F-6: sem sessão →
    invalid-link com link p/ `/forgot-password`; F-7: sessão + senhas iguais →
    `updateUser({password})` + success UI; F-8a/b: senha curta/divergente →
    erro, `updateUser` **não** chamado.
  - Infra adicionada (devDeps): `jsdom`, `@testing-library/react`,
    `@testing-library/dom`, `@testing-library/user-event`. Ambiente jsdom via
    pragma `// @vitest-environment jsdom` por arquivo (config global segue `node`).
  - Suite completa: 610 passam; as 2 falhas restantes são as **pré-existentes**
    de timezone em `date-utils.test.ts` (não relacionadas). `tsc --noEmit` limpo.
    INV-1 respeitado (nenhuma lógica de página editada).

## 4. 📌 Como validar (dev local)

```bash
# backend — pacotes afetados
cd ulabchat-backend && go build ./... && \
  go test ./internal/config/ ./internal/supahttp/ ./internal/httpx/handlers/admin/

# frontend — guard de redirect + typecheck
cd ulabchat && npx vitest run src/lib/auth/ && npx tsc --noEmit
```

---

### Convenção deste arquivo
A cada task concluída: marcar `[x]`, anexar o arquivo/teste que a comprova e,
se surgir pendência nova, adicioná-la na seção apropriada antes de seguir.
</content>
