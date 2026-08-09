# Fechamento da Migração e Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (preferred for this plan). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Corrigir os blockers finais, validar PostgreSQL com snapshot anonimizado, executar Playwright, comprovar backup/restore/canário/rollback e deixar a branch pronta para merge e cutover de produção.

**Architecture:** PostgreSQL será o CRM interno e a fonte de verdade de clientes, leads, cotações, revisões e histórico. Frappe/ERPNext será somente fonte de leitura durante a migração. O outbox continuará registrando eventos internos, mas nenhum CRM externo, N8N ou Evolution será configurado; um fake bridge local testará o contrato de entrega.

**Tech Stack:** React 19, Vite 6, Node.js ESM, TypeScript, PostgreSQL/Neon, Drizzle, Vercel Functions, Playwright, `node:test`, Puppeteer PDF e Upstash/Vercel KV já instalados.

## Global Constraints

- Não alterar, resetar ou sobrescrever mudanças locais em `master`.
- Trabalhar em `feature/migracao-sem-frappe`.
- Não adicionar dependências.
- Não enviar dados brutos, PII, secrets ou payloads Frappe ao outbox, logs, manifests ou relatórios.
- `CRM_CORE_QUOTES_ENABLED` é o único flag de rollout de orçamentos.
- `CRM_OPERATIONAL_MODE` não altera o caminho de orçamentos.
- `CRM_CORE_QUOTES_ENABLED=false` permanece em Preview e Production até o gate de canário.
- Frappe permanece somente como fonte legada durante a migração.
- `/api/view` permanece administrativo e protegido.
- Links de cliente usam apenas `/api/public-quotation` com token vinculado à revisão.
- Nenhum CRM externo será integrado nesta fase.
- N8N e Evolution permanecem sem configuração e sem envio real.
- Apply exige manifest aprovado, cutoff de origem, identidade PostgreSQL correta e ausência de fixture.
- `TEST_DATABASE_URL`, `RESTORE_DATABASE_URL` e `DATABASE_URL` nunca são definidos para o mesmo processo, exceto no comando de testes PostgreSQL que usa somente `TEST_DATABASE_URL`.
- Comandos Drizzle e CLI de migração carregam o alvo isolado em `STAGING_DATABASE_URL` a partir do secret manager e definem somente `DATABASE_URL="$STAGING_DATABASE_URL"`; nunca confiam em variável herdada do shell.
- Todo comando operacional de staging valida `CUTOVER_PG_SERVICE` e `CUTOVER_EXPECTED_DATABASE=aspen_test`.
- Cada task termina com teste focado e commit independente.

---

### Task 1: Fixar contrato de ambientes e alvo PostgreSQL

**Files:**
- Modify: `.env.example`
- Modify: `docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md`
- Modify: `scripts/migrate-frappe-crm.mjs`
- Modify: `api/_functions/frappe-migration.ts`
- Test: `tests/unit/migrate-frappe-cli.test.ts`
- Test: `tests/unit/cutover-checklist.test.ts`

**Interfaces:**
- `assertDatabaseContract(env)` continua validando host, porta e database efetivos do serviço `CUTOVER_PG_SERVICE`.
- `migrate-frappe-crm.mjs --apply` passa a exigir `--expected-manifest-hash` antes de abrir qualquer escrita.
- O contrato operacional usa `CUTOVER_PG_SERVICE`, `PGSERVICEFILE`, `PGPASSFILE`, `DATABASE_URL`, `RESTORE_DATABASE_URL` e `RESTORE_PG_SERVICE`.

- [ ] **Step 1: Write failing tests for mandatory apply hash and safe target selection.**

Adicionar em `tests/unit/migrate-frappe-cli.test.ts` casos que executem o parser/runner existente e confirmem:

```ts
await assert.rejects(
  () => runCli(['--apply']),
  /expected-manifest-hash|manifest.*obrigatório/i,
);

await assert.rejects(
  () => runCli(['--apply', '--expected-manifest-hash', '0'.repeat(64)], {
    CUTOVER_PG_SERVICE: 'aspen-cutover',
    DATABASE_URL: productionUrl,
    PGSERVICEFILE: serviceFile,
    PGPASSFILE: passFile,
  }),
  /manifest|hash/i,
);
```

O teste deve comprovar que a rejeição ocorre antes do primeiro método de repository ser chamado.

- [ ] **Step 2: Run focused tests and confirm failure.**

Run:

```bash
node --test --import tsx tests/unit/migrate-frappe-cli.test.ts tests/unit/cutover-checklist.test.ts
```

Expected: FAIL nos casos de apply sem hash e apply com contrato incompleto.

- [ ] **Step 3: Make the apply hash mandatory.**

Em `scripts/migrate-frappe-crm.mjs`, rejeitar `--apply` sem hash com erro sanitizado.

Em `api/_functions/frappe-migration.ts`, rejeitar `mode === 'apply'` quando `expectedManifestHash` não for uma string hexadecimal de 64 caracteres.

Manter a comparação case-insensitive e retornar erro antes de `processProductUnit`, `processClientUnit` ou `processQuotationUnit`.

Não aceitar `FRAPPE_MIGRATION_FIXTURE` em apply.

- [ ] **Step 4: Make environment commands explicit.**

Atualizar o runbook para usar sempre:

```bash
env -u DATABASE_URL -u TEST_DATABASE_URL -u RESTORE_DATABASE_URL \
  DATABASE_URL="$STAGING_DATABASE_URL" \
  CUTOVER_PG_SERVICE="$CUTOVER_PG_SERVICE" \
  CUTOVER_EXPECTED_DATABASE=aspen_test \
  PGSERVICEFILE="$PGSERVICEFILE" \
  PGPASSFILE="$PGPASSFILE" \
  sh -eu <<'SH'
node --input-type=module <<'NODE'
import { assertDatabaseContract } from './scripts/migrate-frappe-crm.mjs';
assertDatabaseContract(process.env);
NODE
npm run db:migrate
SH
```

Para apply, o comando deve exportar `CUTOVER_PG_SERVICE`, `PGSERVICEFILE` e `PGPASSFILE` no mesmo bloco que chama `assertDatabaseContract`.

Adicionar uma checagem que falhe quando o shell carregar `TEST_DATABASE_URL` apontando para o mesmo database de `DATABASE_URL`.

- [ ] **Step 5: Run focused tests and commit.**

Run:

```bash
node --test --import tsx tests/unit/migrate-frappe-cli.test.ts tests/unit/cutover-checklist.test.ts
npx drizzle-kit check
```

Expected: PASS, sem segredo nos erros.

Commit:

```bash
git add .env.example docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md scripts/migrate-frappe-crm.mjs api/_functions/frappe-migration.ts tests/unit/migrate-frappe-cli.test.ts tests/unit/cutover-checklist.test.ts
git commit -m "fix: require safe migration apply targets"
```

---

### Task 2: Fechar a fronteira de links públicos

**Files:**
- Modify: `src/pages/ManualOrcamentoPage.tsx`
- Modify: `src/pages/QuotationDetailPage.tsx`
- Modify: `src/lib/printFormats.ts`
- Modify: `api/_functions/lib/quote-response.ts`
- Modify: `api/_functions/communication-flow-preview.ts`
- Modify: `api/_functions/send-whatsapp-flow.ts`
- Test: `tests/unit/public-quotation.test.ts`
- Test: `tests/unit/quotation-content.test.ts`
- Create or modify: `tests/quotation-cutover.spec.js`

**Interfaces:**
- `issuePublicQuotationToken({ revisionId, repository })` continua sendo a única emissão de link público PostgreSQL.
- `buildViewUrl()` não retorna URL compartilhável.
- Uma cotação legada sem revisão PostgreSQL retorna `publicUrl: null` ou indicador explícito de indisponibilidade.

- [ ] **Step 1: Write failing link-boundary tests.**

Adicionar testes unitários que verifiquem:

```ts
assert.equal(buildViewUrl('https://app.test', 'ORC-1'), '');
assert.match(publicUrl, /\/api\/public-quotation\?token=/);
assert.doesNotMatch(customerMessage, /\/api\/view/);
```

Adicionar em `tests/quotation-cutover.spec.js` uma asserção de rede:

```js
const customerRequests = [];
page.on('request', request => {
  if (request.url().includes('/api/view')) customerRequests.push(request.url());
});
await expect(page.getByRole('button', { name: /link público/i })).toHaveCount(0);
expect(customerRequests).toEqual([]);
```

- [ ] **Step 2: Run the new tests and confirm failure.**

Run:

```bash
node --test --import tsx tests/unit/public-quotation.test.ts tests/unit/quotation-content.test.ts
npx playwright test tests/quotation-cutover.spec.js --project=chromium
```

Expected: FAIL nos callsites legados que ainda geram `/api/view`.

- [ ] **Step 3: Remove unsupported customer links.**

Em `ManualOrcamentoPage.tsx`, `QuotationDetailPage.tsx` e `printFormats.ts`, separar visualização administrativa de compartilhamento de cliente.

Para revisão PostgreSQL, usar o `publicUrl` retornado pela API.

Para cotação legada sem revisão pública, não renderizar link para cliente e exibir estado explícito de indisponibilidade.

Não remover a visualização administrativa autenticada que usa `/api/view` internamente.

Em `communication-flow-preview.ts` e `send-whatsapp-flow.ts`, rejeitar ou omitir links sem suporte em vez de montar uma URL administrativa.

- [ ] **Step 4: Verify token binding and authorization.**

Cobrir:

- token válido renderiza a revisão indicada;
- token expirado retorna erro sanitizado;
- token revogado não renderiza;
- token de revisão antiga não mostra conteúdo da revisão nova;
- GET administrativo `/api/view` sem sessão retorna 401;
- nenhum texto destinado ao cliente contém `/api/view`.

- [ ] **Step 5: Run tests and commit.**

Run:

```bash
node --test --import tsx tests/unit/public-quotation.test.ts tests/unit/quotation-content.test.ts
npx playwright test tests/quotation-cutover.spec.js --project=chromium
```

Expected: PASS.

Commit:

```bash
git add src/pages/ManualOrcamentoPage.tsx src/pages/QuotationDetailPage.tsx src/lib/printFormats.ts api/_functions/lib/quote-response.ts api/_functions/communication-flow-preview.ts api/_functions/send-whatsapp-flow.ts tests/unit/public-quotation.test.ts tests/unit/quotation-content.test.ts tests/quotation-cutover.spec.js
git commit -m "fix: keep customer links revision-bound"
```

---

### Task 3: Tornar o envio PostgreSQL fail-closed e sem Frappe

**Files:**
- Modify: `api/_functions/send-whatsapp.ts`
- Modify: `api/_functions/send-whatsapp-flow.ts`
- Modify: `api/_functions/communication-flow-preview.ts`
- Test: `tests/unit/whatsapp-flows.test.ts`
- Test: `tests/unit/quotation-outbox.test.ts`
- Create or modify: `tests/unit/send-whatsapp.test.ts`

**Interfaces:**
- Criar helper interno `loadPostgresSendContext(input)` em `send-whatsapp.ts` com entrada `quotationId`, `revisionId`, `businessNumber` e repository.
- O helper retorna snapshot imutável, destinatário validado, revisão, token público e mídias permitidas.
- O caminho `source === 'postgres'` não chama `erpGetDoc`, `erpGetList`, `erpPut`, renderer legado ou URL `ERPNEXT_BASE`.

- [ ] **Step 1: Write failing tests for missing quotation and ownership.**

Adicionar casos:

```ts
await assert.rejects(
  () => sendQuotation({ source: 'postgres', quotation_id: undefined }),
  /cotação.*obrigatória|revisão.*obrigatória/i,
);
assert.equal(providerCalls, 0);
assert.equal(outboxCalls, 0);
```

Adicionar caso em que `business_number` não pertence à revisão carregada.

Esperar erro antes do provider e antes do enqueue.

Adicionar um fetcher que lança quando a URL contém `ERPNEXT_BASE` e confirmar que o caminho PostgreSQL passa sem chamar esse fetcher.

- [ ] **Step 2: Run focused tests and confirm failure.**

Run:

```bash
node --test --import tsx tests/unit/whatsapp-flows.test.ts tests/unit/quotation-outbox.test.ts tests/unit/send-whatsapp.test.ts
```

Expected: FAIL porque referências ausentes ainda podem alcançar o provider.

- [ ] **Step 3: Enforce pre-send PostgreSQL validation.**

No início do ramo PostgreSQL, exigir `quotation_id` e revisão resolvível.

Validar snapshot, status, telefone pertencente à cotação e todos os itens antes de executar o provider.

