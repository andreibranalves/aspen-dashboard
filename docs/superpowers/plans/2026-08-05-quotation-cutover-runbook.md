# Runbook de corte e rollback de orçamentos

Status deste documento: draft operacional pendente de revisão independente e validação ao vivo.

Este runbook é a fonte operacional para snapshot, migração, reconciliação, congelamento, canário, corte e rollback do domínio de orçamentos.

Nenhum operador deve colar segredos, tokens, URLs com credenciais ou dados pessoais neste documento, em tickets ou em logs de comandos.

Um operador executa os comandos e outro operador revisa cada evidência antes da próxima fase.

## 1. Escopo e critérios de parada

O corte cobre o agregado de orçamento, revisões, itens, templates, documentos históricos e referências de lineage.

Produtos, clientes, leads, WhatsApp, CRM e Sales Order continuam sujeitos às próprias flags e aos guardas operacionais.

O corte não autoriza chamadas Frappe inesperadas, efeitos externos fora do outbox ou fallback silencioso após erro PostgreSQL.

A execução para imediatamente quando qualquer condição abaixo ocorrer:

- business number duplicado ou colisão de chave canônica;
- divergência financeira sem explicação aprovada e registrada;
- produto, cliente, template ou outra pré-condição órfã;
- PDF atual exigido pelo canário ausente, ilegível, sem `%PDF-`, sem `%%EOF`, com checksum diferente ou tamanho inesperado; a ausência esperada de arquivo histórico não é essa condição;
- chamada Frappe inesperada depois do congelamento, inclusive uma chamada de leitura não prevista pelo passo atual;
- lote com estado `failed`, tentativa excedida ou checkpoint inconsistente;
- teste de segurança de link público externo falhar;
- leitura de rollback não conseguir abrir um orçamento PostgreSQL e um registro legado conhecido;
- contagem, hash, status, order linkage ou outbox divergir sem explicação aprovada;
- backup não puder ser validado e restaurado em destino isolado;
- qualquer comando retornar erro não classificado.

Ao abortar, não avance a flag, não apague dados e não repita o lote sem preservar o log e o manifest da tentativa.

## 2. Papéis, artefatos e proteção de segredos

O operador de migração executa backup, dry-run, apply e reconciliação.

O revisor de corte confirma hashes, contagens, divergências aprovadas e evidências de rollback.

O responsável pela infraestrutura aplica bloqueio de egress Frappe, alterações de ambiente e redeploy.

O responsável pelo negócio aprova divergências financeiras, retenção de lineage e o canário.

Use um diretório de trabalho fora do repositório para manifests, dumps e logs protegidos.

```bash
set -euo pipefail
umask 077
export CUTOVER_DIR="${CUTOVER_DIR:-$HOME/aspen-cutover-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$CUTOVER_DIR"
: "${CUTOVER_PG_SERVICE:?configure the named libpq service for the apply database}"
: "${PGSERVICEFILE:?configure a protected libpq service file path}"
: "${PGPASSFILE:?configure a protected libpq password file path}"
export CUTOVER_PG_SERVICE PGSERVICEFILE PGPASSFILE
```

Não use `set -x` durante este procedimento.

Não execute `env`, `printenv`, `set` ou comandos que imprimam `DATABASE_URL`, `TEST_DATABASE_URL`, `ERPNEXT_TOKEN` ou tokens de provedores.

Valide somente a presença das variáveis necessárias:

```bash
: "${DATABASE_URL:?configure DATABASE_URL through the deployment secret manager}"
: "${STAGING_DATABASE_URL:?configure staging STAGING_DATABASE_URL through the deployment secret manager}"
export TEST_DATABASE_URL="$STAGING_DATABASE_URL"
```

A mensagem de erro acima não contém o valor da variável.

`CUTOVER_PG_SERVICE` é a conexão nomeada usada pelo apply e por toda reconciliação PostgreSQL.

`PGSERVICEFILE` e `PGPASSFILE` devem ser arquivos protegidos fornecidos pelo gerenciador de segredos.

Não passe uma URL PostgreSQL em argumento de processo, log ou comando `psql`.

O contrato compara `DATABASE_URL` com host, porta e database efetivos lidos da seção `CUTOVER_PG_SERVICE` em `PGSERVICEFILE`.

Não substitua essa verificação por variáveis `CUTOVER_DATABASE_*` digitadas pelo operador ou por uma leitura isolada de `current_database()`.

`DATABASE_URL` é a credencial de configuração da API para o mesmo destino identificado pelo serviço nomeado; não existe uma segunda base de reconciliação.

```bash
set -euo pipefail
: "${CUTOVER_PG_SERVICE:?configure the named libpq service for the apply database}"
export CUTOVER_PG_SERVICE
: "${REPO_ROOT:?configure the absolute path to the reviewed checkout}"
cd "$REPO_ROOT"
node --input-type=module <<'NODE'
import { assertDatabaseContract } from './scripts/migrate-frappe-crm.mjs';
assertDatabaseContract(process.env);
NODE
```

## 3. Pré-condições executáveis

Execute a partir da raiz do checkout revisado.

Registre o commit sem incluir segredos:

```bash
set -euo pipefail
git rev-parse HEAD | tee "$CUTOVER_DIR/commit.txt"
git status --short
```

O status deve estar limpo antes do corte.

Execute os checks obrigatórios:

```bash
npm run build:api
npm run test:unit
npm run lint
npm run type-check
npm run check:tailwind
npm run build
```

