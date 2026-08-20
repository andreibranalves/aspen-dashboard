# Reavaliação do direcionamento técnico

**Data:** 2026-08-19  
**Base avaliada:** `master` em `2a79843`, alinhada a `origin/master`  
**Documento de origem:** `/home/andrei/temp/veredito.md`

## Veredito executivo

O direcionamento original continua correto na arquitetura geral e no principal próximo passo: **PostgreSQL descartável no CI**. Porém, a prioridade deve ser ampliada de “adicionar banco no CI” para **tornar o pipeline uma representação fiel do risco de produção**.

Hoje o repositório está estruturalmente melhor, mas o CI verde ainda prova menos do que parece:

- três execuções recentes de PR concluíram com sucesso;
- `npm run verify:fast` passa localmente com **773 testes, 745 aprovados e 28 ignorados**;
- os 28 ignorados são majoritariamente integrações PostgreSQL condicionadas a `TEST_DATABASE_URL`;
- o CI não roda PostgreSQL real, smoke E2E, `check:tailwind` nem `check:integration-boundary`;
- o job chamado `types` executa somente o typecheck do backend; o frontend passa em `npx tsc -p tsconfig.json --noEmit`, mas isso não é gate versionado;
- `npm audit` reporta atualmente **9 vulnerabilidades: 4 high, 4 moderate e 1 low**.

Portanto, concordo com a direção original, mas mudaria a sequência: primeiro confiabilidade do pipeline e dependências; depois operabilidade; somente então limpeza estrutural.

## Estado das recomendações originais

| Item original                               | Estado atual                                              | Evidência                                                                                                                                      | Decisão recomendada                                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exercitar CI                                | **Concluído parcialmente**                                | Três runs de PR verdes em 2026-08-19. Workflow continua apenas em `pull_request`.                                                              | Considerar concluído. `workflow_dispatch` não é necessário sem uso concreto. `push` em `master` só compensa a ausência de branch protection.                                          |
| PostgreSQL real no CI                       | **Pendente e prioritário**                                | CI não possui `services.postgres` nem `TEST_DATABASE_URL`; `verify:fast` ignorou 28 testes.                                                    | Implementar primeiro. Banco efêmero, migrations nesse banco e testes serializados.                                                                                                    |
| Typecheck frontend                          | **Pendente como gate**                                    | `typecheck` aponta para `api/tsconfig.api.json`; `tsconfig.json` do frontend não é chamado pelo CI. A execução manual passou sem diagnósticos. | Separar scripts `typecheck:api` e `typecheck:web`; `typecheck` chama ambos.                                                                                                           |
| E2E smoke e artefatos                       | **Pendente**                                              | Existe `test:e2e:smoke`, mas o CI não o chama e não publica `playwright-report/`/`test-results/`.                                              | Adicionar smoke após build; upload somente em falha.                                                                                                                                  |
| `check:tailwind`                            | **Pendente no CI**                                        | Existe e integra `check`, mas não `verify:fast` nem CI.                                                                                        | Incluir no contrato canônico ou deletar se não protege risco real; não manter gate “opcional”.                                                                                        |
| `check-no-legacy-provider`                  | **Ainda existe, maior**                                   | Guard: 1.292 linhas; testes: 525; total: 1.817. Commit mais recente corrige limite de lista de paths desse guard.                              | Simplificar após o pipeline. O custo de manutenção já é observável.                                                                                                                   |
| Vulnerabilidades nanoid/PostCSS             | **Mudaram, não desapareceram**                            | `npm audit`: nanoid, PostCSS, Vite e brace-expansion aparecem como high por advisories atuais.                                                 | Atualizar árvore e lockfile; validar com `verify:full`. Não reutilizar advisories antigos como prova de correção atual.                                                               |
| Remover `yarn` e `class-variance-authority` | **Confirmado como provável código morto**                 | Nenhum import encontrado. `yarn` só aparece nos manifests; CVA também aparece na regra de chunk do Vite.                                       | Remover ambos e limpar a regra do Vite, em mudança pequena e validada.                                                                                                                |
| Alinhar Playwright                          | **Pendente**                                              | `@playwright/test ^1.60.0` e `playwright ^1.59.1`.                                                                                             | Fixar a mesma versão, preferencialmente mantendo apenas o pacote realmente necessário.                                                                                                |
| Limpeza determinística do build API         | **Parcialmente resolvido**                                | Há 0 artefatos JS/map rastreados, mas 464 presentes no workspace; `build:api` não limpa antes do `tsc`.                                        | Adicionar limpeza restrita antes do build. Não redesenhar o output agora.                                                                                                             |
| Sete scripts legados                        | **Parcialmente pendente**                                 | Cinco não têm chamadas fora deles próprios; dois (`test-whatsapp-*`) continuam expostos em `package.json`.                                     | Excluir somente os cinco comprovadamente órfãos. Avaliar os dois vivos por comportamento, não por idade.                                                                              |
| Ciclo frontend                              | **Ainda existe como acoplamento**                         | `routes → página de comunicação → FlowEditorTab → Layout → Sidebar → navigation → routes`.                                                     | Não priorizar acima de CI. Ao tocar o shell, mover o contexto de TopBar para módulo neutro e quebrar o ciclo sem reescrita.                                                           |
| Imports infrastructure → modules            | **Existem, mas a recomendação original era ampla demais** | Repositories importam tipos, invariantes e funções puras de domínio.                                                                           | Não inverter mecanicamente. Adapter de persistência depender de invariantes/tipos do domínio pode ser correto. Corrigir apenas ciclos concretos ou dependência de handler/transporte. |
| `npm ci` na Vercel                          | **Pendente**                                              | `vercel.json` usa `npm install` apesar do lockfile.                                                                                            | Trocar para `npm ci`.                                                                                                                                                                 |
| Node 22 em `engines`                        | **Pendente**                                              | CI usa Node 22; `package.json` não declara runtime.                                                                                            | Fixar `engines.node` em `22.x` ou migrar CI/deploy juntos para versão suportada.                                                                                                      |
| Headers básicos                             | **Pendente**                                              | `vercel.json` não possui `headers`.                                                                                                            | Adicionar baseline pequeno; CSP primeiro em Report-Only.                                                                                                                              |
| Alertas, readiness, restore drill           | **Parcial/desconhecido**                                  | Readiness existe, mas exige autenticação e retorna 200 mesmo com `ready: false`; configuração remota de alertas/backups não está no checkout.  | Corrigir sem expor detalhes; confirmar painéis antes de criar tooling duplicado; registrar restore drill.                                                                             |

