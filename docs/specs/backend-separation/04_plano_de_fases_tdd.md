# Fase 4 — Plano de Migração Faseado com Âncoras TDD

Estratégia **strangler**: o novo backend cresce ao lado do monólito;
cada onda corta uma fatia, com rollback trivial (voltar a URL antiga).

## Fase M0 — Fundações (sem risco, sem cutover)

1. Criar repositório `ulabchat-backend` + scaffold da Fase 2 (§1) com `/health`.
2. Criar pacote `@ulabchat/shared` (tipos, roles, scopes, status, validadores puros).
3. CI dos dois novos projetos: lint, typecheck, vitest, build de container.

**Âncoras TDD**
- T0.1 `GET /health` → 200 com shape `{ status: "ok" }`.
- T1.2 pureza do shared (sem `next`/`react`/`process.env`).
- T2.1/T2.2 validação de env na inicialização.

**Gate**: containers dos dois projetos buildam; shared publicado/instalável.

## Fase M1 — Migrar domínio + testes (ainda sem tráfego)

1. Copiar módulos MIGRA (01 §2) para `src/domain/**` ajustando só imports.
2. Unificar os três `admin-client.ts` em `supabase/admin.ts`.
3. Portar `rate-limit` atrás da interface `RateLimitStore` (T2.9).

**Âncoras TDD**: a suíte vitest existente (≈60 arquivos `*.test.ts`) passa
inalterada no novo repo — é a rede de segurança de todo o resto.

**Gate**: `npm test` verde no `ulabchat-backend` com cobertura igual à do monólito.

## Fase M2 — Onda A: máquina-a-máquina

1. Portar `whatsapp/webhook`, `automations/cron|engine`, `flows/cron` (02 §5).
2. Deploy em staging; apontar um número WhatsApp de teste para o novo host.
3. **Shadow period** (produção): manter o webhook da Meta no monólito e
   reproduzir payloads gravados contra o novo backend, comparando efeitos.
4. Cutover: trocar callback URL no painel Meta + URLs do agendador de cron.
   Rollback = trocar de volta (a Meta reenvia com retry — janela tolerável, R1).

**Âncoras TDD**
- T2.7 golden test do webhook (payload real → mesmas escritas no banco).
- T2.8 assinatura inválida → 401 sem efeitos.
- T4.1 cron sem `x-cron-secret` → 401; com secret → drena pendências
  (fixture com 2 rows: 1 vencida processada, 1 futura intacta).

**Gate**: 48h de produção no novo backend sem divergência de mensagens.

## Fase M3 — Onda B: API pública v1

1. Portar rotas `v1/**` + middleware `auth-api-key`.
2. Publicar novo base URL em `docs/public-api.md`; manter o antigo
   respondendo por proxy/redirect durante o período de deprecação (R4).

**Âncoras TDD**
- T2.6 contrato golden por rota v1 (status + envelope idênticos ao legado).
- T4.2 key sem scope → 403; key revogada → 401; rate limit → 429 c/ retryAfter.
- T4.3 isolamento de conta: key da conta A jamais lê dados da conta B (R3).

**Gate**: consumidores de teste operando 100% no novo host.

## Fase M4 — Onda C: rotas do dashboard + frontend

1. Implementar `auth-session` (JWT) no backend (02 §3) e `apiFetch` no
   frontend (03 §2).
2. Portar grupos em sub-ondas independentes, cada uma com deploy próprio:
   c1 WhatsApp ações → c2 Conta/Convites → c3 Automations/Flows → c4 IA.
3. Caso especial de mídia (03 §4) validado manualmente com imagem/áudio/doc.

**Âncoras TDD**
- T2.4/T2.5 sessão: 401 em token expirado; RLS preservada no client as-user.
- T3.1–T3.3 apiFetch (headers, retry-once, FormData).
- T4.4 e2e por sub-onda (mínimo): enviar mensagem, criar convite + redeem,
  ativar flow com execução, gerar draft IA.

**Gate por sub-onda**: checklist manual de staging (03 §7) verde antes da próxima.

## Fase M5 — Limpeza e endurecimento

1. Excluir `src/app/api/**` e módulos migrados do monólito (03 §6).
2. Remover segredos privilegiados do env do frontend + ativar CI T1.1.
3. Mover `supabase/migrations` para o `ulabchat-backend` (novo dono do schema).
4. Atualizar README/CHANGELOG dos dois projetos; `docs/public-api.md` migra.
5. Encerrar proxy/rewrites e suporte a cookie no backend, se usados (T3.5).

**Âncoras TDD**
- T3.4 `grep fetch("/api/` → zero no frontend.
- T1.3 snapshot de rotas do backend == inventário.
- T4.5 smoke suite completa nos dois projetos: `npm run build && npm test`.

**Gate final**: critérios de aceite globais (00 §6) todos ✅.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Perda de eventos Meta no cutover | Shadow period + retry nativo da Meta + gate de 48h (M2) |
| Drift de contrato na v1 | Golden tests T2.6 gerados a partir do monólito ANTES do porte |
| Sessão JWT divergir do comportamento por cookie | T2.5 (RLS) + sub-ondas pequenas na M4 |
| Rate limit in-memory com 2+ instâncias | Interface D5 pronta; travar em 1 réplica até RedisStore |
| `<img src>` de mídia sem header de auth | Solução blob/objectURL especificada (03 §4), validada na sub-onda c1 |
| Segredo esquecido no frontend | CI T1.1 bloqueante |

## Ordem de execução resumida

```
M0 fundações → M1 domínio+testes → M2 webhook/cron (cutover 1)
→ M3 API v1 (cutover 2) → M4 dashboard c1→c4 (cutovers 3–6)
→ M5 limpeza → aceite global (00 §6)
```