Execute também os testes focados na superfície migrada:

```bash
node --test --import tsx tests/unit/cutover-checklist.test.ts
node --test --import tsx tests/unit/route-map.test.ts tests/unit/operational-mode.test.ts
node --test --import tsx tests/unit/frappe-migration.test.ts tests/unit/frappe-migration-repository.test.ts
node --test --import tsx tests/unit/public-quotation.test.ts tests/unit/quotation-html.test.js tests/unit/quotation-outbox.test.ts
```

Execute `npx drizzle-kit check` antes de qualquer migration apply.

Não declare o corte aprovado se um check falhar, mesmo que o comando seguinte passe.

## 4. Banco de staging, backup e restore

Staging deve usar uma base isolada e uma `TEST_DATABASE_URL` injetada pelo gerenciador de segredos.

Nunca aponte testes destrutivos ou `psql` de restore para a base de produção.

Confirme a presença sem imprimir o valor:

```bash
: "${TEST_DATABASE_URL:?configure staging TEST_DATABASE_URL through the deployment secret manager}"
```

Aplique as migrations somente na base isolada de staging, removendo qualquer `TEST_DATABASE_URL` herdada do shell:

```bash
env -u TEST_DATABASE_URL \
  TEST_DATABASE_URL="$STAGING_DATABASE_URL" \
  DATABASE_URL="$STAGING_DATABASE_URL" \
  npm run db:migrate
```

Execute os testes PostgreSQL com a variável já injetada no processo:

```bash
env -u TEST_DATABASE_URL \
  TEST_DATABASE_URL="$STAGING_DATABASE_URL" \
  DATABASE_URL="$STAGING_DATABASE_URL" \
  node --test --import tsx \
  tests/unit/frappe-migration-postgres.test.ts \
  tests/unit/quotations-postgres.test.ts \
  tests/unit/quotation-lifecycle-postgres.test.ts
```

Se `TEST_DATABASE_URL` não estiver disponível, marque os testes como não executados e não alegue rollback transacional, `SKIP LOCKED` ou ownership PostgreSQL validado.

Faça o backup final com retenção configurada pelo ambiente:

```bash
set -euo pipefail
node scripts/backup-crm.mjs | tee "$CUTOVER_DIR/backup.log"
```

Copie manualmente o caminho exato impresso pelo comando para `BACKUP_FILE`.

Não selecione automaticamente o arquivo mais recente.

```bash
set -euo pipefail
: "${BACKUP_FILE:?set the exact backup path printed by the backup command}"
test -f "$BACKUP_FILE"
sha256sum "$BACKUP_FILE" | tee "$CUTOVER_DIR/backup.sha256"
```

Valide o dump no alvo isolado explicitamente configurado em `RESTORE_DATABASE_URL`:

```bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?configure an isolated restore target through the deployment secret manager}"
if [ "${RESTORE_DATABASE_URL}" = "${DATABASE_URL:-}" ]; then
  echo 'ABORT: restore target equals source database' >&2
  exit 1
fi
node scripts/backup-crm.mjs --validate --file "$BACKUP_FILE" \
  | tee "$CUTOVER_DIR/restore-validation.log"
```

O script recusa validação sem `RESTORE_DATABASE_URL`, recusa a mesma identidade do source e nunca executa migration contra `DATABASE_URL`.

Para uma inspeção SQL adicional no alvo isolado, use a conexão libpq nomeada e não uma URL:

```bash
set -euo pipefail
: "${RESTORE_PG_SERVICE:?configure the named libpq service for the isolated restore target}"
psql --dbname "$RESTORE_PG_SERVICE" --set=ON_ERROR_STOP=1 --command 'SELECT current_database();' > "$CUTOVER_DIR/restore-target.txt"
```

Leia a base restaurada e confirme tabelas, contagens e um registro de teste antes de descartar o destino isolado.

Não restaure sobre a base ativa durante o rollback sem uma aprovação explícita, um novo backup e uma janela de indisponibilidade registrada.

## 5. Snapshot, dry-run e manifest

Fixe o snapshot de origem antes do apply.

Para staging, gere a fixture a partir do arquivo protegido sem guardar o salt, a entrada ou a saída no repositório:

```bash
set -euo pipefail
umask 077
: "${FRAPPE_SNAPSHOT_INPUT:?configure the protected source snapshot path}"
: "${FRAPPE_SNAPSHOT_OUTPUT:?configure an output path outside the repository}"
: "${FRAPPE_SNAPSHOT_SALT:?load the anonymization salt only from the secret manager}"
node scripts/anonymize-frappe-snapshot.mjs \
  --input "$FRAPPE_SNAPSHOT_INPUT" \
  --output "$FRAPPE_SNAPSHOT_OUTPUT"
unset FRAPPE_SNAPSHOT_SALT FRAPPE_SNAPSHOT_INPUT
export FRAPPE_MIGRATION_FIXTURE="$FRAPPE_SNAPSHOT_OUTPUT"
```

O anonimizador preserva doctypes, estados, itens, preços e relacionamentos, mas substitui identificadores, documentos, contatos e endereços por valores determinísticos.

O dry-run deve ser executado com uma fixture sem segredos ou contra a fonte autorizada em staging.

Fixture só pode ser usada com `--dry-run`.

