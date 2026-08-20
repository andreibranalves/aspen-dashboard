# Limpeza PostgreSQL-only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover superfícies Typebot, quote leads HTTP, KV e integrações legadas comprovadamente mortas, preservando dados e fluxos PostgreSQL vivos.

**Architecture:** O dispatcher deixará de registrar os endpoints públicos aposentados.
A normalização, identidade, merge e persistência PostgreSQL de `quote_leads` continuarão no módulo puro e no repository existente porque WhatsApp, CRM e emissão de orçamento ainda dependem deles.
A remoção será protegida por testes de rotas, inventário versionado e validação estrutural sem migration ou operação externa.

**Tech Stack:** Node.js 22 ESM, npm, TypeScript, Node Test Runner, Playwright, Drizzle/PostgreSQL, Markdown, Git.

**Spec:** `docs/superpowers/specs/2026-08-18-postgresql-only-cleanup-design.md`

## Global Constraints

- A remoção deve ser orientada por evidência, não por busca textual cega.
- As rotas `typebot-lead-capture` e `quote-leads` só podem ser removidas após confirmação operacional read-only de ausência de consumidores externos ativos.
- `quote_leads`, seus dados, seu schema e o contrato interno mínimo usado por WhatsApp, CRM e emissão de orçamento devem permanecer.
- Não criar migration, alterar schema, fazer backfill, apagar dados ou renomear tabela.
- Não alterar, remover, copiar ou renomear migrations ou snapshots sob `drizzle/`.
- Preservar specs, planos e relatórios históricos sob `docs/superpowers/`.
- Atualizar somente documentação operacional vigente.
- Não condensar flags `STAGING_*`; isso pertence à Fase 18.
- Não adicionar dependências, adapters de compatibilidade, endpoints-túmulo ou fallbacks novos.
- Não executar deploy, push, migration, alteração de Vercel, alteração de Typebot ou outra mutação externa sem autorização explícita.
- Não imprimir segredos, credenciais, payloads, dados pessoais, URLs com credenciais ou detalhes brutos de integração.
- Manter mensagens HTTP destinadas ao usuário em português brasileiro.
- Usar somente arquivos TypeScript como fonte do backend; JavaScript emitido em `api/` é artefato não versionado.
- Não alterar arquivos gerados pelo Vite em `public/`.
- Preservar o transporte Evolution API para WhatsApp.
- Manter `check-no-legacy-provider` como guarda contra Frappe, ERPNext e flags antigas de rollout.
- A ausência de logs acessíveis não prova inatividade; nesse caso, parar e pedir confirmação operacional.
- Se surgir consumidor ativo, migration necessária, mudança de contrato público ou adapter novo, parar e pedir decisão.

---

## File Map

- `api/_app/routes.ts`: remover imports e registros dos dois endpoints aposentados.
- `api/_shared/auth.ts`: remover a exceção pública exclusiva do webhook Typebot.
- `api/_shared/rate-limit.ts`: remover o bucket exclusivo do webhook Typebot.
- `.env.example`: remover `TYPEBOT_LEAD_WEBHOOK_TOKEN` e `TYPEBOT_LEAD_CAPTURE_ENABLED`.
- `api/_modules/quote-leads.ts`: deletar handler HTTP aposentado.
- `api/_modules/typebot-lead-capture.ts`: deletar handler Typebot aposentado.
- `api/_modules/quote-leads-store.ts`: deletar adapter KV aposentado após migrar os testes puros para `quote-leads-pure.ts`.
- `api/_infrastructure/integrations/meta-capi/meta-capi.ts`: deletar se a busca final confirmar que a única chamada é a captura Typebot.
- `api/_modules/quote-leads-pure.ts`: preservar e testar diretamente.
- `api/_infrastructure/db/repositories/quote-leads-repository.ts`: preservar operações ainda usadas por WhatsApp, CRM e emissão de orçamento.
- `tests/unit/routes.test.ts`: atualizar contagem e garantir ausência dos endpoints.
- `tests/unit/handle-request.test.ts`: garantir 404 autenticado para endpoints removidos.
- `tests/unit/auth.test.ts`: remover expectativa de acesso público ao Typebot.
- `tests/unit/quote-leads-store.test.ts`: renomear para `tests/unit/quote-leads-pure.test.ts` e manter somente testes da lógica pura.
- `tests/unit/quote-leads.test.ts`: deletar testes exclusivos do handler HTTP removido.
- `tests/unit/typebot-lead-capture.test.ts`: deletar testes exclusivos do handler Typebot removido.
- `tests/unit/meta-capi.test.ts`: deletar se o módulo Meta CAPI ficar órfão.
- `tests/unit/quote-leads-postgres.test.ts`: remover o teste do handler Typebot e preservar testes diretos do repository e dos vínculos locais.
- `tests/unit/pre-quote-fixtures.ts`: importar o tipo `QuoteLead` do módulo puro.
- `tests/unit/postgres-only-canary.test.js`: remover somente a asserção específica de chamada Typebot se ela ficar sem finalidade após a retirada do endpoint.
- `tests/orcamento.spec.js`: remover mocks do endpoint aposentado, preservando os testes que confirmam ausência da UI de Pré-orçamentos.
- `tests/task-8-fix-r1.spec.js`: remover mock morto de `/api/quote-leads`.
- `tests/task-8-fix-r4.spec.js`: remover mock morto de `/api/quote-leads`.
- `docs/pre-orcamentos-inbox.md`: documentar o estado operacional atual sem instruções Typebot ou endpoint público.
- `docs/superpowers/reports/2026-08-18-postgresql-only-cleanup-acceptance.md`: registrar matriz final de classificação e evidências redigidas.

