import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_db/schema.js';
import { createPostgresCrmDealRepository } from '../../api/_db/crm-deals-repository.js';
import type { FunctionEvent } from '../../api/_http/types.js';
import { createCrmDealsHandler } from '../../api/_functions/crm-deals.js';
import { createCrmUpdateDealHandler } from '../../api/_functions/crm-update-deal.js';
import { createCrmPruneCandidatesHandler } from '../../api/_functions/crm-prune-candidates.js';
import {
  CRM_PIPELINE,
  type CrmDealRecord,
  type CrmDealRepository,
} from '../../api/_db/crm-deals-repository.js';

const NOW = new Date('2026-08-10T12:00:00.000Z');
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);

function deal(overrides: Partial<CrmDealRecord> = {}): CrmDealRecord {
  return {
    id: 'deal-1',
    quoteLeadId: null,
    clientId: null,
    quotationId: 'quotation-1',
    nome: 'Ana',
    email: 'ana@example.com',
    telefone: '5511999990000',
    status: 'Novo Lead',
    followUpStage: 0,
    nextStep: null,
    lostReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    quotation: 'ORC-20260001',
    ...overrides,
  };
}

function memoryRepository(seed: CrmDealRecord[]): CrmDealRepository & { rows: CrmDealRecord[] } {
  const rows = seed.map((row) => ({ ...row }));
  return {
    rows,
    async list({ search = '', limit = 500 }) {
      const needle = search.trim().toLocaleLowerCase('pt-BR');
      return rows
        .filter(
          (row) =>
            !needle ||
            [row.nome, row.email, row.telefone, row.quotation]
              .filter(Boolean)
              .some((value) => String(value).toLocaleLowerCase('pt-BR').includes(needle))
        )
        .slice(0, limit);
    },
    async updateStatus(id, patch) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) return null;
      Object.assign(row, {
        status: patch.status,
        followUpStage: patch.followUpStage == null ? 0 : patch.followUpStage,
        updatedAt: NOW,
      });
      return row;
    },
    async upsertForQuotation(input) {
      const row = deal({
        id: typeof input.id === 'string' ? input.id : `deal-${rows.length + 1}`,
        quotationId: typeof input.quotationId === 'string' ? input.quotationId : null,
        nome: typeof input.nome === 'string' ? input.nome : 'Sem nome',
        email: typeof input.email === 'string' ? input.email : null,
        telefone: typeof input.telefone === 'string' ? input.telefone : null,
      });
      rows.push(row);
      return row;
    },
    async prune() {
      return { success: true, updated: 0, skipped: 0, skipped_deals: [] };
    },
  };
}

function event(
  httpMethod: string,
  body?: unknown,
  queryStringParameters?: Record<string, string>
): FunctionEvent {
  return {
    httpMethod,
    headers: {},
    body: body === undefined ? '' : JSON.stringify(body),
    queryStringParameters: queryStringParameters || {},
  };
}

test('groups local deals into canonical Kanban columns without external fetches', async () => {
  const repository = memoryRepository([
    deal({ id: 'ana', nome: 'Ana', status: 'Novo Lead' }),
    deal({ id: 'bruno', nome: 'Bruno', email: 'bruno@example.com', status: 'Status Extra' }),
    deal({ id: 'carla', nome: 'Carla', email: 'carla@example.com', status: 'Outro Extra' }),
  ]);
  const handler = createCrmDealsHandler({ repository });

  const result = await handler(event('GET', undefined, { search: 'aNA' }));
  const body = JSON.parse(result.body || '');

  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    body.columns.slice(0, CRM_PIPELINE.length).map((column: { status: string }) => column.status),
    CRM_PIPELINE
  );
  assert.equal(body.columns[0].deals[0].lead_name, 'Ana');
  assert.equal(body.columns[0].deals[0].quotation, 'ORC-20260001');
  assert.equal(body.meta.total_deals, 1);
  assert.equal(body.meta.stages, 1);
});

test('keeps unknown local statuses after canonical columns in alphabetical order', async () => {
  const repository = memoryRepository([
    deal({ id: 'z', status: 'Zeta' }),
    deal({ id: 'a', status: 'Alfa' }),
  ]);
  const handler = createCrmDealsHandler({ repository });

  const result = await handler(event('GET'));
  const body = JSON.parse(result.body || '');

  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    body.columns.slice(-2).map((column: { status: string }) => column.status),
    ['Alfa', 'Zeta']
  );
});

