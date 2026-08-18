# Preview Staging e External Write Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar Vercel Preview o staging documentado e bloquear writes Evolution/Meta fora de Production com uma permissão explícita.

**Architecture:** Um helper fail-closed em `api/_shared/external-writes.ts` concentra a decisão de ambiente e a mensagem HTTP 503.
Os módulos de envio fazem um preflight antes de qualquer mutação de estado e repetem o guard na fronteira imediatamente anterior ao POST externo.
Preview usa `APP_ENV=preview`, `EXTERNAL_WRITES_ENABLED=0` e não recebe credenciais perigosas; o runbook documenta a transição reversível da VPS.

**Tech Stack:** Node.js ESM, TypeScript 5.9, Node test runner, Vercel serverless API, Evolution API, Meta CAPI, Markdown operacional.

**Spec:** `docs/superpowers/specs/2026-08-18-staging-preview-guard-design.md`

## Global Constraints

- Permissão de write externo somente com `APP_ENV=production` e `EXTERNAL_WRITES_ENABLED=1`.
- Defaults locais e Preview: `APP_ENV=development` ou `APP_ENV=preview`, sempre com `EXTERNAL_WRITES_ENABLED=0`.
- Guard cobre somente `evolution` e `meta-capi`.
- Não interceptar globalmente `fetch`; OpenRouter, KV e Blob continuam disponíveis para fluxos legítimos do Preview.
- Erros públicos permanecem em PT-BR e nunca incluem tokens, URLs privadas, headers, stack traces ou dados pessoais.
- Não adicionar dependências.
- Não alterar `public/`, `drizzle/` ou documentação histórica.
- Não executar deploy, push, merge, migração remota, configuração do Vercel Dashboard ou remoção da VPS.
- Credenciais e valores operacionais permanecem fora do checkout.
- Limpar somente outputs API ignorados antes/depois dos builds, sem apagar arquivos rastreados.
- Manter um único escritor por worktree e commitar cada tarefa concluída.

---

## Mapa de arquivos

- Criar `api/_shared/external-writes.ts`: decisão fail-closed e erro HTTP público neutro.
- Criar `tests/unit/external-writes.test.ts`: matriz isolada de ambientes e providers.
- Modificar `api/modules/send-whatsapp.ts`: preflight Evolution e guard na fronteira de POST.
- Modificar `api/modules/send-whatsapp-flow.ts`: preflight Evolution antes de preparar/reservar entrega e guard na fronteira de POST.
- Modificar `api/infrastructure/integrations/meta-capi/meta-capi.ts`: guard antes do POST Graph API, preservando `missing_token` sem rede.
- Modificar `tests/unit/send-whatsapp.test.ts`: ambiente de mock autorizado e bloqueio da rota direta/fluxo sem fetch.
- Modificar `tests/unit/send-whatsapp-review-r1.test.ts`: ambiente autorizado para mocks Evolution.
- Modificar `tests/unit/send-whatsapp-idempotency.test.ts`: ambiente autorizado para mocks Evolution.
- Modificar `tests/unit/meta-capi.test.ts`: snapshot de ambiente, caminho autorizado e caminho bloqueado sem fetch.
- Modificar `.env.example`: defaults seguros de `APP_ENV` e `EXTERNAL_WRITES_ENABLED`.
- Modificar `docs/operational-cutoff-procedure.md`: matriz Preview/Production, checklist de credenciais e transição VPS reversível.

---

### Task 1: Criar o guard central fail-closed

**Files:**

- Create: `api/_shared/external-writes.ts`
- Create: `tests/unit/external-writes.test.ts`

**Interfaces:**

- Consumes: `createHttpError` de `api/_shared/http-error.ts` e `NodeJS.ProcessEnv`.
- Produces: `ExternalWriteProvider`, `isExternalWritesAllowed(env)`, `assertExternalWritesAllowed(provider, env)` para os módulos de integração.

- [ ] **Step 1: Escrever os testes falhando para a matriz de ambiente**

