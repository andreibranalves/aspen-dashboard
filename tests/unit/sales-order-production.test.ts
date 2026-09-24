import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addProductionBusinessDays,
  isProductionBusinessDay,
  productionBusinessDaysBetween,
} from '../../api/_shared/calendar-sao-paulo.js';
import {
  atRiskThreshold,
  billedPercent,
  defaultDepositAmount,
  nextProductionStage,
  productionDeadline,
  productionTimeline,
  receivedAmount,
  stageReached,
} from '../../api/_modules/sales-order-production.js';

test('prazo final soma dias úteis de produção pulando fim de semana e feriados nacionais', () => {
  // 15/11 (domingo) e 20/11 (sexta) caem no intervalo.
  assert.equal(productionDeadline('2026-11-10', 20), '2026-12-09');
  assert.equal(addProductionBusinessDays('2026-12-24', 1), '2026-12-28');
  assert.equal(isProductionBusinessDay('2026-04-03'), false, 'Sexta-feira Santa');
  assert.equal(isProductionBusinessDay('2026-04-21'), false, 'Tiradentes');
  assert.equal(isProductionBusinessDay('2026-11-20'), false, 'Consciência Negra');
});

test('Carnaval e Corpus Christi contam como dias úteis', () => {
  assert.equal(isProductionBusinessDay('2026-02-16'), true);
  assert.equal(isProductionBusinessDay('2026-02-17'), true);
  assert.equal(isProductionBusinessDay('2026-06-04'), true);
  assert.equal(addProductionBusinessDays('2026-02-13', 2), '2026-02-17');
});

test('dias úteis entre datas contam o intervalo (início, fim]', () => {
  assert.equal(productionBusinessDaysBetween('2026-11-10', '2026-12-09'), 20);
  assert.equal(productionBusinessDaysBetween('2026-11-10', '2026-11-10'), 0);
  assert.equal(productionBusinessDaysBetween('2026-11-10', '2026-11-01'), 0);
});

test('etapas só avançam', () => {
  assert.equal(nextProductionStage('aguardando_entrada'), 'aguardando_arte');
  assert.equal(nextProductionStage('pronto'), 'entregue');
  assert.equal(nextProductionStage('entregue'), null);
  assert.equal(stageReached('em_producao', 'aguardando_arte'), true);
  assert.equal(stageReached('aguardando_arte', 'em_producao'), false);
});

test('em risco a partir de 75% do prazo, atrasado depois do prazo final, pronto encerra', () => {
  assert.equal(atRiskThreshold(20), 15);
  assert.equal(atRiskThreshold(10), 8);
  const facts = {
    stage: 'em_producao' as const,
    artApprovedOn: '2026-11-10',
    deadline: '2026-12-09',
    readyOn: null,
    stageChangedOn: '2026-11-10',
  };
  // 14 dias úteis consumidos em 01/12; 15 em 02/12.
  assert.equal(productionTimeline(facts, '2026-12-01').state, 'no_prazo');
  const atRisk = productionTimeline(facts, '2026-12-02');
  assert.equal(atRisk.state, 'em_risco');
  assert.equal(atRisk.elapsed_days, 15);
  assert.equal(atRisk.total_days, 20);
  assert.equal(productionTimeline(facts, '2026-12-09').state, 'em_risco');
  assert.equal(productionTimeline(facts, '2026-12-10').state, 'atrasado');
  const ready = productionTimeline(
    { ...facts, stage: 'pronto', readyOn: '2026-12-01' },
    '2026-12-20'
  );
  assert.equal(ready.state, 'concluido');
  assert.equal(ready.elapsed_days, 14);
});

test('aguardando entrada e arte mostram dias parados sem contar prazo', () => {
  const waiting = productionTimeline(
    {
      stage: 'aguardando_arte',
      artApprovedOn: null,
      deadline: null,
      readyOn: null,
      stageChangedOn: '2026-11-10',
    },
    '2026-11-14'
  );
  assert.equal(waiting.state, 'sem_prazo');
  assert.equal(waiting.stalled_days, 4);
  assert.equal(waiting.deadline, null);
});

test('recebido e percentual faturado derivam da entrada e do saldo', () => {
  assert.equal(defaultDepositAmount(123.45), 61.73);
  assert.equal(receivedAmount(100, 50, null), 50);
  assert.equal(receivedAmount(100, 50, '2026-11-10'), 100);
  assert.equal(receivedAmount(100, null, null), 0);
  assert.equal(billedPercent(100, 50, null), 50);
  assert.equal(billedPercent(100, 50, '2026-11-10'), 100);
  assert.equal(billedPercent(0, 0, null), 0);
});