Arquivos gerados ignorados em `api/` não entram no diff.
Depois da última validação, remover artefatos gerados dos módulos deletados.

---

## Task 1: Fechar o gate operacional e a matriz de inventário

**Files:**

- Read-only: `api/`, `src/`, `scripts/`, `tests/`, `.github/`, `.env.example`, `package.json`.
- Read-only: `$HOME/.config/aspen-dashboard/.env.local` somente através do preflight que imprime nomes e estados.
- Create later: `docs/superpowers/reports/2026-08-18-postgresql-only-cleanup-acceptance.md`.

**Interfaces:**

- Consumes: estado Git, referências estáticas, configuração redigida e confirmação operacional do webhook.
- Produces: classificação de cada candidato como `remover`, `preservar vivo` ou `preservar histórico`.
- Later tasks consume: o gate aprovado e a matriz de candidatos sem valores sensíveis.

- [ ] **Step 1: Registrar a linha de base local**

Run:

```bash
git status --short --branch
git rev-parse --short HEAD
npm run verify:fast
```

Expected: worktree sem alterações antes do início e `verify:fast` com código zero.

Se o worktree não estiver limpo, parar e separar as alterações preexistentes antes de continuar.

- [ ] **Step 2: Fazer o inventário estático completo**

Run:

```bash
rg -n -i --glob '!node_modules' --glob '!.git' --glob '!docs/superpowers/**' --glob '!drizzle/**' \
  'frappe|erpnext|quote_leads|quote-leads|typebot|legacy|TYPEBOT_|META_CAPI|META_PIXEL_ID|QUOTE_LEADS_INGEST_TOKEN' \
  api src scripts tests .github .env.example package.json
```

Classificar cada ocorrência pelo arquivo e símbolo que a consome.

Não classificar uma ocorrência como morta somente porque a busca textual a encontrou.

Confirmar via referências que `createPostgresQuoteLeadRepository`, `convertQuoteLeadInTransaction`, `quoteLeadIdentityKey`, `normalizeQuoteLeadInput`, `mergeQuoteLead` e `formatQuoteLeadText` continuam necessários.

- [ ] **Step 3: Confirmar as precondições operacionais sem mutação**

Se houver autorização para inspeção do ambiente operacional, executar:

```bash
node scripts/cutover-env-status.mjs
```

Usar somente os nomes e estados `present` ou `missing` exibidos pelo script.

Não copiar valores de ambiente, tokens, URLs completas ou payloads para o relatório.

Obter confirmação explícita do responsável pelo webhook de que o Typebot não aponta mais para `/api/typebot-lead-capture`.

Verificar, na janela de logs disponível, se houve uso válido das rotas.

Se os logs não estiverem acessíveis, registrar a limitação e não remover as rotas até obter confirmação alternativa do responsável operacional.

