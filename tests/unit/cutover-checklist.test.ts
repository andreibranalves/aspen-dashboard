import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const runbookPath = resolve(root, 'docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md');
const operationalPath = resolve(root, 'docs/operational-cutoff-procedure.md');
const runbook = readFileSync(runbookPath, 'utf8');
const operational = readFileSync(operationalPath, 'utf8');

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
    '## 12. Rollback executável',
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
    'PDF ausente',
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
  ])
    assert.ok(
      runbook.toLocaleLowerCase().includes(marker.toLocaleLowerCase()),
      `missing policy: ${marker}`
    );
});

test('marker scan covers operational prose, excluding this test instructions', () => {
  const prose = [runbook, operational];
  const incompleteWords = ['TODO', 'FIXME', 'TBD', 'PLACEHOLDER', 'WIP'];
  for (const document of prose) {
    const words = document.toLocaleUpperCase().split(/[^A-Z0-9_]+/);
    for (const marker of incompleteWords)
      assert.equal(words.includes(marker), false, `incomplete marker: ${marker}`);
    assert.equal(document.includes('[]'), false, 'incomplete checklist marker');
  }
  assert.doesNotMatch(
    runbook,
    /(?:DATABASE_URL|TEST_DATABASE_URL|ERPNEXT_TOKEN)\s*=\s*(?:postgres(?:ql)?:|https?:\/\/|sk-)/i
  );
  assert.doesNotMatch(
    runbook,
    /(?:sk-[A-Za-z0-9]|Bearer\s+[A-Za-z0-9]{12,}|postgres(?:ql)?:\/\/[^$"\s]+)/i
  );
});