```bash
set -euo pipefail
: "${FRAPPE_MIGRATION_FIXTURE:?configure a sanitized fixture path for dry-run, or unset it for the staging source}"
npm run build:api
node scripts/migrate-frappe-crm.mjs --dry-run --fixture "$FRAPPE_MIGRATION_FIXTURE" \
  > "$CUTOVER_DIR/report.dry-run.json"
sha256sum "$CUTOVER_DIR/report.dry-run.json" | tee "$CUTOVER_DIR/report.dry-run.sha256"
```

Para consultar a fonte de staging em vez de uma fixture sanitizada, remova a fixture e forneça as credenciais somente pelo gerenciador de segredos:

```bash
set -euo pipefail
unset FRAPPE_MIGRATION_FIXTURE
node scripts/migrate-frappe-crm.mjs --dry-run \
  > "$CUTOVER_DIR/report.dry-run.json"
sha256sum "$CUTOVER_DIR/report.dry-run.json" | tee "$CUTOVER_DIR/report.dry-run.sha256"
```

Não redirecione um report ou manifest para o repositório.

O CLI grava o report sanitizado.

O CLI emite o `MigrationManifest` sanitizado dentro do report e o teste de contrato abaixo valida sua forma.

```bash
node --test --import tsx tests/unit/frappe-migration.test.ts \
  --test-name-pattern 'dry-run retorna manifest'
```

Verifique a forma mínima do report sem imprimir o payload inteiro:

```bash
set -euo pipefail
jq -e '
  (.modo == "dry-run") and
  (.dry_run == true) and
  (.manifest.mode == "dry-run") and
  (.manifest.runId | type == "string" and length > 0) and
  (.manifest.manifestHash | test("^[0-9a-f]{64}$")) and
  (.manifest.status == "completed") and
  (.manifest.divergenceCounts.blocking == 0) and
  (.approvedDivergenceKeys | length == 0) and
  (.total | type == "object") and
  (.total.detalhes | type == "array")
' "$CUTOVER_DIR/report.dry-run.json"
```

O report e o manifest aninhado são o artefato verificável do dry-run.

Verifique que o report não contém payload bruto, CPF, CNPJ, telefone, e-mail ou token:

```bash
set -euo pipefail
if rg -n -i 'legacy_payload|legacyPayload|erpnext_token|bearer |token [A-Za-z0-9._-]{12,}|cpf|cnpj|telefone|email' \
  "$CUTOVER_DIR/report.dry-run.json"; then
  echo 'ABORT: report contains forbidden raw data' >&2
  exit 1
fi
```

Verifique divergências antes de aprovar qualquer exceção:

```bash
set -euo pipefail
jq -e '(.total.divergentes // 0) == 0 and (.total.erros // 0) == 0' "$CUTOVER_DIR/report.dry-run.json"
jq -e '(.approvedDivergenceKeys | length == 0)' "$CUTOVER_DIR/report.dry-run.json"
```

Uma divergência aprovada deve referenciar a mesma chave canônica `source_doctype:source_id` exibida no detalhe do report e no conjunto explícito `approvedDivergenceKeys`.

Para Customer e Lead, `source_id` é sempre um token opaco no formato `cliente-<12 hex>`, sem CPF, CNPJ, e-mail ou dois-pontos adicionais.

Não use `--approve-divergence` para contornar duplicata, perda financeira, órfão, PDF atual inválido ou falha de segurança.

## 6. Ordem de dependências e apply

Aplique somente depois de templates, produtos, preços, clientes e leads passarem pela reconciliação.

A ordem obrigatória é `templates -> products -> prices -> clients/leads -> quotations`.

### Delta final antes do apply

Se a origem mudou depois do primeiro dry-run, execute um delta imediatamente antes do apply.

O delta é um novo dry-run contra o mesmo snapshot operacional ou contra a fonte congelada, nunca uma edição manual do report.

```bash
set -euo pipefail
node scripts/migrate-frappe-crm.mjs --dry-run \
  > "$CUTOVER_DIR/report.delta.json"
sha256sum "$CUTOVER_DIR/report.delta.json" | tee "$CUTOVER_DIR/report.delta.sha256"
```

Compare o report delta com o report aprovado e reabra a reconciliação quando contagens, divergências ou detalhes mudarem:

```bash
set -euo pipefail
BASE_MANIFEST_HASH="$(jq -er '.manifest.manifestHash | select(test("^[0-9a-f]{64}$"))' "$CUTOVER_DIR/report.dry-run.json")"
DELTA_MANIFEST_HASH="$(jq -er '.manifest.manifestHash | select(test("^[0-9a-f]{64}$"))' "$CUTOVER_DIR/report.delta.json")"
if [ "$BASE_MANIFEST_HASH" != "$DELTA_MANIFEST_HASH" ]; then
  echo 'ABORT: source delta changed; repeat manifest review before apply' >&2
  exit 1
fi
```

Um delta com divergência bloqueante, novo órfão ou novo conflito financeiro interrompe o apply.

A idempotência por lineage, hashes e checkpoints permite aplicar somente mudanças aprovadas, mas não substitui a revisão do delta.

Execute o apply contra a base autorizada somente depois do backup, do dry-run e do delta aprovados:

```bash
set -euo pipefail
if [ -n "${FRAPPE_MIGRATION_FIXTURE:-}" ]; then
  echo 'ABORT: FRAPPE_MIGRATION_FIXTURE must be unset during apply' >&2
  exit 1
fi
unset FRAPPE_MIGRATION_FIXTURE
: "${CUTOVER_PG_SERVICE:?configure the named libpq service for apply}"
: "${PGSERVICEFILE:?configure the protected libpq service file}"
: "${PGPASSFILE:?configure the protected libpq password file}"
export CUTOVER_PG_SERVICE PGSERVICEFILE PGPASSFILE
node --input-type=module <<'NODE'
import { assertDatabaseContract } from './scripts/migrate-frappe-crm.mjs';
assertDatabaseContract(process.env);
NODE
EXPECTED_MANIFEST_HASH="$(jq -er '.manifest.manifestHash | select(test("^[0-9a-f]{64}$"))' "$CUTOVER_DIR/report.dry-run.json")"
node scripts/migrate-frappe-crm.mjs --apply \
  --expected-manifest-hash "$EXPECTED_MANIFEST_HASH" \
  > "$CUTOVER_DIR/report.apply.json"
sha256sum "$CUTOVER_DIR/report.apply.json" | tee "$CUTOVER_DIR/report.apply.sha256"
RUN_ID="$(jq -er '.manifest.runId | select(test("^[0-9a-f-]{36}$"))' "$CUTOVER_DIR/report.apply.json")"
MANIFEST_HASH="$(jq -er '.manifest.manifestHash | select(test("^[0-9a-f]{64}$"))' "$CUTOVER_DIR/report.apply.json")"
jq -e '.manifest.mode == "apply" and .manifest.status == "completed" and (.approvedDivergenceKeys | length == 0) and .manifest.divergenceCounts.blocking == 0' "$CUTOVER_DIR/report.apply.json"
psql --dbname "$CUTOVER_PG_SERVICE" --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  --variable=run_id="$RUN_ID" --variable=manifest_hash="$MANIFEST_HASH" \
  -c "SELECT json_build_object('runId', id, 'provider', provider, 'mode', mode, 'sourceSnapshotAt', source_snapshot_at, 'manifestHash', manifest_hash, 'status', status) FROM frappe_migration_runs WHERE id = :'run_id'::uuid AND manifest_hash = :'manifest_hash' AND mode = 'apply' AND status = 'completed'" \
  > "$CUTOVER_DIR/manifest.apply.persisted.json"
sha256sum "$CUTOVER_DIR/manifest.apply.persisted.json" > "$CUTOVER_DIR/manifest.apply.persisted.sha256"
sha256sum --check "$CUTOVER_DIR/manifest.apply.persisted.sha256"
jq -e --arg run_id "$RUN_ID" --arg manifest_hash "$MANIFEST_HASH" '(.runId == $run_id) and (.manifestHash == $manifest_hash) and (.status == "completed")' "$CUTOVER_DIR/manifest.apply.persisted.json"
```

Se houver uma divergência de baixo risco previamente aprovada, passe somente sua chave registrada:

```bash
set -euo pipefail
if [ -n "${FRAPPE_MIGRATION_FIXTURE:-}" ]; then
  echo 'ABORT: FRAPPE_MIGRATION_FIXTURE must be unset during apply' >&2
  exit 1
fi
unset FRAPPE_MIGRATION_FIXTURE
: "${CUTOVER_PG_SERVICE:?configure the named libpq service for apply}"
: "${PGSERVICEFILE:?configure the protected libpq service file}"
: "${PGPASSFILE:?configure the protected libpq password file}"
export CUTOVER_PG_SERVICE PGSERVICEFILE PGPASSFILE
node --input-type=module <<'NODE'
import { assertDatabaseContract } from './scripts/migrate-frappe-crm.mjs';
assertDatabaseContract(process.env);
NODE
EXPECTED_MANIFEST_HASH="$(jq -er '.manifest.manifestHash | select(test("^[0-9a-f]{64}$"))' "$CUTOVER_DIR/report.dry-run.json")"
EXPECTED_APPROVAL='SourceDoctype:opaque-source-id'
node scripts/migrate-frappe-crm.mjs --apply \
  --expected-manifest-hash "$EXPECTED_MANIFEST_HASH" \
  --approve-divergence "$EXPECTED_APPROVAL" \
  > "$CUTOVER_DIR/report.apply.json"
sha256sum "$CUTOVER_DIR/report.apply.json" | tee "$CUTOVER_DIR/report.apply.sha256"
RUN_ID="$(jq -er '.manifest.runId | select(test("^[0-9a-f-]{36}$"))' "$CUTOVER_DIR/report.apply.json")"
MANIFEST_HASH="$(jq -er '.manifest.manifestHash | select(test("^[0-9a-f]{64}$"))' "$CUTOVER_DIR/report.apply.json")"
jq -e --arg expected "$EXPECTED_APPROVAL" '
  (.manifest.mode == "apply") and
  (.manifest.status == "completed") and
  (.manifest.divergenceCounts.blocking == 0) and
  (.approvedDivergenceKeys == [$expected]) and
  (.total.detalhes | map(select(((.source_doctype // "") + ":" + (.source_id // "")) == $expected and .aprovada == true)) | length > 0)
' "$CUTOVER_DIR/report.apply.json"
psql --dbname "$CUTOVER_PG_SERVICE" --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  --variable=run_id="$RUN_ID" --variable=manifest_hash="$MANIFEST_HASH" \
  -c "SELECT json_build_object('runId', id, 'provider', provider, 'mode', mode, 'sourceSnapshotAt', source_snapshot_at, 'manifestHash', manifest_hash, 'status', status) FROM frappe_migration_runs WHERE id = :'run_id'::uuid AND manifest_hash = :'manifest_hash' AND mode = 'apply' AND status = 'completed'" \
  > "$CUTOVER_DIR/manifest.apply.persisted.json"
sha256sum "$CUTOVER_DIR/manifest.apply.persisted.json" > "$CUTOVER_DIR/manifest.apply.persisted.sha256"
sha256sum --check "$CUTOVER_DIR/manifest.apply.persisted.sha256"
jq -e --arg run_id "$RUN_ID" --arg manifest_hash "$MANIFEST_HASH" '(.runId == $run_id) and (.manifestHash == $manifest_hash) and (.status == "completed")' "$CUTOVER_DIR/manifest.apply.persisted.json"
```