Emitir token público e renderizar PDF a partir do snapshot somente depois da validação.

Executar `enqueueQuotationSentEvent` somente depois que o provider retornar `accepted: true`.

Se o enqueue falhar depois da aceitação externa, preservar o erro de durabilidade e não fingir sucesso.

- [ ] **Step 4: Block Frappe media in PostgreSQL path.**

Antes de qualquer `sendMedia`, rejeitar URLs que começam com `ERPNEXT_BASE` quando `postgresPath` estiver ativo.

Aceitar somente mídias geradas pelo renderer PostgreSQL ou URLs aprovadas de assets públicos.

Não enviar `ERPNEXT_TOKEN` para nenhum caminho PostgreSQL.

- [ ] **Step 5: Add provider and outbox assertions.**

Verificar que:

- provider não é chamado quando `quotation_id` está ausente;
- provider não é chamado quando telefone não pertence ao snapshot;
- provider recebe apenas após PDF/token válidos;
- `quotation.sent` é enfileirado após aceite;
- retry e erro de outbox não apagam a cotação;
- caminho legado continua separado e explicitamente selecionado.

- [ ] **Step 6: Run tests and commit.**

Run:

```bash
node --test --import tsx tests/unit/whatsapp-flows.test.ts tests/unit/quotation-outbox.test.ts tests/unit/send-whatsapp.test.ts
npm run build:api
```

Expected: PASS.

Commit:

```bash
git add api/_functions/send-whatsapp.ts api/_functions/send-whatsapp-flow.ts api/_functions/communication-flow-preview.ts tests/unit/whatsapp-flows.test.ts tests/unit/quotation-outbox.test.ts tests/unit/send-whatsapp.test.ts
git commit -m "fix: validate PostgreSQL sends before delivery"
```

---

### Task 4: Fazer enrichment e aprovações falharem fechados

**Files:**
- Modify: `api/_functions/lib/frappe-migration-core.ts`
- Modify: `api/_functions/frappe-migration.ts`
- Modify: `scripts/migrate-frappe-crm.mjs`
- Test: `tests/unit/frappe-migration.test.ts`
- Test: `tests/unit/frappe-migration-postgres.test.ts`
- Test: `tests/unit/migrate-frappe-cli.test.ts`

**Interfaces:**
- `normalizeFrappeQuotation(record, clientLineage)` rejeita `record.__migration_enrichment_error === true`.
- `canonicalApprovalKey(sourceDoctype, sourceId)` retorna sempre uma chave sanitizada e hashada para Customer/Lead.
- `approveDivergences()` compara apenas chaves canônicas e retorna contagem real de aprovadas.

- [ ] **Step 1: Add production-shaped and enrichment-error tests.**

Usar fixture de Quotation com:

```json
{
  "quotation_to": "Customer",
  "party_name": "CUST-001",
  "items": [{"item_code": "SKU-001", "qty": 2, "rate": 10}]
}
```

Adicionar variante com `__migration_enrichment_error: true`.

Esperar que a primeira normalize cliente e itens e que a segunda seja bloqueada, sem persistência.

- [ ] **Step 2: Add approval privacy tests.**

Testar que:

- Customer/Lead IDs de qualquer comprimento passam por hash;
- a saída não contém o identificador bruto;
- chave desconhecida falha sem ser ecoada;
- aprovação Customer/Lead usa a mesma representação do relatório;
- `divergenceCounts.approved` conta somente divergências efetivamente aprovadas.

- [ ] **Step 3: Implement fail-closed normalization.**

Em `normalizeFrappeQuotation`, verificar o marker de enrichment antes de ler `party_name`, itens ou lineage.

Manter resolução de `quotation_to` e `party_name` para Customer e Lead.

Não converter erro parcial em quotation vazia ou registro aparentemente válido.

- [ ] **Step 4: Canonicalize approval evidence.**

Centralizar a construção de approval key em uma função pura.

Usar a mesma função no relatório, no CLI e na validação do apply.

Não imprimir chaves desconhecidas nem IDs brutos nos erros.

- [ ] **Step 5: Run tests and commit.**

Run:

```bash
node --test --import tsx tests/unit/frappe-migration.test.ts tests/unit/frappe-migration-postgres.test.ts tests/unit/migrate-frappe-cli.test.ts
```

Expected: PASS.

Commit:

```bash
git add api/_functions/lib/frappe-migration-core.ts api/_functions/frappe-migration.ts scripts/migrate-frappe-crm.mjs tests/unit/frappe-migration.test.ts tests/unit/frappe-migration-postgres.test.ts tests/unit/migrate-frappe-cli.test.ts
git commit -m "fix: fail closed on migration enrichment"
```

---

### Task 5: Preservar revisões imutáveis sem conflito de draft

**Files:**
- Modify: `api/_db/frappe-migration-repository.ts`
- Modify: `api/_db/schema.ts` only if the final constraint needs a migration adjustment
- Modify: `api/_functions/public-quotation.ts` only if token issuance needs a status guard
- Test: `tests/unit/frappe-migration-repository.test.ts`
- Test: `tests/unit/public-quotation.test.ts`
- Test: `tests/unit/quotation-lifecycle-postgres.test.ts`

**Interfaces:**
- `applyQuotationUnit(unit)` mantém uma única revisão `rascunho` por cotação.
- Revisão não rascunho nunca é atualizada em lugar.
- Se a última revisão for rascunho não emitido, source change atualiza esse draft.
- Se a última revisão for `enviado`, `aprovado` ou `perdido`, source change cria nova versão `rascunho`.

- [ ] **Step 1: Add failing repository tests.**

Cobrir:

```ts
await repository.applyQuotationUnit(firstUnit);
await repository.applyQuotationUnit(changedUnit);
const revisions = await repository.listRevisions(quotationId);
assert.equal(revisions.filter(r => r.status === 'rascunho').length, 1);
```

Adicionar caso com revisão `enviado` e confirmar:

```ts
assert.notEqual(oldRevision.id, newRevision.id);
assert.equal(oldRevision.total, oldTotal);
assert.equal(newRevision.total, newTotal);
```

Adicionar token público para a revisão antiga e confirmar que seu PDF/checksum permanece igual após novo apply.

- [ ] **Step 2: Run focused repository tests and confirm failure.**

Run:

```bash
node --test --import tsx tests/unit/frappe-migration-repository.test.ts tests/unit/public-quotation.test.ts tests/unit/quotation-lifecycle-postgres.test.ts
```

