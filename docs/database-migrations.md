# Migrations PostgreSQL

## Regra principal

Migrations seguem a classificação de `docs/release-lanes.md`: uma migration genuinamente aditiva pode ser SAFE; migration destrutiva é CRITICAL. O que exige decisão ou autorização está na seção Autorizações de `AGENTS.md`. Migrations nunca executam implicitamente no startup, build ou CI padrão.

Exceção explícita: o job `postgres` do CI de pull request invoca o apply raw (`npm run db:migrate`)
contra um PostgreSQL service container descartável, nunca contra staging ou produção.

`npm run migrate:apply` é o apply operacional (preflight completo + apply em um comando único);
o apply raw `npm run db:migrate` só é aceito com alvo explicitamente descartável (loopback).

`db:migrate:operational` é um comando interno de `migrate:apply`, não um ponto de
entrada manual. Ele só aceita alvo quando `migrate:apply` injeta
`MIGRATE_APPLY_APPROVED=1` após o preflight; `MIGRATION_TARGET_DATABASE_URL`
sozinha não basta. Os consumidores técnicos existentes ficam preservados;
remover esse entrypoint exige decisão explícita.

A migration de publicação dos templates oficiais é forward-only: ela mantém versões
históricas e acrescenta as versões v2 de forma idempotente. Em caso de rollback de
código, mantenha as colunas e versões aplicadas; restaure somente o código compatível
e valide novamente em um alvo descartável antes de qualquer novo apply. Não há down
migration destrutiva.

## Migrations escritas à mão

Toda migration é SQL escrito à mão em `drizzle/NNNN_<nome>.sql`, com a entrada
correspondente em `drizzle/meta/_journal.json` (próximo `idx`, `tag` igual ao
nome do arquivo e `when` maior que o anterior). Os snapshots em `drizzle/meta/`
param no `0046`; não use `drizzle-kit generate`, porque ele compara contra o
último snapshot e recriaria as tabelas das migrations 0047 em diante. O schema
TypeScript (`api/_infrastructure/db/schema.ts`) é atualizado na mesma mudança.

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

O nome `staging` é histórico: ele identifica o alvo técnico não-produtivo de migration, não um ambiente de homologação (ver [Preview isolado](./preview-isolation.md)).

O shell operacional aprovado fornece `STAGING_DATABASE_URL`, `STAGING_PG_SERVICE`, `PRODUCTION_DATABASE_URL`, `PGSERVICEFILE` e `PGPASSFILE`. Esses nomes são contratos técnicos preexistentes do alvo não-produtivo de migration; não representam uma homologação permanente nem uma VPS de staging.

`PGSERVICEFILE` e `PGPASSFILE` devem ter modo `0600`.

Execute, nesta ordem:

```bash
npm run check:db-migrations
npm run migrate:apply
```

Pare na primeira falha.

Quando uma jornada mutável precisar de ensaio, siga o E2E controlado de
[Preview isolado](./preview-isolation.md). O alvo de migration selecionado
continua sendo o contrato existente; não crie alias Preview, dual-read ou
dual-write para migrations.

`node scripts/cutover-env-status.mjs migration` (ou `migration-production`) confere os nomes exigidos sem mostrar valores; `migrate:apply` repete essa checagem no preflight.

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
