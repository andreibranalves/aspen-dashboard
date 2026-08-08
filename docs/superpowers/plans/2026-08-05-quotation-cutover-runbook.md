# Runbook de corte e rollback de orçamentos

Status deste documento: procedimento aprovado para execução assistida.

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
- PDF ausente, ilegível, sem `%PDF-`, sem `%%EOF`, com checksum diferente ou tamanho inesperado;
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
set -eu
umask 077
export CUTOVER_DIR="${CUTOVER_DIR:-$HOME/aspen-cutover-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$CUTOVER_DIR"
```

Não use `set -x` durante este procedimento.

Não execute `env`, `printenv`, `set` ou comandos que imprimam `DATABASE_URL`, `TEST_DATABASE_URL`, `ERPNEXT_TOKEN` ou tokens de provedores.

Valide somente a presença das variáveis necessárias:

```bash
: "${DATABASE_URL:?configure DATABASE_URL through the deployment secret manager}"
: "${TEST_DATABASE_URL:?configure staging TEST_DATABASE_URL through the deployment secret manager}"
```

A mensagem de erro acima não contém o valor da variável.

## 3. Pré-condições executáveis

Execute a partir da raiz do checkout revisado.

Registre o commit sem incluir segredos:

```bash
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

Execute os testes PostgreSQL com a variável já injetada no processo:

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" node --test --import tsx \
  tests/unit/frappe-migration-postgres.test.ts \
  tests/unit/quotations-postgres.test.ts \
  tests/unit/quotation-lifecycle-postgres.test.ts
```

Se `TEST_DATABASE_URL` não estiver disponível, marque os testes como não executados e não alegue rollback transacional, `SKIP LOCKED` ou ownership PostgreSQL validado.

Faça o backup final com retenção configurada pelo ambiente:

```bash
node scripts/backup-crm.mjs | tee "$CUTOVER_DIR/backup.log"
```

Localize o dump pelo nome retornado sem copiá-lo para o repositório:

```bash
BACKUP_FILE="$(find backups -maxdepth 1 -type f -name 'backup-*.sql' -printf '%T@ %p\n' \
  | sort -nr | head -1 | cut -d' ' -f2-)"
: "${BACKUP_FILE:?backup file not found}"
sha256sum "$BACKUP_FILE" | tee "$CUTOVER_DIR/backup.sha256"
```

Valide o dump em destino temporário ou schema de validação:

```bash
node scripts/backup-crm.mjs --validate --file "$BACKUP_FILE" \
  | tee "$CUTOVER_DIR/restore-validation.log"
```

Para um restore aprovado em uma base isolada, use uma variável fornecida pelo gerenciador de segredos e não o valor literal:

```bash
: "${RESTORE_DATABASE_URL:?configure an isolated restore target through the deployment secret manager}"
psql "$RESTORE_DATABASE_URL" --set ON_ERROR_STOP=1 < "$BACKUP_FILE"
```

Leia a base restaurada e confirme tabelas, contagens e um registro de teste antes de descartar o destino isolado.

Não restaure sobre a base ativa durante o rollback sem uma aprovação explícita, um novo backup e uma janela de indisponibilidade registrada.

## 5. Snapshot, dry-run e manifest

Fixe o snapshot de origem antes do apply.

O dry-run deve ser executado com uma fixture sem segredos ou contra a fonte autorizada em staging.

Fixture só pode ser usada com `--dry-run`.

```bash
: "${FRAPPE_MIGRATION_FIXTURE:?configure a sanitized fixture path for dry-run, or unset it for the staging source}"
npm run build:api
node scripts/migrate-frappe-crm.mjs --dry-run --fixture "$FRAPPE_MIGRATION_FIXTURE" \
  > "$CUTOVER_DIR/report.dry-run.json"
sha256sum "$CUTOVER_DIR/report.dry-run.json" | tee "$CUTOVER_DIR/report.dry-run.sha256"
```

Para consultar a fonte de staging em vez de uma fixture sanitizada, remova a fixture e forneça as credenciais somente pelo gerenciador de segredos:

```bash
unset FRAPPE_MIGRATION_FIXTURE
node scripts/migrate-frappe-crm.mjs --dry-run \
  > "$CUTOVER_DIR/report.dry-run.json"
