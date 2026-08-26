# Migrations PostgreSQL

## Regra principal

Migrations são mudanças HIGH e nunca executam implicitamente no startup, build ou CI padrão.

Exceção explícita: o job `postgres` do CI de pull request invoca `npm run db:migrate`
contra um PostgreSQL service container descartável, nunca contra staging ou produção.

`npm run db:migrate` continua sendo o único apply e deve ser invocado explicitamente.

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

## Gate staging

O shell operacional aprovado fornece `STAGING_DATABASE_URL`, `STAGING_PG_SERVICE`, `PRODUCTION_DATABASE_URL`, `PGSERVICEFILE` e `PGPASSFILE`.

`PGSERVICEFILE` e `PGPASSFILE` devem ter modo `0600`.

Execute, nesta ordem:

```bash
npm run check:db-migrations
npm run db:migration:preflight
TEST_DATABASE_URL="$STAGING_DATABASE_URL" DATABASE_URL= npm run db:migrate
npm run test:e2e:staging
```

Pare na primeira falha.

`cutover-env-status` é um gate de release/cutover, não um pré-requisito geral de migration de banco. Execute-o quando a operação também envolver canário Production, deploy/promoção, rollback, cleanup, cutover de e-mail ou outra etapa de cutover explicitamente declarada.

Nunca execute o apply usando somente `DATABASE_URL`.

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
