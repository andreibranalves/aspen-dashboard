# Boundary PostgreSQL + Drizzle

## Status

Draft for user review.

## Contexto

O Aspen Dashboard usa PostgreSQL como fonte de verdade e Drizzle como camada de acesso ao banco.

A implementação atual já concentra o schema, o client, os locks, os invariants e os repositories em `api/infrastructure/db`.

Os módulos de negócio normalmente consomem repositories, mas três módulos ainda acessam a camada de banco diretamente por motivos específicos de leitura e composição:

- `api/modules/operational-status.ts` consulta a prontidão do banco e as configurações obrigatórias.
- `api/modules/quotation-preview.ts` resolve uma versão de template diretamente pelo client compartilhado.
- `api/modules/whatsapp-crm-match.ts` executa a consulta composta usada para relacionar conversas a registros CRM.

Essas exceções não precisam ser movidas nesta fase.

O risco atual é permitir que novos módulos repitam esse acoplamento sem uma decisão explícita.

A Fase 15 deve manter PostgreSQL e Drizzle, registrar o boundary vigente e impedir regressão estrutural sem alterar comportamento de negócio.

## Objetivo

Registrar a arquitetura de acesso a dados como contrato ativo e adicionar um check estático incremental.

O check deve aceitar as três exceções existentes e bloquear novos acessos diretos fora delas.

A fase não deve trocar PostgreSQL, Drizzle, o driver `postgres`, o schema ou o modelo de repositories.

## Fora de escopo

- Mover as três exceções atuais para repositories.
- Reorganizar todos os módulos em novos diretórios.
- Alterar tabelas, colunas, índices, constraints ou SQL histórico.
- Executar ou gerar migrations.
- Alterar comportamento de handlers, services, repositories ou integrações.
- Configurar banco staging, Preview, backup, canary ou deploy.
- Remover dependências npm.
- Alterar arquivos gerados em `public/` ou `api/`.
- Implementar a lane HIGH de migrations da Fase 16.

## Boundary aprovado

O fluxo oficial de dados é:

```text
handler
  -> module ou service
  -> repository
  -> api/infrastructure/db
  -> Drizzle
  -> PostgreSQL
```

`api/infrastructure/db/schema.ts` define o schema Drizzle e os nomes persistidos.

`api/infrastructure/db/client.ts` cria e reutiliza as conexões de runtime e expõe o client de migration separado.

`api/infrastructure/db/repositories/` concentra consultas e mutações por contrato de domínio.

`api/infrastructure/db/quotation-write-lock.ts` e `api/infrastructure/db/quotation-revision-invariants.ts` são componentes de infraestrutura autorizados a conhecer Drizzle para proteger invariants transacionais.

`drizzle.config.ts`, a pasta `drizzle/` e o comando `npm run db:migrate` pertencem ao fluxo controlado de migration.

Eles não fazem parte do runtime HTTP e não devem ser chamados no startup, no build ou no CI padrão.

Módulos e handlers podem importar repositories e tipos públicos de repositories.

Módulos novos não podem importar diretamente `drizzle-orm`, `postgres`, o schema ou o client de `api/infrastructure/db`.

## Exceções atuais

As exceções abaixo permanecem aceitas nesta fase e devem ser tratadas como dívida explícita:

| Arquivo | Imports diretos aceitos | Motivo |
| --- | --- | --- |
| `api/modules/operational-status.ts` | `getDatabase`, `appSettings`, `sql` | Readiness do banco e leitura mínima de configurações obrigatórias. |
| `api/modules/quotation-preview.ts` | `getDatabase` | Resolução de versão de template no fluxo de preview existente. |
| `api/modules/whatsapp-crm-match.ts` | `and`, `asc`, `desc`, `eq`, `inArray`, `ne`, `or`, `sql`, `getDatabase`, `AppDatabase`, `clients`, `crmDeals`, `quoteLeads`, `quoteRevisions`, `quotations` | Consulta composta de correlação CRM que ainda não foi extraída para um repository dedicado. |

A allowlist deve ser baseada no caminho normalizado do arquivo, no módulo importado e nos bindings importados.

Um novo binding direto dentro de um arquivo allowlisted também deve falhar.