Confirmar que `src/app/routes.tsx` e `src/components/layout/Layout.tsx` não registram nem navegam para Pré-orçamentos.

- [ ] **Step 4: Encerrar o gate ou parar**

Prosseguir somente quando todas as condições forem verdadeiras:

```text
TYPEBOT_LEAD_CAPTURE_ENABLED ausente ou desativada
webhook Typebot desligado ou confirmado como sem destino neste app
nenhum consumidor externo conhecido de quote-leads
nenhuma chamada válida observada na janela de logs disponível
quote_leads preservado como dependência histórica e interna
```

Se uma condição falhar, marcar o candidato como `preservar vivo` e parar antes de editar código.

- [ ] **Step 5: Preparar a matriz de evidências**

A matriz final deverá conter estas colunas:

```text
Candidato | Classificação | Evidência estática | Evidência operacional | Ação/verificação
```

Usar estes candidatos iniciais:

```text
api/_app/routes.ts: registros typebot-lead-capture e quote-leads
api/_modules/typebot-lead-capture.ts
api/_modules/quote-leads.ts
api/_modules/quote-leads-store.ts
api/_infrastructure/integrations/meta-capi/meta-capi.ts
api/_shared/auth.ts: exceção pública Typebot
api/_shared/rate-limit.ts: limite Typebot
.env.example: variáveis TYPEBOT_*
api/_modules/quote-leads-pure.ts
api/_infrastructure/db/repositories/quote-leads-repository.ts
drizzle/
docs/superpowers/
docs/pre-orcamentos-inbox.md
```

O relatório final deverá mencionar o commit de baseline, o commit final, os comandos executados e apenas resultados redigidos.

Não adicionar ainda evidência operacional inventada.

---

## Task 2: Remover endpoints e guardrails mortos com TDD

**Files:**

- Modify: `tests/unit/routes.test.ts`
- Modify: `tests/unit/handle-request.test.ts`
- Modify: `tests/unit/auth.test.ts`
- Modify: `api/_app/routes.ts`
- Modify: `api/_shared/auth.ts`
- Modify: `api/_shared/rate-limit.ts`
- Modify: `.env.example`
- Delete: `api/_modules/quote-leads.ts`
- Delete: `api/_modules/typebot-lead-capture.ts`

**Interfaces:**

- Consumes: gate operacional aprovado na Task 1.
- Produces: dispatcher sem os dois nomes, autenticação sem exceção Typebot e rate limit sem bucket Typebot.
- Preserves: 42 rotas atuais restantes e o comportamento de autenticação das demais rotas.

- [ ] **Step 1: Escrever as regressões estruturais vermelhas**

Em `tests/unit/routes.test.ts`, alterar a expectativa de 44 para 42 e adicionar:

```ts
test('routes: não registra endpoints aposentados', () => {
  assert.equal(Object.hasOwn(routes, 'quote-leads'), false);
  assert.equal(Object.hasOwn(routes, 'typebot-lead-capture'), false);
});

test('rotas e configuração ativas não contêm variáveis Typebot', () => {
  for (const relativePath of [
    '../../api/_app/routes.ts',
    '../../api/_shared/auth.ts',
    '../../api/_shared/rate-limit.ts',
    '../../.env.example',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /TYPEBOT_/, relativePath);
  }
});
```

Em `tests/unit/handle-request.test.ts`, adicionar ao teste de 404 ou criar o teste abaixo:

```ts
test('handleApiRequest: endpoints aposentados respondem 404 com bypass autenticado', async () => {
  withEnv({ NODE_ENV: 'test', APP_AUTH_BYPASS: 'true' });
  for (const routeName of ['quote-leads', 'typebot-lead-capture']) {
    const req = {
      method: 'GET',
      url: `/api/${routeName}`,
      headers: {},
    } as unknown as import('node:http').IncomingMessage;
    const { res, lastStatus, lastBody } = fakeResponse();
    await handleApiRequest(req, res);
    assert.equal(lastStatus(), 404, routeName);
    assert.deepEqual(lastBody(), { error: 'Endpoint não encontrado.' });
  }
});
```

Em `tests/unit/auth.test.ts`, remover a asserção que torna `/api/typebot-lead-capture` público.

- [ ] **Step 2: Rodar as regressões para confirmar o estado vermelho**