Criar o teste com o Node test runner e sem dependência de rede:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertExternalWritesAllowed,
  isExternalWritesAllowed,
} from '../../api/_shared/external-writes.js';

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    APP_ENV: 'development',
    EXTERNAL_WRITES_ENABLED: '0',
    ...overrides,
  };
}

describe('external writes guard', () => {
  it('permite somente production com flag explícita', () => {
    assert.equal(isExternalWritesAllowed(env({ APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: '1' })), true);
    assert.doesNotThrow(() => assertExternalWritesAllowed('evolution', env({ APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: '1' })));
    assert.doesNotThrow(() => assertExternalWritesAllowed('meta-capi', env({ APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: '1' })));
  });

  it('bloqueia Preview mesmo se a flag estiver ligada', () => {
    const preview = env({ APP_ENV: 'preview', EXTERNAL_WRITES_ENABLED: '1' });
    assert.equal(isExternalWritesAllowed(preview), false);
    assert.throws(
      () => assertExternalWritesAllowed('evolution', preview),
      (error: Error & { statusCode?: number; logMessage?: string }) => {
        assert.equal(error.statusCode, 503);
        assert.equal(error.message, 'Integrações externas desativadas neste ambiente.');
        assert.match(error.logMessage || '', /evolution/);
        return true;
      },
    );
  });

  it('bloqueia development, ambiente ausente e flag diferente de 1', () => {
    for (const candidate of [
      env(),
      env({ APP_ENV: undefined, EXTERNAL_WRITES_ENABLED: '1' }),
      env({ APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: '0' }),
      env({ APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: 'true' }),
    ]) {
      assert.equal(isExternalWritesAllowed(candidate), false);
      assert.throws(() => assertExternalWritesAllowed('meta-capi', candidate), { statusCode: 503 });
    }
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar a falha**

Run: `npm run build:api && node --test tests/unit/external-writes.test.ts`
Expected: FAIL porque `api/_shared/external-writes.ts` ainda não existe.

- [ ] **Step 3: Implementar o helper mínimo**

Criar `api/_shared/external-writes.ts` com este contrato:

```ts
import { createHttpError } from './http-error.js';

export type ExternalWriteProvider = 'evolution' | 'meta-capi';

export function isExternalWritesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    String(env.APP_ENV || '').trim().toLowerCase() === 'production' &&
    String(env.EXTERNAL_WRITES_ENABLED || '').trim() === '1'
  );
}

export function assertExternalWritesAllowed(
  provider: ExternalWriteProvider,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isExternalWritesAllowed(env)) return;
  throw createHttpError(
    503,
    'Integrações externas desativadas neste ambiente.',
    `[external-writes] blocked provider: ${provider}`,
  );
}
```

Não ler credenciais, URLs ou headers dentro do helper.
Não adicionar singleton, classe, configuração ou fallback.

- [ ] **Step 4: Rodar os testes do guard**

Run: `npm run build:api && node --test tests/unit/external-writes.test.ts`
Expected: PASS com todos os casos da matriz.

- [ ] **Step 5: Revisar e commitar a tarefa**

Run: `git diff --check -- api/_shared/external-writes.ts tests/unit/external-writes.test.ts`

```bash
git add api/_shared/external-writes.ts tests/unit/external-writes.test.ts
git commit -m "feat: adicionar guard de writes externos"
```

Expected: commit criado somente com o helper e seu teste.

---

### Task 2: Proteger os writes Evolution

**Files:**

- Modify: `api/modules/send-whatsapp.ts:617-665`
- Modify: `api/modules/send-whatsapp-flow.ts:275-335` e preflight do handler antes de carregar contexto
- Modify: `tests/unit/send-whatsapp.test.ts:withEvolutionEnv` e testes de transporte
- Modify: `tests/unit/send-whatsapp-review-r1.test.ts:evolutionEnv`
- Modify: `tests/unit/send-whatsapp-idempotency.test.ts:evolutionEnv`

**Interfaces:**

- Consumes: `assertExternalWritesAllowed('evolution')` de `api/_shared/external-writes.ts`.
- Produces: todos os caminhos não-dry de envio Evolution continuam com o mesmo sucesso, mas respondem 503 antes da rede quando o ambiente não é autorizado.

- [ ] **Step 1: Tornar os ambientes de mock explícitos e adicionar testes bloqueados**

Atualizar cada helper `withEvolutionEnv`/`evolutionEnv` para salvar e restaurar também `APP_ENV` e `EXTERNAL_WRITES_ENABLED`.
O caso padrão dos mocks deve ser autorizado.
Permitir sobrescrever o ambiente para o teste bloqueado:

```ts
function withEvolutionEnv(
  overrides: { appEnv?: string; writes?: string } = {},
) {
  const previous = {
    baseUrl: process.env.EVOLUTION_BASE_URL,
    apiKey: process.env.EVOLUTION_API_KEY,
    instance: process.env.EVOLUTION_INSTANCE,
    appEnv: process.env.APP_ENV,
    writes: process.env.EXTERNAL_WRITES_ENABLED,
  };
  process.env.EVOLUTION_BASE_URL = 'https://evolution.test';
  process.env.EVOLUTION_API_KEY = 'test-key';
  process.env.EVOLUTION_INSTANCE = 'test-instance';
  process.env.APP_ENV = overrides.appEnv || 'production';
  process.env.EXTERNAL_WRITES_ENABLED = overrides.writes || '1';
  return () => {
    for (const [key, value] of Object.entries({
      EVOLUTION_BASE_URL: previous.baseUrl,
      EVOLUTION_API_KEY: previous.apiKey,
      EVOLUTION_INSTANCE: previous.instance,
      APP_ENV: previous.appEnv,
      EXTERNAL_WRITES_ENABLED: previous.writes,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
```

Nos dois arquivos que usam `evolutionEnv`, aplicar o mesmo snapshot e restauração com os nomes locais já existentes.

Adicionar ao `tests/unit/send-whatsapp.test.ts` uma prova de bloqueio na rota direta:

```ts
test('non-dry legacy endpoint blocks Evolution when external writes are disabled', async () => {
  const restoreEnv = withEvolutionEnv({ appEnv: 'preview', writes: '0' });
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    throw new Error('fetch must not run');
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({ telefone: '11999990000', mensagem: 'Olá' }));
    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body || '{}'), {
      error: 'Integrações externas desativadas neste ambiente.',
    });
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});
```

Adicionar ao mesmo arquivo uma prova equivalente para `sendWhatsappFlow`, usando `reservationStore()`, um `resolveFlow` com um passo de texto e um passo `quotation_pdf`, e os mesmos asserts de 503, mensagem e zero chamadas.

- [ ] **Step 2: Rodar os testes para confirmar que o novo comportamento ainda falha**

Run: `npm run build:api && node --test tests/unit/send-whatsapp.test.ts tests/unit/send-whatsapp-review-r1.test.ts tests/unit/send-whatsapp-idempotency.test.ts`
Expected: os novos testes falham porque as rotas ainda executam o mock de transporte.

- [ ] **Step 3: Aplicar o guard no módulo PostgreSQL e no módulo de fluxo**

Adicionar o import abaixo nos dois módulos:

```ts
import { assertExternalWritesAllowed } from '../_shared/external-writes.js';
```

Em `api/modules/send-whatsapp.ts`, chamar o guard depois da validação de configuração e antes de qualquer `fetch`:

```ts
function assertEvolutionConfig(): void {
  const { baseUrl, apiKey, instance } = evolutionConfig();
  const missing: string[] = [];
  if (!baseUrl) missing.push('EVOLUTION_BASE_URL');
  if (!apiKey) missing.push('EVOLUTION_API_KEY');
  if (!instance) missing.push('EVOLUTION_INSTANCE');
  if (missing.length > 0) {
    throw createHttpError(
      500,
      'Integração do WhatsApp não configurada. Verifique as variáveis da Evolution API.',
      `[send-whatsapp] missing env: ${missing.join(', ')}`,
    );
  }
  assertExternalWritesAllowed('evolution');
}

async function evolutionPost(path: string, body: Record<string, unknown>): Promise<EvolutionDeliveryResult> {
  const { baseUrl, apiKey } = evolutionConfig();
  assertExternalWritesAllowed('evolution');
  const url = `${baseUrl}${path}`;
  // manter o fetch, parsing e tratamento de resposta existentes abaixo desta linha
}
```

Preservar a validação de configuração antes do guard para que credenciais ausentes continuem falhando sem rede.

No caminho PostgreSQL não-dry de `api/modules/send-whatsapp.ts`, executar o preflight Evolution com `assertExternalWritesAllowed('evolution')` depois da validação básica de payload/PDF e antes de `loadPostgresSendContext`, emissão de token ou qualquer chamada ao repositório de entrega.
Quando o ambiente local não tem configuração Evolution, preservar as validações locais existentes e deixar `assertEvolutionConfig()` bloquear antes do `fetch`.
O bloco de sequência pode manter a defesa de transporte, evitando repetir o preflight quando `postgresPath` já foi validado.

Em `api/modules/send-whatsapp-flow.ts`, repetir a mesma regra em `assertEvolutionConfig` e na função `evolutionPost`.
O handler do fluxo já chama `assertEvolutionConfig()` antes de carregar o snapshot, preparar PDF ou reservar entrega, portanto o bloqueio ocorre antes de mutação local.
Não substituir `transportError`, `normalizeEvolutionDelivery` ou os contratos de idempotência.

- [ ] **Step 4: Rodar os testes Evolution**

Run: `npm run build:api && node --test tests/unit/send-whatsapp.test.ts tests/unit/send-whatsapp-review-r1.test.ts tests/unit/send-whatsapp-idempotency.test.ts`
Expected: PASS, incluindo caminhos autorizados, bloqueados e zero fetch nos bloqueados.

- [ ] **Step 5: Revisar e commitar a tarefa**

Run: `git diff --check -- api/modules/send-whatsapp.ts api/modules/send-whatsapp-flow.ts tests/unit/send-whatsapp.test.ts tests/unit/send-whatsapp-review-r1.test.ts tests/unit/send-whatsapp-idempotency.test.ts`

```bash
git add api/modules/send-whatsapp.ts api/modules/send-whatsapp-flow.ts tests/unit/send-whatsapp.test.ts tests/unit/send-whatsapp-review-r1.test.ts tests/unit/send-whatsapp-idempotency.test.ts
git commit -m "feat: bloquear writes Evolution fora de producao"
```

Expected: commit sem alterações em outputs `.js` gerados.

---

### Task 3: Proteger o write Meta CAPI

**Files:**

- Modify: `api/infrastructure/integrations/meta-capi/meta-capi.ts:1-45`
- Modify: `tests/unit/meta-capi.test.ts`

**Interfaces:**

- Consumes: `assertExternalWritesAllowed('meta-capi')` de `api/_shared/external-writes.ts`.
- Produces: `sendMetaLeadEvent` preserva `missing_token` sem rede e bloqueia POST quando há token em ambiente não autorizado.

- [ ] **Step 1: Adicionar o teste falhando para Meta bloqueado**

Estender `ORIGINAL_ENV` e `afterEach` para salvar/restaurar `APP_ENV` e `EXTERNAL_WRITES_ENABLED`.
No teste de POST autorizado, definir explicitamente `APP_ENV='production'` e `EXTERNAL_WRITES_ENABLED='1'`.
Adicionar o teste abaixo:

```ts
it('does not post when Meta writes are disabled', async () => {
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token';
  process.env.APP_ENV = 'preview';
  process.env.EXTERNAL_WRITES_ENABLED = '0';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('fetch must not run');
  }) as typeof globalThis.fetch;

  await assert.rejects(
    sendMetaLeadEvent({ eventId: 'blocked-event', email: 'teste@example.com' }),
    (error: Error & { statusCode?: number }) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.message, 'Integrações externas desativadas neste ambiente.');
      return true;
    },
  );
  assert.equal(calls, 0);
});
```

- [ ] **Step 2: Rodar o teste para confirmar a falha**

Run: `npm run build:api && node --test tests/unit/meta-capi.test.ts`
Expected: FAIL porque `sendMetaLeadEvent` ainda faz POST com token em Preview.

- [ ] **Step 3: Aplicar o guard preservando o no-op sem token**

Adicionar o import:

```ts
import { assertExternalWritesAllowed } from '../../../_shared/external-writes.js';
```

Manter a validação do token antes do guard:

```ts
const accessToken = String(process.env.META_CAPI_ACCESS_TOKEN || '').trim();
if (!accessToken) return { sent: false, reason: 'missing_token' } as const;
assertExternalWritesAllowed('meta-capi');
```

Não alterar hash, pixel default, payload, tratamento de resposta ou mensagens de log.

- [ ] **Step 4: Rodar os testes Meta**

Run: `npm run build:api && node --test tests/unit/meta-capi.test.ts`
Expected: PASS com hash, `missing_token`, POST autorizado e bloqueio sem fetch.

- [ ] **Step 5: Revisar e commitar a tarefa**

Run: `git diff --check -- api/infrastructure/integrations/meta-capi/meta-capi.ts tests/unit/meta-capi.test.ts`

```bash
git add api/infrastructure/integrations/meta-capi/meta-capi.ts tests/unit/meta-capi.test.ts
git commit -m "feat: bloquear write Meta fora de producao"
```

Expected: commit somente com a fronteira Meta e seus testes.

---

### Task 4: Documentar Preview e a transição VPS

**Files:**

- Modify: `.env.example`
- Modify: `docs/operational-cutoff-procedure.md`

**Interfaces:**

- Consumes: nomes de ambiente existentes e comandos staging já documentados.
- Produces: contrato operacional sem valores reais, com Preview seguro e transição reversível.

- [ ] **Step 1: Adicionar defaults seguros ao exemplo de ambiente**

Inserir no início de `.env.example`, antes das credenciais de provider:

```dotenv
APP_ENV=development
EXTERNAL_WRITES_ENABLED=0
```

Não preencher tokens, URLs privadas, senhas ou identificadores operacionais.
Não remover as variáveis de staging já existentes.

- [ ] **Step 2: Adicionar a matriz Preview/Production ao runbook**

Adicionar ao `docs/operational-cutoff-procedure.md` uma seção `## Preview como staging` com a matriz abaixo:

```markdown
## Preview como staging

Preview é o staging padrão para branches e releases candidatos.

| Controle | Preview | Production |
| --- | --- | --- |
| `APP_ENV` | `preview` | `production` |
| `EXTERNAL_WRITES_ENABLED` | `0` | `1` |
| Banco | PostgreSQL staging | PostgreSQL production |
| KV/Blob | recursos staging | recursos production |
| Evolution | credenciais ausentes | credenciais configuradas |
| Meta CAPI | token ausente | token configurado |
| Typebot | token ausente | token configurado |

A ausência de credenciais é intencional e complementa o guard de aplicação e o egress bloqueado.
Valores reais permanecem no ambiente operacional fora deste checkout.
```

Adicionar checklist de verificação sem segredos:

```markdown
### Checklist Preview

- `APP_ENV=preview` configurado no ambiente Preview.
- `EXTERNAL_WRITES_ENABLED=0` configurado no ambiente Preview.
- Banco, KV e Blob apontam para recursos de staging.
- Credenciais Evolution, Meta CAPI e Typebot não estão presentes em Preview.
- `STAGING_EXTERNAL_PROVIDERS_DISABLED=1` configurado no executor staging.
- `STAGING_EGRESS_BLOCKED=1` configurado no executor staging.
- `STAGING_FIXTURE_RESET=1` configurado antes da suíte mutável.
- Suítes locais e staging executadas somente com fixtures descartáveis.
```

- [ ] **Step 3: Adicionar a sequência reversível de transição VPS -> Preview**

Adicionar uma seção `## Transição VPS -> Preview` com os passos:

```markdown
## Transição VPS -> Preview

1. Criar Preview a partir da branch candidata.
2. Executar a suíte staging com egress bloqueado e fixtures descartáveis.
3. Registrar resultado, falhas e riscos operacionais.
4. Repetir o ciclo por releases suficientes para obter confiança.
5. Manter a VPS como fallback durante a observação.
6. Remover runtime e infraestrutura VPS somente após decisão operacional explícita.

Nenhuma etapa deste documento altera o Vercel Dashboard, faz deploy, migra banco ou remove Docker, Traefik, nftables e scripts.
```

Manter o canário Production somente leitura e todas as proibições já existentes.

- [ ] **Step 4: Validar formatação e conteúdo documental**

Run: `npx prettier --check docs/operational-cutoff-procedure.md`
Expected: PASS.

Run: `awk '!/^[[:space:]]*(#|$)/ { print }' .env.example | bash -n`
Expected: PASS, validando a sintaxe shell de cada linha não vazia e não comentada.

Run: `git diff --check -- .env.example docs/operational-cutoff-procedure.md`
Expected: PASS.

Run: `git diff --unified=0 -- .env.example docs/operational-cutoff-procedure.md | grep -E '^\+[^+].*(sk-|token=[^<[:space:]]+|postgres(ql)?://[^<[:space:]]+)' || true`
Expected: nenhuma linha nova com credencial ou URL privada.

- [ ] **Step 5: Revisar e commitar a tarefa**

Run: `git diff --check -- .env.example docs/operational-cutoff-procedure.md`

```bash
git add .env.example docs/operational-cutoff-procedure.md
git commit -m "docs: definir Preview como staging seguro"
```

Expected: commit somente com exemplo de env e runbook.

---

### Task 5: Verificação integrada e limpeza do worktree

**Files:**

- Verify: todos os arquivos alterados pelas Tasks 1-4.
- Do not modify: `public/`, `drizzle/`, documentação histórica e arquivos operacionais externos.

**Interfaces:**

- Consumes: commits das Tasks 1-4 e os comandos oficiais do `package.json`.
- Produces: evidência de testes verdes, ausência de egress legado e árvore limpa.

- [ ] **Step 1: Inspecionar o diff acumulado**

Run: `git diff eabf860..HEAD --stat -- api tests .env.example docs/operational-cutoff-procedure.md`
Expected: somente helper, módulos Evolution/Meta, testes, `.env.example` e runbook.

Run: `git diff eabf860..HEAD --check -- api tests .env.example docs/operational-cutoff-procedure.md`
Expected: nenhuma falha de whitespace.

Run: `grep -RniE '\b(TBD|FIXME)\b|T[O]DO|add appropriate|implement later' docs/superpowers/plans/2026-08-18-staging-preview-guard.md || true`
Expected: nenhuma ocorrência de placeholder.

- [ ] **Step 2: Limpar outputs API ignorados antes dos builds**

Run: `git clean -fdX -- api`
Expected: somente arquivos ignorados e gerados dentro de `api/` são removidos; arquivos rastreados permanecem intactos.

- [ ] **Step 3: Rodar a verificação oficial**

Run: `npm run check`
Expected: lint, type-check, Tailwind check e build verdes.

Run: `npm run test:unit`
Expected: suíte unitária verde.

Run: `npx playwright test`
Expected: suíte Playwright local verde.

Run: `node scripts/check-no-legacy-provider.mjs`
Expected: nenhuma referência de provider legado.

- [ ] **Step 4: Limpar outputs e confirmar árvore limpa**

Run: `git clean -fdX -- api`
Expected: outputs `.js` ignorados removidos sem deletar fontes rastreadas.

Run: `git status --short`
Expected: saída vazia.

- [ ] **Step 5: Registrar evidência final**

Anotar no handoff da sessão os comandos executados, resultados, commits das Tasks 1-4 e a condição de staging E2E não executado caso as variáveis operacionais não estejam configuradas.
Não incluir valores de ambiente no handoff.