O valor acima é um identificador de exemplo e deve ser substituído por uma chave já aprovada, nunca por um segredo.

Um apply com erro de lote, divergência bloqueante ou run `failed` retorna código diferente de zero.

Preserve o report, o manifest persistido, seus checksums, o run ID, o conjunto explícito de approvals e o log de cada tentativa.

Não execute apply novamente para mascarar um erro.

Para retomar um run falho, corrija a causa, preserve o mesmo manifest e faça nova revisão antes de repetir.

## 7. Reconciliação técnica e funcional

Capture contagens e invariantes sem selecionar dados pessoais.

Apply e reconciliação devem usar `CUTOVER_PG_SERVICE` da mesma conexão nomeada.

Valide o serviço efetivo e compare o database da conexão ativa com a configuração lida de `PGSERVICEFILE`.

```bash
set -euo pipefail
: "${CUTOVER_PG_SERVICE:?configure the named libpq service for reconciliation}"
export CUTOVER_PG_SERVICE
: "${REPO_ROOT:?configure the absolute path to the reviewed checkout}"
cd "$REPO_ROOT"
node --input-type=module <<'NODE'
import { assertDatabaseContract } from './scripts/migrate-frappe-crm.mjs';
assertDatabaseContract(process.env);
NODE
TARGET_DATABASE="$(psql --dbname "$CUTOVER_PG_SERVICE" --set=ON_ERROR_STOP=1 --tuples-only --no-align --command 'SELECT current_database();')"
EXPECTED_DATABASE="$(cd "$REPO_ROOT" && node --input-type=module <<'NODE'
import { readPgServiceTarget } from './scripts/migrate-frappe-crm.mjs';
process.stdout.write(readPgServiceTarget(process.env).database);
NODE
)"
printf '%s\n' "$TARGET_DATABASE" | tee "$CUTOVER_DIR/reconciliation-target.txt"
test "$TARGET_DATABASE" = "$EXPECTED_DATABASE"
psql --dbname "$CUTOVER_PG_SERVICE" --set=ON_ERROR_STOP=1 <<'SQL' | tee "$CUTOVER_DIR/reconciliation.txt"
SELECT 'duplicate_business_number' AS check_name, count(*) AS failures
FROM (
  SELECT business_number
  FROM quotations
  GROUP BY business_number
  HAVING count(*) > 1
) duplicates;

SELECT 'missing_revision_snapshot' AS check_name, count(*) AS failures
FROM quote_revisions
WHERE template_version_id IS NULL OR sections_snapshot IS NULL;

SELECT 'invalid_lineage' AS check_name, count(*) AS failures
FROM frappe_import_lineage
WHERE lineage_status <> 'verified';

SELECT 'pending_order_linkage' AS check_name, count(*) AS records
FROM quote_revisions
WHERE order_pending = true;
SQL
```

A consulta de `pending_order_linkage` é informativa, mas cada linha precisa de reconciliação contra a origem antes do canário.

Confirme que a contagem de quotations, revisões, itens, templates e documentos bate com o manifest aprovado.

Confirme que cada business number é único e que cada revisão aponta para uma versão de template e um snapshot imutável.

Confirme que nenhum relatório ou resposta operacional serializa `legacy_payload`.

Confirme que o checksum e o tamanho do PDF renderizado sob demanda correspondem ao resultado retornado pela mesma revisão imutável.

Execute os testes de documento, link público, outbox, rotas e rollback antes do canário:

```bash
node --test --import tsx \
  tests/unit/public-quotation.test.ts \
  tests/unit/quotation-html.test.js \
  tests/unit/quotation-outbox.test.ts \
  tests/unit/route-map.test.ts \
  tests/unit/operational-mode.test.ts
```

## 8. Bloqueio de chamadas Frappe e congelamento

Antes do snapshot final, permita somente a leitura Frappe necessária para o dry-run e o apply autorizados.

Durante `postgres-write`, bloqueie escrita Frappe para o domínio de orçamentos e preserve a regra no firewall ou gateway de staging.

`rollback-compatible` é uma exceção controlada: permite somente as escritas Frappe compatíveis descritas na tabela de estados.

No canário PostgreSQL, a rede deve negar o host Frappe e registrar tentativas no log de egress.

A verificação abaixo deve falhar por bloqueio de rede ou política, e não por resposta HTTP válida:

```bash
if curl --silent --show-error --connect-timeout 3 --max-time 5 \
  -o /dev/null 'https://aspenestamparia.l.frappe.cloud/api/method/ping'; then
  echo 'ABORT: Frappe egress is reachable during the blocked phase' >&2
  exit 1
else
  echo 'Frappe egress blocked; inspect firewall audit log'
fi
```

Um timeout, erro de conexão ou negação explícita só é evidência suficiente quando o log da política confirmar o bloqueio.

Um HTTP 401, 403, 404 ou 5xx recebido do host não prova bloqueio e exige abort.

