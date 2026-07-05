# TASKS — super_owner / store provisioning

Próximos passos para a feature de `super_owner` (provisionamento de
stores/tenants). **O projeto está em desenvolvimento — não há ambiente de
produção.** As tasks abaixo são para o fluxo de dev / futura preparação de
deploy. Marque conforme concluir.

> **Legenda:** 🔴 necessário para a feature rodar · 🟡 recomendado
> · 🟢 opcional/follow-up

---

## 0. Estado atual (o que já está pronto)

- [x] Backend: provisionamento, auth `super_owner`, Fase 2 (suspender/reativar
  + grant/revoke) — unit + **integração** verdes.
- [x] Frontend: console `/admin` (stores, criar, detalhe), Fase 2 UI
  (suspender/reativar, gestão de super_owners), fluxo de senha
  (`/auth/callback` + `/reset-password`).
- [x] `make gen-sqlc` reprodutível (alias `account_role` corrigido).
- [x] Testes de integração do backend (provisionamento, suspensão, grants)
  rodando contra o Postgres local.
- [x] **Signup invite-only:** `/signup` sem token mostra "convite necessário";
  self-service de conta eliminado (contas sempre pertencem a uma loja).
- [x] Fix `/admin` 404 (redirect da raiz `/admin` → `/admin/companies`).
- [x] Rail de Configurações: grupo "Workspace" renomeado para **Loja/Store/Tienda**.
- [x] Perfil: super_owner vê card **"Platform admin"** com link para `/admin`.
- [x] Branch `developer` **pushed** nos dois repos (`ulabchat-backend`,
  `ulabchat-frontend`).
- [x] **Local:** migrações 034+035 aplicadas, 1º `super_owner` semeado,
  teste manual OK.

Commits backend: `2067fe2`, `df4c43e`, `572024b`, `8849dc8`, `0997f65`,
`f7f45c7`.
Commits frontend: `621d486`, `64e057d`, `1cbb817`, `19540f1`, `6318e91`,
`eaeaa58`, `657a3b5`, `3a49b15`.

---

## 1. 🔴 Necessário para a feature rodar (por ambiente de dev)

Já feito no dev local atual (ver seção 0). **Refazer estes passos em cada
novo ambiente de dev** (outra máquina, `supabase db reset`, banco novo):

- [x] **Aplicar migrações 034 + 035** — feito no dev local.
  Sem elas o `GetMembership` quebra em **todo** request (`column a.status
  does not exist`) e `/admin` falha (sem `super_owners`).
  - Local: `cd ulabchat-backend && supabase migration up`.
  - **Aplicar a migração antes de subir o backend novo** (evita a janela de erro).

- [x] **Semear o 1º `super_owner`** — feito no dev local
  (`nicolas98aguiar@gmail.com`). Manual, sem endpoint (por design).
  ```sql
  INSERT INTO super_owners (user_id, granted_by)
  VALUES ('<uuid-de-um-auth.users>', NULL);
  ```
  Descobrir o `user_id`: `SELECT id, email FROM auth.users WHERE email = '<email>';`

- [ ] **Config do Supabase para convite/reset (quando testar o e-mail real):**
  no dev local o Supabase captura e-mails no **Inbucket** (nada a configurar
  para testar). Se quiser envio real: SMTP habilitado + **redirect allowlist**
  incluindo `.../auth/callback` + **Site URL** correta.

## 2. 🟡 Validação

- [x] Testes de integração rodados no dev local (3 passando):
  ```
  cd ulabchat-backend && make test-integration     # requer `supabase start`
  ```
- [x] `cd ulabchat-backend`: `go vet` + `go test ./...` verdes
  (`golangci-lint` não instalado no ambiente — pular ou instalar a ferramenta).
- [x] `cd ulabchat && npm run build && npm test` verdes
  (obs.: 2 falhas pré-existentes em `date-utils.test.ts` são de timezone,
  não relacionadas a esta feature).
- [ ] Smoke manual completo no dev (depende de você): provisionar store →
  e-mail (Inbucket) → definir senha → login → suspender/reativar →
  grant/revoke super_owner.

## 3. 🟢 Follow-ups / dívidas conhecidas

- [ ] **Grant de super_owner por email depende de profile existente.**
  `GetUserIdByEmail` lê `profiles`; um usuário que nunca logou não é
  encontrado (retorna 404 "must sign in once first"). Se precisar granting
  a quem nunca entrou, resolver via GoTrue Admin API (dependente de versão).
- [x] **Roteamento pós-login de super_owner sem store (ADR-F1).** Feito: o
  `DashboardShell` redireciona `/dashboard → /admin/companies` quando o
  usuário é `super_owner` e não tem `accountId`. Super_owner **com** loja
  usa o dashboard normal + atalho "Platform admin" no perfil.
- [x] **Rate-limit** nas mutações admin (`POST /admin/companies`, suspend/
  reactivate, grant/revoke): middleware `RateLimitAdmin`, 30/min por
  super_owner. Leituras (GET) sem limite.
- [ ] **i18n do console `/admin`.** Strings hardcoded em inglês (consistente
  com `invite-member-dialog`). *Feature própria — traduzir se o console for
  exposto a não-devs.* Não feito nesta rodada.
- [ ] **Audit log** de ações de plataforma (criar/suspender store, grant/revoke).
  *Feature própria (nova tabela + writes por ação) — fora do escopo desta
  rodada; abrir quando priorizado.*
- [ ] **UX de suspensão no dashboard:** hoje um membro de store suspenso
  recebe 403 seco ("This store is suspended"); considerar uma tela dedicada
  no frontend em vez do erro genérico.

## 4. 📌 Runbook rápido (dev local)

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
