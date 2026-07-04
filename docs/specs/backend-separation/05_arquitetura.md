# Fase 5 — Arquitetura do `ulabchat-backend` (SPARC: Architecture)

> ⚠️ **REVISADO** por `06_revisao_go_decisoes.md`: ADR-1 (Hono) e ADR-3
> (`@ulabchat/shared`) foram substituídas por ADR-1' (Go + chi) e ADR-3'
> (OpenAPI + codegen). ADR-2, ADR-4, ADR-5, ADR-6, camadas, fluxos
> críticos (§3) e topologia (§4) permanecem válidos.

Ratifica as decisões D1–D6 da spec (`00` §3) como ADRs com evidência do
código, e fixa a arquitetura de componentes, contratos internos e topologia
de deploy. Vale como referência normativa para a implementação (M0–M5).

## 1. ADRs — decisões ratificadas

### ADR-1 (D1) Framework: Hono sobre Node ≥ 20 — **RATIFICADA**

**Evidência**: os handlers usam `Request`/`Response` web-standard; o
acoplamento a `next/*` em toda a `src/lib` se resume a **4 arquivos**
(`api/v1/respond.ts`, `auth/account.ts`, `rate-limit.ts` usam `NextResponse`;
`supabase/server.ts` usa `next/headers`). `NextResponse.json(x, init)` é
substituível 1:1 por `Response.json(x, init)`. Não há SSE/streaming nas
rotas de IA (verificado por grep), então nenhum recurso especial de
framework é necessário.

**Consequências**: porte mecânico dos handlers; `supabase/server.ts`
(cookies) **não** migra — no backend a sessão chega por Bearer (ADR-4).

### ADR-2 (D2) Repositório separado `ulabchat-backend` — **RATIFICADA**

Requisito explícito do usuário. Custo assumido: sincronização de contrato
via `@ulabchat/shared` + golden tests (T2.6), em vez de type-check atômico de
monorepo. Mitigação: CI do frontend instala `@ulabchat/shared` pinado por
versão exata; bump de versão é o evento de sincronização.

### ADR-3 (D3) Pacote `@ulabchat/shared` — **RATIFICADA, escopo reduzido**

Só entra código **puro** (01 §2): tipos, `roles.ts`, `scopes.ts`, constantes
de status, validadores sem I/O. Distribuição: git dependency
(`github:…/ulabchat-shared#semver`) para evitar registry privado no início.
Regra de pureza garantida por T1.2 no CI do pacote.

### ADR-4 (D4) Sessão dashboard→backend via JWT Supabase — **RATIFICADA**

**Evidência**: `auth/account.ts` já define o padrão `requireRole(role)` →
`{ supabase (RLS-scoped), userId, accountId, role, account }` com erros
tipados (`UnauthorizedError.status = 401`, `ForbiddenError = 403`). O porte
preserva a assinatura trocando apenas a **fonte** da identidade:

- Hoje: cookie → `createClient()` de `@supabase/ssr` → `auth.getUser()`.
- Backend: `Authorization: Bearer <access_token>` → client anon com o token
  injetado (`global.headers.Authorization`) → mesma RLS, mesmo `requireRole`.

Rotas que hoje usam service-role + filtro por conta (R3) mantêm esse modo.

### ADR-5 (D5) Rate limit in-memory atrás de interface — **RATIFICADA**

