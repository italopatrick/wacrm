# Fase 2 — Especificação do Serviço `ulabchat-backend`

> ⚠️ **SUPERSEDIDO** por `07_especificacao_servico_go.md` (requisito: Go).
> Mantido como registro histórico; os contratos HTTP, rotas críticas e
> âncoras T2.x referenciadas pelos docs 04/06/07 continuam válidos.

Novo projeto (repositório separado). Framework recomendado: **Hono** (D1) —
os route handlers atuais já usam `Request`/`Response` web-standard, então o
porte é quase mecânico.

## 1. Estrutura de diretórios

```
ulabchat-backend/
├── src/
│   ├── server.ts              # bootstrap: env → app → listen
│   ├── app.ts                 # monta middlewares + routers (testável sem listen)
│   ├── config/
│   │   └── env.ts             # parse/validação de env na inicialização (R2)
│   ├── middleware/
│   │   ├── auth-session.ts    # JWT Supabase → SessionContext
│   │   ├── auth-api-key.ts    # portado de lib/auth/api-context.ts
│   │   ├── auth-cron.ts       # x-cron-secret
│   │   ├── cors.ts            # FRONTEND_ORIGINS
│   │   ├── rate-limit.ts      # interface + impl in-memory (D5)
│   │   └── error-handler.ts   # ApiError → envelope JSON
│   ├── routes/                # 1 router por grupo do inventário (01 §1)
│   │   ├── health.ts
│   │   ├── whatsapp/…         # webhook, send, media, templates, broadcast…
│   │   ├── automations/…      # crud, cron, engine
│   │   ├── flows/…
│   │   ├── account/…
│   │   ├── invitations/…
│   │   ├── ai/…
│   │   └── v1/…               # API pública (contrato imutável, R4)
│   ├── domain/                # módulos MIGRA de src/lib (01 §2), inalterados
│   │   ├── whatsapp/…  automations/…  flows/…  ai/…
│   │   ├── api-keys/…  webhooks/…  storage/…
│   │   └── …
│   └── supabase/
│       ├── admin.ts           # client service-role (unifica os 3 admin-client.ts)
│       └── as-user.ts         # client com JWT do usuário (RLS ativa)
├── supabase/migrations/       # movidas do ulabchat (dono do schema)
├── tests/
│   ├── contract/              # testes de contrato por rota (04 §TDD)
│   └── …                      # *.test.ts migram junto dos módulos
├── Dockerfile
├── package.json               # deps: hono, @supabase/supabase-js, @ulabchat/shared
└── vitest.config.ts
```

## 2. Pseudocódigo — bootstrap e config

```pseudo
// config/env.ts — falhar cedo, nunca hard-code (R2)
FUNCTION loadEnv():
  required = [SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
              ENCRYPTION_KEY, META_APP_ID, META_APP_SECRET,
              AUTOMATION_CRON_SECRET, FRONTEND_ORIGINS, SITE_URL]
  FOR name IN required:
    IF env[name] vazio → THROW StartupError("missing env: " + name)
  RETURN objeto tipado congelado (freeze)
// TDD T2.1: loadEnv lança erro nomeando a variável ausente
// TDD T2.2: nenhum outro arquivo lê process.env (grep no CI)

// server.ts
env = loadEnv()
app = buildApp(env)          // app.ts — puro, recebe deps
listen(app, port = env.PORT ?? 3001)

// app.ts
FUNCTION buildApp(env, deps = defaultDeps(env)):
  app = Hono()
  app.use(errorHandler)                  // sempre primeiro
  app.use(cors(allow = env.FRONTEND_ORIGINS))
  app.route("/health", healthRouter)                      // pública
  app.route("/whatsapp/webhook", webhookRouter(deps))     // auth própria (assinatura)
  app.use("/v1/*", authApiKey(deps))                      // Bearer wacrm_live_…
  app.use(["/automations/cron", "/automations/engine",
           "/flows/cron"], authCron(env))                 // x-cron-secret
  app.use("/*", authSession(deps))                        // demais: JWT Supabase
  … montar routers restantes …
  RETURN app
// TDD T2.3: tabela rota→middleware de auth == inventário (teste de snapshot)
```

## 3. Pseudocódigo — auth de sessão (a única peça realmente nova)

Hoje o dashboard chama `/api` com cookie; no backend separado a sessão chega
como JWT (D4).

