# Release lanes

Escolha a lane pelo maior risco presente na mudança.

Quando houver dúvida entre duas lanes, use a mais alta.

## LOW

Use para CSS, copy, ícones, formatação e componentes puramente visuais.

```text
CI
-> Preview
-> merge
-> Production
```

Checks locais recomendados:

```bash
npm run verify:fast
npm run test:e2e:smoke
```

LOW não pode alterar banco, autenticação, permissões, integrações externas ou envio WhatsApp.

## MEDIUM

Use para novos endpoints, regras de negócio, filtros, CRM e alterações comuns em orçamentos.

```text
CI
-> unit
-> E2E do domínio
-> Preview
-> Production
```

Checks mínimos:

```bash
npm run verify:fast
npx playwright test --grep "@crm|@quotations|@products|@smoke"
```

Escolha a tag do domínio afetado.

Não use esta lane quando houver escrita externa, migration, autenticação, permissão ou mudança destrutiva.

## HIGH

Use para migrations, autenticação, envio WhatsApp, integrações externas, permissões e mudanças destrutivas.

```text
CI
-> todos unit
-> build
-> staging DB migration
-> full E2E
-> backup
-> Preview
-> aprovação explícita
-> Production
-> read-only canary
```

Checks locais e controlados:

```bash
npm run verify:full
node scripts/cutover-env-status.mjs
test -n "${STAGING_DATABASE_URL:-}" && TEST_DATABASE_URL="$STAGING_DATABASE_URL" DATABASE_URL= npm run db:migrate
npm run test:e2e:staging
```

Antes da migration, `node scripts/cutover-env-status.mjs` deve retornar sucesso.

`STAGING_DATABASE_URL` deve ser fornecida pelo shell operacional aprovado e apontar para um banco staging não produtivo.

A configuração do Drizzle prioriza `TEST_DATABASE_URL`, por isso o comando copia o alvo staging para `TEST_DATABASE_URL` e esvazia `DATABASE_URL`.

Depois da migration bem-sucedida, execute `npm run test:e2e:staging` antes de Preview.

Nunca execute `npm run db:migrate` usando somente `DATABASE_URL` ou apontando para produção.

`test:e2e:staging` e `db:migrate` são opt-in.

Execute-os somente com o ambiente operacional aprovado e sem imprimir credenciais, dados de produção ou PII.

Migrations não executam no startup, no CI padrão ou implicitamente durante o build.

Mudanças destrutivas seguem expand, deploy compatível, migração de dados e contract.

## Regras comuns

- CI padrão executa lint, tipos, unitários e build.
- E2E de staging não executa no CI padrão.
- Writes externos, WhatsApp, auth, migrations e mudanças destrutivas nunca são LOW.
- Preview não substitui aprovação da lane HIGH.
- O documento orienta o processo, mas não automatiza deploy, backup, aprovação, migration ou canary.