Expected: FAIL no conflito de índice `quote_revisions_one_draft_per_quotation_unique` ou no conteúdo mutado.

- [ ] **Step 3: Implement draft reuse and immutable append.**

Em `applyQuotationUnit`, carregar a última revisão e o draft existente dentro da mesma transação.

Atualizar somente o draft quando ele ainda for o estado editável.

Quando a revisão atual não for draft, inserir `version = latest.version + 1` com novo UUID.

Nunca executar `delete quoteRevisionItems` para uma revisão não draft.

- [ ] **Step 4: Bind public tokens to immutable revision.**

Confirmar que `issuePublicQuotationToken` persiste `revisionId` e que o renderer recarrega exatamente esse revision ID.

Adicionar teste que aplica source change depois do token e compara conteúdo, total, versão e checksum antigos.

- [ ] **Step 5: Run PostgreSQL test database migration and tests.**

Run with explicit target:

```bash
env -u DATABASE_URL -u TEST_DATABASE_URL -u RESTORE_DATABASE_URL \
  DATABASE_URL="$STAGING_DATABASE_URL" \
  CUTOVER_PG_SERVICE="$CUTOVER_PG_SERVICE" \
  CUTOVER_EXPECTED_DATABASE=aspen_test \
  PGSERVICEFILE="$PGSERVICEFILE" \
  PGPASSFILE="$PGPASSFILE" \
  sh -eu <<'SH'
node --input-type=module <<'NODE'
import { assertDatabaseContract } from './scripts/migrate-frappe-crm.mjs';
assertDatabaseContract(process.env);
NODE
npm run db:migrate
unset DATABASE_URL RESTORE_DATABASE_URL
export TEST_DATABASE_URL="$STAGING_DATABASE_URL"
export CUTOVER_PG_SERVICE CUTOVER_EXPECTED_DATABASE=aspen_test PGSERVICEFILE PGPASSFILE
test "$(psql --dbname "service=$CUTOVER_PG_SERVICE" --tuples-only --no-align --command 'SELECT current_database();' | tr -d '[:space:]')" = aspen_test
node --test --test-concurrency=1 --import tsx tests/unit/frappe-migration-repository.test.ts tests/unit/public-quotation.test.ts tests/unit/quotation-lifecycle-postgres.test.ts
SH
```

Expected: PASS and no second draft for one quotation.

- [ ] **Step 6: Commit.**

```bash
git add api/_db/frappe-migration-repository.ts api/_db/schema.ts api/_functions/public-quotation.ts tests/unit/frappe-migration-repository.test.ts tests/unit/public-quotation.test.ts tests/unit/quotation-lifecycle-postgres.test.ts
git commit -m "fix: preserve immutable quotation revisions"
```

---

### Task 6: Corrigir rate limit KV atômico e identidade pública

**Files:**
- Modify: `api/_lib/rate-limit.ts`
- Test: `tests/unit/rate-limit.test.ts`

**Interfaces:**
- `checkRateLimitAsync(req)` mantém retorno `Promise<boolean>`.
- A janela pública usa uma operação Redis atômica que incrementa e define TTL no mesmo comando.
- Falha ou ausência de KV continua retornando `false`.

- [ ] **Step 1: Add a race/TTL contract test.**

Substituir o fake KV atual por um fake que falha se `incr` e `expire` forem chamados separadamente.

Adicionar teste que executa chamadas concorrentes para a mesma chave e confirma limite determinístico.

- [ ] **Step 2: Run focused test and confirm failure.**

Run:

```bash
node --test --import tsx tests/unit/rate-limit.test.ts
```

Expected: FAIL porque a implementação atual usa `incr` e `expire` separados.

- [ ] **Step 3: Use the installed Upstash Redis atomic API.**

Usar `kv.eval` ou equivalente já exposto por `@upstash/redis`, sem dependência nova.

O script deve:

```lua
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
```

Manter hash SHA-256 do token e IP de socket como identidade.

Não voltar a confiar no primeiro `x-forwarded-for`.

- [ ] **Step 4: Run tests and commit.**

Run:

```bash
node --test --import tsx tests/unit/rate-limit.test.ts
```

Expected: PASS.

Commit:

```bash
git add api/_lib/rate-limit.ts tests/unit/rate-limit.test.ts
git commit -m "fix: make public rate limits atomic"
```

---

### Task 7: Tornar outbox externo opcional e criar fake bridge

**Files:**
- Modify: `scripts/quotation-outbox-worker.mjs`
- Modify: `api/_functions/quotation-outbox-worker.ts` only if adapter status needs explicit reporting
- Modify: `docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md`
- Modify: `.env.example`
- Test: `tests/unit/quotation-outbox.test.ts`
- Test: `tests/unit/settings-app-server.test.ts`
- Create: `tests/fixtures/fake-outbox-bridge.mjs`

**Interfaces:**
- `quotationOutboxConfigFromEnv(env)` aceita zero ou mais providers externos.
- `OUTBOX_CRM_URL` não é obrigatório para iniciar configuração interna.
- O worker nunca reivindica evento quando o provider daquele evento não está configurado.
- `tests/fixtures/fake-outbox-bridge.mjs` expõe `POST /events` e `GET /health` usando apenas Node built-in.

- [ ] **Step 1: Write failing optional-provider tests.**

Adicionar teste que executa a validação do worker com apenas `DATABASE_URL` e confirma que não acusa `OUTBOX_CRM_URL` ausente.

Adicionar teste que cria fake bridge, envia evento canônico e confirma o body:

```json
{
  "event_type": "quotation.sent",
  "provider": "crm",
  "quotation_id": "uuid",
  "revision_id": "uuid",
  "business_number": "ORC-20260808",
  "idempotency_key": "opaque-key"
}
```

Confirmar que nenhum campo de cliente, payload Frappe ou token entra no body.

- [ ] **Step 2: Implement fake bridge.**

Usar `node:http`.

`GET /health` retorna 200.

`POST /events` registra requisições em memória e retorna `{ "accepted": true, "message_id": "fake-1" }`.

Variáveis de teste controlam respostas 500, timeout e duplicação sem entrar em produção.

- [ ] **Step 3: Remove mandatory external CRM configuration.**

Alterar `requiredConfiguration` para exigir apenas `DATABASE_URL` e um provider quando o worker for explicitamente executado.

