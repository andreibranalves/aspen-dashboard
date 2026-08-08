import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const runbookPath = resolve(root, 'docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md');
const operationalPath = resolve(root, 'docs/operational-cutoff-procedure.md');
const runbook = readFileSync(runbookPath, 'utf8');
const operational = readFileSync(operationalPath, 'utf8');
const backupScript = readFileSync(resolve(root, 'scripts/backup-crm.mjs'), 'utf8');
const migrationCli = readFileSync(resolve(root, 'scripts/migrate-frappe-crm.mjs'), 'utf8');
const playwrightConfig = readFileSync(resolve(root, 'playwright.config.js'), 'utf8');

const requiredCommands = [
  'npm run build:api',
  'npm run test:unit',
  'npm run lint',
  'npm run type-check',
  'npm run check:tailwind',
  'npm run build',
  'node scripts/backup-crm.mjs',
  'node scripts/backup-crm.mjs --validate',
  'node scripts/migrate-frappe-crm.mjs --dry-run',
  'node scripts/migrate-frappe-crm.mjs --apply',
  'npx playwright test --config=playwright.config.js',
];

test('runbook contains executable preconditions and migration phases', () => {
  for (const command of requiredCommands)
    assert.ok(runbook.includes(command), `missing command: ${command}`);
  for (const heading of [
    '## 4. Banco de staging, backup e restore',
    '## 5. Snapshot, dry-run e manifest',
    '## 6. Ordem de dependências e apply',
    '### Delta final antes do apply',
    '## 7. Reconciliação técnica e funcional',
    '## 8. Bloqueio de chamadas Frappe e congelamento',
    '## 10. Canário',
    '## 11. Worker de outbox e monitoramento',
    '## 13. Rollback executável',
  ])
    assert.ok(runbook.includes(heading), `missing heading: ${heading}`);
});

test('runbook defines every rollout state and rejects flag-only rollback', () => {
  for (const state of ['legacy', 'postgres-write', 'postgres-read-only', 'rollback-compatible']) {
    assert.ok(runbook.includes(`\`${state}\``));
    assert.ok(operational.includes(`\`${state}\``));
  }
  assert.ok(runbook.includes('CRM_CORE_QUOTES_ENABLED=false'));
  assert.ok(runbook.includes('não desfaz escritas PostgreSQL'));
  assert.ok(runbook.includes('não é rollback suficiente'));
});

test('runbook includes abort, document, status, order and lineage policies', () => {
  for (const marker of [
    'business number duplicado',
    'divergência financeira',
    'template ou outra pré-condição órfã',
    'PDF atual exigido',
    'chamada Frappe inesperada',
    'lote com estado `failed`',
    'teste de segurança de link público externo falhar',
    'leitura de rollback',
    'order_linkage',
    'order_pending',
    'legacy_payload',
    'rascunho',
    'enviado',
    'aprovado',
    'perdido',
    'PDF on-demand',
    'approvedDivergenceKeys',
    'RESTORE_DATABASE_URL',
    'CUTOVER_PG_SERVICE',
    'PGSERVICEFILE',
    'EXPECTED_DATABASE',
    'current_database()',
    'manifest.apply.persisted.sha256',
    'sha256sum --check',
    'exit 1',
    'PUT in rollback-compatible writes to legacy',
  ])
    assert.ok(
      runbook.toLocaleLowerCase().includes(marker.toLocaleLowerCase()),
      `missing policy: ${marker}`
    );
});

