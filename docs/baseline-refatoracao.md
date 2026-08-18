# Baseline de refatoração

**Data:** 2026-08-18.

**Commit de referência:** `7dbca51`.

**Runtime local:** Node.js `v22.23.0` e npm `10.9.8`.

**Objetivo:** registrar o estado observável antes das Fases 1-3 da refatoração, sem alterar código de aplicação.

## Checks e tempos

| Comando | Resultado | Tempo de parede | Observação |
| --- | --- | ---: | --- |
| `time npm run check` | Passou, exit `0` | `16.478s` | Lint, type-check, Tailwind e build (api + vite) concluíram com sucesso. |
| `time npm run test:unit` | Passou, exit `0` | cerca de `52s` | 703 testes, 674 pass, 29 skip, 0 fail (execução estabelecida posteriormente ao commit de baseline). |
| `time npx playwright test` | Falhou, exit `1` | `8m51s` | 58 pass, 31 fail; ver classificação abaixo. Artefatos em `test-results/` e `playwright-report/`. |
| `node --test tests/unit/route-map.test.ts` | Passou | `0.070s` | Mapa atual expõe os 44 nomes esperados nos três arquivos. |

A dependência e o toolchain estavam íntegros na rodada de Fix 2: `npm run check` e `npm run test:unit` passaram, e o Playwright chegou a executar todos os specs locais.
As 31 falhas de Playwright são falhas reais de execução local; nenhuma pertence a spec staging-only.

## Classificação das falhas Playwright (31)

Specs staging-only (`tests/postgres-only-cutover.spec.js` e `tests/quotation-cutover-staging.spec.js`) são ignorados localmente via `testIgnore` no `playwright.config.js`.
Nenhuma das 31 falhas veio desses specs: 0 falha staging-only, 31 falhas locais reais.

| Spec | Falhas | Primeira linha de erro |
| --- | ---: | --- |
| `orcamento.spec.js` | 1 | `Test timeout of 60000ms exceeded. Error: locator.click: Test timeout of 60000ms exceeded.` (`:558`) |
| `products-core.spec.js` | 5 | 3x `Test timeout of 60000ms exceeded. Error: locator.click/fill: ...` (`:491`, `:630`, `:305`); 2x `Error: expect(locator).toBeVisible() failed` - `getByText(/10,00/)` (`:214`), `getByText('Produto novo', { exact: true })` (`:267`) |
| `quotation-cutover.spec.js` | 1 | `Error: expect(locator).toBeVisible() failed` - `getByText('Enviado', { exact: true })` (`:99`) |
| `quotation-lifecycle.spec.js` | 6 | 0 visible: `getByText('Emitido')` (`:334`), `getByText('Rascunho')` (`:151`), `getByText('Emitido')` (`:115`), `getByText('PDF indisponível. Tentar novamente')` (`:281`); 2x `toBeDisabled` - `'Envio aceito'` (`:255`), `'Enviar WhatsApp'` (`:305`) |
| `quotation-templates-core.spec.js` | 4 | `getByLabel('Modelo do orçamento')` visible (`:61`), `toHaveValue "arquivado"` (`:145`), `toBeDisabled` `getByLabel('Título - Pagamento')` (`:180`), visible `'Revisão 2'` (`:198`) |
| `quotations-core.spec.js` | 2 | visible `'Produto local'` (`:44`), `toHaveValue "simples"` (`:123`) |
| `settings.spec.js` | 2 | 2x `Test timeout of 60000ms exceeded. Error: locator.fill/click: ...` (`:20`, `:222`) |
| `task-8-fix-r1.spec.js` | 2 | `locator.fill` timeout (`:113`); visible `'Produto legítimo'` (`:173`) |
| `task-8-fix-r4.spec.js` | 6 | 6x `Test timeout of 60000ms exceeded. Error: locator.fill: ...` (`:70`, `:91`, `:111`, `:127`, `:154`, `:183`) |
| `whatsapp-inbox.spec.js` | 2 | visible `getByRole('button', { name: 'Novas' })` (`:5`); `TimeoutError: page.waitForSelector: Timeout 10000ms exceeded` - `'Sincronizar'` (`:35`) |

