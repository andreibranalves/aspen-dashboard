# Fase 18 — Redução de feature flags e variáveis de ambiente

**Status:** desenho aprovado para planejamento.

## Contexto

A suíte E2E de staging ainda combina quatro flags operacionais:

- `STAGING_E2E`;
- `STAGING_EXTERNAL_PROVIDERS_DISABLED`;
- `STAGING_EGRESS_BLOCKED`;
- `STAGING_FIXTURE_RESET`.

As Fases 8–10 já estabeleceram `APP_ENV=preview` e `EXTERNAL_WRITES_ENABLED=0` como contrato do Preview. As duas primeiras flags acima passaram a duplicar esse contrato. As duas últimas continuam atestando controles independentes: bloqueio de egress no executor e autorização para limpar fixtures descartáveis.

## Objetivo

Reduzir combinações de configuração sem enfraquecer os guardrails da suíte staging.

Ao final:

- `APP_ENV=preview` seleciona a execução E2E remota;
- `EXTERNAL_WRITES_ENABLED=0` comprova que writes externos estão desativados;
- `STAGING_EGRESS_BLOCKED=1` continua comprovando o bloqueio de rede do executor;
- `STAGING_FIXTURE_RESET=1` continua autorizando a limpeza das fixtures descartáveis;
- `STAGING_E2E` e `STAGING_EXTERNAL_PROVIDERS_DISABLED` deixam de existir na configuração ativa.

## Decisões

1. **Remoção sem aliases.** As flags aposentadas não terão fallback, alias ou período de compatibilidade.
2. **Seleção por ambiente canônico.** `APP_ENV=preview` substitui `STAGING_E2E=1` no Playwright, no helper staging e no comando npm.
3. **Write guard canônico.** `EXTERNAL_WRITES_ENABLED=0` substitui `STAGING_EXTERNAL_PROVIDERS_DISABLED=1` na precondição staging.
4. **Guardrails independentes preservados.** Egress bloqueado e reset de fixtures não serão inferidos de `APP_ENV`; ambos continuarão obrigatórios.
5. **Sem renomeação de identificadores operacionais.** `STAGING_BASE_URL`, `STAGING_DATABASE_URL`, `STAGING_PG_SERVICE`, `STAGING_E2E_USERNAME` e IDs de fixtures permanecem porque carregam valores ou atestações distintas, não feature flags duplicadas.
6. **Fail closed.** Valores ausentes, diferentes dos literais esperados ou ambientes não Preview impedem a suíte remota antes de requests.
7. **Nenhuma operação externa.** A fase não altera Vercel, banco, providers, secrets, deploys ou infraestrutura de rede.

## Contrato de ambiente

### Desenvolvimento local

```text
APP_ENV=development
EXTERNAL_WRITES_ENABLED=0
```

O Playwright inicia o servidor local e ignora os specs exclusivos de staging.

### Preview/staging

```text
APP_ENV=preview
EXTERNAL_WRITES_ENABLED=0
STAGING_BASE_URL=<origin HTTPS sem credenciais>
STAGING_EGRESS_BLOCKED=1
STAGING_FIXTURE_RESET=1
```

As credenciais e IDs já exigidos pela suíte permanecem fora do checkout.

### Production

```text
APP_ENV=production
EXTERNAL_WRITES_ENABLED=1
```

Esta fase não altera nem executa o canário Production.

## Alterações de código e configuração

### `playwright.config.js`

O modo staging será derivado exclusivamente de:

```js
process.env.APP_ENV === 'preview';
```

Nesse modo, o Playwright continuará usando um worker, não iniciará o Vite local e exigirá que `BASE_URL` corresponda a `STAGING_BASE_URL`.

### `tests/support/staging-auth.js`

`getStagingConfig` exigirá:

- `APP_ENV=preview`;
- `EXTERNAL_WRITES_ENABLED=0`;
- `STAGING_EGRESS_BLOCKED=1`;
- `STAGING_FIXTURE_RESET=1`;
- as credenciais, URLs, atestações de usuário e IDs de fixtures já necessários.