Se não houver provider configurado, o worker termina sem reivindicar eventos e informa que entrega externa está desativada.

Não criar `OUTBOX_CRM_*`, `OUTBOX_N8N_*` ou `OUTBOX_EVOLUTION_*` em Preview/Production.

- [ ] **Step 4: Cover delivery semantics.**

Testar fake bridge com:

- aceite e `providerMessageId`;
- 500 seguido de retry;
- timeout seguido de retry;
- idempotency key repetida;
- attempts máximos e dead-letter;
- lease expirada e ownership incorreto.

- [ ] **Step 5: Run tests and commit.**

Run:

```bash
node --test --import tsx tests/unit/quotation-outbox.test.ts tests/unit/settings-app-server.test.ts
node scripts/quotation-outbox-worker.mjs
```

Expected: o teste do worker sem providers encerra de forma segura e não chama rede externa.

Commit:

```bash
git add scripts/quotation-outbox-worker.mjs api/_functions/quotation-outbox-worker.ts docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md .env.example tests/unit/quotation-outbox.test.ts tests/unit/settings-app-server.test.ts tests/fixtures/fake-outbox-bridge.mjs
git commit -m "fix: make external outbox providers optional"
```

---

### Task 8: Preparar e validar snapshot Frappe anonimizado

**Files:**
- Create: `scripts/anonymize-frappe-snapshot.mjs`
- Modify: `scripts/migrate-frappe-crm.mjs`
- Modify: `docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md`
- Test: `tests/unit/frappe-migration.test.ts`
- Test: `tests/unit/migrate-frappe-cli.test.ts`

**Interfaces:**
- `node scripts/anonymize-frappe-snapshot.mjs --input "$FRAPPE_SNAPSHOT_INPUT" --output "$FRAPPE_SNAPSHOT_OUTPUT"` preserva doctype, relacionamento, itens, preços e estados.
- A saída substitui nomes, documentos, telefones, emails e endereços por valores determinísticos.
- A saída não contém token, payload HTTP ou identificador real.

- [ ] **Step 1: Add anonymizer tests.**

Usar fixture sintético com dois clientes, um Lead, dois produtos e duas quotations relacionadas.

Confirmar que referências internas continuam consistentes e que os valores reais não aparecem no output.

- [ ] **Step 2: Implement deterministic anonymization.**

Usar SHA-256 com salt fornecido somente no processo para gerar pseudônimos estáveis.

Manter `quotation_to`, `party_name`, `items`, `item_code`, `quotation_id` e relacionamentos necessários.

Não imprimir o salt nem conteúdo de entrada/saída.

- [ ] **Step 3: Capture source cutoff before extraction.**

Executar a extração com cutoff criado antes da primeira página.

Propagar `modified_before` para todas as listas Frappe que suportam filtro.

Registrar somente `sourceSnapshotAt` e hashes no manifest.

- [ ] **Step 4: Run dry-run against protected staging artifact.**

Run:

```bash
env -u DATABASE_URL -u TEST_DATABASE_URL -u RESTORE_DATABASE_URL \
  DATABASE_URL="$STAGING_DATABASE_URL" \
  CUTOVER_PG_SERVICE="$CUTOVER_PG_SERVICE" \
  CUTOVER_EXPECTED_DATABASE=aspen_test \
  PGSERVICEFILE="$PGSERVICEFILE" \
  PGPASSFILE="$PGPASSFILE" \
  sh -eu <<'SH'
node --input-type=module <<'NODE'
import { assertDatabaseContract } from './scripts/migrate-frappe-crm.mjs';
assertDatabaseContract(process.env);
NODE
node scripts/migrate-frappe-crm.mjs --dry-run > "$CUTOVER_DIR/report.dry-run.json"
SH
```

Para o teste fixture, usar fixture anonimizado somente em dry-run.

Confirmar `manifestHash`, `sourceSnapshotAt`, `migrationRunId`, contagens e divergências.

- [ ] **Step 5: Apply to `aspen_test` with reviewed hash.**

Run:

```bash
env -u DATABASE_URL -u TEST_DATABASE_URL -u RESTORE_DATABASE_URL \
  DATABASE_URL="$STAGING_DATABASE_URL" \
  CUTOVER_PG_SERVICE="$CUTOVER_PG_SERVICE" \
  CUTOVER_EXPECTED_DATABASE=aspen_test \
  PGSERVICEFILE="$PGSERVICEFILE" \
  PGPASSFILE="$PGPASSFILE" \
  sh -eu <<'SH'
node --input-type=module <<'NODE'
import { assertDatabaseContract } from './scripts/migrate-frappe-crm.mjs';
assertDatabaseContract(process.env);
NODE
node scripts/migrate-frappe-crm.mjs --apply \
  --expected-manifest-hash "$EXPECTED_MANIFEST_HASH"
SH
```

Confirmar que fixture é rejeitada em apply, hash alterado é rejeitado e nenhuma escrita ocorre após mismatch.

- [ ] **Step 6: Run tests and commit.**

Run:

```bash
node --test --import tsx tests/unit/frappe-migration.test.ts tests/unit/migrate-frappe-cli.test.ts
```

Expected: PASS, sem PII no report.

Commit:

```bash
git add scripts/anonymize-frappe-snapshot.mjs scripts/migrate-frappe-crm.mjs docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md tests/unit/frappe-migration.test.ts tests/unit/migrate-frappe-cli.test.ts
git commit -m "test: validate anonymized migration snapshots"
```

---

### Task 9: Criar Playwright local determinístico e staging real

**Files:**
- Modify: `playwright.config.js`
- Create: `tests/quotation-cutover.spec.js`
- Create: `tests/quotation-cutover-staging.spec.js`
- Create: `tests/support/staging-auth.js`
- Modify: `docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md`

**Interfaces:**
- A suíte local usa mocks explícitos de API e não depende de provider externo.
- A suíte staging usa `STAGING_BASE_URL`, usuário de teste e IDs não-PII fornecidos pelo runbook.
- Staging deve falhar por precondição ausente, não mascarar a ausência com skip silencioso.

- [ ] **Step 1: Add local deterministic browser coverage.**

Em `tests/quotation-cutover.spec.js`, cobrir:

```js
test('PostgreSQL quotation never exposes admin view link', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/#/manual');
  await expect(page.getByRole('heading', { name: /Novo Orçamento/i })).toBeVisible();
  expect(requests.filter(url => url.includes('/api/view'))).toEqual([]);
});
```

