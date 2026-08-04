import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isEmptyQuotationSections,
  snapshotFromLegacyRevision,
  templateSeedPlan,
} from '../../api/_db/quotation-template-migration.js';
import { acquireQuotationWriteLock } from '../../api/_db/quotation-write-lock.js';
import { parseQuotationSections } from '../../scripts/migrate-quotation-templates.mjs';

test('legacy revision receives a frozen sections snapshot', () => {
  const snapshot = snapshotFromLegacyRevision({
    pagamento: 'À vista',
    entrega: '3 dias',
    observacoes: 'Aprovar arte',
    prazoProducao: '10 dias úteis',
  });
  assert.equal(snapshot.pagamento.current.body, 'À vista');
  assert.match(snapshot.condicoes_gerais.current.body, /Prazo de entrega:/);
  assert.match(snapshot.condicoes_gerais.current.body, /Observações:/);
  assert.equal(snapshot.prazo_producao.current.title, 'Prazo de produção');
  assert.notStrictEqual(snapshot.pagamento.base, snapshot.pagamento.current);
  assert.notStrictEqual(snapshot.condicoes_gerais.base, snapshot.condicoes_gerais.current);
});

test('legacy snake_case deadline controls snapshot enablement', () => {
  assert.equal(snapshotFromLegacyRevision({ prazo_producao: '' }).prazo_producao.current.enabled, false);
  assert.equal(snapshotFromLegacyRevision({ prazo_producao: '10 dias' }).prazo_producao.current.enabled, true);
});

test('empty sections detection is semantic and preserves meaningful settings', () => {
  assert.equal(isEmptyQuotationSections({
    condicoes_gerais: { body: '', title: 'Condições Gerais', enabled: true },
    pagamento: { body: '', title: 'Pagamento', enabled: true },
    prazo_producao: { title: 'Prazo de produção', enabled: true },
    schema_version: 1,
  }), true);
  assert.equal(isEmptyQuotationSections({
    ...JSON.parse(JSON.stringify({ schema_version: 1, prazo_producao: { enabled: true, title: 'Prazo de produção' }, pagamento: { enabled: true, title: 'Pagamento', body: 'Pix' }, condicoes_gerais: { enabled: true, title: 'Condições Gerais', body: '' } })),
  }), false);
});

test('invalid quotation sections values are treated as empty', () => {
  for (const value of ['not-json', '"invalid-string"', { unknown: true }]) {
    assert.equal(isEmptyQuotationSections(parseQuotationSections(value)), true);
  }
});

test('postgres transaction lock adapter executes a tagged query', async () => {
  let called = false;
  const tx = (strings, ...values) => {
    called = strings.raw?.[0]?.includes('pg_advisory_xact_lock') && values.length === 0;
    return Promise.resolve();
  };
  await acquireQuotationWriteLock(tx);
  assert.equal(called, true);
});

test('built-in seed plan is stable and idempotent by key and hash', () => {
  const plan = templateSeedPlan();
  assert.ok(plan.length >= 3);
  assert.equal(new Set(plan.map((item) => item.key)).size, plan.length);
  for (const item of plan) assert.match(item.source_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(templateSeedPlan(), plan);
});
