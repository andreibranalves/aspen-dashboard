# Preview isolado

Fonte única do gate de Preview. Cada PR/branch implantado em Vercel Preview tem
sua própria URL e usa o PostgreSQL isolado correspondente (branch Neon).
`DATABASE_URL` deve ser a URL efetiva desse deployment e distinta de
`PRODUCTION_DATABASE_URL`; o Preview não envia efeitos externos. Production é
reservado ao `master`.

Preview é a única homologação. Não há VPS de staging, target permanente de
migration nem branch permanente como ambiente de homologação. `npm run preview`
do Vite e a prévia de um orçamento são recursos locais, não homologação.

## Preflight obrigatório

```bash
APP_ENV=preview EXTERNAL_WRITES_ENABLED=0 npm run preview:preflight
```

O executor protegido injeta `DATABASE_URL` e `PRODUCTION_DATABASE_URL` para o
preflight; não coloque valores no checkout nem em comandos. Esse preflight
valida somente o modo Preview, as escritas externas e a identidade distinta do
PostgreSQL de produção. O contrato falha fechado quando uma variável exigida
está ausente; o preflight também falha quando as URLs são inválidas ou apontam
para a mesma identidade PostgreSQL.

## E2E controlado

O executor protegido pré-configura `DATABASE_URL`, `PRODUCTION_DATABASE_URL`,
`E2E_USERNAME`, `E2E_PASSWORD`, `PREVIEW_E2E_USERNAME`,
`VERCEL_AUTOMATION_BYPASS_SECRET`, os IDs `KNOWN_POSTGRES_*` e as atestações
`PREVIEW_EGRESS_BLOCKED=1` e `PREVIEW_FIXTURE_RESET=1`. O operador verifica que
`DATABASE_URL` é a URL efetiva do deployment do PR. Não coloque URLs de banco ou
credenciais inline.

```bash
node scripts/cutover-env-status.mjs preview-e2e
PREVIEW_BASE_URL="https://<deployment-do-pr>.vercel.app" npm run test:e2e:preview -- --list
PREVIEW_BASE_URL="https://<deployment-do-pr>.vercel.app" npm run test:e2e:preview
```

O runner valida a origem, executa o preflight antes do Playwright, passa o
segredo de bypass somente ao filho autorizado e não passa as URLs de banco. O
bootstrap faz uma única requisição por `APIRequestContext` à origem exata, com
os headers oficiais do bypass, e recebe o cookie nesse contexto; a config não
usa header global e desliga traces em Preview. O valor nunca é exibido.

O preflight local compara identidades; `/api/operational-status` prova
ambiente, writes-off, conectividade e persistência servida; a fixture atestada
prova que o deployment atende ao alvo atestado. Nenhuma dessas provas, sozinha,
comprova a identidade única da branch.

Use somente o orçamento e a fixture descartável identificados pelo ambiente do
operador; não crie cotação nem fixture novos. Confirme o estado da página, o
banco isolado, o egress atestado e a ausência de mensagem duplicada. O listener
de requests do browser é atestação independente, não prova de egress da Vercel.
`DELIVERY_ACK` não é gate do Preview: envio real só ocorre em Production, com
autorização.

## Bloqueios no Preview

Evolution, Resend, mutações de Blob e emissão de tokens de upload são bloqueados
no Preview. `VERCEL_ENV=preview` também veta flags de produção contraditórias;
o banco exige `APP_ENV=preview` nesse deployment. Persistência PostgreSQL pode
ser exercitada somente no banco isolado. Não há dual-write, banco fallback ou
coluna `is_test`.

O código só lê as chaves `PREVIEW_*`. As antigas `STAGING_BASE_URL`,
`STAGING_E2E_USERNAME`, `STAGING_EGRESS_BLOCKED` e `STAGING_FIXTURE_RESET` que
ainda existirem no arquivo operacional estão sem uso. `STAGING_DATABASE_URL` e
`STAGING_PG_SERVICE` continuam no contrato de migrations
([runbook](./database-migrations.md)).

## Ciclo de vida das branches de Preview

A integração Vercel + Neon e o workflow
`.github/workflows/neon-preview-prune.yml` fazem a tentativa best-effort de
limpar a branch PostgreSQL associada quando o PR fecha. O workflow não prova
que houve deployment, criação da branch ou remoção efetiva, e falha não bloqueia
o PR.

Para uma limpeza manual, o operador lista as branches sem alterar recursos,
compara-as aos PRs abertos, preserva `main` e releases em validação, apresenta
as candidatas e obtém aprovação humana explícita. Remover uma branch é
destrutivo para seu banco; `main` nunca é removida e `backup-*` exige aprovação
específica.
