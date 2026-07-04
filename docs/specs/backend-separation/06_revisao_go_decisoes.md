# Fase 6 — Revisão: Backend em Go (decisões)

> **Supersede parcialmente** `02` e `05`. Requisito novo: o `ulabchat-backend`
> será implementado em **Go**, não TypeScript/Hono. Este módulo revisa as
> decisões; `07_especificacao_servico_go.md` traz a spec + pseudocódigo.
> Tudo em `00`, `01`, `03` permanece válido (inventário, ondas, frontend).

## 1. O que a mudança de linguagem altera de verdade

A consequência central e honesta: **o "porte mecânico" morre; vira
reescrita.** Os ~60 módulos de `src/lib` e seus `*.test.ts` não podem ser
copiados — cada um é reescrito em Go, e os testes vitest passam a ser a
**especificação executável de referência** (traduzidos para table tests Go
com os mesmos casos e fixtures).

| Aspecto | Plano TS (02/05) | Plano Go |
|---|---|---|
| Handlers | Porte 1:1 (`Request`/`Response`) | Reescrita guiada por golden tests |
| Domínio (`src/lib`) | Copiar + ajustar imports | Reescrever módulo a módulo |
| Testes | Vitest migra intacto | Vitest = referência; reescrever como table tests |
| `@ulabchat/shared` | Pacote TS nos dois lados | Impossível — contrato vira **OpenAPI + codegen** (D3') |
| Risco dominante | Baixo (mesmo código) | Drift de comportamento na reescrita → golden tests obrigatórios |
| Esforço M1 | Dias | **Semanas** — M1 passa a ser a maior fase |

O que **não** muda: estratégia strangler e ondas A/B/C (04), fronteiras do
inventário (01), mudanças do frontend (03 — `apiFetch` é agnóstico de
linguagem do servidor), Supabase compartilhado, contratos HTTP congelados.

## 2. Decisões revisadas e novas

### ADR-1' (substitui ADR-1) Stack Go: `net/http` (Go ≥ 1.22) + chi

- Router: **chi** (ou stdlib puro — Go 1.22 tem method+path patterns);
  chi ganha por middlewares maduros (requestId, recoverer, CORS).
- Sem framework pesado (Gin/Echo/Fiber desnecessários: 50 rotas JSON).
- Versão Go pinada em `go.mod`; binário único distroless no Docker.

### ADR-3' (substitui ADR-3) Contrato: OpenAPI como fonte de verdade

`@ulabchat/shared` (TS) não serve um backend Go. Novo arranjo:

```
ulabchat-backend/api/openapi.yaml   ← fonte de verdade (gerada na M0 a partir
        │                       do comportamento atual + docs/public-api.md)
        ├── codegen Go   → types + chi server stubs (oapi-codegen)
        └── codegen TS   → tipos do client p/ o frontend (openapi-typescript)
```

Lógica pura hoje compartilhável (roles, scopes, status, validadores) é
**duplicada** Go/TS com paridade garantida por testes de vetor comum
(arquivo JSON de casos usado pelas duas suítes — T6.1).

### D7 (nova) Acesso a dados: pgx direto no Postgres do Supabase

Não existe client Supabase Go de primeira linha. Opções avaliadas:

| Opção | Veredito |
|---|---|
| `supabase-community/supabase-go` / `postgrest-go` | Rejeitada como base: camada REST a mais, comunidade, sem transações reais |
| **`jackc/pgx/v5` direto no Postgres (pooler do Supabase)** | **Escolhida** — transações, performance, controle total |

Consequência sobre RLS: conexão direta **bypassa RLS** (equivale ao
service-role). A autorização passa a ser 100% aplicativa:

- Middleware `requireRole` em Go valida o JWT e carrega membership
  (`profiles`/`account_members`) — mesmo contrato do `auth/account.ts`.
- **Toda query filtra por `account_id` explicitamente** — generaliza a
  disciplina R3, que hoje já cobre metade das rotas (as de service-role).
- Salvaguarda opcional documentada: `SET LOCAL role/request.jwt.claims`
  por transação para reativar RLS em rotas sensíveis (custo: 1 round-trip).
- Queries com **sqlc** (SQL tipado gerado) para reduzir erro humano; regra
  de lint/review: nenhuma query em tabela multi-tenant sem `account_id` no
  WHERE (T6.2 valida com testes de isolamento por conta).

Auth/Storage continuam via HTTP: validação de JWT local (D8) e Storage
pela API REST do Supabase (upload de mídia é só multipart + bearer).

### D8 (nova) Validação de JWT Supabase em Go

`github.com/golang-jwt/jwt/v5`, validando localmente (sem round-trip ao
Auth): HS256 com `SUPABASE_JWT_SECRET` **ou** JWKS (`/auth/v1/.well-known/
jwks.json`) se o projeto usar chaves assimétricas — detectar na M0 e fixar.
Claims usadas: `sub` (userId), `exp`, `aud`. Revogação de sessão segue a
semântica atual (expiração curta do access token).

### D9 (nova) Compatibilidade criptográfica byte a byte

O banco já contém dados cifrados/hasheados pelo Node. O Go DEVE ler e
escrever nos mesmos formatos (verificado no código atual):

| Artefato | Formato exato | Go stdlib |
|---|---|---|
| Tokens WhatsApp (`encryption.ts`) | AES-256-**GCM**, chave hex 32B, IV 12B, `iv:ct:tag` em hex; legado AES-256-**CBC** `iv:ct` (decrypt-only, IV 16B) | `crypto/aes` + `cipher.NewGCM` (tag 16B já é default) |
| API keys (`keys.ts`) | SHA-256 hex do plaintext `wacrm_live_` + 32B CSPRNG; prefixo de exibição = literal + 8 chars | `crypto/sha256`, `crypto/rand`, compare constante |
| Webhooks saída (`sign.ts`) | `X-Wacrm-Signature: t=<unix>,v1=<hex hmac-sha256(t + "." + rawBody)>` | `crypto/hmac` |
| Webhook Meta (`webhook-signature.ts`) | `X-Hub-Signature-256: sha256=<hex hmac(META_APP_SECRET, rawBody)>` | `crypto/hmac` |

**T6.3 (âncora crítica)**: suíte de vetores cruzados — fixtures cifradas
pelo Node de produção-like decifram em Go e vice-versa; hashes/assinaturas
idênticos para as mesmas entradas. Bloqueante antes de qualquer cutover.

### Decisões que permanecem (inalteradas)

- **ADR-2** repo separado `ulabchat-backend` · **ADR-4** JWT Bearer do dashboard
  (mecânica de validação agora é D8) · **ADR-5** rate limit atrás de
  interface (Go: `sync.Map`/mutex fixed-window; 1 réplica até Redis) ·
  **ADR-6** realtime/presença no frontend · R1–R6 · ondas A/B/C · fases
  M0–M5 (com M1 redimensionada — ver 07 §6).

## 3. Trade-offs assumidos ao escolher Go

| Ganho | Custo aceito |
|---|---|
| Binário único, deploy trivial, footprint mínimo | Reescrever ~60 módulos testados que já funcionam |
| Concorrência real p/ broadcast/engines (goroutines vs event loop) | Duplicação Go/TS da lógica pura compartilhada (mitigada por T6.1) |
| Tipagem em tempo de compilação ponta a ponta com sqlc | Time precisa manter dois ecossistemas (npm + go) |
| Isolamento total dos segredos em processo separado (igual ao plano TS) | Perda do reuso direto dos testes vitest (viram referência) |

## 4. Âncoras TDD desta revisão

- **T6.1** Vetores comuns (JSON) de roles/scopes/status/validadores passam
  nas duas implementações (Go e TS do frontend).
- **T6.2** Isolamento multi-tenant: para cada query sqlc em tabela com
  `account_id`, teste que conta A não lê/escreve dados da conta B.
- **T6.3** Vetores criptográficos cruzados Node↔Go (D9) — bloqueante.
- **T6.4** OpenAPI: respostas do backend Go validam contra `openapi.yaml`;
  golden tests T2.6 (gravados do monólito Next **antes** da reescrita)
  continuam sendo a autoridade final de contrato.
