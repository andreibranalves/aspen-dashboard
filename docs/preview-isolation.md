# Preview isolado

Cada PR implantado na Vercel ganha um Preview com URL própria e uma branch
PostgreSQL no Neon, `preview/<branch-git>`, copiada da produção no primeiro
deploy. Preview é a única homologação e Production é o `master` (ADR 0011).
`npm run preview` do Vite e a prévia de um orçamento são recursos locais, não
homologação.

## O que o código garante

- Num deployment `VERCEL_ENV=preview`, toda conexão ao banco falha fechada sem
  `APP_ENV=preview`, `EXTERNAL_WRITES_ENABLED=0` e um `DATABASE_URL` diferente
  de `PRODUCTION_DATABASE_URL`
  ([client.ts](../api/_infrastructure/db/client.ts)). A comparação trata
  `ep-x` e `ep-x-pooler` do Neon como o mesmo banco.
- Evolution, e-mail, Blob, QStash e Google Data Manager só escrevem com
  `VERCEL_ENV` de produção, `APP_ENV=production` e
  `EXTERNAL_WRITES_ENABLED=1` ([external-writes.ts](../api/_shared/external-writes.ts)).
  Envio real só acontece em Production.
- Não há dual-write, banco fallback nem coluna `is_test`.

`/api/operational-status` mostra ambiente, escritas externas, conectividade e
persistência de um deployment.

## Dados reais

A branch do Preview é uma cópia dos dados de produção, com clientes, telefones e
conversas. O acesso passa pela proteção de deployment da Vercel e pelo login do
app. Não copie dados do Preview para fora dele.

## Migration no Preview

O deploy não aplica migration: a branch nasce com o schema de produção. Num PR
com migration, aplique-a na branch do próprio PR antes de validar o Preview,
com a autorização prevista em `AGENTS.md`:

```bash
npm run migrate:apply -- --target preview
```

O comando parte da branch Git atual, encontra `preview/<branch-git>` pela API do
Neon, recusa branch padrão, primária ou protegida e qualquer URL de produção, e
só então aplica ([runbook](./database-migrations.md#gate-preview)). Se a
migration mudar depois de aplicada, resete a branch a partir de `main` no Neon e
aplique de novo.

## Limite de branches e ciclo de vida

O plano Free do Neon aceita 10 branches por projeto, `main` inclusa. Acima
disso, todo Preview novo falha com `Resource provisioning failed` antes do
build. Cada PR aberto com Preview ocupa uma vaga até fechar.

- `dependabot/**` e `docs/**` não geram Preview (`git.deploymentEnabled` em
  `vercel.json`). Use `docs/` só para PR sem código de runtime; o CI continua
  validando.
- Ao fechar o PR, a integração Vercel + Neon e
  `.github/workflows/neon-preview-prune.yml` tentam apagar a branch. É
  best-effort: falha não bloqueia o PR.
- Liberar vaga é apagar a branch de um PR aberto, o que destrói aquele banco.
  O operador lista as branches, compara com os PRs abertos e aprova a remoção;
  `main` nunca sai e `backup-*` exige aprovação específica. O próximo deploy
  do PR recria a branch.

## E2E no Preview

```bash
node scripts/cutover-env-status.mjs preview-e2e
PREVIEW_BASE_URL="https://<deployment-do-pr>.vercel.app" npm run test:e2e:preview
```

O primeiro comando lista as variáveis exigidas, só com nomes e estados; o
`DATABASE_URL` delas é o da branch do PR. O runner roda o preflight de
isolamento, restaura a cotação de rascunho e entra na proteção da Vercel com o
segredo de bypass, sem exibi-lo nem passar as URLs de banco ao Playwright. Use
só as cotações indicadas em `KNOWN_POSTGRES_*`. `PREVIEW_EGRESS_BLOCKED` e
`PREVIEW_FIXTURE_RESET` são declarações do operador; a garantia contra envio
externo é o bloqueio do código acima.
