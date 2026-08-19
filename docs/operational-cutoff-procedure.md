# Procedimento operacional PostgreSQL

O dashboard usa PostgreSQL como fonte de verdade para produtos, clientes, orçamentos, CRM, pedidos e atividade de catálogo.

## Pré-condições

- `npm run build:api` concluído.
- `npm run test:unit` concluído.
- `npm run lint` concluído.
- `npm run type-check` concluído.
- `npm run build` concluído.
- `node scripts/check-no-legacy-provider.mjs` concluído.
- Backup e restore são operações controladas fora deste repositório.

## Readiness

`GET /api/operational-status` verifica somente conectividade PostgreSQL e configurações locais obrigatórias.

A resposta não contém segredos, credenciais, dados de clientes ou informações de serviços externos.

A aplicação fica pronta quando o banco responde e `app_settings` contém validade, pagamento e template padrão válidos.

## Fluxo local

1. Execute as verificações automatizadas em uma cópia local.
2. Confirme que `src/app/routes.tsx` é a tabela única de rotas e que `src/app/App.tsx` despacha as rotas por hash.
3. Confirme que produtos, clientes, orçamentos, CRM, pedidos, atividade e telas de comunicação usam contratos locais.
4. Valide o envio WhatsApp somente com mocks da Evolution em testes.
5. Registre resultados e riscos no relatório de auditoria apropriado.

Nenhuma etapa deste documento executa deploy, alteração de ambiente, migração ou acesso a serviço remoto.

## Preview como staging

Preview é o staging padrão para branches e releases candidatos.

| Controle                  | Preview              | Production               |
| ------------------------- | -------------------- | ------------------------ |
| `APP_ENV`                 | `preview`            | `production`             |
| `EXTERNAL_WRITES_ENABLED` | `0`                  | `1`                      |
| Banco                     | PostgreSQL staging   | PostgreSQL production    |
| KV/Blob                   | recursos staging     | recursos production      |
| Evolution                 | credenciais ausentes | credenciais configuradas |

A ausência de credenciais é intencional e complementa o guard de aplicação e o egress bloqueado.
Valores reais permanecem no ambiente operacional fora deste checkout.

### Checklist Preview

- `APP_ENV=preview` configurado no ambiente Preview.
- `EXTERNAL_WRITES_ENABLED=0` configurado no ambiente Preview.
- Banco, KV e Blob apontam para recursos de staging.
- Credenciais Evolution não estão presentes em Preview.
- `STAGING_EXTERNAL_PROVIDERS_DISABLED=1` configurado no executor staging.
- `STAGING_EGRESS_BLOCKED=1` configurado no executor staging.
- `STAGING_FIXTURE_RESET=1` configurado antes da suíte mutável.
- Suítes locais e staging executadas somente com fixtures descartáveis.

## Transição VPS -> Preview

1. Criar Preview a partir da branch candidata.
2. Executar a suíte staging com egress bloqueado e fixtures descartáveis.
3. Registrar resultado, falhas e riscos operacionais.
4. Repetir o ciclo por releases suficientes para obter confiança.
5. Manter a VPS como fallback durante a observação.
6. Remover runtime e infraestrutura VPS somente após decisão operacional explícita.

Nenhuma etapa deste documento altera o Vercel Dashboard, faz deploy, migra banco ou remove Docker, Traefik, nftables e scripts.

## Comandos de verificação e corte

Execute as verificações locais antes dos testes de staging:

```bash
node scripts/check-no-legacy-provider.mjs
npm run build:api
TZ=UTC node --test tests/unit/*.test.{js,ts}
npm run lint -- --max-warnings=0
npm run build
```

Execute as suítes de staging somente com PostgreSQL, egress bloqueado e fixtures descartáveis:

```bash
STAGING_E2E=1 \
BASE_URL="$STAGING_BASE_URL" \
STAGING_BASE_URL="$STAGING_BASE_URL" \
E2E_USERNAME="$E2E_USERNAME" \
E2E_PASSWORD="$E2E_PASSWORD" \
STAGING_E2E_USERNAME="$E2E_USERNAME" \
KNOWN_POSTGRES_QUOTATION_ID="$KNOWN_POSTGRES_QUOTATION_ID" \
KNOWN_POSTGRES_SCRATCH_QUOTATION_ID="$KNOWN_POSTGRES_SCRATCH_QUOTATION_ID" \
STAGING_EXTERNAL_PROVIDERS_DISABLED=1 \
STAGING_EGRESS_BLOCKED=1 \
STAGING_FIXTURE_RESET=1 \
npx playwright test tests/postgres-only-cutover.spec.js tests/quotation-cutover-staging.spec.js
```

O canário Production é somente leitura, não envia WhatsApp e não captura leads.
A cobertura de fluxos mutáveis pertence exclusivamente à suíte de staging.

Execute o canário depois de configurar os identificadores PostgreSQL existentes:

```bash
CANARY_BASE_URL="$PRODUCTION_BASE_URL" \
CANARY_PASSWORD="$PRODUCTION_CANARY_PASSWORD" \
CANARY_QUOTATION_ID="$KNOWN_PRODUCTION_POSTGRES_QUOTATION_ID" \
CANARY_PUBLIC_QUOTATION_URL="$KNOWN_PRODUCTION_PUBLIC_QUOTATION_URL" \
node scripts/postgres-only-canary.mjs
```