**Evidência**: `rate-limit.ts` já documenta exatamente este plano ("swap the
`check` implementation for Redis… keeping the same return shape. The call
sites won't change") e é fixed-window sem timers. Arquitetura: interface
`RateLimitStore` (02 §6); deploy trava em **1 réplica** até existir
`RedisStore`. Registrar essa restrição no README de deploy do `ulabchat-backend`.

### ADR-6 (D6) Realtime/presença permanecem no frontend — **RATIFICADA**

**Evidência**: canais Supabase Realtime em hooks/componentes do browser;
o backend não participa. Nenhum trabalho de arquitetura necessário.

## 2. Arquitetura de componentes (hexagonal-light)

Três camadas com dependência unidirecional. Não introduzimos ports/adapters
formais nem CQRS — o domínio migrado já é modular e testado; a arquitetura
apenas o preserva e isola as bordas.

```
┌──────────────────────────── ulabchat-backend ────────────────────────────┐
│  HTTP (routes/ + middleware/)         ← borda: valida, autentica  │
│    │ chama funções puras/async com contexto explícito             │
│    ▼                                                              │
│  Domínio (domain/whatsapp, automations, flows, ai, …)             │
│    │ recebe clients por parâmetro ou factory                      │
│    ▼                                                              │
│  Infra (supabase/admin, supabase/as-user, meta HTTP,              │
│         RateLimitStore, storage)                                  │
└───────────────────────────────────────────────────────────────────┘
Regras de dependência (lint no CI):
  routes → domain → infra   (nunca o inverso)
  domain NÃO importa hono nem lê process.env (config chega do env.ts)
```

### 2.1 Contextos de autenticação (contrato interno central)

Uma união discriminada por `authType`, unificando os três modos:

```pseudo
TYPE AuthContext =
  | SessionContext { authType:"session";  supabase: RLSClient; admin: AdminClient;
                     userId; accountId; role; account }
  | ApiKeyContext  { authType:"api_key";  supabase: AdminClient;
                     accountId; keyId; scopes; createdBy }   // já existe hoje
  | CronContext    { authType:"cron";     admin: AdminClient }

// Handlers de domínio compartilhados (ex.: send-message) aceitam
// { supabase, accountId } — o mínimo comum — como já fazem hoje.
```

### 2.2 Envelope de erro (contrato HTTP)

Preserva o comportamento atual: erros tipados com `.status` mapeados por um
único `error-handler`. Formato do corpo idêntico ao legado (golden tests
T2.6 são a autoridade — não padronizar "a mais" durante a migração; qualquer
unificação de envelope fica para depois da M5).

### 2.3 Mapa de módulos → rotas

| Router | Middleware | Domínio consumido |
|---|---|---|
| `health` | — | — |
| `whatsapp/webhook` | assinatura Meta | whatsapp, automations (trigger), flows (trigger), webhooks/deliver |
| `automations/*`, `flows/*` (cron/engine) | `authCron` | automations, flows |
| `v1/*` | `authApiKey` + rate limit | contacts, conversations, whatsapp/send, webhooks/endpoints |
| `whatsapp/*` (ações) | `authSession` | whatsapp, storage |
| `account/*`, `invitations/*` | `authSession` (+ `requireRole`) | auth/account, auth/invitations, api-keys |
| `ai/*` | `authSession` | ai |

## 3. Fluxos críticos (sequência)

### 3.1 Mensagem recebida (webhook Meta)

```
Meta ──POST /whatsapp/webhook──▶ verifySignature(raw)      [R5]
  └─▶ 200 ACK imediato
      └─▶ resolveConversation → INSERT message (admin client)
            ├─▶ Supabase Realtime ──▶ frontend (inbox atualiza)   [ADR-6]
            ├─▶ automations.trigger / flows.engine (síncrono como hoje)
            └─▶ webhooks.deliver (assinado, SSRF-guarded)
```

### 3.2 Ação do dashboard (ex.: enviar mensagem)

```
Browser ──apiFetch POST {API_URL}/whatsapp/send (Bearer JWT)──▶
  authSession: getUser(jwt) → requireRole → SessionContext
  └─▶ domain/whatsapp/send-message (client RLS ou admin+accountId, como hoje)
        └─▶ Meta Graph API → INSERT message → Realtime → UI
```

## 4. Topologia de deploy

```
                    ┌────────────┐
   usuários ──────▶ │  Next.js   │  (Vercel/VPS)  — sem segredos privilegiados
                    └─────┬──────┘
        Bearer JWT        │ HTTPS (CORS: FRONTEND_ORIGINS)
                    ┌─────▼──────┐
   Meta webhook ──▶ │ ulabchat-backend  │  container único (ADR-5), PORT, /health
   cron pinger  ──▶ └─────┬──────┘
                          │ service-role / anon+JWT
                    ┌─────▼──────┐
                    │  Supabase  │  Postgres+RLS · Auth · Storage · Realtime
                    └────────────┘   (schema: migrations vivem no ulabchat-backend)
```

- **CORS**: allowlist exata de `FRONTEND_ORIGINS`; `Authorization` permitido;
  sem credenciais de cookie (JWT via header dispensa `credentials: include`).
- **TLS/host**: `api.<domínio>`; o domínio antigo mantém proxy para `/api/v1`
  durante a deprecação (R4).
- **Observabilidade mínima**: log estruturado por request (`requestId`,
  rota, status, latência, `accountId` quando houver); nunca tokens.

## 5. Riscos arquiteturais aceitos

| Risco | Aceito porque |
|---|---|
| Latência extra browser→api→supabase nas ações | Ações são poucas (35 call sites) e não são o caminho de leitura; leituras seguem diretas (ADR-6) |
| Processamento do webhook síncrono pós-ACK | Comportamento atual preservado; fila dedicada é evolução pós-M5, fora de escopo (00 §4) |
| Golden tests como contrato (sem OpenAPI) | Menor custo agora; OpenAPI pode ser gerado depois a partir das rotas v1 |

## 6. Handoff para a próxima fase

- Pseudocódigo detalhado por componente: já em `02` §2–§6.
- Ordem de implementação e gates: `04` (M0–M5).
- Próximo modo SPARC: **Refinement** (implementação TDD começando por M0 —
  scaffold + `@ulabchat/shared` + CI).
