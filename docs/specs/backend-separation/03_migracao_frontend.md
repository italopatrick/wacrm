# Fase 3 — Migração do Frontend (ulabchat)

O que muda no projeto Next.js quando as rotas `/api` deixam de existir
localmente. Princípio: **mudança mínima** — leituras RLS e realtime não
mudam (D6); apenas as chamadas `fetch("/api/…")` ganham um client.

## 1. O que NÃO muda

- Páginas RSC que consultam Supabase via `@/lib/supabase/server`.
- Componentes/hooks com `@/lib/supabase/client` (22 arquivos) e canais
  Realtime (`use-realtime`, `use-presence`, `use-total-unread`,
  `use-unread-notifications`, inbox).
- Login/signup/forgot-password (`@supabase/ssr`, cookies) — auth continua
  direto com o Supabase.
- i18n, layout, componentes visuais.

## 2. Client HTTP central (`src/lib/api/client.ts`)

Hoje os componentes fazem `fetch("/api/whatsapp/send", …)` e o cookie viaja
automático. Com o backend em outro host, é preciso: base URL + JWT + erros.

```pseudo
// src/lib/api/client.ts
FUNCTION apiFetch(path, init = {}):
  base = env.NEXT_PUBLIC_API_URL          // ex.: https://api.ulabchat.app
  session = supabaseBrowser().auth.getSession()
  IF !session → redirecionar para /login (sessão expirou)

  response = fetch(base + path, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: "Bearer " + session.access_token,
      // Content-Type continua responsabilidade do chamador (FormData etc.)
    },
  })

  IF response.status == 401:
    refreshed = supabase.auth.refreshSession()
    IF ok → repetir UMA vez com o novo token
    ELSE → redirecionar /login
  RETURN response

// Variante RSC/Server Action: ler o token da sessão de cookies
// via supabaseServer().auth.getSession() e repassar como Bearer.

// TDD T3.1: apiFetch injeta Authorization e prefixa base URL
// TDD T3.2: 401 → um refresh → retry → sucesso; segundo 401 → logout
// TDD T3.3: FormData não ganha Content-Type manual (boundary preservado)
```

## 3. Substituição mecânica das chamadas

```pseudo
PARA CADA ocorrência de fetch("/api/X", opts) no frontend:
  1. Trocar por apiFetch("/X", opts)          // some o prefixo /api
  2. Nenhuma outra mudança — corpo, método e tratamento de resposta iguais
     (o backend preserva os envelopes JSON, T2.6)

LOCALIZAÇÃO: grep -rn "fetch(['\"]/api/" src/ → lista exaustiva a
             registrar no PR da migração (âncora T3.4: esse grep
             devolve ZERO ao final da onda C)
```

## 4. Casos especiais

| Caso | Tratamento |
|---|---|
| `whatsapp/media/[mediaId]` (mídia em `<img src>`/download) | `src` não envia header → ou (a) apiFetch → blob → objectURL, ou (b) backend aceita token curto via query string assinada. **Spec: (a)** por simplicidade; revisar se houver problema de cache |
| Upload de mídia (FormData) | apiFetch já cobre (T3.3) |
| `invitations/[token]/peek` (página pública `/join/[token]`) | Rota pública no backend; apiFetch sem exigir sessão (flag `allowAnonymous`) |
| SSE/streaming em `ai/draft`/`ai/playground` (se houver) | apiFetch retorna `Response` cru — chamador consome o stream normalmente |
| Rotas chamadas de RSC/Server Actions | usar a variante server do apiFetch (token dos cookies) |

## 5. Período de transição — proxy opcional (mitigação de risco)

Para fazer a onda C rota a rota sem tocar em todos os componentes de uma vez:

```pseudo
// next.config.ts — rewrites temporários
rewrites():
  RETURN migratedRoutes.map(r => ({
    source: "/api/" + r + "/:path*",
    destination: env.NEXT_PUBLIC_API_URL + "/" + r + "/:path*",
  }))
// Limitação: cookie não vira Bearer — exige que o backend aceite também
// cookie Supabase DURANTE a transição (middleware auth-session lê ambos).
// Remover rewrites + suporte a cookie ao final (âncora T3.5).
```

Decisão: usar rewrites **apenas** se a migração big-bang da onda C se provar
arriscada; caso contrário pular direto para o apiFetch.

## 6. Limpeza final

- [ ] Excluir `src/app/api/**` por completo.
- [ ] Excluir módulos MIGRA de `src/lib` (inventário 01 §2) e seus testes.
- [ ] Remover do `.env` do frontend: `SUPABASE_SERVICE_ROLE_KEY`,
      `ENCRYPTION_KEY`, `META_APP_*`, `AUTOMATION_CRON_SECRET` etc. (01 §4).
- [ ] Adicionar `NEXT_PUBLIC_API_URL` à documentação de setup/README.
- [ ] Instalar `@ulabchat/shared` e trocar imports de tipos/roles/scopes/status.
- [ ] CI T1.1 (frontend sem segredos privilegiados) ativo.

## 7. Critérios de aceite da Fase 3

- [ ] `grep "fetch(['\"]/api/"` → zero ocorrências (T3.4).
- [ ] Fluxos manuais verdes em staging: enviar mensagem, reagir, broadcast,
      criar automation, ativar flow, gerar draft IA, convidar membro,
      criar/revogar API key, upload e exibição de mídia.
- [ ] Realtime intacto (mensagem recebida aparece no inbox sem reload).
- [ ] `npm run build && npm test` verdes no frontend.
