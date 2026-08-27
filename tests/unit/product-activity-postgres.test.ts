import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';

import {
  createPostgresProductActivityRepository,
  appendProductActivityEvents,
  type ProductActivityEventInput,
  type ProductActivityRecord,
  type ProductActivityRepository,
} from '../../api/_infrastructure/db/repositories/product-activity-repository.js';
import { products, productActivityEvents } from '../../api/_infrastructure/db/schema.js';
import { createHandler } from '../../api/_modules/product-activity.js';
import * as schema from '../../api/_infrastructure/db/schema.js';

import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env, ['TEST_ACTIVITY_DATABASE_URL', 'TEST_DATABASE_URL']);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);

function event(method: string, body?: unknown, query: Record<string, string> = {}) {
  return {
    httpMethod: method,
    body: body === undefined ? '' : JSON.stringify(body),
    headers: {},
    queryStringParameters: query,
  } as any;
}

function parse(result: { body?: string }) {
  return JSON.parse(result.body || '{}') as Record<string, any>;
}

class MemoryActivityRepository implements ProductActivityRepository {
  private rows: ProductActivityRecord[] = [];
  lastLimit = 0;

  async appendMany(events: readonly ProductActivityEventInput[]): Promise<void> {
    this.rows.push(...events.map((row, index) => ({
      sku: row.sku,
      tipo: row.tipo,
      texto: row.texto,
      reference_id: row.reference_id ?? row.referenceId ?? null,
      id: `activity-${this.rows.length + index + 1}`,
      data: new Date(0).toISOString(),
    })));
  }

  async list(sku: string, limit: number): Promise<ProductActivityRecord[]> {
    this.lastLimit = limit;
    return this.rows.filter((row) => row.sku === sku).slice(-limit).reverse();
  }
}

test('returns an empty local activity stream for a new SKU', async () => {
  const repository = new MemoryActivityRepository();
  const handler = createHandler({ repository });
  const result = await handler(event('GET', undefined, { sku: 'SKU-NEW' }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(parse(result), { sku: 'SKU-NEW', atividades: [] });
});

test('records a price change and returns it newest first', async () => {
  const repository = new MemoryActivityRepository();
  const handler = createHandler({ repository });
  await repository.appendMany([{ sku: 'SKU-1', tipo: 'preco', texto: 'Preço atualizado' }]);
  const rows = await repository.list('SKU-1', 3);
  assert.equal(rows[0].tipo, 'preco');
  assert.deepEqual(parse(await handler(event('GET', undefined, { sku: 'SKU-1' }))).atividades[0], {
    tipo: 'preco',
    texto: 'Preço atualizado',
    data: rows[0].data,
    id: rows[0].id,
  });
});

test('persists ordering, limit and transaction rollback in disposable PostgreSQL', { skip: !TEST_DATABASE_URL }, async () => {
  const client = postgres(TEST_DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  const concurrentClientA = postgres(TEST_DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => {},
  });
  const concurrentClientB = postgres(TEST_DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => {},
  });
  const concurrentDbA = drizzle(concurrentClientA, { schema });
  const concurrentDbB = drizzle(concurrentClientB, { schema });
  const sku = `TEST-ACTIVITY-${Date.now()}`;
  const repository = createPostgresProductActivityRepository(() => db);

  try {
    await migrate(db, { migrationsFolder });
    await db.insert(products).values({ sku, nome: 'Produto de atividade' });

    await repository.appendMany([
      { sku, tipo: 'produto', texto: 'Produto criado', reference_id: `${sku}:create` },
      { sku, tipo: 'preco', texto: 'Preço atualizado', reference_id: `${sku}:price` },
      { sku, tipo: 'orcamento', texto: 'Orçamento ORC-20260001 criado', reference_id: `${sku}:quote` },
    ]);
    const rows = await repository.list(sku, 2);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].tipo, 'orcamento');
    assert.equal(rows[1].tipo, 'preco');

    await assert.rejects(
      () => db.transaction(async (tx) => {
        await appendProductActivityEvents(tx, [{
          sku,
          tipo: 'pedido',
          texto: 'Pedido PED-2026-0001 criado',
          reference_id: `${sku}:order-rollback`,
        }]);
        throw new Error('rollback activity test');
      }),
      /rollback activity test/,
    );
    assert.equal((await repository.list(sku, 20)).some((row) => row.tipo === 'pedido'), false);

    await repository.appendMany([{ sku, tipo: 'pedido', texto: 'Pedido PED-2026-0001 criado', reference_id: `${sku}:order` }]);
    await repository.appendMany([{ sku, tipo: 'pedido', texto: 'Pedido PED-2026-0001 criado', reference_id: `${sku}:order` }]);
    assert.equal((await repository.list(sku, 20)).filter((row) => row.reference_id === `${sku}:order`).length, 1);

    const concurrentReference = `${sku}:concurrent`;
    await Promise.all([
      createPostgresProductActivityRepository(() => concurrentDbA).appendMany([{
        sku,
        tipo: 'pedido',
        texto: 'Pedido concorrente A',
        reference_id: concurrentReference,
      }]),
      createPostgresProductActivityRepository(() => concurrentDbB).appendMany([{
        sku,
        tipo: 'pedido',
        texto: 'Pedido concorrente B',
        reference_id: concurrentReference,
      }]),
    ]);
    const concurrentRows = (await repository.list(sku, 50)).filter(
      (row) => row.reference_id === concurrentReference,
    );
    assert.equal(concurrentRows.length, 1);

    await repository.appendMany([
      { sku, tipo: 'pedido', texto: 'Pedido legítimo 1', reference_id: `${sku}:distinct:1` },
      { sku, tipo: 'pedido', texto: 'Pedido legítimo 2', reference_id: `${sku}:distinct:2` },
    ]);
    const distinctRows = (await repository.list(sku, 50)).filter((row) => row.reference_id?.startsWith(`${sku}:distinct:`));
    assert.equal(distinctRows.length, 2);
  } finally {
    await db.delete(productActivityEvents).where(eq(productActivityEvents.productSku, sku)).catch(() => undefined);
    await db.delete(products).where(eq(products.sku, sku)).catch(() => undefined);
    await Promise.all([
      client.end({ timeout: 5 }),
      concurrentClientA.end({ timeout: 5 }),
      concurrentClientB.end({ timeout: 5 }),
    ]);
  }
});

test('returns Portuguese validation errors', async () => {
  const repository = new MemoryActivityRepository();
  const handler = createHandler({ repository });
  assert.equal((await handler(event('GET'))).statusCode, 400);
  assert.match(parse(await handler(event('GET'))).error, /SKU/);
  for (const limit of ['abc', '10abc', '0', '-1', '1.5', '']) {
    const result = await handler(event('GET', undefined, { sku: 'SKU-1', limit }));
    assert.equal(result.statusCode, 400);
    assert.match(parse(result).error, /Limite/);
  }
  const bounded = await handler(event('GET', undefined, { sku: 'SKU-1', limit: '999' }));
  assert.equal(bounded.statusCode, 200);
  assert.equal(repository.lastLimit, 20);
  await handler(event('GET', undefined, { sku: 'SKU-1' }));
  assert.equal(repository.lastLimit, 10);
  assert.equal((await handler(event('POST', undefined, { sku: 'SKU-1' }))).statusCode, 405);
});
