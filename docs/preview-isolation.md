# Preview isolado

Cada PR/branch implantado em Vercel Preview tem sua própria URL e deve usar o
PostgreSQL isolado correspondente. `DATABASE_URL` deve ser a URL efetiva desse
deployment e distinta de `PRODUCTION_DATABASE_URL`; o Preview não envia efeitos
externos. Production é reservado ao `master`.

## Preflight obrigatório

```bash
APP_ENV=preview EXTERNAL_WRITES_ENABLED=0 npm run preview:preflight
```

O executor protegido injeta `DATABASE_URL` e `PRODUCTION_DATABASE_URL`; não
coloque valores no checkout nem em comandos. O preflight falha fechado quando
qualquer valor está ausente, inválido ou aponta para a mesma identidade
PostgreSQL.

Para a jornada E2E controlada, o operador fornece a URL do deployment do PR e
as identidades PostgreSQL no executor protegido:

```bash
PREVIEW_BASE_URL="https://<deployment-do-pr>.vercel.app" npm run test:e2e:preview -- --list
```

O runner valida a origem, executa o preflight antes do Playwright e não passa a
URL de produção ao filho. A prova remota ocorre por `/api/operational-status` e
pela fixture atestada; isso não é prova única da identidade da branch.

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

Evolution e Resend são bloqueados no Preview. Persistência PostgreSQL pode ser exercitada somente no banco isolado. Não há dual-write, banco fallback ou coluna `is_test`.

O provisionamento e a remoção das branches PostgreSQL de Preview seguem a
política de [ciclo de vida das branches de Preview](./release-lanes.md#ciclo-de-vida-das-branches-de-preview).
O prune existente é best-effort; verifique URL, banco e limpeza conforme o
runbook operacional. `npm run preview` do Vite e a prévia de um orçamento são
recursos locais/documentais, não ambientes de homologação.