Adicionar casos de link público, status de revisão, PDF e erro sanitizado.

- [ ] **Step 2: Add staging login helper.**

`tests/support/staging-auth.js` deve abrir `/#/login`, preencher credenciais vindas de `E2E_USERNAME` e `E2E_PASSWORD`, aguardar `/api/login` 200 e confirmar a rota autenticada.

O helper deve falhar se `STAGING_BASE_URL`, `E2E_USERNAME` ou `E2E_PASSWORD` estiverem ausentes.

Não salvar password em `storageState` versionado.

- [ ] **Step 3: Add staging real-flow tests.**

`tests/quotation-cutover-staging.spec.js` deve testar:

- login real;
- lista e abertura de cotação PostgreSQL conhecida;
- PDF da revisão atual;
- emissão e consumo de link público;
- expiração/revogação;
- `/api/view` sem sessão retorna 401;
- criação/edição com revision ID novo;
- no request para domínio Frappe;
- rollback-compatible read de cotação legada;
- nenhum envio real para N8N/Evolution.

IDs devem vir de `KNOWN_POSTGRES_QUOTATION_ID` e `KNOWN_LEGACY_QUOTATION_ID`.

- [ ] **Step 4: Add staging fake provider contract.**

Executar o fake bridge local em testes de integração do outbox.

No staging browser test, validar somente que o caminho PostgreSQL não faz request a provider real e que o outbox registra referência canônica.

- [ ] **Step 5: Run local Playwright.**

Run:

```bash
npm run test:e2e -- tests/quotation-cutover.spec.js
```

Expected: PASS sem credenciais externas.

- [ ] **Step 6: Run staging Playwright.**

Run usando secrets pelo secret manager:

```bash
BASE_URL="$STAGING_BASE_URL" \
STAGING_E2E=1 \
E2E_USERNAME="$E2E_USERNAME" \
E2E_PASSWORD="$E2E_PASSWORD" \
KNOWN_POSTGRES_QUOTATION_ID="$KNOWN_POSTGRES_QUOTATION_ID" \
KNOWN_LEGACY_QUOTATION_ID="$KNOWN_LEGACY_QUOTATION_ID" \
npx playwright test tests/quotation-cutover-staging.spec.js --project=chromium
```

Expected: PASS, trace e screenshot somente em falha, sem secret nos artefatos.

- [ ] **Step 7: Commit.**

```bash
git add playwright.config.js tests/quotation-cutover.spec.js tests/quotation-cutover-staging.spec.js tests/support/staging-auth.js docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md
git commit -m "test: cover quotation cutover in Playwright"
```

---

### Task 10: Executar backup, restore e reconciliação PostgreSQL

**Files:**
- Modify: `scripts/backup-crm.mjs` only for verified command/identity gaps
- Modify: `docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md`
- Test: `tests/unit/backup-crm.test.ts`
- Test: `tests/unit/backup.test.ts`

**Interfaces:**
- `RESTORE_DATABASE_URL` nunca pode ser igual à identidade de `DATABASE_URL` ou de `PRODUCTION_DATABASE_URL`.
- `backup-crm.mjs --validate --file <dump>` exige `RESTORE_PG_SERVICE`, `RESTORE_EXPECTED_DATABASE=aspen_restore`, mapeamento host/porta/database e `current_database()` do serviço nomeado.
- Reconciliação compara contagens, hashes, lineage, revisões finais, itens, templates, status e divergências aprovadas por identidade de origem.

- [ ] **Step 1: Provision required client tools.**

Instalar `pg_dump`, `psql` e `jq` no host operacional.

Verificar:

```bash
pg_dump --version
psql --version
jq --version
```

Expected: versões presentes antes de qualquer backup.

O host operacional deve falhar fechado se qualquer ferramenta estiver ausente.
O runbook exige registrar as versões no diretório protegido do corte.

- [ ] **Step 2: Run backup preflight.**

Run somente contra `STAGING_DATABASE_URL`, com serviço nomeado, `CUTOVER_BACKUP_DIR` externo e protegido:

```bash
env -u DATABASE_URL -u TEST_DATABASE_URL -u RESTORE_DATABASE_URL \
  DATABASE_URL="$STAGING_DATABASE_URL" \
  CUTOVER_PG_SERVICE="$CUTOVER_PG_SERVICE" \
  PGSERVICEFILE="$PGSERVICEFILE" \
  PGPASSFILE="$PGPASSFILE" \
  CUTOVER_BACKUP_DIR="$CUTOVER_BACKUP_DIR" \
  CUTOVER_EXPECTED_DATABASE=aspen_test \
  node scripts/backup-crm.mjs --preflight
```

Registrar capacidade, tamanho, conexões, retenção e espaço de destino sem imprimir URL.
O preflight é obrigatório e aborta o backup quando capacidade está crítica ou o destino não tem modo 0700.


- [ ] **Step 3: Create and checksum backup.**

Run com serviço nomeado, `CUTOVER_BACKUP_DIR` externo e explícito:

```bash
env -u DATABASE_URL -u TEST_DATABASE_URL -u RESTORE_DATABASE_URL \
  DATABASE_URL="$STAGING_DATABASE_URL" \
  CUTOVER_PG_SERVICE="$CUTOVER_PG_SERVICE" \
  PGSERVICEFILE="$PGSERVICEFILE" \
  PGPASSFILE="$PGPASSFILE" \
  CUTOVER_BACKUP_DIR="$CUTOVER_BACKUP_DIR" \
  CUTOVER_EXPECTED_DATABASE=aspen_test \
  node scripts/backup-crm.mjs
sha256sum "$BACKUP_FILE" > "$CUTOVER_DIR/backup.sha256"
sha256sum --check "$CUTOVER_DIR/backup.sha256"
```

Confirmar diretório 0700, arquivo 0600 e arquivo fora do checkout.
Não selecionar automaticamente o backup mais recente.


- [ ] **Step 4: Restore into `aspen_restore`.**

Run:

```bash
: "${RESTORE_DATABASE_URL:?configure isolated restore target}"
: "${RESTORE_PG_SERVICE:?configure the named restore service}"
: "${PRODUCTION_DATABASE_URL:?configure active production identity}"
: "${PGSERVICEFILE:?configure protected PGSERVICEFILE}"
: "${PGPASSFILE:?configure protected PGPASSFILE}"
env -u DATABASE_URL -u TEST_DATABASE_URL -u RESTORE_DATABASE_URL \
  DATABASE_URL="$STAGING_DATABASE_URL" \
  RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" \
  RESTORE_PG_SERVICE="$RESTORE_PG_SERVICE" \
  RESTORE_EXPECTED_DATABASE=aspen_restore \
  PRODUCTION_DATABASE_URL="$PRODUCTION_DATABASE_URL" \
  PGSERVICEFILE="$PGSERVICEFILE" \
  PGPASSFILE="$PGPASSFILE" \
  node scripts/backup-crm.mjs --validate --file "$BACKUP_FILE"
```

Confirmar tabelas, migrations, contagens e um registro sintético de verificação no destino isolado.


- [ ] **Step 5: Run dry-run, apply and reconciliation on `aspen_test`.**

Persistir:

- report dry-run;
- manifest hash;
- report apply;
- checksum dos reports;
- run ID;
- reconciliação por doctype e status;
- divergências aprovadas.

Abortar se `blocking > 0`, se manifest mudar, se a identidade do banco divergir ou se a reconciliação não produzir `reconciliation.json` e seu checksum fora do checkout.
Usar o comando executável da seção 7 do runbook para persistir hashes, contagens, statuses, lineage, revisões e divergências aprovadas.

- [ ] **Step 6: Run tests and commit documentation.**

Run:

```bash
node --test --import tsx tests/unit/backup-crm.test.ts tests/unit/backup.test.ts tests/unit/cutover-checklist.test.ts
```

Expected: PASS.

Commit:

```bash
git add scripts/backup-crm.mjs docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md tests/unit/backup-crm.test.ts tests/unit/backup.test.ts tests/unit/cutover-checklist.test.ts
git commit -m "docs: verify backup restore and reconciliation"
```

---

### Task 11: Executar canário, rollback e bloqueio de egress

**Files:**
- Modify: `docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md`
- Modify: `vercel.json` only if the approved deployment needs an existing safe route/configuration change
- Test: `tests/operational-mode.spec.js`
- Test: `tests/quotation-lifecycle.spec.js`
- Test: `tests/quotation-cutover-staging.spec.js`

**Interfaces:**
- Estado efetivo permanece controlado apenas por `CRM_CORE_QUOTES_ENABLED` e `CRM_QUOTES_ROLLOUT_STATE`.
- Rollback não apaga dados PostgreSQL.
- Leitura legada e leitura PostgreSQL devem ser verificadas separadamente.

- [ ] **Step 1: Deploy reviewed branch to Preview.**

Deploy sem Production:

```bash
vercel deploy
```

Confirmar commit, env Preview, logs sem segredo e health endpoint.

- [ ] **Step 2: Block Frappe egress in staging.**

Aplicar regra de rede ou DNS deny para o domínio Frappe no ambiente staging.

Manter apenas fixture/endpoint de migração aprovado para a etapa de import.

Confirmar que abrir, editar, renderizar PDF e gerar link PostgreSQL não depende de Frappe.

- [ ] **Step 3: Run staging regression.**

Run:

```bash
BASE_URL="$STAGING_BASE_URL" STAGING_E2E=1 \
npx playwright test tests/quotation-cutover-staging.spec.js tests/operational-mode.spec.js tests/quotation-lifecycle.spec.js --project=chromium
```

Expected: PASS com egress bloqueado.

- [ ] **Step 4: Execute canário PostgreSQL.**

Manter `CRM_CORE_QUOTES_ENABLED=false` durante preparação.

Ativar `CRM_CORE_QUOTES_ENABLED=true` e `CRM_QUOTES_ROLLOUT_STATE=postgres-write` somente no ambiente staging.

Criar uma cotação interna controlada.

Verificar persistência, revisão, PDF, link público, outbox e logs.

Não usar cliente real nem envio real.

- [ ] **Step 5: Exercise rollback.**

Restaurar:

```text
CRM_CORE_QUOTES_ENABLED=false
CRM_QUOTES_ROLLOUT_STATE=legacy
```

Confirmar leitura legada conhecida, leitura PostgreSQL preservada e ausência de fallback silencioso em erro de banco.

- [ ] **Step 6: Production canary.**

Antes do canário, registrar:

- backup checksum;
- commit deployed;
- manifest hash;
- contagens e divergências;
- aprovador operacional;
- janela de rollback;
- métricas de erro.

Executar somente uma cotação interna controlada.

Abortar em qualquer erro de link, PDF, revision, egress, autenticação ou reconciliação.

- [ ] **Step 7: Commit final runbook evidence.**

```bash
git add docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md tests/operational-mode.spec.js tests/quotation-lifecycle.spec.js tests/quotation-cutover-staging.spec.js
git commit -m "docs: record quotation canary and rollback evidence"
```

---

### Task 12: Full verification and final review gate

**Files:**
- Modify: `.superpowers/sdd/2026-08-08-fechamento-migracao-cutover/progress.md`
- Create: `docs/superpowers/reports/2026-08-08-migracao-acceptance.md`

**Interfaces:**
- O relatório final lista cada critério, comando, resultado e limitação operacional.
- Nenhum Critical ou Important permanece sem correção ou decisão explícita.

- [ ] **Step 1: Run complete local verification.**

```bash
npm run test:unit
npm run build:api
npm run type-check
npm run lint
npm run check:tailwind
npm run build
npx drizzle-kit check
git diff --check
```

Expected: zero falhas, warnings existentes documentados e zero segredo detectado.

- [ ] **Step 2: Run complete PostgreSQL verification.**

```bash
env -u DATABASE_URL -u TEST_DATABASE_URL -u RESTORE_DATABASE_URL \
  DATABASE_URL="$STAGING_DATABASE_URL" \
  CUTOVER_PG_SERVICE="$CUTOVER_PG_SERVICE" \
  CUTOVER_EXPECTED_DATABASE=aspen_test \
  PGSERVICEFILE="$PGSERVICEFILE" \
  PGPASSFILE="$PGPASSFILE" \
  sh -eu <<'SH'
node --input-type=module <<'NODE'
import { assertDatabaseContract } from './scripts/migrate-frappe-crm.mjs';
assertDatabaseContract(process.env);
NODE
npm run db:migrate
unset DATABASE_URL RESTORE_DATABASE_URL
export TEST_DATABASE_URL="$STAGING_DATABASE_URL"
export CUTOVER_PG_SERVICE CUTOVER_EXPECTED_DATABASE=aspen_test PGSERVICEFILE PGPASSFILE
test "$(psql --dbname "service=$CUTOVER_PG_SERVICE" --tuples-only --no-align --command 'SELECT current_database();' | tr -d '[:space:]')" = aspen_test
node --test --test-concurrency=1 --import tsx tests/unit/frappe-migration-postgres.test.ts tests/unit/orcamento-postgres.test.ts tests/unit/quotations-postgres.test.ts tests/unit/quotation-lifecycle-postgres.test.ts tests/unit/frappe-migration-repository.test.ts
SH
```