Os testes com Frappe bloqueado devem usar fixture ou adapter/fetch injetado que falha em qualquer chamada inesperada.

Não declare sucesso se uma chamada Frappe ocorrer fora da fase de fonte explicitamente aprovada.

Com o bloqueio confirmado no log de egress, execute os testes de staging contra uma URL sem credenciais:

```bash
set -euo pipefail
: "${STAGING_BASE_URL:?configure the staging origin without credentials in the URL}"
: "${E2E_USERNAME:?configure the staging test username through the secret manager}"
: "${E2E_PASSWORD:?configure the staging test password through the secret manager}"
: "${KNOWN_POSTGRES_QUOTATION_ID:?configure a non-PII PostgreSQL quotation id}"
: "${KNOWN_POSTGRES_SCRATCH_QUOTATION_ID:?configure a disposable non-PII sent PostgreSQL scratch quotation id}"
: "${KNOWN_LEGACY_QUOTATION_ID:?configure a non-PII legacy quotation id}"
: "${STAGING_E2E_USERNAME:?configure the designated account identifier in staging deployment env}"
: "${STAGING_EXTERNAL_PROVIDERS_DISABLED:?set staging external provider guard to 1}"
: "${STAGING_EGRESS_BLOCKED:?set staging egress guard to 1}"
: "${STAGING_FIXTURE_RESET:?set disposable fixture cleanup attestation to 1}"
[ "$STAGING_E2E_USERNAME" = "$E2E_USERNAME" ]
[ "$STAGING_EXTERNAL_PROVIDERS_DISABLED" = 1 ]
[ "$STAGING_EGRESS_BLOCKED" = 1 ]
[ "$STAGING_FIXTURE_RESET" = 1 ]
[ -z "${OUTBOX_N8N_URL:-}" ]
[ -z "${N8N_OUTBOX_WEBHOOK_URL:-}" ]
[ -z "${OUTBOX_EVOLUTION_URL:-}" ]
[ -z "${OUTBOX_CRM_URL:-}" ]
BASE_URL="$STAGING_BASE_URL" \
STAGING_E2E=1 \
E2E_USERNAME="$E2E_USERNAME" \
E2E_PASSWORD="$E2E_PASSWORD" \
STAGING_E2E_USERNAME="$STAGING_E2E_USERNAME" \
KNOWN_POSTGRES_QUOTATION_ID="$KNOWN_POSTGRES_QUOTATION_ID" \
KNOWN_POSTGRES_SCRATCH_QUOTATION_ID="$KNOWN_POSTGRES_SCRATCH_QUOTATION_ID" \
KNOWN_LEGACY_QUOTATION_ID="$KNOWN_LEGACY_QUOTATION_ID" \
STAGING_EXTERNAL_PROVIDERS_DISABLED="$STAGING_EXTERNAL_PROVIDERS_DISABLED" \
STAGING_EGRESS_BLOCKED="$STAGING_EGRESS_BLOCKED" \
STAGING_FIXTURE_RESET="$STAGING_FIXTURE_RESET" \
npx playwright test --config=playwright.config.js \
  tests/quotation-cutover-staging.spec.js \
  tests/operational-mode.spec.js \
  tests/quotations-core.spec.js \
  tests/quotation-lifecycle.spec.js
```

O comando só é válido depois do bloqueio Frappe e da confirmação de que staging aponta para a base nomeada esperada.

A suíte staging falha explicitamente quando qualquer precondição, credencial, provider guard, egress guard ou fixture reset attestation estiver ausente.

A aplicação usa autenticação somente por senha e não possui campo de username.

`STAGING_E2E_USERNAME` é a identidade designada configurada no ambiente de staging e validada pelo endpoint de inspeção do outbox através do header de attestation.

A senha é usada somente pelo formulário de login e não é salva em `storageState` ou artefato versionado.

O scratch quotation é disposable, começa enviado, é usado serialmente para emissão/revisão/edição e deve ser excluído pelo teste ao final.

O deployment de staging deve manter `STAGING_E2E=1`, `STAGING_E2E_USERNAME`, `STAGING_EXTERNAL_PROVIDERS_DISABLED=1` e `STAGING_EGRESS_BLOCKED=1` configurados no ambiente do servidor para habilitar a inspeção autenticada.

O worker de outbox permanece desabilitado quando os três `OUTBOX_*_URL` estão ausentes; o endpoint de inspeção retorna apenas referências canônicas e exige os guards de staging.

## 9. Máquina de estados e transições

A fonte de verdade da fase é a combinação de `CRM_CORE_QUOTES_ENABLED` e `CRM_QUOTES_ROLLOUT_STATE`.

O valor efetivo é `legacy` quando `CRM_CORE_QUOTES_ENABLED` não é exatamente `true`.

Com a flag exatamente `true`, estado ausente resulta em `postgres-write`.

Com a flag exatamente `true`, `CRM_QUOTES_ROLLOUT_STATE=legacy` mantém `legacy` explicitamente.

Os estados válidos são `legacy`, `postgres-write`, `postgres-read-only` e `rollback-compatible`.