Origem das linhas de erro: `error-context.md` por artefato em `test-results/` e dados de `playwright-report/`.
As falhas foram registradas sem alteração de aplicação ou teste.

## Endpoints

O mapa atual em `api/[...path].ts` expõe 44 endpoints.

| Endpoint | Fonte atual |
| --- | --- |
| `operational-status` | `api/[...path].ts` |
| `client-detail` | `api/[...path].ts` |
| `crm-deals` | `api/[...path].ts` |
| `crm-prune-candidates` | `api/[...path].ts` |
| `crm-update-deal` | `api/[...path].ts` |
| `duplicate-quotation` | `api/[...path].ts` |
| `edit-draft` | `api/[...path].ts` |
| `extract` | `api/[...path].ts` |
| `leads-clients` | `api/[...path].ts` |
| `login` | `api/[...path].ts` |
| `logout` | `api/[...path].ts` |
| `orcamento` | `api/[...path].ts` |
| `pdf` | `api/[...path].ts` |
| `pricing-lookup` | `api/[...path].ts` |
| `product-detail` | `api/[...path].ts` |
| `product-update` | `api/[...path].ts` |
| `product-pricing-update` | `api/[...path].ts` |
| `product-activity` | `api/[...path].ts` |
| `product-pricing` | `api/[...path].ts` |
| `products` | `api/[...path].ts` |
| `quote-leads` | `api/[...path].ts` |
| `quotations` | `api/[...path].ts` |
| `quotation-templates` | `api/[...path].ts` |
| `order-templates` | `api/[...path].ts` |
| `quotation-preview` | `api/[...path].ts` |
| `quotation-issues` | `api/[...path].ts` |
| `public-quotation` | `api/[...path].ts` |
| `sales-dashboard` | `api/[...path].ts` |
| `sales-order-from-quotation` | `api/[...path].ts` |
| `sales-orders` | `api/[...path].ts` |
| `send-whatsapp` | `api/[...path].ts` |
| `send-whatsapp-flow` | `api/[...path].ts` |
| `whatsapp-send-status` | `api/[...path].ts` |
| `settings` | `api/[...path].ts` |
| `typebot-lead-capture` | `api/[...path].ts` |
| `whatsapp-conversations` | `api/[...path].ts` |
| `whatsapp-flows` | `api/[...path].ts` |
| `whatsapp-leads` | `api/[...path].ts` |
| `communication-flow-preview` | `api/[...path].ts` |
| `communication-send-events` | `api/[...path].ts` |
| `communication-flows` | `api/[...path].ts` |
| `communication-media` | `api/[...path].ts` |
| `communication-media-upload` | `api/[...path].ts` |
| `view` | `api/[...path].ts` |

A confirmação automatizada passou em `tests/unit/route-map.test.ts`.

## Integrações externas

| Integração | Arquivos encontrados |
| --- | --- |
| PostgreSQL/Drizzle | `api/_db/client.ts`, `api/_db/schema.ts`, `api/_db/*-repository.ts` e handlers que importam esses módulos |
| Evolution API | `api/_functions/lib/whatsapp-conversations-sync.ts`, `api/_functions/send-whatsapp-flow.ts`, `api/_functions/send-whatsapp.ts`, `api/_functions/whatsapp-leads.ts` |
| OpenRouter | `api/_functions/edit-draft.ts`, `api/_functions/extract.ts`, `api/_functions/whatsapp-leads.ts` |
| Meta CAPI | `api/_functions/lib/meta-capi.ts` |
| Typebot | `api/_functions/typebot-lead-capture.ts` |
| Vercel KV | `api/_functions/lib/whatsapp-conversations-store.ts`, `api/_functions/whatsapp-flows.ts`, `api/_lib/rate-limit.ts` |
| Vercel Blob | `api/_functions/communication-media-upload.ts`, `api/_functions/lib/postgres-media.ts`, `api/_functions/lib/quotation-document-storage.ts` |