Run:

```bash
npm run build:api
node --test tests/unit/routes.test.ts tests/unit/handle-request.test.ts tests/unit/auth.test.ts
```

Expected: falha por contagem de rotas e porque os endpoints ainda estão registrados.

A falha deve ser de comportamento esperado, não de sintaxe ou import quebrado.

- [ ] **Step 3: Remover os registros de rota**

Em `api/_app/routes.ts`:

- Remover o import de `quoteLeads`.
- Remover o import de `typebotLeadCapture`.
- Remover as propriedades `'quote-leads'` e `'typebot-lead-capture'` do objeto `routes`.

Não reordenar os demais handlers sem necessidade.

- [ ] **Step 4: Remover exceções de pipeline exclusivas**

Em `api/_shared/auth.ts`:

- Remover `PUBLIC_ROUTES`.
- Remover o branch `PUBLIC_ROUTES.has(routeName)`.
- Preservar `AUTH_ROUTES`, o acesso GET de `public-quotation` e o bypass de desenvolvimento.

Em `api/_shared/rate-limit.ts`:

- Remover somente `'typebot-lead-capture': 20` de `ROUTE_LIMITS`.
- Preservar o rate limit de login, extração, envio WhatsApp e quotation pública.

Em `.env.example`:

- Remover `TYPEBOT_LEAD_WEBHOOK_TOKEN=`.
- Remover `TYPEBOT_LEAD_CAPTURE_ENABLED=false`.

- [ ] **Step 5: Deletar os handlers HTTP aposentados**

Deletar:

```text
api/_modules/quote-leads.ts
api/_modules/typebot-lead-capture.ts
```

Não mover suas funções para outro módulo.

A ausência de rota deve usar o 404 padrão do dispatcher para requisições autenticadas.

Requisições sem autenticação continuarão falhando no guard de autenticação antes do dispatch, preservando o comportamento fail-closed do pipeline.

- [ ] **Step 6: Rodar a regressão verde**

Run:

```bash
npm run build:api
node --test tests/unit/routes.test.ts tests/unit/handle-request.test.ts tests/unit/auth.test.ts tests/unit/rate-limit.test.ts
```

Expected: todos os testes passam, a contagem é 42 e os dois endpoints retornam 404 quando o pipeline está autenticado.

- [ ] **Step 7: Verificar o pipeline sem referências aos handlers**

Run:

```bash
rg -n 'quote-leads|typebot-lead-capture|TYPEBOT_' \
  api/_app/routes.ts api/_shared/auth.ts api/_shared/rate-limit.ts .env.example
```

Expected: nenhuma ocorrência nos arquivos alterados da Task 2.

Referências restantes em testes e módulos serão tratadas nas Tasks 3 e 4, sem adicionar alias.

- [ ] **Step 8: Commitar o corte de endpoints**

```bash
git add api/_app/routes.ts api/_shared/auth.ts api/_shared/rate-limit.ts .env.example \
  tests/unit/routes.test.ts tests/unit/handle-request.test.ts tests/unit/auth.test.ts \
  api/_modules/quote-leads.ts api/_modules/typebot-lead-capture.ts
git commit -m "refactor(api): remove dead lead endpoints"
```

---

## Task 3: Remover adapters órfãos e preservar cobertura PostgreSQL

**Files:**

- Rename: `tests/unit/quote-leads-store.test.ts` -> `tests/unit/quote-leads-pure.test.ts`
- Modify: `tests/unit/pre-quote-fixtures.ts`
- Modify: `tests/unit/quote-leads-postgres.test.ts`
- Modify: `tests/unit/postgres-only-canary.test.js`
- Delete: `api/_modules/quote-leads-store.ts`
- Delete: `api/_infrastructure/integrations/meta-capi/meta-capi.ts` quando a busca de consumidores confirmar orfandade
- Delete: `tests/unit/quote-leads.test.ts`
- Delete: `tests/unit/typebot-lead-capture.test.ts`
- Delete: `tests/unit/meta-capi.test.ts` quando o módulo Meta CAPI for deletado
- Preserve: `api/_modules/quote-leads-pure.ts`
- Preserve: `api/_infrastructure/db/repositories/quote-leads-repository.ts`

**Interfaces:**