```

Não redirecione um report ou manifest para o repositório.

O CLI grava o report sanitizado.

O `MigrationManifest` do dry-run permanece em memória e é validado pelo teste de contrato abaixo.

```bash
node --test --import tsx tests/unit/frappe-migration.test.ts \
  --test-name-pattern 'dry-run retorna manifest'
```

Verifique a forma mínima do report sem imprimir o payload inteiro:

```bash
jq -e '
  (.modo == "dry-run") and
  (.dry_run == true) and
  (.total | type == "object") and
  (.total.detalhes | type == "array")
' "$CUTOVER_DIR/report.dry-run.json"
```

Verifique que o report não contém payload bruto, CPF, CNPJ, telefone, e-mail ou token:

```bash
if rg -n -i 'legacy_payload|legacyPayload|erpnext_token|bearer |token [A-Za-z0-9._-]{12,}|cpf|cnpj|telefone|email' \
  "$CUTOVER_DIR/report.dry-run.json"; then
  echo 'ABORT: manifest contains forbidden raw data' >&2
  exit 1
fi
```

Verifique divergências antes de aprovar qualquer exceção:

```bash
jq -e '(.total.divergentes // 0) == 0 and (.total.erros // 0) == 0' "$CUTOVER_DIR/report.dry-run.json"
jq -e '(.total.aprovadas // 0) >= 0' "$CUTOVER_DIR/report.dry-run.json"
```

Uma divergência aprovada deve referenciar `source_doctype:source_id` e existir no registro de aprovação.

Não use `--approve-divergence` para contornar duplicata, perda financeira, órfão, PDF inválido ou falha de segurança.

## 6. Ordem de dependências e apply

Aplique somente depois de templates, produtos, preços, clientes e leads passarem pela reconciliação.

A ordem obrigatória é `templates -> products -> prices -> clients/leads -> quotations`.

### Delta final antes do apply

Se a origem mudou depois do primeiro dry-run, execute um delta imediatamente antes do apply.

O delta é um novo dry-run contra o mesmo snapshot operacional ou contra a fonte congelada, nunca uma edição manual do report.

```bash
node scripts/migrate-frappe-crm.mjs --dry-run \
  > "$CUTOVER_DIR/report.delta.json"
sha256sum "$CUTOVER_DIR/report.delta.json" | tee "$CUTOVER_DIR/report.delta.sha256"
```

Compare o report delta com o report aprovado e reabra a reconciliação quando contagens, divergências ou detalhes mudarem:

```bash
if ! cmp -s "$CUTOVER_DIR/report.dry-run.json" "$CUTOVER_DIR/report.delta.json"; then
  echo 'DELTA: source changed; repeat manifest review before apply' >&2
fi
```

Um delta com divergência bloqueante, novo órfão ou novo conflito financeiro interrompe o apply.

A idempotência por lineage, hashes e checkpoints permite aplicar somente mudanças aprovadas, mas não substitui a revisão do delta.

Execute o apply contra a base autorizada somente depois do backup, do dry-run e do delta aprovados:

```bash
node scripts/migrate-frappe-crm.mjs --apply \
  > "$CUTOVER_DIR/report.apply.json"
sha256sum "$CUTOVER_DIR/report.apply.json" | tee "$CUTOVER_DIR/report.apply.sha256"

psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --tuples-only --no-align \
  -c "SELECT json_build_object('runId', id, 'provider', provider, 'mode', mode, 'sourceSnapshotAt', source_snapshot_at, 'manifestHash', manifest_hash, 'status', status) FROM frappe_migration_runs WHERE mode = 'apply' ORDER BY started_at DESC LIMIT 1" \
  > "$CUTOVER_DIR/manifest.apply.json"
sha256sum "$CUTOVER_DIR/manifest.apply.json" | tee "$CUTOVER_DIR/manifest.apply.sha256"
jq -e '
  (.runId | type == "string" and length > 0) and
  (.manifestHash | test("^[0-9a-f]{64}$")) and
  (.mode == "apply") and
  (.status == "completed")
