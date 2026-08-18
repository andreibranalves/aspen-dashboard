# Boundary PostgreSQL + Drizzle

## Regra principal

PostgreSQL é a fonte de verdade do Aspen Dashboard.

Drizzle é a camada de acesso usada pelo backend.

O fluxo oficial é:

```text
handler
  -> module ou service
  -> repository
  -> api/infrastructure/db
  -> Drizzle
  -> PostgreSQL
```

Módulos novos devem consumir repositories e seus tipos públicos.

Módulos novos não devem importar diretamente `drizzle-orm`, `postgres`, o schema ou o client de `api/infrastructure/db`.

## Ownership

`api/infrastructure/db/schema.ts` define o schema Drizzle e os nomes persistidos.

`api/infrastructure/db/client.ts` cria e reutiliza conexões de runtime e mantém o client dedicado ao fluxo de migration.

`api/infrastructure/db/repositories/` concentra consultas e mutações por contrato de domínio.

`api/infrastructure/db/quotation-write-lock.ts` e `api/infrastructure/db/quotation-revision-invariants.ts` conhecem Drizzle para proteger invariants transacionais.

`drizzle.config.ts`, a pasta `drizzle/` e `npm run db:migrate` pertencem ao fluxo controlado de migration.

Migrations não executam no startup, no build ou no CI padrão.

## Exceções atuais

Estas exceções são aceitas somente enquanto não houver repository equivalente revisado:

| Arquivo                             | Acesso aceito                                        | Motivo                                           |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `api/modules/operational-status.ts` | `getDatabase`, `appSettings`, `sql`                  | Readiness do banco e configurações obrigatórias. |
| `api/modules/quotation-preview.ts`  | `getDatabase`                                        | Resolução da versão de template no preview.      |
| `api/modules/whatsapp-crm-match.ts` | Bindings Drizzle, client e tabelas listados no check | Consulta composta de correlação CRM.             |

A allowlist ativa e executável está em `scripts/check-postgres-boundary.mjs`.

Um novo binding direto em uma exceção existente também deve falhar.

## Check obrigatório

Execute antes de enviar uma mudança:

```bash
npm run check:db-boundary
npm run check:db-migrations
```

O check procura imports diretos de Drizzle, `postgres`, schema e client sob `api/modules/`.

Imports de repositories continuam permitidos.

A saída contém somente caminho, linha e motivo.

Nenhum dos checks executa migration ou abre escrita no banco.

Os checks não leem ambiente, abrem banco ou fazem chamadas externas.

## Evolução

Extraia uma exceção para um repository quando uma mudança de domínio tocar aquele fluxo.

A extração deve preservar o comportamento, adicionar testes de comportamento e remover a entrada correspondente da allowlist na mesma mudança.

A política operacional HIGH está em [Migrations PostgreSQL](./database-migrations.md).

Não altere migrations históricas para resolver uma violação de boundary.