test('updates a local status and follow-up stage through the handler', async () => {
  const repository = memoryRepository([deal()]);
  const handler = createCrmUpdateDealHandler({ repository });

  const result = await handler(
    event('PUT', {
      deal_id: 'deal-1',
      status: 'Perdido',
      follow_up_stage: 2,
    })
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || ''), {
    success: true,
    deal_id: 'deal-1',
    status: 'Perdido',
  });
  assert.equal(repository.rows[0].status, 'Perdido');
  assert.equal(repository.rows[0].followUpStage, 2);
});

test('returns Brazilian Portuguese errors for unsupported CRM methods', async () => {
  const repository = memoryRepository([]);
  const handlers = [
    createCrmDealsHandler({ repository }),
    createCrmUpdateDealHandler({ repository }),
    createCrmPruneCandidatesHandler({ repository }),
  ];
  const results = await Promise.all(handlers.map((handler) => handler(event('PATCH'))));

  for (const result of results) {
    assert.equal(result.statusCode, 405);
    assert.equal(JSON.parse(result.body || '').error, 'Método não permitido.');
  }
});

test(
  'returns the same active deal for concurrent quotation upserts in PostgreSQL',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const connectionOptions = {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    } as const;
    const clientA = postgres(TEST_DATABASE_URL!, connectionOptions);
    const clientB = postgres(TEST_DATABASE_URL!, connectionOptions);
    const barrierClient = postgres(TEST_DATABASE_URL!, connectionOptions);
    const monitorClient = postgres(TEST_DATABASE_URL!, connectionOptions);
    const dbA = drizzle(clientA, { schema });
    const dbB = drizzle(clientB, { schema });
    const clientId = randomUUID();
    const quotationId = randomUUID();
    const businessNumber = `ORC-2099${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
    let barrierHeld = false;
    let concurrent: Promise<CrmDealRecord[]> | undefined;
    try {
      await migrate(dbA, { migrationsFolder });
      await dbA.insert(schema.clients).values({
        id: clientId,
        nome: 'Cliente Concorrente',
        email: 'cliente-concorrente@example.com',
        telefone: '5511999990000',
      });
      await dbA.insert(schema.quotations).values({
        id: quotationId,
        clientId,
        businessNumber,
        status: 'enviado',
        createdAt: NOW,
        updatedAt: NOW,
      });

      const repositoryA = createPostgresCrmDealRepository(() => dbA, { now: () => NOW });
      const repositoryB = createPostgresCrmDealRepository(() => dbB, { now: () => NOW });
      await barrierClient.unsafe('BEGIN');
      barrierHeld = true;
      await barrierClient.unsafe('LOCK TABLE "crm_deals" IN SHARE MODE');
      concurrent = Promise.all([
        repositoryA.upsertForQuotation({
          quotationId,
          nome: 'Concorrente A',
          email: 'concorrente-a@example.com',
        }),
        repositoryB.upsertForQuotation({
          quotationId,
          nome: 'Concorrente B',
          email: 'concorrente-b@example.com',
        }),
      ]);
      let blockedInserts = 0;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [{ count }] = await monitorClient.unsafe<{ count: number }[]>(
          `
            SELECT count(*)::int AS count
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND query LIKE '%insert into "crm_deals"%'
              AND wait_event_type = 'Lock'
          `
        );
        blockedInserts = count;
        if (blockedInserts >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(blockedInserts, 2);
      await barrierClient.unsafe('COMMIT');
      barrierHeld = false;
      const [first, second] = await concurrent;

      assert.equal(first.id, second.id);
      assert.notEqual(first.status, 'Perdido');
      const rows = await dbA
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.quotationId, quotationId));
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0]?.status, 'Perdido');
    } finally {
      if (concurrent) await concurrent.catch(() => undefined);
      if (barrierHeld) await barrierClient.unsafe('ROLLBACK').catch(() => undefined);
      await dbA.delete(schema.crmDeals).where(eq(schema.crmDeals.quotationId, quotationId));
      await dbA.delete(schema.quotations).where(eq(schema.quotations.id, quotationId));
      await dbA.delete(schema.clients).where(eq(schema.clients.id, clientId));
      await Promise.all([
        clientA.end({ timeout: 5 }),
        clientB.end({ timeout: 5 }),
        barrierClient.end({ timeout: 5 }),
        monitorClient.end({ timeout: 5 }),
      ]);
    }
  }
);

test(
  'persists local deals and revalidates active orders in PostgreSQL',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const clientId = randomUUID();
    const quotationId = randomUUID();
    const revisionId = randomUUID();
    const dealId = randomUUID();
    const boundaryQuotationId = randomUUID();
    const boundaryDealId = randomUUID();
    const orderId = randomUUID();
    const businessSequence = Math.floor(Math.random() * 9999);
    const businessNumber = `ORC-2099${String(businessSequence).padStart(4, '0')}`;
    const boundaryBusinessNumber = `ORC-2099${String(businessSequence + 1).padStart(4, '0')}`;
    const old = new Date('2026-07-01T12:00:00.000Z');
    const underThirtyElapsedDays = new Date('2026-07-11T13:00:00.000Z');
    try {
      await migrate(db, { migrationsFolder });
      await db.insert(schema.clients).values({
        id: clientId,
        nome: 'Ana PostgreSQL',
        email: 'ana.pg@example.com',
        telefone: '5511999990000',
      });
      await db.insert(schema.quotations).values({
        id: quotationId,
        businessNumber,
        clientId,
        status: 'enviado',
        createdAt: old,
        updatedAt: old,
      });
      await db.insert(schema.quoteRevisions).values({
        id: revisionId,
        quotationId,
        version: 1,
        status: 'enviado',
        validadeDias: 15,
        clienteNome: 'Ana PostgreSQL',
        subtotal: '100.00',
        total: '100.00',
        createdAt: old,
      });
      await db.insert(schema.crmDeals).values({
        id: dealId,
        clientId,
        quotationId,
        nome: 'Ana PostgreSQL',
        email: 'ana.pg@example.com',
        telefone: '5511999990000',
        status: 'Orcamento Enviado',
        createdAt: old,
        updatedAt: old,
      });
      await db.insert(schema.quotations).values({
        id: boundaryQuotationId,
        businessNumber: boundaryBusinessNumber,
        clientId,
        status: 'enviado',
        createdAt: underThirtyElapsedDays,
        updatedAt: underThirtyElapsedDays,
      });
      await db.insert(schema.crmDeals).values({
        id: boundaryDealId,
        clientId,
        quotationId: boundaryQuotationId,
        nome: 'Ana Limite',
        email: 'ana.limite@example.com',
        telefone: '5511999990000',
        status: 'Orcamento Enviado',
        createdAt: underThirtyElapsedDays,
        updatedAt: old,
      });

      const repository = createPostgresCrmDealRepository(() => db, { now: () => NOW });
      const listed = await repository.list({ search: 'ANA.PG@' });
      assert.equal(listed[0]?.quotation, businessNumber);
      const upserted = await repository.upsertForQuotation({
        quotationId,
        nome: 'Ana PostgreSQL Atualizada',
        email: 'ANA.PG@EXAMPLE.COM',
      });
      assert.equal(upserted.id, dealId);
      assert.equal(upserted.nome, 'Ana PostgreSQL Atualizada');
      await db
        .update(schema.crmDeals)
        .set({ updatedAt: old })
        .where(eq(schema.crmDeals.id, dealId));
      assert.equal((await repository.listPruneCandidates!(NOW)).length, 1);
      assert.deepEqual(await repository.prune([boundaryDealId], NOW), {
        success: true,
        updated: 0,
        skipped: 1,
        skipped_deals: [
          {
            deal_id: boundaryDealId,
            reason: 'Orçamento não está mais elegível para limpeza.',
          },
        ],
      });

      const pruned = await repository.prune([dealId], NOW);
      assert.equal(pruned.updated, 1);
      const [lost] = await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.id, dealId));
      assert.equal(lost?.status, 'Perdido');
      assert.equal(
        lost?.nextStep,
        'Marcado como perdido por limpeza de pipeline: sem resposta após 30 dias.'
      );

      await db.insert(schema.salesOrders).values({
        id: orderId,
        orderNumber: 'PED-2099-0001',
        quotationId,
        quotationRevisionId: revisionId,
        clientId,
        status: 'Draft',
        transactionDate: '2026-08-10',
        subtotal: '100.00',
        grandTotal: '100.00',
      });
      await db
        .update(schema.crmDeals)
        .set({ status: 'Orcamento Enviado', updatedAt: old })
        .where(eq(schema.crmDeals.id, dealId));
      const skipped = await repository.prune([dealId], NOW);
      assert.deepEqual(skipped.skipped_deals, [
        { deal_id: dealId, reason: 'Pedido criado após a listagem.' },
      ]);
    } finally {
      await db.delete(schema.salesOrders).where(eq(schema.salesOrders.id, orderId));
      await db.delete(schema.crmDeals).where(eq(schema.crmDeals.id, boundaryDealId));
      await db.delete(schema.crmDeals).where(eq(schema.crmDeals.id, dealId));
      await db.delete(schema.quotations).where(eq(schema.quotations.id, boundaryQuotationId));
      await db.delete(schema.quotations).where(eq(schema.quotations.id, quotationId));
      await db.delete(schema.clients).where(eq(schema.clients.id, clientId));
      await client.end({ timeout: 5 });
    }
  }
);
