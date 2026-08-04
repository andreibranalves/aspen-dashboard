import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  snapshotFromLegacyRevision,
  templateSeedPlan,
} from '../../api/_db/quotation-template-migration.js';

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
  assert.notStrictEqual(snapshot.pagamento.base, snapshot.pagamento.current);
});

test('built-in seed plan is stable and idempotent by key and hash', () => {
  const plan = templateSeedPlan();
  assert.ok(plan.length >= 3);
  assert.equal(new Set(plan.map((item) => item.key)).size, plan.length);
  for (const item of plan) assert.match(item.source_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(templateSeedPlan(), plan);
});