test('marker scan covers operational prose, excluding this test instructions', () => {
  const prose = [runbook, operational];
  const incompleteWords = ['TODO', 'FIXME', 'TBD', 'PLACEHOLDER', 'WIP'];
  const secretMarker =
    /(?:DATABASE_URL|TEST_DATABASE_URL|RESTORE_DATABASE_URL|ERPNEXT_TOKEN)\s*=\s*(?:postgres(?:ql)?:|https?:\/\/|sk-)/i;
  const secretValue = /(?:sk-[A-Za-z0-9]|Bearer\s+[A-Za-z0-9]{12,}|postgres(?:ql)?:\/\/[^$"\s]+)/i;
  for (const document of prose) {
    const words = document.toLocaleUpperCase().split(/[^A-Z0-9_]+/);
    for (const marker of incompleteWords)
      assert.equal(words.includes(marker), false, `incomplete marker: ${marker}`);
    assert.equal(document.includes('[ ]'), false, 'incomplete checklist marker');
    assert.equal(document.includes('[]'), false, 'incomplete checklist marker');
    assert.doesNotMatch(document, secretMarker);
    assert.doesNotMatch(document, secretValue);
    assert.doesNotMatch(
      document,
      /psql\s+["']?\$(?:DATABASE_URL|TEST_DATABASE_URL|RESTORE_DATABASE_URL)/
    );
  }
});

test('delta comparison uses stable manifest hash and aborts real changes', () => {
  assert.match(runbook, /BASE_MANIFEST_HASH=.*manifest\.manifestHash/);
  assert.match(runbook, /DELTA_MANIFEST_HASH=.*manifest\.manifestHash/);
  assert.match(runbook, /if \[ "\$BASE_MANIFEST_HASH" != "\$DELTA_MANIFEST_HASH" \]/);
  assert.match(runbook, /ABORT: source delta changed/);
  assert.match(runbook, /ABORT: source delta changed[\s\S]*exit 1/);
});

test('service contract and repository root are exported before Node checks', () => {
  const preflight = runbook.slice(runbook.indexOf('## 2.'), runbook.indexOf('## 3.'));
  const reconciliation = runbook.slice(runbook.indexOf('## 7.'), runbook.indexOf('## 8.'));
  for (const section of [preflight, reconciliation]) {
    assert.match(section, /set -euo pipefail/);
    assert.match(section, /: "\$\{CUTOVER_PG_SERVICE:\?[^\"]+\}"[\s\S]*export CUTOVER_PG_SERVICE/);
    assert.match(section, /: "\$\{REPO_ROOT:\?[^\"]+\}"[\s\S]*cd "\$REPO_ROOT"[\s\S]*node --input-type=module <<'NODE'[\s\S]*assertDatabaseContract\(process\.env\)/);
  }
  assert.match(
    preflight,
    /export CUTOVER_PG_SERVICE[\s\S]*cd "\$REPO_ROOT"[\s\S]*node --input-type=module/
  );
  assert.match(
    reconciliation,
    /export CUTOVER_PG_SERVICE[\s\S]*cd "\$REPO_ROOT"[\s\S]*node --input-type=module/
  );
});

test('supporting scripts fail closed and emit verifiable migration artifacts', () => {
  assert.match(backupScript, /RESTORE_DATABASE_URL/);
  assert.match(backupScript, /delete env\.TEST_DATABASE_URL/);
  assert.match(backupScript, /TEST_DATABASE_URL: ''/);
  assert.match(backupScript, /--file/);
  assert.match(backupScript, /alvo isolado diferente/);
  assert.doesNotMatch(backupScript, /issued_documents/);
  assert.doesNotMatch(backupScript, /function runValidate[\s\S]*getDatabaseUrl\('DATABASE_URL'\)/);
  assert.match(migrationCli, /normalizedMode === 'apply' && fixture/);
  assert.match(migrationCli, /mode === 'apply' && process\.env\.FRAPPE_MIGRATION_FIXTURE/);
  assert.match(migrationCli, /assertDatabaseContract/);
  assert.match(migrationCli, /readPgServiceTarget/);
  assert.match(migrationCli, /PGSERVICEFILE/);
  assert.match(migrationCli, /approvedDivergenceKeys/);
  assert.match(migrationCli, /manifest: result\.manifest/);
  assert.match(migrationCli, /expected-manifest-hash/);
  assert.match(runbook, /STAGING_DATABASE_URL/);
  assert.match(runbook, /TEST_DATABASE_URL="\$STAGING_DATABASE_URL"/);
  const applySection = runbook.slice(
    runbook.indexOf('Execute o apply contra a base autorizada'),
    runbook.indexOf('Se houver uma divergência de baixo risco previamente aprovada')
  );
  assert.match(applySection, /export CUTOVER_PG_SERVICE PGSERVICEFILE PGPASSFILE/);
  assert.match(applySection, /assertDatabaseContract\(process\.env\)/);
  assert.match(playwrightConfig, /process\.env\.BASE_URL/);
  assert.match(runbook, /set -euo pipefail/);
  assert.doesNotMatch(runbook, /set -eu\n/);
});