| Estado efetivo | Leituras de orçamento | Escritas de orçamento | Ação operacional |
| --- | --- | --- | --- |
| `legacy` | Frappe | Frappe | Estado inicial ou compatibilidade explícita antes da escrita PostgreSQL. |
| `postgres-write` | PostgreSQL | PostgreSQL na transação do agregado; efeitos externos pelo outbox | Estado de corte e canário. Bloquear chamadas Frappe não previstas. |
| `postgres-read-only` | PostgreSQL | Sem nova escrita PostgreSQL; escrita compatível deve ser bloqueada ou seguir o comportamento explicitamente testado do endpoint | Congelamento para reconciliação e decisão de avanço. |
| `rollback-compatible` | PostgreSQL quando o registro existe; Frappe para registro legado ausente | Frappe para novas escritas compatíveis | Estado de rollback sem apagar o agregado PostgreSQL. |

A transição permitida de preparação é `legacy -> postgres-write` após apply e reconciliação.

A transição de congelamento é `postgres-write -> postgres-read-only` antes de inspeção final.

A transição de rollback é `postgres-write -> postgres-read-only -> rollback-compatible` após congelar novos efeitos externos.

O retorno ao corte é `rollback-compatible -> postgres-read-only -> postgres-write` somente após nova reconciliação e aprovação.

A transição para `legacy` exige preservar e reconciliar os registros PostgreSQL, mesmo que a flag seja desligada.

Definir `CRM_CORE_QUOTES_ENABLED=false` não desfaz escritas PostgreSQL, não restaura dados Frappe e não é rollback suficiente depois que PostgreSQL recebeu dados.

Não altere uma flag sem registrar o estado anterior, o estado desejado, o commit, o operador, o revisor e o horário UTC.

Depois de cada redeploy, confirme o estado efetivo com a leitura autenticada de settings e com uma leitura de orçamento conhecida.

## 10. Canário

O canário deve usar um orçamento de teste não financeiro e um conjunto de leitura histórica conhecido.

O canário mínimo é criar ou abrir um rascunho PostgreSQL, abrir sua revisão, renderizar HTML/PDF, verificar `%PDF-` e `%%EOF`, emitir um link público com expiração e confirmar o checksum.

O canário deve confirmar que `quotation.created` ou `quotation.updated` aparece no outbox e que uma tentativa de provider falha em retry sem apagar o orçamento.

O canário deve confirmar que um orçamento legado conhecido continua acessível conforme a política do estado atual.

O canário deve confirmar que não houve chamada Frappe no log de egress após o congelamento.

Aumente o tráfego somente se contagens, latência, erros, checksum, outbox e logs permanecerem dentro dos limites aprovados.

Qualquer falha do canário é uma condição de abort e inicia a seção de rollback.

## 11. Worker de outbox e monitoramento

O outbox é interno e não exige CRM externo, N8N ou Evolution.

Deixe `OUTBOX_N8N_URL`, `N8N_OUTBOX_WEBHOOK_URL`, `OUTBOX_EVOLUTION_URL` e `OUTBOX_CRM_URL` unset em Preview e Production nesta fase.

Com `DATABASE_URL` e nenhum provider configurado, `npm run worker:quotation-outbox` termina com estado `disabled` e não reivindica eventos.

Quando um bridge futuro for aprovado, configure somente o provider correspondente e seu token no ambiente protegido do worker.

O worker reivindica somente eventos cujo provider possui endpoint configurado; eventos de outros providers permanecem pendentes e não perdem lease.

Execute uma vez ou agende com lock externo: `npm run worker:quotation-outbox`.

O scheduler deve executar lotes curtos em intervalo menor que o próximo retry e impedir duas instâncias sem leases PostgreSQL.

Monitore contagem `pending`, idade do evento mais antigo, `attempts`, `dead_letter`, `last_error_class`, provider message ID e eventos sem lease.

O fake bridge de testes usa somente Node built-in e não pode ser configurado em Preview/Production:

```bash
node --test --import tsx tests/unit/quotation-outbox.test.ts tests/unit/settings-app-server.test.ts
```

O teste de bridge deve comprovar health, payload canônico sem PII/raw payload, 500, timeout, retry/backoff, idempotency key, dead-letter e lease ownership.

Qualquer dead-letter, lease perdida repetidamente, bridge indisponível ou divergência entre provider acceptance e outbox deve abortar o canário e abrir incidente.

No canário futuro, injete uma falha de bridge, confirme retry/backoff e depois confirme entrega idempotente com o mesmo `idempotency_key`.

## 12. Política de documentos históricos, status e pedidos

A política selecionada para este corte é PDF on-demand: o PostgreSQL persiste o agregado, a revisão e a lineage, e o endpoint renderiza o PDF a partir da revisão imutável quando solicitado.

O repositório PostgreSQL atual ignora a unidade de documento histórico e não grava linha nem metadados de PDF histórico.

A resposta pública de PDF on-demand informa MIME, tamanho e checksum do conteúdo renderizado.

A resposta de preview informa MIME, tamanho e metadados do template; o operador deve calcular o checksum dos bytes retornados quando essa rota for usada.

Não existe retenção de PDF histórico nesta fase.

A ausência de um PDF histórico persistido é esperada e não bloqueia o apply nem o canário on-demand; somente um cenário que exigir download histórico arquivado deve abortar por política não suportada, não por integridade de PDF atual.

O canário de documento deve validar `%PDF-`, `%%EOF`, MIME, tamanho e checksum do PDF renderizado sob demanda.

O sistema não deve regenerar um PDF histórico a partir de dados Frappe depois do congelamento.

Qualquer política futura de archive precisa de uma implementação de storage real, teste de read-back e uma mudança de escopo aprovada.

A retenção desta fase cobre somente a revisão PostgreSQL e a lineage autorizada.