## Direcionamento proposto

### P0 — Fazer o CI provar o que importa

1. **Job PostgreSQL efêmero**
   - usar service container nativo do GitHub Actions;
   - aplicar migrations somente no banco descartável;
   - definir `TEST_DATABASE_URL` apenas no job;
   - executar testes PostgreSQL serialmente;
   - falhar se a suíte esperada continuar ignorada.

2. **Contrato único de verificação**
   - `typecheck:web` para `tsconfig.json`;
   - `typecheck:api` para `api/tsconfig.api.json`;
   - alinhar CI e `verify:fast` nos checks rápidos existentes;
   - evitar duplicar lógica YAML: scripts npm continuam sendo a interface do pipeline.

3. **Smoke E2E**
   - rodar `test:e2e:smoke` depois do build;
   - publicar traces, screenshots e relatório apenas em falha;
   - manter suíte completa fora do caminho crítico se custo/tempo não justificar cada PR.

Esse pacote é mais valioso que qualquer refatoração arquitetural agora: aumenta a profundidade do módulo CI — interface pequena, mais comportamento realmente verificado.

### P1 — Fechar riscos baratos de supply chain e deploy

1. Corrigir a árvore apontada por `npm audit`, começando pelos 4 highs; não adicionar um gate permanentemente vermelho antes da atualização.
2. Alinhar Playwright e remover `yarn`/CVA comprovadamente não usados.
3. Trocar Vercel para `npm ci` e alinhar runtime via `engines.node`.
4. Adicionar Dependabot para npm e GitHub Actions. Para vulnerabilidades em PR, escolher **um** mecanismo: Dependency Review se disponível; caso contrário `npm audit --audit-level=high`.
5. Verificar secret scanning/push protection no painel. Não adicionar Gitleaks se o recurso nativo já estiver ativo.

O repositório é privado e a API confirma que branch protection/rulesets continuam indisponíveis no plano atual. Portanto, CI em `push` para `master` pode servir como detecção pós-merge, mas não substitui proteção preventiva. Não trataria isso como P0 enquanto o fluxo humano de PR estiver funcionando.

### P2 — Operabilidade mínima

1. Fazer readiness retornar **503** quando não pronto.
2. Se um probe externo for necessário, expor somente `{ "ready": boolean }`; manter detalhes autenticados.
3. Vincular readiness/smoke a Deployment Checks da Vercel, se o plano permitir.
4. Confirmar alertas de 5xx/latência no painel antes de criar código próprio.
5. Executar restore drill em banco isolado e registrar data, RTO, RPO e validações. Verificar backup não substitui restaurá-lo.
6. Adicionar headers mínimos (`X-Content-Type-Options`, `Referrer-Policy`); testar CSP em Report-Only antes de bloquear integrações.

