# Fase 1 — Inventário do Backend e Classificação de Fronteiras

Classificação de cada artefato em: **MIGRA** (vai para `ulabchat-backend`),
**FICA** (permanece no frontend), **COMPARTILHA** (vai para `@ulabchat/shared`).

## 1. Route handlers (`src/app/api/**`) — todos MIGRAM, agrupados por onda

A ordem das ondas minimiza risco: primeiro superfícies máquina-a-máquina
(sem impacto no browser), por último as rotas chamadas pelo dashboard.

### Onda A — máquina-a-máquina (sem mudança no frontend)

| Rota | Auth | Observações |
|---|---|---|
| `whatsapp/webhook` | Assinatura Meta `X-Hub-Signature-256` + verify token | Crítica (R1) — entrada de todas as mensagens |
| `automations/cron` | Header `x-cron-secret` = `AUTOMATION_CRON_SECRET` | Drena `automation_pending_executions` |
| `automations/engine` | idem cron | Executor assíncrono |
| `flows/cron` | idem cron | |
| `health` | pública | Novo backend precisa da própria |

### Onda B — API pública v1 (muda só a URL base; contrato imutável, R4)

| Rota | Auth |
|---|---|
| `v1/me` | API key (`requireApiKey` + scopes + rate limit) |
| `v1/contacts`, `v1/contacts/[id]` | idem |
| `v1/conversations`, `v1/conversations/[id]`, `v1/conversations/[id]/messages` | idem |
| `v1/messages` | idem |
| `v1/broadcasts`, `v1/broadcasts/[id]` | idem |
| `v1/webhooks`, `v1/webhooks/[id]` | idem |

### Onda C — rotas do dashboard (exigem o client HTTP da Fase 3 no frontend)

| Grupo | Rotas | Auth atual → nova |
|---|---|---|
| WhatsApp | `whatsapp/send`, `react`, `broadcast`, `config`, `config/verify-registration`, `media/[mediaId]`, `templates/[id]`, `templates/submit`, `templates/sync` | cookie Supabase → JWT Bearer (D4) |
| Conta | `account`, `account/api-keys(/[id])`, `account/invitations(/[id])`, `account/members(/[userId])`, `account/transfer-ownership` | idem |
| Convites | `invitations/[token]/peek`, `invitations/[token]/redeem` | peek é público; redeem exige sessão |
| Automations | `automations`, `[id]`, `[id]/duplicate` | idem |
| Flows | `flows`, `[id]`, `[id]/activate`, `[id]/runs`, `templates` | idem |
| IA | `ai/config`, `ai/draft`, `ai/knowledge(/[id])`, `ai/knowledge/reindex`, `ai/playground`, `ai/test` | idem |

## 2. Módulos de domínio (`src/lib/**`)

### MIGRA — lógica de backend (com seus `*.test.ts`)

| Módulo | Conteúdo | Dependências sensíveis |
|---|---|---|
| `whatsapp/*` | `meta-api`, `send-message`, `broadcast-core`, `encryption`, `webhook-signature`, `template-*`, `phone-utils`, `resolve-conversation`, `registration` | `ENCRYPTION_KEY`, `META_APP_*` |
| `automations/*` | `engine`, `validate`, `steps-tree`, `meta-send`, `trigger-meta`, `templates`, `admin-client` | service-role |
| `flows/*` | `engine`, `edges`, `fallback`, `validate`, `meta-send`, `templates`, `admin-client` (‡ `layout.ts` — ver §3) | service-role |
| `ai/*` | `auto-reply`, `generate`, `embeddings`, `chunk`, `knowledge`, `context`, `query`, `config`, `admin-client` | chaves de provedores IA |
| `api-keys/*` | `keys` (hash), `scopes`, `store` | |
| `webhooks/*` | `deliver`, `endpoints`, `events`, `sign`, `ssrf` | SSRF guard obrigatório |
| `auth/api-context` | resolução de API key → conta | service-role |
| `auth/invitations`, `auth/account` (parte server) | RPCs de convite/conta | `ALLOWED_INVITE_HOSTS` |
| `rate-limit` | buckets in-memory (D5: abstrair interface) | |
| `storage/upload-media` | upload service-role | |
| `broadcast-status`, `template-status` | máquinas de estado | |