`effectiveStagingOrigin` usará `APP_ENV=preview` para decidir se deve restringir requests à origem staging.

Mensagens de erro nomearão somente a precondição ausente ou inválida. Não incluirão valores, tokens, URLs completas, payloads ou dados pessoais.

### `package.json`

`test:e2e:staging` injetará `APP_ENV=preview`. O comando não injetará `STAGING_E2E` nem uma flag substituta.

### Manifesto e documentação

`scripts/cutover-env-status.mjs`, `.env.example`, `docs/baseline-refatoracao.md` e `docs/operational-cutoff-procedure.md` removerão as duas flags aposentadas.

O runbook registrará owner, propósito e condição de remoção das flags restantes:

| Flag                     | Owner          | Propósito                                                      | Condição de remoção                                                                     |
| ------------------------ | -------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `STAGING_EGRESS_BLOCKED` | operação/infra | atestar bloqueio de egress durante E2E mutável                 | substituir por prova automática equivalente no executor                                 |
| `STAGING_FIXTURE_RESET`  | QA/operação    | autorizar limpeza das fixtures staging declaradas descartáveis | suíte deixar de mutar staging ou isolamento automático tornar a atestação desnecessária |

Valores reais não serão documentados ou versionados.

## Testes

A implementação seguirá TDD.

Testes unitários do helper staging provarão que:

- Preview com writes desativados, egress bloqueado e reset autorizado é aceito;
- `APP_ENV` ausente ou diferente de `preview` é rejeitado;
- `EXTERNAL_WRITES_ENABLED` ausente ou diferente de `0` é rejeitado;
- egress ou reset ausente/inválido é rejeitado;
- `BASE_URL` fora da origem staging é rejeitada;
- as flags aposentadas não influenciam o resultado.

Testes estruturais ou existentes cobrirão o manifesto e a configuração Playwright sem testar texto por texto quando o comportamento puder ser exercitado diretamente.

Verificação final mínima:

```bash
npm run verify:fast
npm run verify:full
node scripts/cutover-env-status.mjs
node scripts/check-no-legacy-provider.mjs
git diff --check
```

O preflight de ambiente pode retornar código não zero quando a configuração externa estiver incompleta; nesse caso, somente sua saída redigida de nomes e estados será registrada. A suíte staging remota não será executada sem configuração válida e autorização operacional.

## Fora de escopo

- Remover `STAGING_EGRESS_BLOCKED` ou `STAGING_FIXTURE_RESET`.
- Renomear todas as variáveis prefixadas por `STAGING_`.
- Criar schema genérico de configuração, registry de flags ou nova dependência.
- Padronizar clients de integrações externas; isso pertence à Fase 19.
- Alterar o guard de writes externos já implementado.
- Executar deploy, push, migration, staging remoto ou mudança de secrets.

## Critérios de aceite

- `STAGING_E2E` e `STAGING_EXTERNAL_PROVIDERS_DISABLED` não aparecem em código ativo, testes ativos, scripts operacionais, `.env.example` ou documentação operacional vigente.
- `APP_ENV=preview` é a única seleção de modo staging no Playwright.
- `EXTERNAL_WRITES_ENABLED=0` é obrigatório para a suíte staging.
- `STAGING_EGRESS_BLOCKED=1` e `STAGING_FIXTURE_RESET=1` permanecem obrigatórios e documentados com owner, propósito e condição de remoção.
- Execuções locais continuam iniciando Vite e ignorando specs staging.
- Execuções Preview continuam sem servidor local, com um worker e origem restrita.
- Nenhum alias, fallback, dependência, migration ou alteração externa é adicionado.
- `verify:fast`, `verify:full`, scanner legado e `git diff --check` terminam sem falhas locais.
- Nenhum arquivo gerado em `public/` é versionado.