```pseudo
// middleware/auth-session.ts
FUNCTION authSession(deps)(request, next):
  token = bearerToken(request.headers.authorization)
  IF !token → RETURN 401 unauthorized()

  // valida assinatura+expiração localmente OU via auth server
  user = deps.supabaseAnon.auth.getUser(token)
  IF error → RETURN 401 unauthorized()

  // duas opções de acesso ao banco a partir daqui:
  //  (a) client "as-user": anon key + header Authorization=token → RLS ativa
  //      (preserva as garantias que as rotas de dashboard têm hoje)
  //  (b) service-role + filtro explícito por accountId (disciplina R3)
  // REGRA: portar cada rota mantendo o modo que ela usa HOJE.
  ctx.session = {
    authType: "session",
    userId:  user.id,
    supabase: deps.clientAsUser(token),   // (a) — default
    admin:    deps.admin,                 // (b) — quando a rota já usava
  }
  RETURN next()
// TDD T2.4: token expirado → 401; token válido → ctx.session.userId correto
// TDD T2.5: client as-user NÃO enxerga linhas de outra conta (teste RLS)
```

`getCurrentAccount` (cookie → conta) é portado para `(jwt → conta)` reusando
a mesma consulta de membership; a assinatura da função de domínio não muda.

## 4. Pseudocódigo — porte mecânico de um route handler

```pseudo
// Padrão de porte (aplicar rota a rota, sem reescrever domínio):
ANTES (Next):  export async function POST(request: Request) { … }
DEPOIS (Hono): router.post("/send", (c) => POST_body(c.req.raw, c.var.session))

REGRAS DO PORTE:
  1. Corpo da função copiado; `NextResponse.json(x, {status})` → `Response.json(...)`
     (ou helper `respond.ts` já existente em lib/api — migra junto).
  2. Params dinâmicos: `[id]` → `:id`; ler de c.req.param() em vez de props.
  3. Toda validação de entrada permanece na borda (R6).
  4. Imports `@/lib/…` → `@/domain/…`; imports `next/*` PROIBIDOS (lint).
// TDD T2.6: por rota portada, teste de contrato compara status+shape do JSON
//           com fixture gravada da implementação Next (golden test)
```

## 5. Pseudocódigo — webhook Meta (rota crítica, R1/R5)

```pseudo
// routes/whatsapp/webhook.ts
GET  /whatsapp/webhook:            // handshake de verificação da Meta
  IF query.hub_verify_token == config_da_conta.verify_token:
    RETURN 200 text(query.hub_challenge)
  RETURN 403

POST /whatsapp/webhook:
  raw = request.rawBody             // ANTES de parsear JSON
  IF !verifySignature(raw, header["x-hub-signature-256"], META_APP_SECRET):
    RETURN 401                      // mesmo algoritmo de webhook-signature.ts (R5)
  ACK 200 IMEDIATO; processamento segue (mesma semântica atual):
    resolveConversation → persistir mensagem → triggers de automations/flows
    → entrega de webhooks de saída (deliver.ts, com guard SSRF)
// TDD T2.7: payload real gravado da Meta → mesmas linhas inseridas que no legado
// TDD T2.8: assinatura inválida → 401 e NADA persistido
```

## 6. Rate limit (D5)

```pseudo
INTERFACE RateLimitStore:
  consume(bucket, limit, windowMs) → { allowed, retryAfter }

IMPL MemoryStore    // porte de lib/rate-limit.ts — default
IMPL RedisStore     // futura, mesma interface; escolhida por env
// TDD T2.9: os testes atuais de rate-limit.test.ts passam contra a interface
```

## 7. Operação

- **Deploy**: container próprio (Dockerfile com health probe port-agnostic,
  como no frontend). Porta via `PORT`.
- **Crons**: o agendador externo (Vercel Cron / pinger) passa a apontar para
  `https://api.…/automations/cron` etc. — mesmos headers.
- **Meta**: atualizar a callback URL do webhook no painel Meta para o novo
  host (plano de cutover na Fase 4).
- **Logs**: prefixar com `requestId`; nunca logar tokens/segredos.

## 8. Critérios de aceite da Fase 2

- [ ] `buildApp` sobe em teste sem rede (deps injetadas) — base de todos os testes.
- [ ] T2.1–T2.9 verdes.
- [ ] Todos os `*.test.ts` migrados de `src/lib` passam sem alteração de lógica
      (apenas paths de import).
