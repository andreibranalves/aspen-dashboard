import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { eq } from 'drizzle-orm';
import {
  ensureFixtureTemplateVersion,
  type FixtureRevisionFields,
} from '../fixtures/quotation-revision-seeds.ts';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import { createPostgresCrmDealRepository } from '../../api/_infrastructure/db/repositories/crm-deals-repository.js';
import type { CrmPipelineStageRepository } from '../../api/_infrastructure/db/repositories/crm-pipeline-stages-repository.js';
import { createPostgresCrmPipelineStageRepository } from '../../api/_infrastructure/db/repositories/crm-pipeline-stages-repository.js';
import type { FunctionEvent } from '../../api/_http/types.js';
import { createCrmDealsHandler } from '../../api/_modules/crm-deals.js';
import { createCrmUpdateDealHandler } from '../../api/_modules/crm-update-deal.js';
import { createCrmPruneCandidatesHandler } from '../../api/_modules/crm-prune-candidates.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';
import {
  CRM_PIPELINE,
  type CrmDealRecord,
  type CrmDealRepository,
} from '../../api/_infrastructure/db/repositories/crm-deals-repository.js';

const NOW = new Date('2026-08-10T12:00:00.000Z');
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
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

function memoryPipelineRepository(): CrmPipelineStageRepository {
  const rows = CRM_PIPELINE.map((key, position) => ({
    key,
    name: key,
    position,
    role: null,
    dealCount: 0,
  }));
  return {
    async list() {
      return rows;
    },
    async create() {
      throw new Error('not used');
    },
    async rename() {
      throw new Error('not used');
    },
    async reorder() {
      throw new Error('not used');
    },
    async remove() {
      throw new Error('not used');
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
    deal({
      id: 'ana',
      nome: 'Ana',
      clientId: 'client-ana',
      quoteLeadId: null,
      quotationId: '11111111-1111-4111-8111-111111111101',
      status: 'Novo Lead',
    }),
    deal({
      id: 'bruno',
      nome: 'Bruno',
      email: 'bruno@example.com',
      clientId: null,
      quoteLeadId: 'lead-bruno',
      quotationId: '22222222-2222-4222-8222-222222222202',
      status: 'Status Extra',
    }),
    deal({
      id: 'carla',
      nome: 'Carla',
      email: 'carla@example.com',
      clientId: null,
      quoteLeadId: null,
      quotationId: null,
      quotation: null,
      status: 'Outro Extra',
    }),
  ]);
  const handler = createCrmDealsHandler({
    repository,
    pipelineRepository: memoryPipelineRepository(),
  });

  const result = await handler(event('GET', undefined, { search: 'aNA' }));
  const body = JSON.parse(result.body || '');

  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    body.columns.slice(0, CRM_PIPELINE.length).map((column: { status: string }) => column.status),
    CRM_PIPELINE
  );
  assert.equal(body.columns[0].deals[0].lead_name, 'Ana');
  assert.equal(body.columns[0].deals[0].client_id, 'client-ana');
  assert.equal(body.columns[0].deals[0].quote_lead_id, null);
  assert.equal(body.columns[0].deals[0].quotation_id, '11111111-1111-4111-8111-111111111101');
  assert.equal(body.columns[0].deals[0].quotation, 'ORC-20260001');
  assert.equal(body.meta.total_deals, 1);
  assert.equal(body.meta.stages, 1);

  const allResult = await handler(event('GET'));
  const allBody = JSON.parse(allResult.body || '');
  const allDeals: Array<Record<string, unknown>> = allBody.columns.flatMap(
    (column: { deals: Array<Record<string, unknown>> }) => column.deals
  );
  const allDealsById = Object.fromEntries(allDeals.map((candidate) => [candidate.id, candidate]));
  assert.deepEqual(Object.keys(allDealsById).sort(), ['ana', 'bruno', 'carla']);
  assert.deepEqual(allDealsById.ana, {
    id: 'ana',
    client_id: 'client-ana',
    quote_lead_id: null,
    quotation_id: '11111111-1111-4111-8111-111111111101',
    lead_name: 'Ana',
    email: 'ana@example.com',
    telefone: '5511999990000',
    status: 'Novo Lead',
    quotation: 'ORC-20260001',
    follow_up_stage: 0,
    next_step: null,
    criado_em: NOW.toISOString(),
    modificado_em: NOW.toISOString(),
  });
  assert.equal(allDealsById.bruno?.client_id, null);
  assert.equal(allDealsById.bruno?.quote_lead_id, 'lead-bruno');
  assert.equal(allDealsById.bruno?.quotation_id, '22222222-2222-4222-8222-222222222202');
  assert.equal(allDealsById.carla?.client_id, null);
  assert.equal(allDealsById.carla?.quote_lead_id, null);
  assert.equal(allDealsById.carla?.quotation_id, null);
  assert.equal(allDealsById.carla?.quotation, null);
});