Imports de `../infrastructure/db/repositories/*.js` continuam permitidos em qualquer módulo.

## Check estático

Criar `scripts/check-postgres-boundary.mjs` usando somente APIs nativas do Node.js.

O script deve exportar uma função pura para receber uma lista de arquivos e retornar violações com caminho, linha e motivo.

A execução CLI deve descobrir arquivos TypeScript sob `api/modules/` recursivamente.

A execução CLI deve inspecionar imports estáticos e imports dinâmicos.

O check deve identificar estes alvos diretos:

- `drizzle-orm` e qualquer subpath de `drizzle-orm`.
- `postgres` e qualquer subpath de `postgres`.
- O módulo `api/infrastructure/db/client.ts` ou sua extensão `.js` emitida.
- O módulo `api/infrastructure/db/schema.ts` ou sua extensão `.js` emitida.

Imports para repositories não são violações.

A allowlist deve comparar os bindings efetivamente importados, não apenas o caminho do arquivo.

Cada violação deve ser impressa como `arquivo:linha: motivo`.

O processo deve retornar `0` sem violações e `1` quando encontrar qualquer violação.

O processo não deve ler valores de ambiente, abrir conexões ou executar comandos externos.

O output não deve incluir credenciais, SQL de dados, payloads ou dados pessoais.

## Integração npm e CI

Adicionar o script:

```json
"check:db-boundary": "node scripts/check-postgres-boundary.mjs"
```

Adicionar `npm run check:db-boundary` à composição de `verify:fast`.

Criar um job paralelo `boundary` no workflow `.github/workflows/ci.yml`.

O job deve usar as mesmas permissões, checkout fixado, Node.js 22 e política de credenciais já existentes.

O job deve executar `npm ci` e `npm run check:db-boundary`.

O job `build` deve incluir `boundary` em `needs`.

O job não deve executar migrations, E2E, deploy, chamadas externas ou usar secrets.

## Testes

Criar `tests/unit/postgres-boundary.test.ts` para testar a função pura do scanner.

O teste deve cobrir uma importação direta proibida em um módulo novo.

O teste deve cobrir a aceitação dos bindings atuais de cada uma das três exceções.

O teste deve cobrir uma importação de repository permitida.

O teste deve cobrir o retorno da linha e do motivo para uma violação.

O teste deve usar fixtures de texto em memória e não deve abrir banco, ler `.env` ou depender de arquivos gerados.

A ordem de validação da fase é:

```bash
npm run check:db-boundary
npm run verify:fast
npm run typecheck
npm run test:unit
npm run build
npx prettier --check docs/superpowers/specs/2026-08-18-postgresql-drizzle-boundary-design.md scripts/check-postgres-boundary.mjs tests/unit/postgres-boundary.test.ts .github/workflows/ci.yml
node scripts/check-no-legacy-provider.mjs
git diff --check
```

O build deve ser executado depois do teste para confirmar que o novo script e o teste não quebram o projeto.

Outputs TypeScript emitidos em `api/` devem ser removidos antes da conclusão.

## Critérios de aceitação

- O documento `docs/postgresql-drizzle-boundary.md` descreve o fluxo oficial, os owners, as exceções e a regra para novos módulos.
- O check passa no estado atual do repository.
- O check falha para um módulo novo que importa diretamente Drizzle, `postgres`, schema ou client.
- O check aceita os bindings atuais e apenas os bindings atuais das três exceções.
- O check aceita imports de repositories.
- `verify:fast` executa o check sem remover os comandos existentes.
- O CI executa o check em paralelo e o build depende dele.
- Nenhum runtime, migration, schema, provider, fixture, rota ou assertion muda de comportamento.
- Nenhum valor sensível aparece em documentação, output ou testes.
- Não há mudanças em `public/`, SQL histórico ou dependências npm.

## Decisões adiadas

A extração das três exceções para repositories será avaliada somente quando uma mudança de domínio tocar esses fluxos.

A política operacional de migrations HIGH será definida em uma spec própria da Fase 16.

A remoção da allowlist somente ocorrerá quando cada exceção tiver um repository equivalente, testes de comportamento e revisão independente.