### FICA — usado pela UI

| Módulo | Motivo |
|---|---|
| `supabase/client.ts`, `supabase/server.ts` | Sessão do browser/RSC (leituras RLS, realtime) |
| `dashboard/queries.ts`, `dashboard/date-utils` | Consultas RLS renderizadas em RSC |
| `inbox/conversations` | Consumido pela UI do inbox |
| `contacts/parse-contact-csv`, `dedupe`, `resolve-import-tags` | Import CSV roda no fluxo da UI (†verificar se o commit final é via rota — se sim, a parte de escrita MIGRA) |
| `flows/layout` (dagre), `themes`, `utils`, `currency`, `presence` | Puro frontend |
| `auth/roles` (parte de exibição) | ver COMPARTILHA |

### COMPARTILHA → pacote `@ulabchat/shared`

| Artefato | Motivo |
|---|---|
| `src/types/**` + tipos gerados do schema Supabase | Contrato único frontend/backend |
| `flows/types.ts`, `dashboard/types.ts`, `ai/types.ts` | Tipos de domínio usados nos dois lados |
| `auth/roles.ts` (enum de papéis + predicados `can*`) | UI esconde botões; backend aplica de verdade |
| `api-keys/scopes.ts` (lista de scopes) | UI de criação de chave + validação no backend |
| Constantes de status (`broadcast-status`, `template-status` — parte declarativa) | Badges na UI, transições no backend |
| Schemas de validação (`automations/validate`, `flows/validate` — parte pura) | Validar no editor (UX) e na borda (segurança) |

**Regra do pacote shared**: só código **puro** (tipos, enums, predicados,
validadores sem I/O). Nada que importe `supabase-js` com service-role,
`next/*`, ou leia `process.env`.

## 3. Infra e artefatos fora de `src/`

| Artefato | Destino |
|---|---|
| `supabase/migrations/*.sql` (30 arquivos) | **MIGRA** para `ulabchat-backend` — o dono do schema é o backend |
| `Dockerfile` | Cada projeto ganha o seu; o health probe port-agnostic (commit `24bc3f3`) vira referência para o do backend |
| `docs/public-api.md` | MIGRA para `ulabchat-backend` (documenta a superfície dele) |
| `vitest.config.ts` | Duplicar/adaptar nos dois projetos |

## 4. Variáveis de ambiente — partição

| Variável | Frontend | Backend |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | ✅ | ✅ (sem prefixo) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ (validar JWT) |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ **removida** | ✅ |
| `ENCRYPTION_KEY` | ❌ removida | ✅ |
| `META_APP_ID`, `META_APP_SECRET` | ❌ removidas | ✅ |
| `AUTOMATION_CRON_SECRET` | ❌ removida | ✅ |
| `AI_CONTEXT_MESSAGE_LIMIT`, `AI_REQUEST_TIMEOUT_MS` | ❌ | ✅ |
| `WHATSAPP_TEMPLATES_DRY_RUN` | ❌ | ✅ |
| `ALLOWED_INVITE_HOSTS` | ❌ | ✅ |
| `NEXT_PUBLIC_SITE_URL` | ✅ | ✅ (montar links de convite) |
| `NEXT_PUBLIC_API_URL` **(nova)** | ✅ | — |
| `FRONTEND_ORIGINS` **(nova, CORS)** | — | ✅ |

**Ganho de segurança**: após a separação, o processo do frontend não possui
mais nenhum segredo capaz de bypassar RLS ou falar com a Meta.

## 5. Âncoras TDD do inventário

- **T1.1** Teste de lint/CI no frontend: falha se algo importar
  `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` ou `@ulabchat/shared` impuro.
- **T1.2** Teste no `@ulabchat/shared`: nenhum arquivo importa `next`, `react`
  ou lê `process.env` (verificação estática no CI do pacote).
- **T1.3** Snapshot da lista de rotas do backend == inventário deste doc
  (evita rota esquecida no cutover).
