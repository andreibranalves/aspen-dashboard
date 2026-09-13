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
3. descarta qualquer URL de alvo herdada (`BASE_URL`, `PREVIEW_BASE_URL`,
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
--no-install --config playwright.safe.config.js ...`. O `--node-options`
   explícito tem precedência sobre `npm_config_node_options`/`.npmrc`, então a
   configuração npm não consegue remover a guarda dos processos filhos antes do
   servidor/browser subirem; o `--no-install` impede resolução/instalação de
   pacotes;
8. cria uma **capability** efêmera e privada do run (arquivo `0600` em diretório
   `0700`, com prova aleatória que nunca é gravada em claro), vinculada ao
   `SAFE_E2E_RUN_ID`, à config dedicada e a `SAFE_E2E_SPECS`, e a injeta no
   ambiente do filho. Em qualquer desfecho — sucesso, falha do Playwright, falha
   de auditoria, exceção ou sinal — o runner revoga a capability e aplica o
   encerramento best-effort do processo lançado (ver "Encerramento best-effort").

Executar o spec diretamente (`npx playwright test
tests/commercial-queue-integrated.spec.js`) é recusado: a config comum
(`playwright.config.js`) **sempre** exclui `SAFE_E2E_SPECS`, então o Playwright
responde `No tests found` (exit != 0) antes de qualquer request. O spec também
revalida os invariantes do ambiente isolado e a capability antes do primeiro
request HTTP.

## Config dedicada e capability

A suíte integrada só existe em `playwright.safe.config.js`, usada exclusivamente
por `scripts/run-safe-e2e.mjs`. Ela seleciona exatamente `SAFE_E2E_SPECS`, roda
com um worker e mantém o servidor local de loopback. No carregamento (antes de
qualquer spawn), ela exige simultaneamente:

- o ambiente isolado COMPLETO (`safeE2eEnvironmentIsValid`); e
- uma capability viva criada pelo runner, checada de forma síncrona
  (`scripts/lib/safe-e2e-capability.mjs`): arquivo/diretório privados, dono
  esperado quando inspecionável, `runId` deste run, config e specs corretas,
  validade curta (5 min) e prova cujo hash bate por comparação em tempo
  constante.

Sem a capability, a config nem carrega (`exit != 0`, sem servidor/browser). Um
conjunto de variáveis públicas "seguras-aparentes" — no shell ou injetado por
`.env`/`loadLocalEnv` — não libera nada: a config comum ignora a suíte de forma
incondicional, e a dedicada exige o arquivo + prova do runner. Capability
ausente, pública, malformada, expirada, de outro run/config/spec, com prova
errada ou já removida falha fechado.

**Fronteira de ameaça:** a capability não afirma proteger contra um processo
malicioso do MESMO usuário (quem lê a prova consegue forjar o arquivo). O
objetivo é impedir que execução acidental ou um ambiente forjado libere/importe
a suíte sem uma capability viva e correspondente criada pelo runner.

## Encerramento best-effort

O Playwright é iniciado como líder de um novo grupo de processos (`detached` em
POSIX), mas o Playwright 1.60 lança `webServer` e browsers com `detached: true`,
criando grupos/sessões independentes que `kill(-pgid)` não alcança. O runner
**não** persegue descendentes; o encerramento é limitado ao que é conhecido com
confiança.

Em qualquer desfecho (sucesso, falha do Playwright, falha de auditoria, exceção
ou sinal), a finalização é idempotente e segue esta ordem:

1. **revoga a capability primeiro** — a liberação nunca é preservada nem
   reutilizada depois de consumida;
2. sinaliza **somente o filho direto/grupo conhecido**, e somente enquanto o
   ciclo de vida do `ChildProcess` (`exitCode`/`signalCode` nulos) comprova que a
   identidade ainda é a que foi lançada; nunca um PID/PGID derivado de `/proc`,
   `ps` ou de um valor guardado anteriormente;
3. espera um tempo limitado pelo fechamento desse filho;
4. encerra com o status convencional do sinal (`SIGINT -> 130`, `SIGTERM -> 143`)
   quando disponível, ou com o status agregado, preservando a falha.

Se o filho já fechou, **nenhum sinal é enviado**: a identidade não é mais
confiável e um PID/PGID reutilizado por outro processo não pode ser atingido. Não
há confirmação de morte, escalada para `SIGKILL`, varredura contínua nem fallback
de plataforma.

**Limites documentados (não são bugs):**

- um descendente que entra em nova sessão (`detached`/`setsid`) pode sobreviver
  ao runner; o processo direto que ignora `SIGTERM` também pode sobreviver;
- a revogação da capability não interrompe código que **já a validou** antes do
  sinal; ela apenas impede uma nova validação.

Ambos rodam dentro do ambiente isolado (banco descartável, loopback, credenciais
removidas e sem egress), então a sobrevivência é uma limitação best-effort
documentada, não uma garantia de contenção.

**Fronteira de contenção:** o runner só chama `process.kill` sobre o grupo/PID do
filho que ele mesmo lançou e que o `ChildProcess` ainda reporta vivo; sinais ao
grupo do próprio runner ou a processos alheios continuam impossíveis.

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
