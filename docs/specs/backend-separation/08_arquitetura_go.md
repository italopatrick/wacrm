# Fase 8 — Arquitetura Go: Ratificação de D7–D9 (SPARC: Architecture)

Complementa `05_arquitetura.md` (cujas camadas, fluxos §3 e topologia §4
seguem válidos) ratificando as decisões da revisão Go (`06`) com evidência
do código, e fixando os pontos de arquitetura que só apareceram na
verificação: pgvector, RPCs SQL e o mapa de riscos do bypass de RLS.

## 1. ADRs ratificadas

### ADR-7 (D7) Dados via pgx + sqlc direto no Postgres — **RATIFICADA, com salvaguardas obrigatórias**

**Evidências novas**:

- **pgvector é requisito de driver**: `ai_knowledge_chunks.embedding
  vector(1536)` com busca por cosseno (`<=>`) na migration 030. O pool pgx
  DEVE registrar o tipo (`pgvector/pgvector-go`); a busca semântica e FTS
  já vivem em funções SQL (`match_ai_knowledge_semantic/fts`) — o Go só as
  chama.
- **10 RPCs SQL** concentram a lógica sensível de conta/convite
  (`redeem_invitation`, `transfer_account_ownership`, `set_member_role`,
  `remove_account_member`, `peek_invitation`, contadores e
  `record_webhook_failure`). Em pgx viram `SELECT * FROM fn($1,…)` —
  **nenhuma reescrita**: a lógica já está no banco e é compartilhada com
  qualquer client. Isso reduz materialmente o escopo da reescrita de
  `accounts/invitations` em Go.
- **34 tabelas têm RLS habilitada** — é isso que a conexão direta bypassa.
  Metade das rotas atuais já opera assim (service-role + filtro), mas a
  outra metade hoje se apoia na RLS. Logo, salvaguardas viram **norma
  arquitetural**, não sugestão:

**Salvaguardas obrigatórias (bloqueiam merge)**:
1. Toda query sqlc em tabela multi-tenant tem `account_id = $n` no WHERE —
   verificado por teste de isolamento por tabela (T6.2) e checklist de PR.
2. `internal/store` é o **único** pacote com acesso ao pool; handlers e
   domínio não montam SQL (lint de imports já previsto em 07 §1).
3. Usuário de banco **dedicado** para o `ulabchat-backend` (não `postgres`):
   `GRANT` mínimo por tabela; sem DDL. Migrations rodam por role separada.
4. RPCs `SECURITY DEFINER` que hoje validam `auth.uid()` internamente
   precisam de **auditoria na M0**: chamadas fora do PostgREST não têm
   `request.jwt.claims`. Padrão de porte: versão `_v2(p_actor uuid, …)` que
   recebe o ator explícito, ou `SET LOCAL request.jwt.claims` na transação
   antes do call. Decidir por função na auditoria (âncora T8.1).

### ADR-8 (D8) JWT local com fallback JWKS — **RATIFICADA**

Arquitetura de verificação em `internal/supahttp/authjwks.go`:

```pseudo
IF cfg.SUPABASE_JWT_SECRET presente → verificador HS256 estático
ELSE → JWKS (cache em memória, refresh por kid desconhecido, TTL 10min)
Claims mínimas: sub, exp, aud=="authenticated", iss==SUPABASE_URL/auth/v1
```

Sem chamada ao Auth por request (latência zero de auth); a janela de
revogação é a expiração do access token — mesma garantia do monólito hoje.
Detecção HS256 vs assimétrico é tarefa M0 (um `curl` no JWKS do projeto).

### ADR-9 (D9) Compatibilidade criptográfica — **RATIFICADA**

Formatos confirmados no código (`encryption.ts`, `keys.ts`, `sign.ts`,
`webhook-signature.ts`) e todos mapeiam para stdlib Go (tabela em 06 §D9).
Ponto de arquitetura: `internal/domain/crypto` é o único pacote que toca
`ENCRYPTION_KEY`/HMAC — handlers recebem funções, nunca a chave. Os vetores
cruzados T6.3 entram no CI como job bloqueante desde a M0 (gerados por um
script Node one-off no monólito, commitados em `test/vectors/`).

## 2. Componentes revisados (delta sobre 05 §2)

```
httpx (chi) ──▶ domain ──▶ store (pgx+sqlc+pgvector)  ─┐
                  │                                     ├─▶ Supabase Postgres
                  ├──────▶ supahttp (Storage REST,      │   (34 tabelas RLS,
                  │         JWKS)  ────────────────────┘    10 RPCs, pgvector)
                  └──────▶ providers HTTP (Meta Graph, OpenAI, Anthropic)
```

- `domain/ai/providers` replica `generate.ts`: switch por
  `config.provider` (openai|anthropic) sobre HTTP puro — sem SDK, mantendo
  paridade de payload com os providers TS atuais (golden nos corpos).
- Embeddings (1536 dims → OpenAI `text-embedding-3-small` ou equivalente
  configurado): mesma dimensão é **invariante** — mudar exige re-indexar a
  knowledge base; registrar como restrição no README (R7 nova).
- `store` expõe interfaces por agregado (`ContactStore`, `MessageStore`…)
  para os table tests do domínio rodarem com fakes; integração real usa
  `supabase start` local.

## 3. Fluxo revisado: busca semântica de conhecimento (novo caso crítico)

```
POST /ai/draft (authSession)
  └─▶ domain/ai: contexto da conversa (store)
      └─▶ embeddings HTTP (provider) → vetor 1536
          └─▶ store: SELECT * FROM match_ai_knowledge_semantic($acct, $vec, …)
              └─▶ montar prompt → provider generate → draft na resposta
// Âncora T8.2: golden do draft com fixture de chunks — mesmo ranking
// (distância cosseno) que o monólito produz para a mesma query
```

## 4. Riscos arquiteturais — mapa atualizado

| Risco | Severidade | Mitigação ratificada |
|---|---|---|
| Query nova sem `account_id` (bypass RLS) | **Alta** | Salvaguardas 1–3 da ADR-7; T6.2 por tabela |
| RPC SECURITY DEFINER assumindo `auth.uid()` | **Alta** | Auditoria M0 + padrão `_v2(p_actor)` (T8.1) |
| Drift de comportamento na reescrita | Alta | Golden tests gravados ANTES (T2.6/T6.4); vitest como spec executável |
| Cripto incompatível corrompe tokens | Alta | T6.3 bloqueante no CI desde M0 |
| Dimensão de embedding divergente | Média | Invariante R7 documentada; validação na carga de config |
| Pooler Supabase (pgbouncer/transaction mode) vs prepared statements do pgx | Média | `default_query_exec_mode=simple_protocol` OU porta de session mode — decidir na M0 com teste de carga leve |

## 5. Tarefas M0 adicionadas pela ratificação

1. Auditar as 10 RPCs: quais leem `auth.uid()`/claims → lista `_v2` (T8.1).
2. Detectar HS256 vs JWKS do projeto Supabase (ADR-8).
3. Criar role de banco dedicada + grants mínimos (ADR-7.3).
4. Gerar vetores T6.3 (script Node one-off) e fixtures golden T2.6.
5. Validar modo do pooler com pgx (§4 último risco).

## 6. Handoff

Pseudocódigo de implementação: `07` (estrutura, middlewares, webhook,
estratégia de reescrita §5). Fases e gates: `04` com o delta de `07` §6 e
as tarefas M0 acima. Próximo modo SPARC: **Refinement** (M0).