' "$CUTOVER_DIR/manifest.apply.json"
```

Se houver uma divergência de baixo risco previamente aprovada, passe somente sua chave registrada:

```bash
node scripts/migrate-frappe-crm.mjs --apply \
  --approve-divergence 'SourceDoctype:source-id' \
  > "$CUTOVER_DIR/report.apply.json"

psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --tuples-only --no-align \
  -c "SELECT json_build_object('runId', id, 'provider', provider, 'mode', mode, 'sourceSnapshotAt', source_snapshot_at, 'manifestHash', manifest_hash, 'status', status) FROM frappe_migration_runs WHERE mode = 'apply' ORDER BY started_at DESC LIMIT 1" \
  > "$CUTOVER_DIR/manifest.apply.json"
sha256sum "$CUTOVER_DIR/manifest.apply.json" | tee "$CUTOVER_DIR/manifest.apply.sha256"
jq -e '
  (.runId | type == "string" and length > 0) and
  (.manifestHash | test("^[0-9a-f]{64}$")) and
  (.mode == "apply") and
  (.status == "completed")
' "$CUTOVER_DIR/manifest.apply.json"
```

O valor acima é um identificador de exemplo e deve ser substituído por uma chave já aprovada, nunca por um segredo.

Um apply com erro de lote, divergência bloqueante ou run `failed` retorna código diferente de zero.

Preserve o report, o manifest persistido, seus checksums, o run ID e o log de cada tentativa.

Não execute apply novamente para mascarar um erro.

Para retomar um run falho, corrija a causa, preserve o mesmo manifest e faça nova revisão antes de repetir.

## 7. Reconciliação técnica e funcional

Capture contagens e invariantes sem selecionar dados pessoais:

```bash
psql "$TEST_DATABASE_URL" --set ON_ERROR_STOP=1 <<'SQL' | tee "$CUTOVER_DIR/reconciliation.txt"
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

Confirme que o checksum do PDF persistido e o tamanho do objeto correspondem ao documento arquivado.

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

## 11. Política de documentos históricos, status e pedidos

A política selecionada é arquivar uma cópia imutável de cada PDF histórico válido no Vercel Blob antes do primeiro corte.

O objeto usa a chave determinística `quotations-migration/{businessNumber}/{sourceId}-{sha256}.pdf`.

O PDF deve conservar MIME `application/pdf`, tamanho, checksum SHA-256 e metadados da revisão de origem.

O sistema não deve regenerar o PDF histórico a partir do template atual depois do corte.

PDF ausente, corrompido, sem checksum verificável ou com checksum divergente bloqueia o apply e o canário.

A política de retenção de PDF é manter o objeto enquanto o orçamento ou sua lineage estiver retido, com exclusão somente por procedimento de arquivamento aprovado.

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

## 12. Rollback executável

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

Valide uma leitura de orçamento PostgreSQL conhecido, uma leitura de orçamento legado conhecido e uma nova escrita compatível encaminhada ao caminho aprovado.

Valide que nenhuma leitura PostgreSQL existente foi apagada ou mascarada.

Execute a leitura de rollback:

```bash
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

## 13. Evidências e encerramento

O corte só pode ser encerrado quando todos os artefatos abaixo estiverem no diretório protegido do corte:

- commit e status limpo;
- logs dos checks obrigatórios;
- checksum do backup e validação de restore;
- manifest dry-run e apply com hashes;
- divergências aprovadas ou contagem bloqueante zero;
- reconciliação técnica e funcional;
- evidência de bloqueio Frappe;
- resultados de PDF, link público, outbox, rotas e rollback;
- decisão de canário assinada pelo operador, revisor e responsável pelo negócio;
- estado efetivo e horário UTC após o último redeploy.

Se PostgreSQL de staging ou Playwright contra staging não estiver disponível, registre essa validação como não executada.

Não declare o primeiro subphase pronto com base em testes locais que não cobrem a dependência ausente.
