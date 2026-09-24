import assert from 'node:assert/strict';
import test from 'node:test';

import {
  routeTaskContext,
  taskGroup,
  taskLinkRoute,
  type OperatorTask,
} from '../../src/features/tasks/taskRules.ts';

const base: OperatorTask = { id: 't1', title: 'x', due_on: null, link: null, created_at: '' };
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

test('taskGroup separa atrasadas, hoje, próximas e sem data', () => {
  const today = '2098-08-10';
  assert.equal(taskGroup(base, today), 'undated');
  assert.equal(taskGroup({ ...base, due_on: '2098-08-09' }, today), 'overdue');
  assert.equal(taskGroup({ ...base, due_on: today }, today), 'today');
  assert.equal(taskGroup({ ...base, due_on: '2098-08-11' }, today), 'upcoming');
});

test('vínculo abre o pedido ou o cliente e a rota atual sugere o vínculo', () => {
  assert.equal(taskLinkRoute({ kind: 'sales_order', id: ID, label: 'P' }), `/sales-orders/${ID}`);
  assert.equal(taskLinkRoute({ kind: 'client', id: ID, label: 'C' }), `/leads/cliente/${ID}`);
  assert.deepEqual(routeTaskContext(`/sales-orders/${ID}?tab=x`), { kind: 'sales_order', id: ID });
  assert.deepEqual(routeTaskContext(`/leads/cliente/${ID}`), { kind: 'client', id: ID });
  assert.equal(routeTaskContext('/sales-orders'), null);
  assert.equal(routeTaskContext('/sales-orders/PED-1'), null);
});