- Consumes: `QuoteLead`, normalização, identidade e merge diretamente de `api/_modules/quote-leads-pure.ts`.
- Produces: nenhum import ativo de `quote-leads-store`, Typebot handler ou Meta CAPI.
- Preserves: repository PostgreSQL, vínculos WhatsApp/CRM e conversão transacional de leads.

- [ ] **Step 1: Confirmar consumidores antes da exclusão**

Run:

```bash
rg -n 'quote-leads-store|meta-capi|sendMetaLeadEvent|createHandler as createTypebotHandler|from .*typebot-lead-capture' \
  api src scripts tests .env.example package.json .github
```

Expected before edits:

- `quote-leads-store` aparece apenas em testes e no próprio adapter.
- `meta-capi` e `sendMetaLeadEvent` aparecem apenas no handler Typebot e no teste Meta.
- `createTypebotHandler` aparece apenas no teste PostgreSQL de captura e no teste unitário Typebot.

Se existir outro consumidor ativo, preservá-lo e remover somente o que estiver comprovadamente órfão.

- [ ] **Step 2: Mover a cobertura de lógica pura para o módulo correto**

Renomear o teste:

```bash
git mv tests/unit/quote-leads-store.test.ts tests/unit/quote-leads-pure.test.ts
```

No novo arquivo, trocar o import por:

```ts
import {
  formatQuoteLeadText,
  mergeQuoteLead,
  normalizeQuoteLeadInput,
  type QuoteLead,
} from '../../api/_modules/quote-leads-pure.js';
```

Remover `createMemoryDeps`, `createQuoteLeadMemoryDeps`, `upsertQuoteLead`, `listQuoteLeads` e `updateQuoteLead`.

Manter os testes de normalização de payload Typebot, códigos numéricos de produto, produto textual, formatação para textarea, formulário do site com attribution e estado `incomplete`.

Adicionar um teste direto de merge para preservar status terminal e first-touch:

```ts
it('preserva status terminal e attribution first-touch no merge puro', () => {
  const current = makeQuoteLead({
    status: 'converted',
    quotationId: 'ORC-20260001',
    attribution: { gclid: 'first-gclid', utm_source: 'google' },
  });
  const incoming = normalizeQuoteLeadInput(
    {
      nome: 'Ana Atualizada',
      telefone: '5511978086811',
      source: 'typebot',
      gclid: 'second-gclid',
      utm_source: 'meta',
    },
    { now: () => '2026-07-01T12:00:00.000Z', id: () => current.id }
  );

  const merged = mergeQuoteLead(current, incoming, '2026-07-01T12:00:00.000Z');

  assert.equal(merged.status, 'converted');
  assert.equal(merged.quotationId, 'ORC-20260001');
  assert.equal(merged.attribution?.gclid, 'first-gclid');
  assert.equal(merged.attribution?.utm_source, 'google');
  assert.equal(merged.nome, 'Ana Atualizada');
});
```

Atualizar o `describe` para `quote-leads-pure`.

- [ ] **Step 3: Ajustar fixtures e testes PostgreSQL**

Em `tests/unit/pre-quote-fixtures.ts`, trocar:

```ts
import type { QuoteLead } from '../../api/_modules/quote-leads-store.js';
```

por:

```ts
import type { QuoteLead } from '../../api/_modules/quote-leads-pure.js';
```

Em `tests/unit/quote-leads-postgres.test.ts`:

- Remover o import `createTypebotHandler`.
- Deletar o teste com o título `persiste captura Typebot pelo handler real com lead e deal locais`.
- Remover somente a manipulação de `TYPEBOT_LEAD_WEBHOOK_TOKEN` e `TYPEBOT_LEAD_CAPTURE_ENABLED` que pertencia a esse teste.
- Manter os testes diretos do repository, inclusive os que usam `source: 'typebot'` para representar dados históricos persistidos.
- Manter o teste que verifica dependência em `quote-leads-pure` e ausência de `quote-leads-store`.

Não mudar o schema nem apagar fixtures históricos da tabela.

- [ ] **Step 4: Deletar testes de superfícies removidas**

Deletar:

```text
tests/unit/quote-leads.test.ts
tests/unit/typebot-lead-capture.test.ts
tests/unit/meta-capi.test.ts
```

