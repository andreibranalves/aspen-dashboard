# Design - Fases 4-5: Backend por domínio (monólito modular)

Data: 2026-08-18.
Status: aprovado pelo usuário em 2026-08-18 (design v2, incorporando avaliação do Oracle).

## 1. Objetivo

Implementar as Fases 4, 5 e parte da Fase 9 (seção 9 da spec) da `aspen-dashboard-plano-refatoracao.md`:

- Fase 4: organizar o backend por domínio (`modules/`) com infraestrutura separada (`infrastructure/`).
- Fase 5: permanecer monólito modular - mesmo deploy, mesmo banco, mesma aplicação.
- Seção 9 (Domain x Infrastructure): separação física de arquivos e registro explícito de violações de fronteira existentes.

Esta fase é **organização física**.
Não altera comportamento, não cria clients de integração (Fase 19) e não conserta violações de fronteira - apenas as move e as registra.

## 2. Escopo

Mover os 111 arquivos TypeScript do backend:

- `api/_functions/` (78 arquivos): handlers, cores de negócio e helpers `lib/`.
- `api/_db/` (24 arquivos): schema, client PG, repositórios e 4 arquivos de domínio.
- `api/_lib/` (9 arquivos): divididos entre `_shared/`, `_http/` e `modules/`.

Ficam intactos: `api/_app/` (routes.ts, handle-request.ts), `api/_http/` (adapters), `api/[...path].ts`.

## 3. Decisões aprovadas

1. **Um plano** para o backend inteiro, execução em tasks por domínio.
2. **Layout flat** dentro de `modules/` - sem subpastas `handlers/`/`services/`.
   Exceção única: `infrastructure/db/repositories/` (17 repositórios).
3. **Módulo `system`** para login, logout, settings, operational-status.
4. **Limpeza de output tsc antes do primeiro move** e builds sempre a partir de árvore limpa.
5. **Inventário de violações de fronteira** registrado neste design (para Fase 19), não corrigido aqui.
6. **Sem re-exports de compatibilidade** - todos os consumidores (tests, scripts, src, config) atualizados atomicamente.
7. **Correções do Oracle** aplicadas: extract/order-templates/print-format/quotation-status em quotations; postgres-media/time-greeting/send-whatsapp-flow/media-schema em communication; typebot-lead-capture em customers; write-lock e revision-invariants permanecem em infrastructure/db; `_http/` recebe types.ts e function-adapter.ts.

## 4. Estrutura alvo

Arquivos marcados com `*` vêm de `_functions/lib/`, `_db/` ou `_lib/` (movimentos entre diretórios).

### `api/_shared/` (5, todos vindos de `_lib/`)

```text
auth.ts, http-error.ts, password.ts, rate-limit.ts, session.ts
```

### `api/_http/` (2 adicionais, vindos de `_lib/`)

```text
function-adapter.ts, types.ts
```

### `api/modules/` (80, flat)

- **quotations** (26): orcamento, orcamento-core, quotations, quotations-core, quotation-preview, quotation-issues, quotation-templates, duplicate-quotation, edit-draft, public-quotation, pdf, view, order-templates, extract, quotation-html*, quotation-pdf*, quotation-pdf-renderer*, quotation-template-catalog* (era `lib/quotation-templates.ts`), quotation-delivery*, quotation-document-storage*, quotation-draft-snapshot*, quotation-issue-core*, print-format*, quotation-status*, quotation-content*, quotation-template-snapshot*
- **products** (11): products, products-core, product-detail, product-detail-core, product-update, product-update-core, product-pricing, product-pricing-update, product-activity, pricing-lookup, pricing-core
- **crm** (4): crm-deals, crm-update-deal, crm-prune-candidates, crm-prune*
- **customers** (11): client-detail, client-detail-core, client-core, leads-clients, leads-clients-core, quote-leads, client-schema, client-repository (interface canônica), quote-leads-pure*, quote-leads-store*, typebot-lead-capture
- **sales-orders** (3): sales-orders, sales-dashboard, sales-order-from-quotation
- **whatsapp** (12): send-whatsapp, whatsapp-conversations, whatsapp-flows, whatsapp-leads, whatsapp-send-status, whatsapp-conversations-store*, whatsapp-conversations-sync*, whatsapp-crm-match*, whatsapp-identity-audit*, whatsapp-identity-backfill*, whatsapp-identity-resolver*, whatsapp-send-reservation-store*
- **communication** (9): communication-flow-preview, communication-flows, communication-send-events, communication-media, communication-media-upload, send-whatsapp-flow, postgres-media*, time-greeting*, media-schema*
- **system** (4): login, logout, settings, operational-status