test('keeps unknown local statuses after canonical columns in alphabetical order', async () => {
  const repository = memoryRepository([
    deal({ id: 'z', status: 'Zeta' }),
    deal({ id: 'a', status: 'Alfa' }),
  ]);
  const handler = createCrmDealsHandler({
    repository,
    pipelineRepository: memoryPipelineRepository(),
  });

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
    createCrmDealsHandler({ repository, pipelineRepository: memoryPipelineRepository() }),
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
        status: 'emitido',
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
        status: 'emitido',
        createdAt: old,
        updatedAt: old,
      });
      const fixtureFields: FixtureRevisionFields = await ensureFixtureTemplateVersion(db as any);
      await db.insert(schema.quoteRevisions).values({
        ...fixtureFields,
        id: revisionId,
        quotationId,
        version: 1,
        status: 'emitido',
        validadeDias: 15,
        companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
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
        status: 'emitido',
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

test(
  'upsert for quotation reuses lead deals, preserves advanced stages and does not reopen Perdido',
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
    const advancedQuotationId = randomUUID();
    const lostQuotationId = randomUUID();
    const leadId = randomUUID();
    const leadDealId = randomUUID();
    const advancedDealId = randomUUID();
    const lostDealId = randomUUID();
    try {
      await migrate(db, { migrationsFolder });
      await db.insert(schema.clients).values({
        id: clientId,
        nome: 'Ana Upsert',
        email: 'ana.upsert@example.com',
        telefone: '5511999990000',
      });
      const businessBase = Date.now() % 100000000;
      await db.insert(schema.quotations).values([
        {
          id: quotationId,
          clientId,
          businessNumber: `ORC-${String(businessBase).padStart(8, '0')}`,
          status: 'rascunho',
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: advancedQuotationId,
          clientId,
          businessNumber: `ORC-${String((businessBase + 1) % 100000000).padStart(8, '0')}`,
          status: 'rascunho',
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: lostQuotationId,
          clientId,
          businessNumber: `ORC-${String((businessBase + 2) % 100000000).padStart(8, '0')}`,
          status: 'rascunho',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);

      await db.insert(schema.quoteLeads).values({
        id: leadId,
        identityKey: `crm-upsert-${leadId}`,
        nome: 'Ana Upsert',
        email: 'ana.upsert@example.com',
        telefone: '5511999990000',
        source: 'typebot',
        status: 'converted',
        quotationId,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await db.insert(schema.crmDeals).values({
        id: leadDealId,
        quoteLeadId: leadId,
        nome: 'Ana Upsert',
        email: 'ana.upsert@example.com',
        telefone: '5511999990000',
        status: 'Novo Lead',
        createdAt: NOW,
        updatedAt: NOW,
      });
      await db.update(schema.quoteLeads).set({ crmDealId: leadDealId }).where(eq(schema.quoteLeads.id, leadId));
      await db.insert(schema.crmDeals).values({
        id: advancedDealId,
        clientId,
        quotationId: advancedQuotationId,
        nome: 'Ana Upsert',
        email: 'ana.upsert@example.com',
        telefone: '5511999990000',
        status: 'Em Negociacao',
        createdAt: NOW,
        updatedAt: NOW,
      });
      await db.insert(schema.crmDeals).values({
        id: lostDealId,
        clientId,
        quotationId: lostQuotationId,
        nome: 'Ana Upsert',
        email: 'ana.upsert@example.com',
        telefone: '5511999990000',
        status: 'Perdido',
        lostReason: 'Sem resposta após 30 dias.',
        createdAt: NOW,
        updatedAt: NOW,
      });

      const repository = createPostgresCrmDealRepository(() => db, { now: () => NOW });
      const reattached = await repository.upsertForQuotation({
        quotationId,
        clientId,
        nome: 'Ana Upsert Emitida',
        email: 'ANA.UPSERT@EXAMPLE.COM',
        telefone: '5511999990000',
      });
      assert.equal(reattached.id, leadDealId);
      assert.equal(reattached.quotationId, quotationId);
      assert.equal(reattached.status, 'Orcamento Enviado');
      assert.equal(reattached.nome, 'Ana Upsert Emitida');
      const [lead] = await db.select().from(schema.quoteLeads).where(eq(schema.quoteLeads.id, leadId));
      assert.equal(lead?.crmDealId, leadDealId);

      const preserved = await repository.upsertForQuotation({
        quotationId: advancedQuotationId,
        clientId,
        nome: 'Ana Upsert',
        email: 'ana.upsert@example.com',
      });
      assert.equal(preserved.id, advancedDealId);
      assert.equal(preserved.status, 'Em Negociacao');

      const lost = await repository.upsertForQuotation({
        quotationId: lostQuotationId,
        clientId,
        nome: 'Ana Upsert',
        email: 'ana.upsert@example.com',
      });
      assert.equal(lost.id, lostDealId);
      assert.equal(lost.status, 'Perdido');
      const lostRows = await db
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.quotationId, lostQuotationId));
      assert.equal(lostRows.length, 1);

      const created = await repository.upsertForQuotation({
        quotationId: quotationId,
        clientId,
        nome: 'Ana Upsert Emitida',
        email: 'ana.upsert@example.com',
      });
      assert.equal(created.id, leadDealId);
    } finally {
      await db.update(schema.quoteLeads).set({ crmDealId: null, quotationId: null }).where(eq(schema.quoteLeads.id, leadId));
      await db.delete(schema.crmDeals).where(eq(schema.crmDeals.id, leadDealId));
      await db.delete(schema.crmDeals).where(eq(schema.crmDeals.id, advancedDealId));
      await db.delete(schema.crmDeals).where(eq(schema.crmDeals.id, lostDealId));
      await db.delete(schema.quoteLeads).where(eq(schema.quoteLeads.id, leadId));
      await db.delete(schema.quotations).where(eq(schema.quotations.id, quotationId));
      await db.delete(schema.quotations).where(eq(schema.quotations.id, advancedQuotationId));
      await db.delete(schema.quotations).where(eq(schema.quotations.id, lostQuotationId));
      await db.delete(schema.clients).where(eq(schema.clients.id, clientId));
      await client.end({ timeout: 5 });
    }
  }
);

test(
  'persists configurable pipeline stages and protects occupied stages in PostgreSQL',
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
    const dealId = randomUUID();
    let createdKey: string | null = null;
    let originalOrder: string[] = [];
    try {
      await migrate(db, { migrationsFolder });
      const pipelineRepository = createPostgresCrmPipelineStageRepository(() => db, {
        now: () => NOW,
        keyFactory: () => randomUUID(),
      });
      originalOrder = (await pipelineRepository.list()).map((stage) => stage.key);

      const created = await pipelineRepository.create(`Qualificação ${dealId.slice(0, 8)}`);
      createdKey = created.key;
      assert.equal(created.dealCount, 0);

      const renamed = await pipelineRepository.rename(created.key, `Triagem ${dealId.slice(0, 8)}`);
      assert.equal(renamed?.name, `Triagem ${dealId.slice(0, 8)}`);

      const reordered = await pipelineRepository.reorder([created.key, ...originalOrder]);
      assert.equal(reordered[0]?.key, created.key);

      await db.insert(schema.crmDeals).values({
        id: dealId,
        nome: 'Negócio na etapa customizada',
        status: created.key,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await assert.rejects(
        pipelineRepository.remove(created.key),
        /Mova os negócios desta etapa antes de removê-la\./
      );

      await db.delete(schema.crmDeals).where(eq(schema.crmDeals.id, dealId));
      assert.equal(await pipelineRepository.remove(created.key), true);
      createdKey = null;
      assert.deepEqual(
        (await pipelineRepository.list()).map((stage) => stage.key),
        originalOrder
      );
    } finally {
      await db.delete(schema.crmDeals).where(eq(schema.crmDeals.id, dealId));
      if (createdKey) {
        await db
          .delete(schema.crmPipelineStages)
          .where(eq(schema.crmPipelineStages.key, createdKey));
        for (const [position, key] of originalOrder.entries()) {
          await db
            .update(schema.crmPipelineStages)
            .set({ position })
            .where(eq(schema.crmPipelineStages.key, key));
        }
      }
      await client.end({ timeout: 5 });
    }
  }
);
