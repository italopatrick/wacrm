# Fase 7 — Especificação do Serviço `ulabchat-backend` em Go

Substitui a Fase 2 (`02_especificacao_servico_backend.md`) como spec de
implementação. Decisões em `06_revisao_go_decisoes.md` (ADR-1', ADR-3',
D7–D9). Convenções Go: layout padrão `cmd/` + `internal/`, contexto via
`context.Context`, erros com `errors.Is/As`.

## 1. Estrutura do repositório

```
ulabchat-backend/
├── cmd/api/main.go            # bootstrap: env → deps → router → ListenAndServe
├── api/openapi.yaml           # fonte de verdade do contrato (ADR-3')
├── internal/
│   ├── config/config.go       # loadEnv: falha cedo, struct imutável (R2)
│   ├── httpx/                 # borda HTTP
│   │   ├── router.go          # chi: monta middlewares + rotas (testável)
│   │   ├── middleware/        # auth_session, auth_apikey, auth_cron,
│   │   │                      # cors, ratelimit, requestid, recover
│   │   ├── respond/           # envelopes JSON idênticos ao legado (T2.6)
│   │   └── handlers/          # 1 pacote por grupo: whatsapp, account,
│   │                          # invitations, automations, flows, ai, v1
│   ├── domain/                # reescrita de src/lib (06 §1)
│   │   ├── whatsapp/          # metaapi, sendmessage, broadcast, templates,
│   │   │                      # phoneutils, resolveconv, registration
│   │   ├── automations/       # engine, validate, stepstree, trigger
│   │   ├── flows/             # engine, edges, fallback, validate
│   │   ├── ai/                # autoreply, generate, embeddings, chunk,
│   │   │                      # knowledge, contexto, query, config
│   │   ├── apikeys/  webhooks/  invitations/  accounts/
│   │   └── crypto/            # aesgcm.go (D9), sign.go, metasig.go
│   ├── store/                 # D7: pgx + sqlc
│   │   ├── db.go              # pool pgxpool no pooler do Supabase
│   │   ├── queries/*.sql      # SQL fonte do sqlc (WHERE account_id = $1)
│   │   └── gen/               # código gerado — não editar
│   ├── supahttp/              # APIs REST do Supabase: storage.go, authjwks.go
│   └── ratelimit/             # interface Store + memstore (fixed window)
├── test/
│   ├── golden/                # fixtures gravadas do monólito Next (T2.6)
│   ├── vectors/               # T6.1 (lógica comum) e T6.3 (cripto Node↔Go)
│   └── integration/           # contra Supabase local (supabase start)
├── go.mod  Dockerfile  Makefile  .golangci.yml
```

Regras de dependência (import lint): `httpx → domain → store|supahttp`;
`domain` não importa chi nem lê env — config e clients chegam por injeção.

## 2. Pseudocódigo — bootstrap e config

```pseudo
// internal/config/config.go
FUNC Load() (Config, error):
  required = {SUPABASE_URL, SUPABASE_JWT_SECRET (ou JWKS_URL — D8),
              DATABASE_URL,            // pooler Postgres (D7)
              SUPABASE_SERVICE_ROLE_KEY, // só p/ Storage REST
              ENCRYPTION_KEY (hex 64), META_APP_ID, META_APP_SECRET,
              AUTOMATION_CRON_SECRET, FRONTEND_ORIGINS, SITE_URL, PORT?}
  faltou algum → error nomeando a variável   // TDD T7.1
  ENCRYPTION_KEY: validar hex de 32 bytes na carga, não no primeiro uso

// cmd/api/main.go
cfg  = config.Load() or exit(1)
pool = pgxpool.New(ctx, cfg.DatabaseURL)     // ping na subida
deps = deps{pool, jwtVerifier(cfg), metaClient(cfg), storage(cfg), memRL}
srv  = &http.Server{Handler: httpx.NewRouter(cfg, deps), Addr: ":"+cfg.Port}
graceful shutdown em SIGTERM (drenar in-flight; relevante p/ webhook)
```

## 3. Pseudocódigo — middlewares de auth

```pseudo
// AuthContext (05 §2.1) vira valores tipados no context.Context
// via chave privada; handlers leem com auth.FromContext(ctx).

// middleware/auth_session.go  (ADR-4 + D8 + D7)
FUNC AuthSession(deps) middleware:
  token  = bearer(r.Header["Authorization"])   or 401
  claims = deps.jwt.Verify(token)              or 401   // local, sem I/O
  // requireRole portado de auth/account.ts — 1 query sqlc:
  member = store.GetMembership(ctx, claims.Sub) or 401  // profile+account+role
  ctx    = auth.WithSession(ctx, {UserID, AccountID, Role, Account})
  next(ctx)
// Variante RequireRole(min Role): 403 se hasMinRole falhar (paridade
// com roles.ts — vetores T6.1)
// TDD T7.2: expirado→401; role insuficiente→403; feliz→ctx completo
// D7: daqui em diante TODA query recebe AccountID do contexto (T6.2)

// middleware/auth_apikey.go — reescrita de auth/api-context.ts
FUNC AuthAPIKey(deps) middleware:
  key = bearer or bare token; !looksLikeApiKey(key) → 401
  hash = sha256hex(key)                        // D9, paridade T6.3
  row  = store.FindActiveKeyByHash(ctx, hash)  or 401
  rate = deps.rl.Consume("key:"+row.ID, limits) ; !ok → 429 + Retry-After
  scopes exigidos pela rota ⊄ row.Scopes → 403
  async touchLastUsed(row.ID)                  // best-effort, não bloqueia
  ctx = auth.WithAPIKey(ctx, {AccountID, KeyID, Scopes})
// TDD T7.3: revogada→401; sem scope→403; 429 c/ Retry-After; isolamento T6.2

// middleware/auth_cron.go
header x-cron-secret != cfg.AutomationCronSecret → 401 (compare constante)
secret não configurado → 503 (paridade com rota atual)
```