### `api/infrastructure/db/` (5, todos de `_db/`)

```text
schema.ts, client.ts, client-schema.ts (tabela PG), quotation-write-lock.ts, quotation-revision-invariants.ts
```

### `api/infrastructure/db/repositories/` (17, todos de `_db/`)

```text
client-repository, crm-deals-repository, order-template-repository, pricing-repository,
product-activity-repository, product-catalog-repository, products-repository,
quotation-delivery-repository, quotation-issue-repository, quotation-lifecycle-repository,
quotation-template-library-repository, quotation-template-repository,
quote-draft-management-repository, quote-leads-repository, quote-repository,
sales-orders-repository, settings-repository
```

### `api/infrastructure/integrations/` (2)

```text
evolution/evolution-delivery.ts
meta-capi/meta-capi.ts
```

`openrouter/`, `blob/` e `kv/` não são criados nesta fase - não existem arquivos dedicados a eles hoje.
A centralização em clients é Fase 19.

### Renomeação por colisão

`_functions/lib/quotation-templates.ts` (catálogo embutido de templates, usado por 5 repositórios e handlers) colide com o handler `_functions/quotation-templates.ts`.
O catálogo vira `modules/quotation-template-catalog.ts`.
O handler mantém o nome `quotation-templates.ts`.

## 5. Fronteiras Domain x Infrastructure (Fase 5)

Regra (será formalizada no `ARCHITECTURE.md` da Fase 20):

- `modules/` contém regras de negócio e contratos de domínio.
- `infrastructure/` contém PostgreSQL/Drizzle, Evolution, Meta CAPI e demais detalhes de infraestrutura.
- Handler conhece service; service conhece contrato de repository; repository conhece PG.
- Handler não instancia cliente de integração diretamente.

### Violações conhecidas (registradas para Fase 19, NÃO corrigidas aqui)

| Arquivo (destino) | Violação |
| --- | --- |
| `modules/whatsapp-crm-match.ts` | Importa Drizzle e schema diretamente |
| `modules/quote-leads-store.ts` | Usa `@vercel/kv` diretamente |
| `modules/extract.ts` | Acessa OpenRouter inline |
| `modules/edit-draft.ts` | Acessa OpenRouter inline |
| `modules/whatsapp-leads.ts` | Acessa OpenRouter inline |
| `modules/send-whatsapp.ts` | Lê config Evolution e faz `fetch` inline |
| `modules/send-whatsapp-flow.ts` | Lê config Evolution e faz `fetch` inline |
| `modules/postgres-media.ts` | Usa Vercel Blob + KV (nome engana; sem PG) |
| `infrastructure/db/client-repository.ts` | Implementa interface de `modules/customers` - padrão correto a generalizar |

## 6. Mecânica de execução

1. **Limpeza prévia**: remover os 116 pares `.js`/`.js.map` gerados (gitignored) ANTES do primeiro move.
   Output antigo pode mascarar caminhos não atualizados em type-check e testes.
2. **Move**: `git mv` por arquivo, agrupado por task de domínio.
3. **Rewrite de imports**: mecânico e determinístico (novo caminho relativo é função da posição origem/destino).
   Cobre sintaxe `import ... from '...'`, `export ... from '...'`, imports dinâmicos `import('...')` e strings de caminho em `readFile`/`readFileSync` de testes.
   Script descartável (não commitado) faz o rewrite em `api/`, `tests/`, `scripts/`, `src/`.
   Documentação histórica (`docs/superpowers/**`, `docs/baseline-refatoracao.md`, spec raiz) é EXCLUÍDA do rewrite.
4. **Atualização de `routes.ts`**: imports dos handlers movidos, por task.
5. **Atualização de configuração e docs ativas**: `drizzle.config.ts` (schema path), `AGENTS.md` (raiz), `tests/AGENTS.md`, `api/_functions/AGENTS.md` e `api/_lib/AGENTS.md` (movidos/reescritos), `src/lib/quotationIssueApi.ts` (import de tipo).
6. **Verificação por task**: build limpo + `npm run type-check` + testes unitários do domínio movido.
7. **Limpeza residual**: após cada task, `git status` + `find api -name '*.js'` para pegar outputs órfãos.