Não declare retenção de objeto Blob ou metadata row de PDF histórico.

O status original permanece em lineage para auditoria.

O status canônico é determinado pela tabela abaixo:

| Status de origem | Status canônico | Order linkage | `order_pending` |
| --- | --- | --- | --- |
| `draft` | `rascunho` | nenhum | `false` |
| `submitted`, `open`, `sent` | `enviado` | nenhum | `false` |
| `ordered` | `aprovado` | `ordered` | `true` |
| `completed` | `aprovado` | `completed` | `true` |
| `closed` | `aprovado` | `closed` | `true` |
| `lost`, `cancelled`, `expired` | `perdido` | nenhum | `false` |
| desconhecido | `rascunho` | nenhum | `false`, com divergência registrada |

Não invente um Sales Order ausente.

`order_linkage` registra a relação conhecida e `order_pending` marca a reconciliação necessária para `ordered`, `completed` e `closed`.

Uma divergência entre o vínculo de pedido e a origem é condição de abort até aprovação explícita.

`legacy_payload` é dado bruto autorizado somente para leitura operacional de auditoria e replay.

`legacy_payload` nunca aparece em manifest, relatório, log, resposta API ou evidência pública.

A retenção selecionada para `legacy_payload` é a vida útil da linha de lineage.

Ao arquivar a lineage, um operador autorizado deve purgar o payload bruto conforme a política de retenção aprovada e preservar somente hashes, identificadores, status e evidência mínima.

A retenção padrão dos dumps segue `BACKUP_RETENTION_DAYS`, com validação de restore antes da remoção.

## 13. Rollback executável

O rollback começa congelando criação, edição, emissão e efeitos externos do canário.

Preserve o backup, o manifest, os hashes, o log de egress e o último estado conhecido.

Mude primeiro para compatibilidade, mantendo a flag mestre ligada:

```bash
# No gerenciador de segredos da implantação, sem imprimir valores:
# CRM_CORE_QUOTES_ENABLED=true
# CRM_QUOTES_ROLLOUT_STATE=rollback-compatible
# Faça redeploy e aguarde o health check.
```

Não use somente `CRM_CORE_QUOTES_ENABLED=false` para rollback depois de qualquer escrita PostgreSQL.

Valide registros conhecidos sem imprimir payloads ou credenciais:

```bash
set -euo pipefail
: "${KNOWN_POSTGRES_QUOTATION_ID:?configure a non-PII PostgreSQL quotation id for rollback read verification}"
: "${KNOWN_LEGACY_QUOTATION_ID:?configure a non-PII legacy quotation id for rollback read verification}"
: "${APP_ORIGIN:?configure the staging origin without credentials in the URL}"
: "${APP_CURL_CONFIG:?configure a protected curl config with staging authentication}"
PG_COUNT="$(psql --dbname "$CUTOVER_PG_SERVICE" --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  --variable=quotation_id="$KNOWN_POSTGRES_QUOTATION_ID" \
  --command "SELECT count(*) FROM quotations WHERE id = :'quotation_id'::uuid;")"
test "$PG_COUNT" = '1'

curl --fail --silent --show-error --config "$APP_CURL_CONFIG" \
  --url "$APP_ORIGIN/api/quotations?id=$KNOWN_LEGACY_QUOTATION_ID" \
  > "$CUTOVER_DIR/rollback-legacy-read.json"
jq -e 'type == "object" and length > 0' "$CUTOVER_DIR/rollback-legacy-read.json"
```

The PostgreSQL query and the authenticated legacy route read are both required evidence.

Execute the rollback write-route contract without mutating a live record:

```bash
set -euo pipefail
node --test --import tsx \
  --test-name-pattern='PUT in rollback-compatible writes to legacy' \
  tests/unit/operational-mode.test.ts
```

Valide que nenhuma leitura PostgreSQL existente foi apagada ou mascarada.

Execute os demais testes de leitura de rollback:

```bash
set -euo pipefail
node --test --import tsx \
  tests/unit/operational-mode.test.ts \
  tests/unit/quotations-core.test.ts \
  tests/unit/quotations-postgres.test.ts
```

Se a leitura de rollback falhar, mantenha o tráfego congelado e restaure somente em destino isolado para diagnóstico.

Se a compatibilidade for estável, escolha entre corrigir e retornar a `postgres-read-only` ou repetir o canário antes de `postgres-write`.

Um retorno integral a `legacy` exige aprovação separada, snapshot PostgreSQL preservado e plano para registros criados somente no PostgreSQL.

Nunca descarte o banco PostgreSQL para simular rollback.

Nunca faça fallback automático para Frappe após um erro PostgreSQL.

## 14. Evidências e encerramento

O corte só pode ser encerrado quando todos os artefatos abaixo estiverem no diretório protegido do corte:

- commit e status limpo;
- logs dos checks obrigatórios;
- checksum do backup e validação de restore;
- report e manifest dry-run/apply com hashes;
- divergências aprovadas ou contagem bloqueante zero;
- reconciliação técnica e funcional;
- evidência de bloqueio Frappe;
- resultados de PDF, link público, outbox, rotas e rollback;
- decisão de canário assinada pelo operador, revisor e responsável pelo negócio;
- estado efetivo e horário UTC após o último redeploy.

Se PostgreSQL de staging ou Playwright contra staging não estiver disponível, registre essa validação como não executada.

Não declare o primeiro subphase pronto com base em testes locais que não cobrem a dependência ausente.