Esses testes cobrem handlers ou integração que deixam de existir.

A cobertura de persistência local deve permanecer em `quote-leads-postgres.test.ts` e nos testes de WhatsApp/CRM.

- [ ] **Step 5: Remover o adapter KV e a integração Meta órfãos**

Deletar `api/_modules/quote-leads-store.ts`.

Deletar `api/_infrastructure/integrations/meta-capi/meta-capi.ts` somente se o comando da Step 1 confirmar que não há outro consumidor.

Não remover `@vercel/kv` do `package.json`, porque o rate limit de `public-quotation` continua usando KV compartilhado.

Não remover `quote-leads-pure.ts` nem cada operação do repository PostgreSQL somente por conter o termo `quote_leads`.

Em `tests/unit/postgres-only-canary.test.js`, remover `typebot-lead-capture` da regex que garante que o canário não chama endpoints de escrita:

```js
assert.equal(
  calls.some((call) => /send-whatsapp/i.test(call.url)),
  false
);
```

- [ ] **Step 6: Rodar a cobertura focada**

Run:

```bash
npm run build:api
TZ=UTC node --test \
  tests/unit/quote-leads-pure.test.ts \
  tests/unit/quote-leads-postgres.test.ts \
  tests/unit/whatsapp-crm-match.test.ts \
  tests/unit/whatsapp-crm-postgres.test.ts \
  tests/unit/whatsapp-conversations-postgres-only.test.ts
```

Expected: testes puros passam, testes sem banco ficam somente nos skips previstos e os fluxos PostgreSQL/WhatsApp continuam sem falhas.

- [ ] **Step 7: Confirmar ausência dos adapters removidos**

Run:

```bash
if rg -n 'quote-leads-store|meta-capi|sendMetaLeadEvent|typebot-lead-capture|TYPEBOT_' \
  api src scripts tests .env.example package.json .github; then
  echo 'active retired adapter reference found' >&2
  exit 1
fi
```

Expected: nenhum resultado e código zero.

Referências históricas em `docs/superpowers/` e `drizzle/` não entram nessa busca.

- [ ] **Step 8: Commitar a remoção dos adapters**

```bash
git add api/_modules/quote-leads-store.ts api/_infrastructure/integrations/meta-capi/meta-capi.ts \
  tests/unit/quote-leads-pure.test.ts tests/unit/quote-leads-postgres.test.ts \
  tests/unit/pre-quote-fixtures.ts tests/unit/postgres-only-canary.test.js \
  tests/unit/quote-leads.test.ts \
  tests/unit/typebot-lead-capture.test.ts tests/unit/meta-capi.test.ts
git commit -m "refactor(leads): remove retired adapters"
```

---

## Task 4: Limpar mocks ativos e atualizar documentação operacional

**Files:**

- Modify: `tests/orcamento.spec.js`
- Modify: `tests/task-8-fix-r1.spec.js`
- Modify: `tests/task-8-fix-r4.spec.js`
- Modify: `docs/pre-orcamentos-inbox.md`

**Interfaces:**

- Consumes: rotas removidas e cobertura interna preservada nas Tasks 2 e 3.
- Produces: testes E2E sem mocks de endpoint morto e documentação operacional coerente com o runtime atual.
- Preserves: teste visual que confirma ausência da tela e do botão de Pré-orçamentos.

- [ ] **Step 1: Remover mocks do endpoint aposentado**

Em `tests/orcamento.spec.js`, remover cada bloco que intercepta `**/api/quote-leads**`.

Manter o teste `não exibe a fila de pré-orçamentos no CRM` e o teste `Auto não exibe seleção de pré-orçamentos`, porque eles verificam a ausência da UI, não o endpoint removido.

Em `tests/task-8-fix-r1.spec.js` e `tests/task-8-fix-r4.spec.js`, remover somente as chamadas:

```js
await page.route('**/api/quote-leads**', (route) => json(route, { data: [] }));
```

Não remover mocks de quotations, pricing, communication ou WhatsApp.

- [ ] **Step 2: Atualizar a documentação operacional vigente**

Substituir `docs/pre-orcamentos-inbox.md` por conteúdo equivalente a:

```md
# Dados históricos de pré-orçamentos

A tela de Pré-orçamentos e os endpoints de ingestão e fila foram removidos do dashboard.

A tabela `quote_leads` permanece para preservar histórico, vínculos de CRM, conversas WhatsApp e conversão de orçamentos já existentes.

A Inbox do WhatsApp pode criar e reencontrar vínculos locais por meio do repository PostgreSQL.

A captura Typebot não faz parte do runtime atual e não existe webhook ativo neste aplicativo.

Não há migração destrutiva nem remoção de dados nesta fase.
```

Não mencionar tokens, hosts, credenciais ou instruções para reativar o endpoint removido.

Não alterar specs, planos ou relatórios históricos sob `docs/superpowers/`.

- [ ] **Step 3: Rodar os testes E2E focados**

Run:

```bash
npx playwright test tests/orcamento.spec.js tests/task-8-fix-r1.spec.js tests/task-8-fix-r4.spec.js
```

Expected: os fluxos de Auto, CRM, pedidos e envio WhatsApp passam sem depender de `/api/quote-leads`.

- [ ] **Step 4: Commitar a limpeza operacional**

```bash
git add tests/orcamento.spec.js tests/task-8-fix-r1.spec.js tests/task-8-fix-r4.spec.js \
  docs/pre-orcamentos-inbox.md
git commit -m "docs(db): align retired lead surfaces"
```

---

## Task 5: Registrar aceite e concluir a verificação

**Files:**

- Create: `docs/superpowers/reports/2026-08-18-postgresql-only-cleanup-acceptance.md`

**Interfaces:**

- Consumes: matriz da Task 1, diff final, resultados de testes e confirmação operacional redigida.
- Produces: relatório de aceite reproduzível e worktree limpo.
- Preserves: todos os arquivos sob `drizzle/`, `public/` e os dados externos.

- [ ] **Step 1: Rodar a guarda estrutural existente**

Run:

```bash
node scripts/check-no-legacy-provider.mjs
```

Expected: código zero e nenhuma saída contendo segredo, payload ou dado pessoal.

- [ ] **Step 2: Rodar a suíte rápida**

Run:

```bash
npm run verify:fast
```

Expected: lint, typecheck, boundaries, migrations, layout Vercel e testes unitários passam sem falhas.

- [ ] **Step 3: Rodar a suíte completa**

Run:

```bash
npm run verify:full
```

Expected: `verify:fast`, build web e todos os E2E locais terminam com código zero.

Não executar `npm run db:migrate`, `npm run test:e2e:staging`, deploy ou push como parte desta task.

- [ ] **Step 4: Verificar invariantes do diff**

Run:

```bash
git diff --check
test -z "$(git diff --name-only -- drizzle)"
test -z "$(git diff --name-only -- public)"
if git grep -n -E 'TYPEBOT_|typebot-lead-capture|quote-leads-store|meta-capi|sendMetaLeadEvent' -- \
  api src scripts tests .env.example package.json .github; then
  echo 'active legacy reference found' >&2
  exit 1
fi
```

Expected:

- `git diff --check` com código zero.
- Nenhum arquivo em `drizzle/` ou `public/` no diff.
- Nenhuma referência ativa aos nomes removidos.

- [ ] **Step 5: Limpar artefatos gerados dos módulos deletados**

Depois de todos os testes, executar somente a limpeza direcionada:

```bash
rm -f \
  api/_modules/quote-leads.js api/_modules/quote-leads.js.map \
  api/_modules/quote-leads-store.js api/_modules/quote-leads-store.js.map \
  api/_modules/typebot-lead-capture.js api/_modules/typebot-lead-capture.js.map \
  api/_infrastructure/integrations/meta-capi/meta-capi.js \
  api/_infrastructure/integrations/meta-capi/meta-capi.js.map
```

Não remover artefatos gerados de módulos ainda usados antes de encerrar a sessão.

- [ ] **Step 6: Escrever o relatório de aceite**

Criar `docs/superpowers/reports/2026-08-18-postgresql-only-cleanup-acceptance.md` com estas seções:

```md
# PostgreSQL-only Cleanup Acceptance

## Resultado

- Status final: registrar `PASS` somente com todas as verificações verdes; caso contrário, registrar `BLOCKED`.
- Commit de baseline: copiar a saída de `git rev-parse --short HEAD` antes das edições.
- Commit final: copiar a saída de `git rev-parse --short HEAD` após o aceite.
- Worktree: registrar `clean` ou a lista redigida de alterações restantes.

## Gate operacional

- `TYPEBOT_LEAD_CAPTURE_ENABLED`: somente estado present/missing ou disabled
- webhook Typebot: confirmação redigida com data e responsável
- consumidores externos de `quote-leads`: resultado redigido
- janela de logs: resultado redigido, sem payload ou PII

## Matriz de classificação

| Candidato                      | Classificação             | Evidência estática                 | Evidência operacional | Ação/verificação          |
| ------------------------------ | ------------------------- | ---------------------------------- | --------------------- | ------------------------- |
| Rotas Typebot e quote-leads    | remover                   | `api/_app/routes.ts` sem registros | gate aprovado         | 404 autenticado           |
| Handlers HTTP aposentados      | remover                   | sem importadores vivos             | gate aprovado         | arquivos removidos        |
| Adapter KV                     | remover                   | sem importadores vivos             | não aplicável         | arquivo removido          |
| Meta CAPI                      | remover ou preservar vivo | resultado da busca de referências  | não aplicável         | ação registrada           |
| `quote-leads-pure.ts`          | preservar vivo            | repository e testes importam       | não aplicável         | testes focados            |
| `quote-leads-repository.ts`    | preservar vivo            | WhatsApp, CRM e emissão importam   | não aplicável         | regressões verdes         |
| `drizzle/`                     | preservar histórico       | migrations aplicadas               | não aplicável         | diff vazio                |
| `docs/superpowers/`            | preservar histórico       | decisões e evidências              | não aplicável         | diff histórico preservado |
| `docs/pre-orcamentos-inbox.md` | atualizar vigente         | descrevia estado anterior          | não aplicável         | texto atualizado          |

## Verificações

- Comandos executados e códigos de saída.
- Contagem final de testes, passes, skips e falhas.
- LSP e lens diagnostics.
- `git diff --check`.
- ausência de alterações em `drizzle/` e `public/`.

## Operações não executadas

- migrations
- preflight contra banco real
- E2E staging
- deploy
- push
- alterações externas
```

Preencher cada campo com a evidência real antes de commitar o relatório, sem incluir valores sensíveis.

Se o gate operacional não tiver sido confirmado, não escrever `PASS` nem remover os endpoints.

- [ ] **Step 7: Rodar diagnostics finais**

Run:

```bash
npx prettier --check docs/superpowers/reports/2026-08-18-postgresql-only-cleanup-acceptance.md
git diff --check
git status --short --branch
```

Expected: Markdown formatado, diff sem whitespace inválido e somente o relatório novo ou worktree limpo após o commit.

Executar LSP primary e lens diagnostics nos arquivos alterados.

Expected: zero erros bloqueantes.

- [ ] **Step 8: Commitar o aceite**

```bash
git add docs/superpowers/reports/2026-08-18-postgresql-only-cleanup-acceptance.md
git commit -m "docs(db): record PostgreSQL-only cleanup"
```

- [ ] **Step 9: Confirmar o estado final**

Run:

```bash
test -z "$(git status --porcelain)"
git log -3 --oneline
```

Expected: worktree limpo e os commits das Tasks 2, 3, 4 e 5 visíveis no histórico.

---

## Self-review checklist

- [ ] Cada candidato da spec aparece na matriz de inventário ou como preservado por dependência viva.
- [ ] A tabela `quote_leads` e o schema não são modificados.
- [ ] Migrations e snapshots históricos não são modificados.
- [ ] A cobertura pura foi movida para `quote-leads-pure.ts`, sem manter o adapter KV.
- [ ] WhatsApp, CRM e conversão de orçamento mantêm seus importadores PostgreSQL.
- [ ] `TYPEBOT_*` desaparece do runtime ativo, testes ativos e `.env.example`.
- [ ] Nenhum mock E2E aponta para endpoint removido.
- [ ] Specs, planos e relatórios históricos permanecem intactos.
- [ ] Não há dependência nova, fallback, endpoint-túmulo ou alteração externa.
- [ ] `verify:fast`, `verify:full`, scanner, diff check, LSP e lens foram executados antes da conclusão.
