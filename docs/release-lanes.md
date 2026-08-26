# Classificação de risco: FAST, CRITICAL e RELEASE

Escolha a classificação pela consequência possível da mudança, não pelo domínio.
`FAST` é o padrão; promova apenas com critério objetivo (ver `AGENTS.md`).

## FAST

Padrão para mudanças reversíveis: UI, copy, navegação, filtros, CRUD comum,
refactors locais, cálculos em rascunho experimental.

```text
CI (rede de segurança assíncrona)
-> Preview
-> merge
-> Production
```

Checks locais:

```bash
npm run verify:fast
npm run test:unit:focused -- tests/unit/<arquivo>.test.ts   # quando houver comportamento relevante
npx playwright test <spec da jornada alterada>              # quando houver jornada de UI afetada
```

Mudança puramente visual ou de copy não exige teste automatizado novo.
FAST não pode alterar banco de forma destrutiva, autenticação, permissões,
integrações externas nem envio real de WhatsApp/e-mail.

## CRITICAL

Use quando a mudança puder causar: perda destrutiva ou irreversível de dados;
envio real de WhatsApp/e-mail/documento ao cliente; valores oficialmente
emitidos; alterações de autenticação, autorização ou isolamento de tenant;
invariantes de idempotência, locks ou concorrência.

Consulte o [runbook Migrations PostgreSQL](./database-migrations.md) para migrations.

```text
CI (checks estáticos + PostgreSQL descartável)
-> testes das invariantes e caminhos de erro
-> repositories contra banco efêmero (quando persistência for afetada)
-> E2E das jornadas afetadas
-> revisão independente de lógica
-> Preview
-> aprovação explícita
-> Production
```

Fluxo padrão de migration aditiva em staging, controlado e opt-in (fora do CI padrão):

```bash
npm run verify:full
npm run check:db-migrations
npm run db:migration:preflight
TEST_DATABASE_URL="$STAGING_DATABASE_URL" DATABASE_URL= npm run db:migrate
npm run test:e2e:staging
```

A CI executa checks estáticos e um apply somente no PostgreSQL descartável do job;
alvos operacionais continuam fora do CI padrão.

`STAGING_DATABASE_URL` e `STAGING_PG_SERVICE` precisam representar o mesmo staging.
A identidade staging não pode igualar produção. Stdout redigido fica fora do checkout.

Qualquer falha interrompe o fluxo. `db:migration:preflight` permanece o gate de identidade e segurança do alvo de banco.
`cutover-env-status` é um gate de release/cutover, não um pré-requisito geral de migration de banco. Ele continua obrigatório quando o procedimento aplicável envolver canário Production, deploy/promoção, rollback, cleanup, cutover de e-mail ou outro cutover explicitamente declarado. Migrations destrutivas, de cleanup e de transição da fonte de verdade não seguem automaticamente a lane aditiva e podem exigir esses gates operacionais adicionais.
A configuração do Drizzle prioriza `TEST_DATABASE_URL`, por isso o comando copia o
alvo staging para `TEST_DATABASE_URL` e esvazia `DATABASE_URL`.
Nunca execute `npm run db:migrate` usando somente `DATABASE_URL` ou apontando para produção.
Execute os comandos operacionais somente com o ambiente aprovado e sem imprimir
credenciais, dados de produção ou PII.

Migrations não executam no startup ou implicitamente durante o build. O único apply
no CI é a exceção explícita do banco descartável do job `postgres`; alvos operacionais
continuam fora do CI padrão.

Mudanças destrutivas seguem expand, deploy compatível, migração de dados e contract.

## RELEASE (gate periódico)

RELEASE não é tipo de issue: é um gate aplicado ao conjunto integrado antes de
deploy importante, milestone concluído, epic grande fechado ou candidata a beta.

```bash
npm run verify:full          # FAST + corpus unitário completo + build + E2E completo
npm run test:postgres        # PostgreSQL real, quando aplicável
```

Inclui também: smoke manual das jornadas principais, revisão de migrations pendentes
e regressões conhecidas documentadas.

## Ciclo de vida das branches de Preview

A integração Vercel + Neon cria uma branch PostgreSQL `preview/<git-branch>` para cada nova branch implantada em Preview. O projeto Neon Free comporta 10 branches; `main` ocupa uma delas.

Mantenha somente:

- `main`;
- branches de Preview vinculadas a PRs abertos;
- branches usadas por uma validação de release em andamento.

Uma branch de Preview torna-se candidata a remoção quando o PR correspondente foi merged ou fechado e nenhuma validação ativa depende dela. A branch Git e deployments históricos não justificam reter indefinidamente o banco de Preview.

Faça a limpeza:

1. após merge ou fechamento de PR;
2. antes de abrir ou reimplantar Previews quando houver 8 ou mais branches Neon;
3. semanalmente, como auditoria de segurança.

Antes de remover qualquer branch:

1. liste as branches Neon sem alterar recursos;
2. compare cada `preview/*` com os PRs abertos no GitHub;
3. preserve `main` e qualquer release em validação;
4. apresente a lista de candidatas e obtenha aprovação humana explícita;
5. remova somente as candidatas aprovadas e confirme a capacidade liberada.

A remoção é destrutiva para o banco daquela Preview. Nunca automatize a exclusão sem a comparação com PRs abertos e nunca remova `main`.

## Regras comuns

- CI padrão executa lint, tipos, corpus unitário completo, repositories contra banco descartável, build e smoke E2E como rede de segurança assíncrona.
- E2E completo de staging não executa no CI padrão.
- Writes externos reais, auth, migrations e mudanças destrutivas nunca são FAST.
- Falha já existente no baseline exige reprodução na base e issue própria antes de ser ignorada.
- Preview não substitui aprovação de fluxos CRITICAL.
- O documento orienta o processo, mas não automatiza deploy, backup, aprovação, migration ou canary.