## 4. Pseudocódigo — webhook Meta e cripto (rotas críticas)

```pseudo
// handlers/whatsapp/webhook.go   (R1, R5, D9)
GET  /whatsapp/webhook:  hub.verify_token ok → 200 texto(hub.challenge) | 403
POST /whatsapp/webhook:
  raw = io.ReadAll(r.Body)                       // ANTES de decodificar
  !metasig.Verify(raw, r.Header["X-Hub-Signature-256"], cfg.MetaAppSecret)
    → 401, nada persistido                       // TDD T2.8
  w.WriteHeader(200)                             // ACK imediato
  go process(detachedCtx, raw)                   // goroutine c/ recover;
    // graceful shutdown espera via WaitGroup — melhora sobre o Node,
    // mesma semântica externa. process(): decode → resolveConversation
    // → insert message (tx pgx) → triggers automations/flows
    // → webhooks.Deliver (assinatura sign.go + guard SSRF)
// TDD T2.7 (golden): payload real → mesmas linhas que o monólito produzia

// internal/domain/crypto/aesgcm.go  (D9 — formatos exatos)
Encrypt(plain):  iv = rand(12B); GCM(key=hexdecode(ENCRYPTION_KEY));
                 return hex(iv)+":"+hex(ct)+":"+hex(tag16)
Decrypt(s):      3 partes → GCM (validar iv==12B) | 2 partes → CBC legado
                 (iv 16B, decrypt-only) | senão → erro
// TDD T6.3: fixtures cifradas pelo Node decifram aqui e vice-versa

// internal/domain/webhooks/ssrf.go — reescrever ssrf.ts:
// resolver DNS → rejeitar IPs privados/loopback/link-local/metadata,
// redirects re-validados. TDD: casos do ssrf.test.ts como table tests.
```

## 5. Estratégia de reescrita do domínio (o grosso do trabalho)

```pseudo
PARA CADA módulo do inventário MIGRA (01 §2), NESTA ordem por onda:
  1. Ler o .ts e o .test.ts correspondentes (spec executável)
  2. Escrever PRIMEIRO o table test Go com os casos do vitest
     (mesmos nomes de caso; fixtures copiadas para test/vectors|golden)
  3. Implementar até verde; queries viram .sql do sqlc (account_id sempre)
  4. Rodar golden test T2.6 da rota que o consome (se já portada)
NUNCA "melhorar" comportamento durante a reescrita — bugs descobertos
viram issue e reproduzem-se em Go (contrato congelado até M5).
```

Ordem interna recomendada (dependências): `crypto` → `store` básico →
`apikeys` → `whatsapp/metaapi+sendmessage` → `webhooks` → `automations` →
`flows` → `ai` → `accounts/invitations`.

## 6. Impacto nas fases M0–M5 (revisa `04`)

| Fase | Revisão para Go |
|---|---|
| M0 | + `go mod init`, chi, sqlc, oapi-codegen; gravar golden fixtures do monólito **antes de tudo**; gerar `openapi.yaml` inicial; decidir HS256 vs JWKS (D8) |
| M1 | **Maior fase agora**: reescrita do domínio (§5) + T6.1/T6.2/T6.3 verdes. Gate: cobertura de casos ≥ vitest de referência |
| M2–M4 | Ondas e cutovers idênticos ao plano (04); gates inalterados |
| M5 | + remover `@ulabchat/shared` do plano TS; frontend consome tipos gerados do OpenAPI (ADR-3') |

## 7. Ferramentas e qualidade

- **Testes**: `go test` (unit/table) + integração com `supabase start`
  local; golden/contract via fixtures HTTP gravadas (T2.6/T6.4).
- **Lint**: golangci-lint (errcheck, gosec, sqlclosecheck) + regra custom
  de import (§1) + revisão obrigatória de `account_id` em queries novas.
- **CI**: vet, lint, test -race, build binário, imagem distroless,
  validação do openapi.yaml, T6.1/T6.3 (vetores cruzados baixados do
  repo do frontend ou submódulo `test/vectors`).
- **Arquivos < 500 linhas** (R6) — vale para `.go` e `.sql`.

## 8. Critérios de aceite (substituem 02 §8)

- [ ] `make test` verde incluindo `-race`; integração contra Supabase local.
- [ ] T6.3 (cripto cruzada) e T6.2 (isolamento) verdes — bloqueantes.
- [ ] Golden tests T2.6 verdes para toda rota portada (autoridade final).
- [ ] Binário sobe com env mínima e responde `GET /health`; falha de env
      nomeia a variável (T7.1).
- [ ] `openapi.yaml` validado no CI e tipos TS gerados consumidos pelo
      frontend sem `any`.
