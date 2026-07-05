# TASKS — super_owner / store provisioning

Próximos passos para levar a feature de `super_owner` (provisionamento de
stores/tenants) do estado atual até produção. Marque conforme concluir.

> **Legenda:** 🔴 bloqueia produção · 🟡 recomendado · 🟢 opcional/follow-up
> · ⚙️ processo/deploy

---

## 0. Estado atual (o que já está pronto)

- [x] Backend: provisionamento, auth `super_owner`, Fase 2 (suspender/reativar
  + grant/revoke) — unit + **integração** verdes.
- [x] Frontend: console `/admin` (stores, criar, detalhe), Fase 2 UI
  (suspender/reativar, gestão de super_owners), fluxo de senha
  (`/auth/callback` + `/reset-password`).
- [x] `make gen-sqlc` reprodutível (alias `account_role` corrigido).
- [x] Branch `developer` **pushed** nos dois repos (`ulabchat-backend`,
  `ulabchat-frontend`).
- [x] **Local:** migrações 034+035 aplicadas, 1º `super_owner` semeado,
  teste manual OK.

Commits backend: `2067fe2`, `df4c43e`, `572024b`, `8849dc8`, `0997f65`.
Commits frontend: `621d486`, `64e057d`, `1cbb817`.

---

## 1. 🔴 Bloqueantes para produção

- [ ] **Aplicar migrações 034 + 035 no banco de produção.**
  Sem elas o `GetMembership` quebra em **todo** request (`column a.status
  does not exist`) e `/admin` falha (sem `super_owners`).
  - Supabase hospedado: `supabase link --project-ref <REF>` → `supabase db push`.
  - **Rode a migração ANTES/junto do deploy do backend** (evita a janela de erro).

- [ ] **Semear o 1º `super_owner` em produção** (manual — sem endpoint, por design).
  ```sql
  INSERT INTO super_owners (user_id, granted_by)
  VALUES ('<uuid-de-um-auth.users>', NULL);
  ```
  Descobrir o `user_id`: `SELECT id, email FROM auth.users WHERE email = '<email>';`

- [ ] **Config do Supabase (prod) para o convite/reset funcionar:**
  - [ ] SMTP habilitado (senão os e-mails de convite/reset não saem).
  - [ ] **Redirect allowlist** incluindo `.../auth/callback` (o `redirect_to`
    do convite aponta para lá) e a **Site URL** correta.

- [ ] **Deploy conjunto backend + frontend.** O front chama `/api/admin/*`
  e o novo fluxo de auth; ambos precisam subir juntos com a migração aplicada.

## 2. ⚙️ Processo (merge/PR)

- [ ] Abrir PRs `developer → main` (você faz manualmente):
  - Backend: `https://github.com/ulabapps/ulabchat-backend/pull/new/developer`
  - Frontend: `https://github.com/ulabapps/ulabchat-frontend/pull/new/developer`
- [ ] Revisar o diff (atenção especial aos pontos de auth: `AuthSession`
  agora nega store suspenso; `FindActiveKeyByHash` filtra store suspenso).
- [ ] Nota de release: destacar que a migração deve ir **antes** do backend.

## 3. 🟡 Validação antes do merge

- [ ] Rodar os testes de integração num ambiente com Supabase de pé:
  ```
  cd ulabchat-backend && make test-integration     # requer `supabase start`
  ```
- [ ] `cd ulabchat-backend && make test lint vet`.
- [ ] `cd ulabchat && npm run build && npm test`
  (obs.: 2 falhas pré-existentes em `date-utils.test.ts` são de timezone,
  não relacionadas a esta feature).
- [ ] Smoke manual em staging: provisionar store → e-mail → definir senha →
  login → suspender/reativar → grant/revoke super_owner.

## 4. 🟢 Follow-ups / dívidas conhecidas

- [ ] **Grant de super_owner por email depende de profile existente.**
  `GetUserIdByEmail` lê `profiles`; um usuário que nunca logou não é
  encontrado (retorna 404 "must sign in once first"). Se precisar granting
  a quem nunca entrou, resolver via GoTrue Admin API (dependente de versão).
- [ ] **Roteamento pós-login de super_owner sem store (ADR-F1).** Hoje o
  middleware manda usuário logado em `/login` para `/dashboard`
  (account-scoped). Um super_owner sem store chega em `/admin` manualmente.
  Opcional: redirecionar `/dashboard → /admin` quando `isSuperOwner` e sem
  `accountId`.
- [ ] **i18n do console `/admin`.** Strings hardcoded em inglês (consistente
  com `invite-member-dialog`). Traduzir se o console for exposto a não-devs.
- [ ] **Rate-limit** em `POST /admin/companies` e `POST /admin/super-owners`.
- [ ] **Audit log** de ações de plataforma (criar/suspender store, grant/revoke).
- [ ] **UX de suspensão no dashboard:** hoje um membro de store suspenso
  recebe 403 seco ("This store is suspended"); considerar uma tela dedicada
  no frontend em vez do erro genérico.

## 5. 📌 Runbook rápido (local)

```bash
# aplicar migrações no Supabase local
cd ulabchat-backend && supabase migration up

# listar usuários (para escolher o super_owner)
docker exec <supabase_db_container> psql -U postgres -d postgres \
  -c "SELECT id, email FROM auth.users ORDER BY created_at;"

# semear super_owner
docker exec <supabase_db_container> psql -U postgres -d postgres \
  -c "INSERT INTO super_owners (user_id, granted_by) VALUES ('<uuid>', NULL) ON CONFLICT DO NOTHING;"

# reverter o seed
#   DELETE FROM super_owners WHERE user_id = '<uuid>';
```

---

### Referências
- Spec/pseudocódigo: `01`–`06` nesta pasta.
- Arquitetura + ADRs + planos: `architecture/A1`–`A6`.