## 7. Inventário de consumidores a atualizar

- **65 arquivos de teste** em `tests/` com caminhos antigos, incluindo:
  - imports estáticos e dinâmicos;
  - strings lidas via `readFileSync` que apontam para código-fonte (ex.: `tests/unit/sales-dashboard-postgres.test.ts:424`, `tests/unit/sales-orders-postgres.test.ts:215-219`, `tests/unit/quote-leads-postgres.test.ts:31-45`, `tests/unit/whatsapp-leads.test.ts:547`, `tests/unit/quotations-core.test.ts:217`);
  - imports dinâmicos com query string: `tests/unit/quotation-issues.test.ts:33,41`, `scripts/test-whatsapp-sequence.mjs:25`.
- **Scripts**: `scripts/whatsapp-identity-audit.mjs` (imports), `scripts/test-whatsapp-sequence.mjs` (import dinâmico), comentários em `scripts/app-server.mjs` e `scripts/hash-app-password.mjs`.
- **Frontend**: `src/lib/quotationIssueApi.ts` (importa tipo de `api/_db/quotation-content`).
- **Config**: `drizzle.config.ts` (schema path).
- **Docs ativas**: `AGENTS.md` raiz (WHERE TO LOOK), `tests/AGENTS.md`, `api/_functions/AGENTS.md`, `api/_lib/AGENTS.md`.

## 8. Sequenciamento de tasks

1. Inventário exato + limpeza de outputs `.js`/`.js.map`.
2. `_http/` + `_shared/` (types, function-adapter, auth, session, password, http-error, rate-limit) + `routes.ts` + `api/[...path].ts` + pipeline.
3. `modules/products` (inclui pricing-core, base para quotations).
4. `modules/customers` (client-schema, interface de repository, quote-leads-pure - base para infrastructure/db).
5. `modules/quotations` (maior domínio; inclui extract, order-templates, catálogo, conteúdo e snapshot).
6. `modules/communication` + `modules/whatsapp` (tasks consecutivas sem commit intermediário quebrado; dependências cíclicas entre flows, media, transporte e public-quotation).
7. `modules/crm` + `modules/sales-orders` + `modules/system`.
8. `infrastructure/db` + `infrastructure/db/repositories` (atômico) + `drizzle.config.ts` + `infrastructure/integrations/`.
9. Grep residual (`_functions`, `_db`, `_lib` em `api/`, `tests/`, `scripts/`, `src/`) + limpeza de outputs órfãos.
10. Verificação final: build limpo, `npm run check`, `npm run test:unit`, `npm test`, `node scripts/check-no-legacy-provider.mjs`.

## 9. Critérios de aceitação

- Nenhum arquivo `.ts` em `api/_functions/`, `api/_db/` ou `api/_lib/`.
- `api/_app/routes.ts` continua sendo a única definição de rotas e compila.
- `grep -r "_functions\|_db\|_lib" api tests scripts src` retorna zero ocorrências em código ativo (permitido em docs históricas).
- `npm run check` verde.
- 689 unit tests verdes (exceto os 29 PostgreSQL skips conhecidos).
- 89 E2E verdes (`npm test`).
- `node scripts/check-no-legacy-provider.mjs` verde.
- Mapa de rotas idêntico ao de antes do refactor (`tests/unit/route-map.test.ts`).

## 10. Fora de escopo

- Frontend por feature (Fases 6-7).
- Vercel Preview como staging, segurança de preview, transição VPS (Fases 8-10).
- CI, verify:fast/full, classificação Playwright, release lanes (Fases 11-14).
- Clients centralizados de integração (Fase 19).
- Correção das violações de fronteira listadas na seção 5.
- Mudança de assinatura de qualquer handler ou repositório.
- Migrations e limpeza PostgreSQL-only (Fases 15-18).

## 11. Riscos

- Grafo denso de imports em `_db` (71 relativos) - rewrite mecânico + type-check por task cobrem.
- Rewrite automatizado pode tocar docs históricas - excluir `docs/` e spec raiz do script.
- Builds sem limpeza geram falso verde - limpeza antes de cada build intermediário.
- 29 testes PostgreSQL continuam sem execução funcional sem banco descartável - não mudam nesta fase.
- `src/lib/quotationIssueApi.ts` não é coberto por type-check da API - conferir manualmente na task 5.