### P3 — Reduzir manutenção acidental

1. Apagar os cinco scripts sem callers:
   - `scripts/playwright-test-product-detail.mjs`;
   - `scripts/playwright-test-react.mjs`;
   - `scripts/playwright-test-responsive.mjs`;
   - `scripts/test-manual-orcamento.mjs`;
   - `scripts/test-product-detail.mjs`.
2. Substituir o parser próprio de 1.817 linhas (`check-no-legacy-provider` + testes) por:
   - regra estrutural do ESLint para imports proibidos;
   - scan textual pequeno para nomes/flags aposentados que não são imports;
   - revisão normal para tentativas de ofuscação.

O guard atual tenta ser analisador estático e detector de ofuscação. Isso oferece interface grande, implementação cara e falsa sensação de segurança. Se o threat model inclui contributor malicioso tentando burlar checks, um parser artesanal não é controle suficiente; revisão, permissões e scanners próprios para segurança são a seam correta.

### P4 — Arquitetura somente quando houver mudança adjacente

- Quebrar o ciclo frontend movendo `SetTopBarActionsCtx`/`useSetTopBarActions` para módulo neutro; sem React Router e sem reescrita.
- Não “corrigir” todos os imports de infrastructure para modules. Repositories são adapters e podem depender de tipos/invariantes puros do domínio. O problema real seria domínio depender do adapter concreto ou ciclos de runtime.
- Manter monólito modular, PostgreSQL como fonte de verdade e uma única Function Vercel.

## O que eu faria nas próximas quatro mudanças

1. **PR 1:** PostgreSQL efêmero no CI + prova de zero skips esperados.
2. **PR 2:** typecheck web + smoke E2E + artifacts em falha + alinhamento dos gates.
3. **PR 3:** atualização de dependências, Playwright alinhado, remoção de Yarn/CVA, `npm ci` e `engines.node`.
4. **PR 4:** readiness/503 + checks de deploy + registro do primeiro restore drill.

Depois disso, apagar scripts mortos e reduzir o guard legado. Refatoração dos seams arquiteturais fica oportunista.

## Evidência executada

- `npm run verify:fast`: exit 0; 773 testes; 745 pass; 28 skipped; 0 fail.
- `npx tsc -p tsconfig.json --noEmit`: exit 0; sem diagnósticos.
- `npm audit --json`: 9 vulnerabilidades; 4 high, 4 moderate, 1 low.
- GitHub Actions: três execuções recentes de PR concluídas com sucesso.
- GitHub branch protection e rulesets: HTTP 403, indisponíveis para este repositório privado no plano atual.
- Artefatos compilados sob `api/`: 0 rastreados; 464 presentes no workspace.
- Guard legado: 1.817 linhas incluindo testes.

Não foram executados E2E, migrations, deploys nem operações de escrita externas.

## Fontes primárias

- GitHub Actions — service containers: <https://docs.github.com/actions/tutorials/communicating-with-docker-service-containers>
- GitHub Actions — artifacts: <https://docs.github.com/en/actions/concepts/workflows-and-actions/storing-workflow-data-as-artifacts>
- GitHub — Dependency Review: <https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review>
- GitHub — Dependabot version updates: <https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-version-updates>
- GitHub — push protection: <https://docs.github.com/en/code-security/concepts/secret-security/push-protection>
- npm — `npm ci`: <https://docs.npmjs.com/cli/v11/commands/npm-ci/>
- npm — `npm audit`: <https://docs.npmjs.com/cli/v11/commands/npm-audit/>
- Vercel — `vercel.json`: <https://vercel.com/docs/project-configuration/vercel-json>
- Vercel — Node.js versions: <https://vercel.com/docs/functions/runtimes/node-js/node-js-versions>
- Vercel — Deployment Checks: <https://vercel.com/docs/deployment-checks>
- Vercel — Alerts: <https://vercel.com/docs/alerts>
- MDN — practical security guides: <https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides>
- PostgreSQL — `pg_verifybackup`: <https://www.postgresql.org/docs/18/app-pgverifybackup.html>
- Advisories atuais detectados: [nanoid GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [nanoid GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8), [PostCSS GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [PostCSS GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849), [Vite GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3), [Vite GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff).

## Limites desta avaliação

Configurações remotas de Vercel Alerts/Deployment Checks, secret scanning, push protection e backups do provedor não são comprováveis pelo checkout. Devem ser confirmadas nos painéis antes de abrir trabalho duplicado. O estado do banco não foi acessado e nenhuma migration foi executada.
