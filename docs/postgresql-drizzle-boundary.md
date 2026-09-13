# Boundary PostgreSQL + Drizzle

## Regra principal

PostgreSQL é a fonte de verdade do Aspen Dashboard.

Drizzle é a camada de acesso usada pelo backend.

O fluxo oficial é:

```text
handler
  -> module ou service
  -> repository
  -> api/_infrastructure/db
  -> Drizzle
  -> PostgreSQL
```

Módulos novos devem consumir repositories e seus tipos públicos.

Módulos novos não devem importar diretamente `drizzle-orm`, `postgres`, o schema ou o client de `api/_infrastructure/db`.

## Ownership

`api/_infrastructure/db/schema.ts` define o schema Drizzle e os nomes persistidos.

`api/_infrastructure/db/client.ts` cria e reutiliza conexões de runtime e mantém o client dedicado ao fluxo de migration.

`api/_infrastructure/db/repositories/` concentra consultas e mutações por contrato de domínio.

`api/_infrastructure/db/quotation-write-lock.ts` e `api/_infrastructure/db/quotation-revision-invariants.ts` conhecem Drizzle para proteger invariants transacionais.

`drizzle.config.ts`, a pasta `drizzle/` e `npm run db:migrate` pertencem ao fluxo controlado de migration.

Migrations não executam no startup, no build ou no CI padrão de validação estática.

Exceção explícita: o job `postgres` do CI de pull request aplica a cadeia versionada
somente em um PostgreSQL service container descartável, antes dos testes de repositories.
Esse job não usa bancos de Preview ou Production nem credenciais operacionais.

## Exceções atuais

Estas exceções são aceitas somente enquanto não houver repository equivalente revisado:

| Arquivo                              | Acesso aceito                                        | Motivo                                           |
| ------------------------------------ | ---------------------------------------------------- | ------------------------------------------------ |
| `api/_modules/operational-status.ts` | `getDatabase`, `appSettings`, `sql`                  | Readiness do banco e configurações obrigatórias. |
| `api/_modules/quotation-preview.ts`  | `getDatabase`                                        | Resolução da versão de template no preview.      |
| `api/_modules/whatsapp-crm-match.ts` | Bindings Drizzle, client e tabelas listados no check | Consulta composta de correlação CRM.             |

A allowlist ativa e executável está em `scripts/check-postgres-boundary.mjs`.

Um novo binding direto em uma exceção existente também deve falhar.

## Check obrigatório

Execute antes de enviar uma mudança:

```bash
npm run check:db-boundary
npm run check:db-migrations
npm run check:vercel-functions
```

O check procura imports diretos de Drizzle, `postgres`, schema e client sob `api/_modules/`.

Imports de repositories continuam permitidos.

A saída contém somente caminho, linha e motivo.

Nenhum dos checks lê credenciais de banco nem acessa o ambiente operacional de destino, não abre conexão com banco, não executa migrations e não escreve.

O `check:db-migrations` lê `MIGRATION_BASE_REF` apenas para inspecionar o diff Git local; não acessa um alvo de banco nem faz chamadas externas.

## Layout da Vercel

`api/[...path].ts` é a única entrada de Function implantável.

`api/_modules/`, `api/_infrastructure/`, `api/_app/`, `api/_http/` e `api/_shared/` são diretórios privados para a descoberta file-based da Vercel.

Valide o layout com `npm run check:vercel-functions`.

Não mova helpers para um caminho público sob `api/` e não use `.vercelignore` para remover uma dependência importada pelo catch-all.

## Evolução

Extraia uma exceção para um repository quando uma mudança de domínio tocar aquele fluxo.

A extração deve preservar o comportamento, adicionar testes de comportamento e remover a entrada correspondente da allowlist na mesma mudança.

A classificação de risco segue [Lanes de entrega](./release-lanes.md); operações de banco seguem [Migrations PostgreSQL](./database-migrations.md).

Não altere migrations históricas para resolver uma violação de boundary.
