# Preview isolado

Cada PR/branch implantado em Vercel Preview tem sua própria URL e deve usar o
PostgreSQL isolado correspondente. `DATABASE_URL` deve ser a URL efetiva desse
deployment e distinta de `PRODUCTION_DATABASE_URL`; o Preview não envia efeitos
externos. Production é reservado ao `master`.

## Preflight obrigatório

```bash
APP_ENV=preview EXTERNAL_WRITES_ENABLED=0 npm run preview:preflight
```

O executor protegido injeta `DATABASE_URL` e `PRODUCTION_DATABASE_URL` para o
preflight; não coloque valores no checkout nem em comandos. Esse preflight
valida somente o modo Preview, as escritas externas e a identidade distinta do
PostgreSQL de produção. Para o E2E, o contrato `preview-e2e` também exige
`VERCEL_AUTOMATION_BYPASS_SECRET` na origem externa protegida. O contrato falha
fechado quando uma variável exigida está ausente; o preflight também falha
quando as URLs são inválidas ou apontam para a mesma identidade PostgreSQL.

Para a jornada E2E controlada, o operador fornece a URL do deployment do PR e
as identidades PostgreSQL no executor protegido:

```bash
PREVIEW_BASE_URL="https://<deployment-do-pr>.vercel.app" npm run test:e2e:preview -- --list
```

O runner valida a origem, executa o preflight antes do Playwright, passa o
segredo somente ao filho autorizado e não passa as URLs de banco. O bootstrap
faz uma única requisição por `APIRequestContext` à origem exata, com os headers
oficiais do bypass, e recebe o cookie nesse contexto; a config não usa header
global e desliga traces em Preview. O valor nunca é exibido. A prova remota
ocorre por `/api/operational-status` e pela fixture atestada; isso não é prova
única da identidade da branch.

Migração manual futura do arquivo operacional (sem alias):

- `STAGING_BASE_URL` → `PREVIEW_BASE_URL`
- `STAGING_E2E_USERNAME` → `PREVIEW_E2E_USERNAME`
- `STAGING_EGRESS_BLOCKED` → `PREVIEW_EGRESS_BLOCKED`
- `STAGING_FIXTURE_RESET` → `PREVIEW_FIXTURE_RESET`

`STAGING_DATABASE_URL` e `STAGING_PG_SERVICE` permanecem somente no contrato
técnico de migrations. `DATABASE_URL` precisa ser verificada pelo operador
contra o deployment do PR. O arquivo externo não é alterado nesta tarefa.

O arquivo operacional protegido pode ainda conter chaves antigas do E2E
prefixadas por `STAGING_`. Ele
não é alterado por esta mudança: a migração manual futura desses consumidores é
responsabilidade de Andrei, sem alias ou dual-read neste checkout. Se houver
Deployment Protection configurada na Vercel, o operador usa a credencial já
aprovada; este fluxo não cria outro mecanismo de autenticação.

Evolution, Resend, mutações de Blob e emissão de tokens de upload são bloqueados
no Preview. `VERCEL_ENV=preview` também veta flags de produção contraditórias;
o banco exige `APP_ENV=preview` nesse deployment. Persistência PostgreSQL pode
ser exercitada somente no banco isolado. Não há dual-write, banco fallback ou coluna `is_test`.

O provisionamento e a remoção das branches PostgreSQL de Preview seguem a
política de [ciclo de vida das branches de Preview](./release-lanes.md#ciclo-de-vida-das-branches-de-preview).
O prune existente é best-effort; verifique URL, banco e limpeza conforme o
runbook operacional. `npm run preview` do Vite e a prévia de um orçamento são
recursos locais/documentais, não ambientes de homologação.
