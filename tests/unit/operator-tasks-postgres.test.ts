import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import { createPostgresOperatorTasksRepository } from '../../api/_infrastructure/db/repositories/operator-tasks-repository.js';
import { createTasksHandler } from '../../api/_modules/tasks.js';
import type { FunctionEvent } from '../../api/_http/types.js';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
// 12:00 UTC = 09:00 em São Paulo: "hoje" é 2098-08-10.
const NOW = new Date('2098-08-10T12:00:00.000Z');

function event(
  httpMethod: string,
  body?: unknown,
  queryStringParameters: Record<string, string> = {}
): FunctionEvent {
  return {
    httpMethod,
    headers: {},
    body: body === undefined ? '' : JSON.stringify(body),
    queryStringParameters,
  };
}

test('tarefas: cria só com título, agrupa atrasadas, vincula e conclui', { skip: !TEST_DATABASE_URL }, async () => {
  const client = postgres(TEST_DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  const repository = createPostgresOperatorTasksRepository(() => db as never, { now: () => NOW });
  const handler = createTasksHandler({ repository });
  const call = async (method: string, body?: unknown, query: Record<string, string> = {}) => {
    const response = await handler(event(method, body, query));
    return { statusCode: response.statusCode, body: JSON.parse(response.body || '{}') };
  };
  const tag = randomUUID().slice(0, 8);
  const clientId = randomUUID();
  const orderId = randomUUID();
  const orderNumber = `PED-2098-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
  const createdIds: string[] = [];
  try {
    await migrate(db, { migrationsFolder });
    await db.delete(schema.operatorTasks);
    await db.insert(schema.clients).values({ id: clientId, nome: `Cliente tarefa ${tag}` });
    await db.insert(schema.salesOrders).values({
      id: orderId,
      orderNumber,
      quotationId: null,
      clientId,
      status: 'To Deliver and Bill',
      transactionDate: '2098-08-10',
      subtotal: '10.00',
      grandTotal: '10.00',
    });

    const onlyTitle = await call('POST', { title: '  Ligar   para fornecedor  ' });
    assert.equal(onlyTitle.statusCode, 201);
    assert.equal(onlyTitle.body.task.title, 'Ligar para fornecedor');
    assert.equal(onlyTitle.body.task.due_on, null);
    assert.equal(onlyTitle.body.task.link, null);
    createdIds.push(onlyTitle.body.task.id);

    const overdue = await call('POST', { title: 'Cobrar sinal', due_on: '2098-08-09', sales_order_id: orderId });
    assert.equal(overdue.statusCode, 201);
    assert.deepEqual(overdue.body.task.link, { kind: 'sales_order', id: orderId, label: orderNumber });
    createdIds.push(overdue.body.task.id);

    const today = await call('POST', { title: 'Enviar arte', due_on: '2098-08-10', client_id: clientId });
    assert.deepEqual(today.body.task.link, { kind: 'client', id: clientId, label: `Cliente tarefa ${tag}` });
    createdIds.push(today.body.task.id);

    assert.equal((await call('POST', { title: '   ' })).statusCode, 400);
    assert.equal((await call('POST', { title: 'x', due_on: '2098-02-30' })).statusCode, 400);
    assert.equal((await call('POST', { title: 'x', sales_order_id: orderId, client_id: clientId })).statusCode, 400);
    assert.equal((await call('POST', { title: 'x', client_id: randomUUID() })).statusCode, 400);

    const list = await call('GET');
    assert.equal(list.statusCode, 200);
    assert.equal(list.body.today, '2098-08-10');
    assert.equal(list.body.overdue_count, 1);
    assert.deepEqual(
      list.body.tasks.map((task: { title: string }) => task.title),
      ['Cobrar sinal', 'Enviar arte', 'Ligar para fornecedor']
    );
    assert.deepEqual((await call('GET', undefined, { view: 'alerts' })).body, { success: true, overdue_count: 1 });

    const moved = await call('PATCH', { due_on: '2098-08-20' }, { id: overdue.body.task.id });
    assert.equal(moved.body.task.due_on, '2098-08-20');
    assert.deepEqual(moved.body.task.link?.kind, 'sales_order');
    assert.equal((await call('GET', undefined, { view: 'alerts' })).body.overdue_count, 0);

    const done = await call('PATCH', { action: 'complete' }, { id: today.body.task.id });
    assert.equal(done.statusCode, 200);
    assert.equal((await call('PATCH', { action: 'complete' }, { id: today.body.task.id })).statusCode, 404);
    const afterComplete = await call('GET');
    assert.ok(!afterComplete.body.tasks.some((task: { id: string }) => task.id === today.body.task.id));
    assert.equal((await call('PATCH', { action: 'bogus' }, { id: overdue.body.task.id })).statusCode, 400);
    assert.equal((await call('DELETE')).statusCode, 405);
  } finally {
    if (createdIds.length) {
      await db.delete(schema.operatorTasks).where(inArray(schema.operatorTasks.id, createdIds));
    }
    await db.delete(schema.salesOrders).where(inArray(schema.salesOrders.id, [orderId]));
    await db.delete(schema.clients).where(inArray(schema.clients.id, [clientId]));
    await client.end();
  }
});