Expected: PASS contra `aspen_test`, sem conexão em `neondb`.

- [ ] **Step 3: Run complete Playwright verification.**

```bash
set -euo pipefail
npm run test:e2e -- tests/quotation-cutover.spec.js tests/client-core.spec.js tests/orcamento-core.spec.js tests/quotations-core.spec.js tests/quotation-lifecycle.spec.js tests/quotation-templates-core.spec.js tests/whatsapp-inbox.spec.js
: "${STAGING_BASE_URL:?configure staging origin without credentials}"
: "${E2E_USERNAME:?configure staging test account identifier}"
: "${E2E_PASSWORD:?configure staging password through secret manager}"
: "${STAGING_E2E_USERNAME:?configure the staging account attestation}"
: "${KNOWN_POSTGRES_QUOTATION_ID:?configure non-PII PostgreSQL quotation id}"
: "${KNOWN_POSTGRES_SCRATCH_QUOTATION_ID:?configure disposable non-PII sent scratch quotation id}"
: "${KNOWN_LEGACY_QUOTATION_ID:?configure non-PII legacy quotation id}"
: "${STAGING_EXTERNAL_PROVIDERS_DISABLED:?set provider guard to 1}"
: "${STAGING_EGRESS_BLOCKED:?set egress guard to 1}"
: "${STAGING_FIXTURE_RESET:?set fixture reset attestation to 1}"
[ "$STAGING_E2E_USERNAME" = "$E2E_USERNAME" ]
[ "$STAGING_EXTERNAL_PROVIDERS_DISABLED" = 1 ]
[ "$STAGING_EGRESS_BLOCKED" = 1 ]
[ "$STAGING_FIXTURE_RESET" = 1 ]
[ -z "${OUTBOX_N8N_URL:-}" ]
[ -z "${N8N_OUTBOX_WEBHOOK_URL:-}" ]
[ -z "${OUTBOX_EVOLUTION_URL:-}" ]
[ -z "${OUTBOX_CRM_URL:-}" ]
BASE_URL="$STAGING_BASE_URL" \
STAGING_E2E=1 \
E2E_USERNAME="$E2E_USERNAME" \
E2E_PASSWORD="$E2E_PASSWORD" \
STAGING_E2E_USERNAME="$STAGING_E2E_USERNAME" \
KNOWN_POSTGRES_QUOTATION_ID="$KNOWN_POSTGRES_QUOTATION_ID" \
KNOWN_POSTGRES_SCRATCH_QUOTATION_ID="$KNOWN_POSTGRES_SCRATCH_QUOTATION_ID" \
KNOWN_LEGACY_QUOTATION_ID="$KNOWN_LEGACY_QUOTATION_ID" \
STAGING_EXTERNAL_PROVIDERS_DISABLED="$STAGING_EXTERNAL_PROVIDERS_DISABLED" \
STAGING_EGRESS_BLOCKED="$STAGING_EGRESS_BLOCKED" \
STAGING_FIXTURE_RESET="$STAGING_FIXTURE_RESET" \
npx playwright test tests/quotation-cutover-staging.spec.js --project=chromium
```

Expected: local e staging PASS.

The staging run requires firewall egress evidence separately because browser listeners cannot observe server-side Frappe/provider fetches.

- [ ] **Step 4: Run diagnostics.**

```bash
npm run lint
```

Then run `lens_diagnostics` with `mode=all` for files editados.

Expected: nenhum erro bloqueante novo.

- [ ] **Step 5: Complete acceptance report.**

O relatório deve registrar:

- commits e arquivos alterados;
- migrations aplicadas no alvo de teste;
- snapshot e manifest hashes;
- backup/restore checksums;
- Playwright report;
- canário e rollback;
- fake bridge results;
- valores de rollout usados;
- riscos não testáveis;
- confirmação de que CRM externo, N8N e Evolution não foram configurados.

- [ ] **Step 6: Request one final scoped review.**

Gerar pacote somente da nova série de commits desde `e373cb5`.

Revisar Critical, Important e Minor contra a spec aprovada.

Não declarar pronto antes de o reviewer retornar `Ready to merge`.

- [ ] **Step 7: Commit acceptance evidence.**

```bash
git add docs/superpowers/reports/2026-08-08-migracao-acceptance.md
git commit -m "docs: record migration completion evidence"
```

---

## Definition of Done

- [ ] Nenhum link customer-facing usa `/api/view`.
- [ ] Nenhum caminho PostgreSQL chama Frappe ou usa `ERPNEXT_TOKEN`.
- [ ] Envio sem cotação/revisão válida não alcança provider.
- [ ] Revisões antigas permanecem imutáveis.
- [ ] Existe no máximo um draft por cotação.
- [ ] Apply sem manifest hash ou com hash divergente falha antes de escrever.
- [ ] Enrichment incompleto bloqueia a unidade e não produz dado parcial.
- [ ] Approval keys são canônicas, hashadas e não vazam PII.
- [ ] Rate limit público é atômico, compartilhado e fail-closed.
- [ ] CRM externo, N8N e Evolution não são necessários para iniciar o sistema interno.
- [ ] `aspen_test` recebeu migrations e integração PostgreSQL passou.
- [ ] Snapshot anonimizado foi migrado e reconciliado.
- [ ] Playwright local e staging passou com Frappe egress bloqueado.
- [ ] Backup foi criado, checksum validado e restore executado em `aspen_restore`.
- [ ] Canário e rollback foram executados com evidência.
- [ ] Full unit/build/lint/type/Tailwind/Drizzle checks passaram.
- [ ] Scoped final review retornou pronto para merge.
- [ ] `CRM_CORE_QUOTES_ENABLED` só foi ativado após os gates anteriores.