O inventário foi obtido com buscas por `EVOLUTION`, `OPENROUTER`, `META_CAPI`, `TYPEBOT`, `KV_REST` e `BLOB_READ` em `api`.

## Variáveis de ambiente

### Referenciadas diretamente em `api` ou `scripts`

| Grupo | Variáveis |
| --- | --- |
| Runtime/Vercel | `BASE_URL`, `DEPLOY_PRIME_URL`, `PORT`, `URL`, `VERCEL`, `VERCEL_OIDC_TOKEN` |
| Autenticação | `APP_AUTH_BYPASS`, `APP_PASSWORD_HASH`, `APP_SESSION_SECRET` |
| PostgreSQL/serviços | `DATABASE_URL`, `PRODUCTION_DATABASE_URL`, `PGPASSFILE`, `PGSERVICEFILE`, `CUTOVER_EXPECTED_DATABASE`, `CUTOVER_PG_SERVICE`, `RESTORE_EXPECTED_DATABASE`, `RESTORE_PG_SERVICE` |
| Preflight/backup | `BACKUP_RETENTION_DAYS`, `PREFLIGHT_MAX_BLOB_SIZE_MB`, `PREFLIGHT_MAX_CONNECTIONS`, `PREFLIGHT_MAX_DB_SIZE_MB` |
| Evolution API | `EVOLUTION_API_KEY`, `EVOLUTION_BASE_URL`, `EVOLUTION_INSTANCE` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_SITE_URL` |
| Meta CAPI | `META_CAPI_ACCESS_TOKEN`, `META_PIXEL_ID` |
| Typebot/ingestão | `QUOTE_LEADS_INGEST_TOKEN`, `TYPEBOT_LEAD_CAPTURE_ENABLED`, `TYPEBOT_LEAD_WEBHOOK_TOKEN` |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, `QUOTATION_BLOB_READ_WRITE_TOKEN`, `QUOTATION_BLOB_STORE_ID` |
| Vercel KV | `KV_REST_API_TOKEN`, `KV_REST_API_URL` |

### Declaradas em `.env.example`

| Grupo | Variáveis |
| --- | --- |
| Banco e PostgreSQL | `DATABASE_URL`, `TEST_DATABASE_URL`, `RESTORE_DATABASE_URL`, `CUTOVER_PG_SERVICE`, `RESTORE_PG_SERVICE`, `PGSERVICEFILE`, `PGPASSFILE`, `PRODUCTION_DATABASE_URL`, `PRODUCTION_PG_SERVICE` |
| Staging | `STAGING_BASE_URL`, `STAGING_DATABASE_URL`, `STAGING_PG_SERVICE`, `STAGING_E2E`, `STAGING_E2E_USERNAME`, `STAGING_EXTERNAL_PROVIDERS_DISABLED`, `STAGING_EGRESS_BLOCKED`, `STAGING_FIXTURE_RESET` |
| E2E/canary | `E2E_USERNAME`, `E2E_PASSWORD`, `KNOWN_POSTGRES_QUOTATION_ID`, `KNOWN_POSTGRES_SCRATCH_QUOTATION_ID`, `CANARY_BASE_URL`, `CANARY_PASSWORD`, `CANARY_QUOTATION_ID`, `CANARY_PUBLIC_QUOTATION_URL` |
| Produção/Preview | `PREVIEW_DEPLOYMENT_URL`, `PREVIOUS_PRODUCTION_DEPLOYMENT_URL`, `POST_CLEANUP_PREVIEW_URL`, `CANARY_BASE_URL`, `PRODUCTION_CANARY_PASSWORD`, `KNOWN_PRODUCTION_POSTGRES_QUOTATION_ID`, `KNOWN_PRODUCTION_PUBLIC_QUOTATION_URL` |
| Auth e comunicação | `APP_PASSWORD_HASH`, `APP_SESSION_SECRET`, `APP_AUTH_BYPASS`, `SMTP_PASSWORD` |
| Providers | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `TYPEBOT_LEAD_WEBHOOK_TOKEN`, `TYPEBOT_LEAD_CAPTURE_ENABLED`, `BLOB_READ_WRITE_TOKEN`, `QUOTATION_BLOB_READ_WRITE_TOKEN`, `QUOTATION_BLOB_STORE_ID`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` |

