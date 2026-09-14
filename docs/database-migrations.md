# Migrations PostgreSQL

## Regra principal

Migrations seguem a classificação de `docs/release-lanes.md`: uma migration genuinamente aditiva pode ser SAFE; migration destrutiva é CRITICAL. Criar e testar uma migration genuinamente aditiva em PostgreSQL local descartável faz parte da implementação autorizada. Migration destrutiva, alteração histórica ou mudança da estratégia exige decisão explícita; aplicar em staging ou produção exige autorização operacional separada. Migrations nunca executam implicitamente no startup, build ou CI padrão.

Exceção explícita: o job `postgres` do CI de pull request invoca o apply raw (`npm run db:migrate`)
contra um PostgreSQL service container descartável, nunca contra staging ou produção.

`npm run migrate:apply` é o apply operacional (preflight completo + apply em um comando único);
o apply raw `npm run db:migrate` só é aceito com alvo explicitamente descartável (loopback).

`db:migrate:operational` é um comando interno de `migrate:apply`, não um ponto de
entrada manual. Ele só aceita alvo quando `migrate:apply` injeta
`MIGRATE_APPLY_APPROVED=1` após o preflight; `MIGRATION_TARGET_DATABASE_URL`
sozinha não basta. Os consumidores técnicos existentes ficam preservados;
remover esse entrypoint exige decisão explícita.

O job `postgres` cria um fixture determinístico descartável antes de `verify:quotation-company`.
O fixture exige ao menos uma revisão e uma linha de configurações, portanto a verificação
agregada nunca passa com corpus vazio; ele só é usado no service container efêmero do CI.

A migration de publicação dos templates oficiais é forward-only: ela mantém versões
históricas e acrescenta as versões v2 de forma idempotente. Em caso de rollback de
código, mantenha as colunas e versões aplicadas; restaure somente o código compatível
e valide novamente em um alvo descartável antes de qualquer novo apply. Não há down
migration destrutiva.

## Classificação

Toda migration nova começa com `-- migration-risk: additive` ou `-- migration-risk: destructive`.

Additive acrescenta estrutura ou dados compatíveis e normalmente segue o fluxo padrão de migration.

Destructive remove, renomeia ou torna estrutura ou dados incompatíveis. Migrations destrutivas, de cleanup, de transição da fonte de verdade ou parte explícita de um cutover de produção exigem também os gates operacionais definidos pelo procedimento correspondente.

O cabeçalho declara risco, mas não substitui review humano.

## Expand-contract

Mudança destructive segue `expand -> deploy compatível -> migrate data -> contract`.

Contract não ocorre antes de a aplicação deixar de depender da estrutura antiga e a migração de dados estar validada.

## Gate estático

Execute `npm run check:db-migrations`.

O gate recusa alteração de migration histórica e classificação inválida.

## Gate do alvo não-produtivo de migration

O shell operacional aprovado fornece `STAGING_DATABASE_URL`, `STAGING_PG_SERVICE`, `PRODUCTION_DATABASE_URL`, `PGSERVICEFILE` e `PGPASSFILE`. Esses nomes são contratos técnicos preexistentes do alvo não-produtivo de migration; não representam uma homologação permanente nem uma VPS de staging.

`PGSERVICEFILE` e `PGPASSFILE` devem ter modo `0600`.

Execute, nesta ordem:

```bash
npm run check:db-migrations
npm run migrate:apply
```

Pare na primeira falha.

Quando uma jornada mutável precisar de ensaio, o operador seleciona o banco
isolado correspondente no contrato aprovado e executa o E2E do deployment
Preview separadamente, conforme [Preview isolado](./preview-isolation.md):

```bash
PREVIEW_BASE_URL="https://<deployment-do-pr>.vercel.app" npm run test:e2e:preview
```

O executor protegido pré-configura `DATABASE_URL`,
`PRODUCTION_DATABASE_URL` e as credenciais/atestações E2E; não coloque URLs de
banco ou segredos no comando. `DATABASE_URL` deve ser verificada pelo operador
como a URL efetiva do deployment do PR. O preflight local compara identidades e o endpoint
`/api/operational-status`, junto da fixture atestada, comprova ambiente,
writes-off, conectividade e persistência servida; nenhuma dessas etapas prova
sozinha a identidade única da branch. `PRODUCTION_DATABASE_URL` é exigida no
executor protegido apenas para a comparação e não é passada ao Playwright.

O alvo de migration selecionado continua sendo o contrato existente; não crie
alias Preview, dual-read ou dual-write para migrations.

`cutover-env-status` é um gate de release/cutover, não um pré-requisito geral de migration de banco. Execute-o quando a operação também envolver canário Production, deploy/promoção, rollback, cleanup, cutover de e-mail ou outra etapa de cutover explicitamente declarada.

Nunca execute o apply usando somente `DATABASE_URL`.

## Gate produção

A seleção explícita do alvo de produção é um caminho separado do alvo
não-produtivo de migration. O shell operacional aprovado precisa fornecer, além
de `PGSERVICEFILE` e `PGPASSFILE` em modo `0600`:

- `PRODUCTION_DATABASE_URL` e `DATABASE_URL` identificando o mesmo database;
- `PRODUCTION_PG_SERVICE` no `PGSERVICEFILE`, confirmado por `SELECT current_database()`;
- `CUTOVER_PG_SERVICE` e `CUTOVER_EXPECTED_DATABASE` identificando o mesmo alvo;
- `CUTOVER_BACKUP_DIR` ou `BACKUP_DIR` externo ao checkout.

Execute, nesta ordem:

```bash
npm run check:db-migrations
npm run migrate:apply -- --target production
```

O comando prova a identidade do alvo e então executa o backup existente (`npm run db:backup`) antes de abrir o apply. Se a prova de identidade ou o backup falhar, o apply não é chamado. A migration permanece forward-only; não existe rollback automático.

Sem argumento, `npm run migrate:apply` mantém exatamente o fluxo técnico de
`staging`. Alvos diferentes de `staging` ou `production` são recusados.

## Evidência

Salve stdout dos gates em diretório operacional protegido fora do checkout.

A evidência contém commit, timestamp, migration, risco e resultados redigidos.

Nunca salve URL, host, usuário, senha, PII, payload ou linha de dados.

## Falhas

O preflight é read-only e executa somente `SELECT current_database()`.

Falha de preflight não chama migration.

Falha de migration não libera E2E, Preview ou Production.

Não existe rollback automático para SQL arbitrário.

Restore usa o procedimento de backup existente e um alvo explicitamente isolado.
