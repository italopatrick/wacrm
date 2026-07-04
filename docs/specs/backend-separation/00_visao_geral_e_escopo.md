# Fase 0 — Visão Geral e Escopo: Separação do Backend

> Especificação SPARC (spec-pseudocode) para extrair o backend do ulabchat
> em um projeto separado. Módulos: `00`–`04`.

## 1. Contexto atual

O ulabchat hoje é um monólito Next.js 16 + Supabase:

- **Frontend** (App Router): páginas em `src/app/(auth)` e `src/app/(dashboard)`,
  componentes em `src/components`.
- **"Backend" embutido**: ~50 route handlers em `src/app/api/**` + lógica de
  domínio em `src/lib/**`.
- **Supabase** é o plano de dados: Postgres (30 migrations em
  `supabase/migrations/`), Auth (sessão via cookies `@supabase/ssr`),
  Storage (mídia/avatares) e Realtime (inbox, presença, notificações).

### Fato arquitetural decisivo

O frontend **não** passa pelas rotas `/api` para a maioria das leituras:
22 arquivos client-side importam `@/lib/supabase/client` e consultam o
Postgres diretamente sob RLS, além de 4+ hooks de Realtime
(`use-realtime`, `use-presence`, `use-total-unread`, canais no inbox).

As rotas `/api` existem para o que o browser **não pode** fazer:

| Categoria | Exemplos | Por quê |
|---|---|---|
| Integração Meta/WhatsApp | `whatsapp/send`, `whatsapp/webhook`, `templates/*`, `media/*` | Segredos Meta (`META_APP_SECRET`, tokens criptografados com `ENCRYPTION_KEY`) |
| Engines assíncronos | `automations/engine`, `automations/cron`, `flows/cron` | service-role + segredo de cron |
| API pública v1 | `v1/**` | Auth por API key (`wacrm_live_…`) + rate limit |
| Operações privilegiadas de conta | `account/**`, `invitations/**` | RPCs que exigem service-role / validações server-side |
| IA | `ai/**` | Chaves de provedores, embeddings, knowledge base |

## 2. Objetivo

Extrair todo esse backend para um **projeto separado** (repositório próprio),
mantendo o frontend Next.js como app de UI. O Supabase permanece
**compartilhado** como fonte de verdade (banco, auth, storage, realtime).

```
ANTES                              DEPOIS
┌──────────────────────┐          ┌────────────┐   HTTP    ┌─────────────┐
│  Next.js (ulabchat)     │          │  Next.js   │──────────▶│  ulabchat-backend  │
│  UI + /api + lib     │          │  (UI)      │           │  (backend)  │
└─────────┬────────────┘          └─────┬──────┘           └──────┬──────┘
          │                             │  leituras/realtime      │ service-role
          ▼                             ▼  (RLS, anon key)        ▼
      Supabase                       Supabase  ◀──────────────────┘
```

## 3. Decisões de arquitetura (a ratificar na Fase de Arquitetura)

| # | Decisão | Recomendação | Alternativas |
|---|---|---|---|
| D1 | Runtime/framework do novo backend | **Hono** sobre Node ≥ 20 (leve, `Request`/`Response` nativos → portar route handlers quase 1:1) | Fastify, NestJS, Express |
| D2 | Layout de repositório | Repositório separado `ulabchat-backend` (pedido explícito) | Monorepo com workspaces (rejeitado pelo requisito) |
| D3 | Contrato de tipos compartilhados | Pacote `@ulabchat/shared` publicado (npm privado ou git) com tipos de domínio + tipos gerados do Supabase | Duplicação controlada; OpenAPI codegen |
| D4 | Auth do dashboard → backend | Frontend envia o **JWT do Supabase** (`Authorization: Bearer <access_token>`); backend valida com `supabase.auth.getUser(jwt)` | Proxy via rewrites do Next mantendo cookies |
| D5 | Rate limit | Continuar in-memory **enquanto houver 1 instância**; abstrair interface para trocar por Redis/Postgres ao escalar | Redis desde o início |
| D6 | Realtime/presença | **Permanece no frontend** direto com Supabase — não migra | — |

## 4. Fora de escopo (non-goals)

- Trocar o Supabase por outro banco/auth.
- Reescrever lógica de domínio — os módulos de `src/lib/**` migram como estão
  (com seus testes vitest).
- Migrar leituras do dashboard que hoje usam RLS direto — continuam no frontend.
- Multi-região, filas dedicadas (BullMQ etc.) — os crons via HTTP + segredo
  continuam como estão.

## 5. Restrições e invariantes

- **R1**: Zero downtime — migração incremental por grupo de rotas (strangler);
  o webhook da Meta não pode perder eventos durante o cutover.
- **R2**: Nenhum segredo hard-coded; toda config via env (ver inventário em `01`).
- **R3**: Cada consulta com service-role DEVE ser filtrada por `accountId`
  (disciplina já documentada em `src/lib/auth/api-context.ts`).
- **R4**: Contratos da API pública `/api/v1` (documentada em `docs/public-api.md`)
  são **imutáveis** — consumidores externos existem; apenas a URL base muda,
  com redirect/proxy no domínio antigo durante deprecação.
- **R5**: Assinatura de webhooks de saída (`webhooks/sign.ts`) e verificação
  de assinatura da Meta (`webhook-signature.ts`) mantêm algoritmos idênticos.
- **R6**: Arquivos < 500 linhas; validação de entrada nas bordas do sistema.

## 6. Critérios de aceite globais

- [ ] `ulabchat-backend` sobe isolado com `npm run dev` e responde `GET /health`.
- [ ] Todos os testes vitest dos módulos migrados passam no novo repo.
- [ ] Suíte de testes de contrato (Fase 4) verde contra o novo backend.
- [ ] Webhook Meta processado pelo novo backend em staging (eco de mensagem).
- [ ] Frontend sem nenhum route handler em `src/app/api/**` exceto os que
      forem explicitamente mantidos (ver `01_inventario_backend.md` §4).
- [ ] `npm run build && npm test` verdes nos dois projetos.

## 7. Mapa dos módulos desta especificação

| Arquivo | Conteúdo |
|---|---|
| `00_visao_geral_e_escopo.md` | Este documento |
| `01_inventario_backend.md` | Inventário completo: o que migra, o que fica, o que é compartilhado |
| `02_especificacao_servico_backend.md` | Spec + pseudocódigo do novo serviço `ulabchat-backend` |
| `03_migracao_frontend.md` | Spec + pseudocódigo das mudanças no frontend |
| `04_plano_de_fases_tdd.md` | Plano faseado de migração com âncoras TDD |