O inventário direto foi obtido com `grep` de `process.env.*` em `api` e `scripts`.
O inventário declarativo foi obtido com a lista de nomes de `.env.example`.
Nenhum valor de variável, credencial ou dado de produção foi registrado neste documento.

## Migrations em produção

O caminho previsto no comando da spec, `drizzle/migrations`, não existe neste checkout.
Os arquivos SQL versionados ficam diretamente em `drizzle/`.

| Faixa | Arquivos |
| --- | --- |
| `0000`-`0003` | `0000_app_settings.sql`, `0001_products.sql`, `0002_clients.sql`, `0003_smart_bucky.sql` |
| `0004`-`0007` | `0004_silky_morbius.sql`, `0005_puzzling_nightcrawler.sql`, `0006_panoramic_firestar.sql`, `0007_sticky_darkstar.sql` |
| `0008`-`0011` | `0008_young_kitty_pryde.sql`, `0009_quotation_import.sql`, `0010_add_item_notas.sql`, `0011_quotation-template-library.sql` |
| `0012`-`0015` | `0012_frappe_migration_runs.sql`, `0013_frappe_migration_batches_non_negative.sql`, `0014_frappe_lineage_provenance.sql`, `0015_goofy_spirit.sql` |
| `0016`-`0019` | `0016_ambiguous_butterfly.sql`, `0017_order_templates.sql`, `0018_postgres_only_domains.sql`, `0019_quotation_issue_delivery.sql` |

`drizzle/meta/` contém 20 snapshots (`0000_snapshot.json` a `0019_snapshot.json`) e `_journal.json`.
A consulta `psql "$DATABASE_URL" -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;"` não conseguiu conectar: não há servidor PostgreSQL local no socket `/var/run/postgresql/.s.PGSQL.5432`.
As migrations aplicadas em produção não puderam ser confirmadas neste ambiente.
Nenhuma migration foi executada ou alterada.

## Testes com dependência externa

A busca por `EVOLUTION`, `OPENROUTER`, `KV_REST`, `BLOB_READ` e `META_CAPI` encontrou:

| Arquivo de teste | Indicador encontrado |
| --- | --- |
| `tests/unit/backup.test.ts` | Provider/configuração externa |
| `tests/unit/extract-handler.test.ts` | OpenRouter |
| `tests/unit/meta-capi.test.ts` | Meta CAPI |
| `tests/unit/rate-limit.test.ts` | Vercel KV |
| `tests/unit/send-whatsapp-idempotency.test.ts` | Evolution/WhatsApp |
| `tests/unit/send-whatsapp-review-r1.test.ts` | Evolution/WhatsApp |
| `tests/unit/send-whatsapp.test.ts` | Evolution/WhatsApp |
| `tests/unit/settings-app-server.test.ts` | Runtime/provider |
| `tests/unit/whatsapp-leads.test.ts` | Evolution/OpenRouter |

A classificação atual é baseada em referências textuais aos providers.
Ainda não foi feita a confirmação de quais testes fazem chamadas reais e quais usam mocks.

## Limitações e riscos residuais

- As 31 falhas locais de Playwright não foram corrigidas neste task: Task 1 é somente baseline.
  Causas prováveis (não confirmadas aqui): estado de login/auth na sessão E2E e asserções de visible/value que não atingiram o estado esperado em tempo hábil.
- O status de migrations aplicadas em produção permanece desconhecido até uma consulta com `DATABASE_URL` de produção.
- Antes da Task 2, o teste de paridade confirma somente que os três mapas atuais têm os mesmos 44 nomes.
- Os tempos de `test:unit` (52s) e Playwright (8m51s) foram medidos em execuções posteriores ao commit de baseline e podem variar conforme a máquina.
- Este baseline não inclui mudanças de código ou alterações de banco.
