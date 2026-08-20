# Design - CI, checks e release lanes

## Status

Aprovado pelo usuário em 2026-08-18.

## Contexto

As Fases 11-14 introduzem automação de CI, comandos de verificação, classificação dos E2E e um processo proporcional ao risco.

O repositório usa Node.js 22, npm, TypeScript, Node Test Runner, Vite e Playwright.

Não há workflow GitHub Actions existente.

O script `test:unit` precisa compilar a API antes de executar porque os testes importam os arquivos JavaScript emitidos em `api/`.

O script `build` compila a API e gera o frontend em `public/`.

Os testes Playwright locais usam mocks e os testes de staging são excluídos da execução local padrão.

## Objetivos

- Executar lint, tipos, testes unitários e build em CI sem adicionar dependências.
- Oferecer `verify:fast` para feedback local rápido.
- Oferecer `verify:full` para mudanças críticas sem recompilar a API duas vezes no mesmo fluxo.
- Permitir seleção de E2E por domínio via tags Playwright.
- Documentar lanes LOW, MEDIUM e HIGH sem automatizar deploys ou operações externas.
- Preservar compatibilidade dos scripts existentes.

## Fora de escopo

- Deploy, merge, proteção de branches ou configuração no GitHub Dashboard.
- Execução de E2E de staging no CI padrão.
- Migrations, backup remoto, canary ou qualquer escrita externa automática.
- Mudança de comportamento do produto ou da configuração de staging.
- Remoção de flags, providers, adapters, migrations históricas ou arquivos gerados.
- Inclusão de dependências npm.

## Decisões

### 1. Scripts npm

Manter `type-check`, `test:unit`, `test:e2e`, `build:api` e `build` funcionando.

Adicionar `typecheck` como alias canônico de `type-check`.

Extrair a geração web para `build:web` e manter `build` como `build:api` seguido de `build:web`.

Mover a limpeza dos assets web para um comando explícito usado por `build:web`, removendo a dependência do lifecycle implícito `prebuild`.

Manter `test:unit` autocontido e extrair uma execução sem recompilação para uso interno de composição.

Definir `verify:fast` como lint, typecheck e testes unitários.

Definir `verify:full` como `verify:fast`, build web e Playwright.

Nesse fluxo, a compilação da API feita por `test:unit` e o build web cobrem o build completo sem repetir a compilação da API.

Adicionar `test:e2e:smoke` usando `--grep "@smoke"`.

Manter `check` inalterado para não remover a verificação existente de Tailwind.

### 2. GitHub Actions

Criar `.github/workflows/ci.yml` para pull requests.

Usar Node.js 22 e `npm ci` a partir do `package-lock.json`.

Criar jobs independentes para `lint`, `types` e `unit`.

Criar job `build` dependente dos três jobs anteriores.

Usar permissões mínimas de leitura, cancelamento de execuções anteriores do mesmo ref e nenhum segredo ou ambiente externo.

O job de unitários usa o comando autocontido `test:unit`.

O job de build usa `build` e não executa Playwright.

### 3. Tags Playwright

Usar tags nos títulos de `test.describe` quando o arquivo tiver um grupo existente.

Usar tags no título do teste quando não houver grupo para evitar wrappers artificiais de arquivos grandes.

As tags válidas são `@smoke`, `@quotations`, `@crm`, `@products`, `@whatsapp`, `@database`, `@external` e `@critical`.

A classificação inicial é:

| Área | Specs | Tags principais |
| --- | --- | --- |
| CRM | `client-core`, `crm-prune` | `@crm`, `@smoke` no fluxo principal |
| Dashboard | `dashboard` | `@smoke` |
| Produtos | `products-core` | `@products`, `@smoke` |
| Orçamentos | `orcamento-core`, `orcamento`, `quotation-*`, `quotations-core`, `settings`, `task-8-fix-*` | `@quotations`; `@smoke` nos fluxos rápidos; `@critical` nos fluxos de emissão, entrega ou reconciliação |
| Banco | `postgres-only-cutover`, `quotation-cutover-staging`, `quotation-cutover` | `@database`, `@critical` |
| WhatsApp | `whatsapp-inbox` | `@whatsapp`, `@external`, `@critical` |

Não alterar fixtures, rotas, assertions, ordem ou comportamento dos testes.

A seleção de tags usa o `--grep` nativo do Playwright.

### 4. Release lanes

Criar documentação operacional ativa em `docs/release-lanes.md`.

A lane LOW cobre CSS, copy, ícones, formatação e componentes puramente visuais.

A lane LOW exige CI e Preview antes do merge e produção.

A lane MEDIUM cobre endpoints, regras de negócio, filtros, CRM e alterações comuns em orçamentos.

A lane MEDIUM exige CI, unitários, E2E do domínio afetado e Preview antes da produção.

A lane HIGH cobre migrations, autenticação, envio WhatsApp, integrações externas, permissões e mudanças destrutivas.

A lane HIGH exige `verify:full`, staging com banco, E2E completo, backup, aprovação explícita, produção e canary read-only.

Migrations continuam sendo executadas somente por `npm run db:migrate` em etapa controlada.

A documentação não cria automação de deploy, backup, aprovação ou canary.

## Fluxo de dados

```text
Pull request
    |
    +--> lint
    +--> types
    +--> unit
            |
            v
          build

Desenvolvimento: verify:fast
Mudança crítica: verify:full
Seleção de domínio: Playwright --grep @tag
```

## Tratamento de falhas

Qualquer comando de verificação deve retornar o código de saída original do comando que falhar.

O CI deve falhar no primeiro job obrigatório com erro e impedir o build dependente.

Nenhum erro de build, banco, provedor ou credencial deve ser exposto em artefatos ou documentação com valores sensíveis.

E2E de staging continua opt-in e depende do ambiente operacional externo.

## Verificação e aceitação

- `npm run typecheck` e `npm run type-check` passam.
- `npm run build:web` e `npm run build` passam.
- `npm run verify:fast` passa.
- `npm run test:e2e:smoke -- --list` lista pelo menos um teste.
- `npx playwright test --grep "@products|@smoke" --list` lista testes.
- `npm run verify:full` passa.
- `npm test` passa.
- O workflow contém jobs paralelos de lint, tipos e unitários, com build dependente.
- Cada tag válida aparece em pelo menos um teste aplicável.
- `api/**/*.js` e `api/**/*.js.map` gerados por builds são removidos antes da conclusão.
- Não há dependências novas nem alterações em `public/`, `drizzle/` ou migrations históricas.
