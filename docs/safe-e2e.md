# E2E integrado seguro

O E2E integrado (`HTTP -> PostgreSQL descartável -> GET /api/commercial-queue -> UI`)
sobe um servidor Node real. Para que ele nunca carregue configuração operacional,
o ponto de entrada é `scripts/run-safe-e2e.mjs`, exposto como `npm run test:e2e:safe`.

## Invocação

```bash
TEST_DATABASE_URL=postgresql://review:review@127.0.0.1:55432/aspen_safe_e2e \
  npm run test:e2e:safe
```

O comando:

1. exige `TEST_DATABASE_URL` apontando para PostgreSQL descartável em loopback
   (`localhost`, `127.0.0.1` ou `[::1]`); alvo remoto ou malformado falha fechado;
2. reconstrói o ambiente por **allowlist fail-closed**: apenas variáveis de
   processo/runtime/teste declaradamente inofensivas (PATH, HOME, locale,
   Node/Playwright, `TEST_DATABASE_URL`, `PORT`, `API_PORT`, knobs do E2E)
   sobrevivem; qualquer outra chave é descartada por padrão. A origem
   operacional explícita é classificada e coberta por testes de regressão:
   credenciais de WhatsApp (`EVOLUTION_*`), e-mail (`RESEND_*`, `SMTP_*`), IA
   (`OPENROUTER_*`), storage (`BLOB_*`, `QUOTATION_BLOB_*`), KV (`KV_*`), Ads
   (`GOOGLE_ADS_*`, `GOOGLE_DATA_MANAGER_*`), Typebot/Meta (`TYPEBOT_*`,
   `META_CAPI_*`, `META_PIXEL_*`), publicação QStash/cron (`QSTASH_*`,
   `CRON_SECRET`), follow-up (`QUOTATION_FOLLOW_UP_*`, incluindo a URL do
   worker), origem da extensão de navegador
   (`WHATSAPP_CONTEXT_EXTENSION_ORIGIN`), tokens de ingestão (`QUOTE_LEADS_*`,
   incluindo o token anterior que a machine-auth ainda aceita), segredos de
   sessão (`APP_PASSWORD_HASH`, `APP_SESSION_SECRET`, `E2E_*`), URLs de banco
   operacional (`PRODUCTION_/STAGING_/RESTORE_DATABASE_URL`,
   `MIGRATION_*`, `CLIENT_CONSOLIDATION_*`),
   `PG*`/`CUTOVER_*`/`LITE_BASELINE_*`/`CLEANUP_*`;
3. descarta qualquer URL de alvo herdada (`BASE_URL`, `STAGING_BASE_URL`,
   `VERCEL_URL`, `DEPLOYMENT_URL`, `PREVIEW_DEPLOYMENT_URL`, `CANARY_BASE_URL`,
   `KNOWN_PRODUCTION_PUBLIC_QUOTATION_URL`), todo modo/origem de plataforma de
   deployment realmente consumido (`VERCEL`, `VERCEL_PROJECT_PRODUCTION_URL`,
   `DEPLOY_PRIME_URL`, `URL`, `VERCEL_ENV`) e os aliases npm que reescrevem o
   ambiente dos filhos (`npm_config_*` case-insensitive, `NPM_TOKEN` e demais
   `npm_*`), reconstruindo `NODE_OPTIONS` do zero, sem preservar preloads
   herdados;
4. fixa `APP_ENV=test`, `EXTERNAL_WRITES_ENABLED=0`, `DOTENV_CONFIG_PATH=/dev/null`
   e injeta um token de ingestão sintético com tamanho válido (>= 32 bytes);
5. **força o alvo HTTP** para `http://localhost:<PLAYWRIGHT_PORT>` (`5173` por
   padrão), validado antes de qualquer spawn: o alvo efetivo nunca é uma URL
   remota herdada, e o browser não pode ser apontado para fora do loopback;
6. pré-carrega `scripts/lib/safe-e2e-network-guard.mjs` no processo do servidor:
   toda chamada `fetch` global é registrada e destinos não-loopback são negados;
7. só então invoca o Playwright via `npx --node-options "--import <guarda>"
   --no-install ...`. O `--node-options` explícito tem precedência sobre
   `npm_config_node_options`/`.npmrc`, então a configuração npm não consegue
   remover a guarda dos processos filhos antes do servidor/browser subirem; o
   `--no-install` impede resolução/instalação de pacotes.

Executar o spec diretamente (`npx playwright test tests/commercial-queue-integrated.spec.js`)
é recusado: o spec verifica os invariantes do ambiente isolado e falha antes do
primeiro request HTTP, em vez de carregar `.env` operacional em silêncio.

## Status fail-closed

O status final do comando é agregado: um run verde do Playwright **não** basta.
O comando falha quando a guarda de egress registrou bloqueio, quando o log de
evidência está ilegível ou quando o marcador de inicialização da guarda está
ausente (instrumentação não comprovada). O ponto de entrada também executa um
controle positivo antes do Playwright: um subprocesso com a mesma guarda tenta um
destino não-loopback e precisa ser recusado; caso contrário o run nem começa.

## Prova de ausência de transporte

Contadores de efeito durável (`quotation_deliveries`, `quotation_email_deliveries`,
`quotation_follow_ups`, `sales_orders`) continuam sendo conferidos, mas não são
suficientes: um listener de request do browser não enxerga egress do servidor.
A evidência válida é o log da guarda de egress (`SAFE_E2E_EGRESS_LOG`), lida pelo
spec: o marcador `guard_initialized` precisa existir, e nenhuma entrada `blocked`
ou saída não-loopback é aceita.

Escopo da guarda: ela instrumenta o `fetch` global do Node, o transporte HTTP
usado por este backend. Ela não afirma bloquear outras stacks de rede
(`net`/`tls` nativos, bibliotecas com socket próprio); o alvo do browser é
impedido separadamente pelo `BASE_URL` de loopback forçado.

## CI

O job `postgres` usa `node scripts/run-safe-e2e.mjs` com apenas
`TEST_DATABASE_URL` definida — nenhuma credencial operacional é exposta ao passo.
