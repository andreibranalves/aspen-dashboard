import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  appSettings,
  clients,
  crmDeals,
  productActivityEvents,
  products,
  quotations,
  quoteLeads,
  quoteRevisions,
  salesOrders,
} from '../../api/_infrastructure/db/schema.js';
import {
  createPostgresQuoteDraftRepository,
  QuoteDraftConflictError,
} from '../../api/_infrastructure/db/repositories/quote-repository.js';
import { createPostgresQuoteLeadRepository } from '../../api/_infrastructure/db/repositories/quote-leads-repository.js';
import {
  listQuotationOriginCandidates,
  readQuotationOriginCandidateReport,
  readQuotationOrigin,
} from '../../api/_infrastructure/db/repositories/quotation-origin-repository.js';
import { createPostgresQuoteDraftManagementRepository } from '../../api/_infrastructure/db/repositories/quote-draft-management-repository.js';
import { createPostgresQuotationLifecycleRepository } from '../../api/_infrastructure/db/repositories/quotation-lifecycle-repository.js';
import { DEFAULT_QUOTATION_COMPANY_CONFIGURATION } from '../../api/_modules/quotation-company.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_modules/quotation-template-catalog.js';
import { ensureFixtureTemplateVersion } from '../fixtures/quotation-revision-seeds.ts';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env, [
  'TEST_QUOTE_DATABASE_URL',
  'TEST_DATABASE_URL',
]);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);

type ReportDatabase = ReturnType<typeof drizzle<typeof schema>>;

async function insertReportLead(
  database: ReportDatabase,
  input: {
    id: string;
    email: string;
    createdAt: Date;
    source?: string;
    originalCreatedAt?: string | null;
  },
) {
  const raw = input.originalCreatedAt === undefined
    ? null
    : {
        siteSubmission:
          input.originalCreatedAt === null
            ? {}
            : { originalCreatedAt: input.originalCreatedAt },
      };
  await database.insert(quoteLeads).values({
    id: input.id,
    identityKey: `report-fixture-${input.id}`,
    email: input.email,
    source: input.source || 'site_form',
    raw,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

async function insertReportQuotation(
  database: ReportDatabase,
  fixtureFields: Awaited<ReturnType<typeof ensureFixtureTemplateVersion>>,
  input: {
    id: string;
    businessNumber: string;
    revisionId: string;
    clientId: string;
    createdAt: Date;
    email: string;
    version?: number;
    name?: string;
  },
) {
  const name = input.name || 'Relatório histórico sintético';
  await database.insert(clients).values({ id: input.clientId, nome: name });
  await database.insert(quotations).values({
    id: input.id,
    businessNumber: input.businessNumber,
    clientId: input.clientId,
    status: 'emitido',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  await insertReportRevision(database, fixtureFields, {
    quotationId: input.id,
    revisionId: input.revisionId,
    createdAt: input.createdAt,
    email: input.email,
    version: input.version,
    name,
  });
  return { quotationId: input.id, revisionId: input.revisionId, clientId: input.clientId };
}

async function insertReportRevision(
  database: ReportDatabase,
  fixtureFields: Awaited<ReturnType<typeof ensureFixtureTemplateVersion>>,
  input: {
    quotationId: string;
    revisionId: string;
    createdAt: Date;
    email: string;
    version?: number;
    name?: string;
  },
) {
  const name = input.name || 'Relatório histórico sintético';
  await database.insert(quoteRevisions).values({
    ...fixtureFields,
    id: input.revisionId,
    quotationId: input.quotationId,
    version: input.version || 1,
    status: 'emitido',
    validadeDias: 15,
    companySnapshot: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
    clienteNome: name,
    clienteEmail: input.email,
    subtotal: '1.00',
    total: '1.00',
    createdAt: input.createdAt,
  });
}

function instrumentReportDatabase(
  database: ReportDatabase,
  mutateAfterFirstSelect: () => Promise<void>,
) {
  let selectCount = 0;
  let mutationStarted = false;
  let selectCountAtMutation: number | null = null;
  let transactionConfig: unknown;

  const wrapQuery = (query: object): object =>
    new Proxy(query, {
      get(target, property, receiver) {
        if (property === 'then') {
          const then = Reflect.get(target, property, receiver);
          if (typeof then !== 'function') return then;
          return (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) =>
            Reflect.apply(then, target, [
              async (rows: unknown) => {
                selectCount += 1;
                if (!mutationStarted) {
                  mutationStarted = true;
                  selectCountAtMutation = selectCount;
                  await mutateAfterFirstSelect();
                }
                return resolve(rows);
              },
              reject,
            ]);
        }
        const member = Reflect.get(target, property, receiver);
        if (typeof member !== 'function') return member;
        return (...args: unknown[]) => wrapQuery(Reflect.apply(member, target, args) as object);
      },
    });

  const wrapExecutor = (executor: object) =>
    new Proxy(executor, {
      get(target, property, receiver) {
        if (property === 'select') {
          const select = Reflect.get(target, property, receiver);
          return (...args: unknown[]) => wrapQuery(Reflect.apply(select as Function, target, args) as object);
        }
        const member = Reflect.get(target, property, receiver);
        return typeof member === 'function' ? member.bind(target) : member;
      },
    });

  const instrumented = new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'select') {
        const select = Reflect.get(target, property, receiver);
        return (...args: unknown[]) => wrapQuery(Reflect.apply(select as Function, target, args) as object);
      }
      if (property === 'transaction') {
        const transaction = Reflect.get(target, property, receiver);
        return (callback: (executor: object) => Promise<unknown>, config?: unknown) => {
          transactionConfig = config;
          return Reflect.apply(transaction as Function, target, [
              (executor: object) => callback(wrapExecutor(executor)),
              config,
            ]);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  return {
    database: instrumented,
    getSelectCount: () => selectCount,
    getSelectCountAtMutation: () => selectCountAtMutation,
    getTransactionConfig: () => transactionConfig,
  };
}

test(
  'PostgreSQL quotation creation persists a validated opportunity origin atomically',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const client = postgres(TEST_DATABASE_URL!, {
      max: 4,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(client, { schema });
    const suffix = randomUUID().slice(0, 8);
    const sku = `ORIGIN-${suffix}`;
    const externalId = `siteQuote.${randomUUID()}`;
    const secondExternalId = `siteQuote.${randomUUID()}`;
    const createdIds: string[] = [];
    const createdClientIds: string[] = [];
    const leadIds: string[] = [];
    const dealIds: string[] = [];
    const orderIds: string[] = [];
    const dateExternalId = `siteQuote.${randomUUID()}`;

    try {
      await migrate(db, { migrationsFolder });
      await db
        .insert(appSettings)
        .values({ singletonId: 1, templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key })
        .onConflictDoUpdate({
          target: appSettings.singletonId,
          set: { templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key },
        });
      await db.insert(products).values({
        sku,
        nome: 'Produto sintético de origem',
        descricao: 'Fixture #203',
        unidade: 'Und',
        precoBase: '10.00',
        ativo: true,
      });

      const leadRepository = createPostgresQuoteLeadRepository(() => db, {
        now: () => new Date('2026-09-01T12:00:00.000Z'),
      });
      const lead = await leadRepository.ingestSiteSubmission({
        externalId,
        payloadFingerprint: 'a'.repeat(64),
        originalCreatedAt: '2026-09-01T11:00:00.000Z',
        nome: 'Contato sintético',
        email: `origem-${suffix}@example.test`,
        whatsapp: '5511999991111',
        produto: 'Produto sintético',
        quantidade: '10',
        consent: { given: true, source: 'site_quote_form' },
      });
      assert.ok(lead.crmDealId);
      leadIds.push(lead.id);
      dealIds.push(lead.crmDealId);

      const quotationRepository = createPostgresQuoteDraftRepository(() => db, {
        now: () => new Date('2026-09-02T12:00:00.000Z'),
      });
      const created = await quotationRepository.createDraft({
        quote_lead_id: lead.id,
        crm_deal_id: lead.crmDealId,
        nome: 'Cliente editável independente',
        email: `cliente-${suffix}@example.test`,
        telefone: '5511888881111',
        items: [{ item_code: sku, qty: '10.000' }],
      });
      createdIds.push(created.quotation_uuid);
      createdClientIds.push(created.cliente_id);

      const [quotation] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, created.quotation_uuid));
      const [savedLead] = await db.select().from(quoteLeads).where(eq(quoteLeads.id, lead.id));
      const [savedDeal] = await db
        .select()
        .from(crmDeals)
        .where(eq(crmDeals.id, lead.crmDealId!));

      assert.equal(quotation?.quoteLeadId, lead.id);
      assert.equal(savedLead?.quotationId, created.quotation_uuid);
      assert.equal(savedLead?.status, 'converted');
      assert.equal(savedDeal?.quotationId, created.quotation_uuid);
      assert.equal(savedDeal?.clientId, created.cliente_id);

      assert.deepEqual(await readQuotationOrigin(db, { quotationId: created.quotation_uuid }), {
        status: 'linked',
        source: 'site_form',
        sourceLabel: 'Formulário do site',
        quotationNumber: created.quotation_id,
        salesOrderNumber: null,
        reason: null,
      });

      const secondForSameSubmission = await quotationRepository.createDraft({
        quoteLeadId: lead.id,
        crmDealId: lead.crmDealId,
        nome: 'Segundo cliente editável',
        items: [{ item_code: sku, qty: '2.000' }],
      });
      createdIds.push(secondForSameSubmission.quotation_uuid);
      createdClientIds.push(secondForSameSubmission.cliente_id);
      assert.equal(
        (await readQuotationOrigin(db, { quotationId: created.quotation_uuid })).status,
        'linked',
      );

      await assert.rejects(
        () => db.transaction(async (transaction) => {
          await transaction.update(crmDeals).set({ quoteLeadId: null }).where(eq(crmDeals.id, lead.crmDealId!));
          await transaction.update(quoteLeads).set({ crmDealId: null }).where(eq(quoteLeads.id, lead.id));
          await transaction.delete(quoteLeads).where(eq(quoteLeads.id, lead.id));
        }),
        (error: unknown) => {
          const cause = (error as { cause?: { code?: string; constraint_name?: string } })?.cause;
          return cause?.code === '23503' && cause.constraint_name === 'quotations_quote_lead_id_quote_leads_id_fk';
        },
      );

      await db
        .update(quotations)
        .set({ status: 'emitido' })
        .where(eq(quotations.id, secondForSameSubmission.quotation_uuid));
      await db
        .update(quoteRevisions)
        .set({ status: 'emitido' })
        .where(eq(quoteRevisions.id, secondForSameSubmission.revision_id));
      const management = createPostgresQuoteDraftManagementRepository(() => db);
      const issued = await management.get!(secondForSameSubmission.quotation_uuid);
      assert.ok(issued);
      const lifecycle = createPostgresQuotationLifecycleRepository(() => db, {
        now: () => new Date('2026-09-03T12:00:00.000Z'),
      });
      const approved = await lifecycle.setStatus(secondForSameSubmission.quotation_uuid, {
        status: 'aprovado',
        concurrency_token: issued.concurrency_token,
      });
      const [order] = await db
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.quotationId, secondForSameSubmission.quotation_uuid));
      assert.ok(order);
      orderIds.push(order.id);
      assert.equal(order.quotationRevisionId, secondForSameSubmission.revision_id);
      assert.equal(approved.sales_order_id, order.orderNumber);
      assert.equal(
        (
          await readQuotationOrigin(db, {
            quotationId: secondForSameSubmission.quotation_uuid,
            salesOrderId: order.id,
            quotationRevisionId: created.revision_id,
          })
        ).reason,
        'order_revision_conflict',
      );
      assert.deepEqual(
        await readQuotationOrigin(db, {
          quotationId: secondForSameSubmission.quotation_uuid,
          salesOrderId: order.id,
          quotationRevisionId: order.quotationRevisionId,
        }),
        {
          status: 'linked',
          source: 'site_form',
          sourceLabel: 'Formulário do site',
          quotationNumber: secondForSameSubmission.quotation_id,
          salesOrderNumber: order.orderNumber,
          reason: null,
        },
      );

      const triggerSuffix = suffix.replace(/[^a-z0-9]/gi, '');
      const triggerName = `quotation_origin_rollback_${triggerSuffix}`;
      const functionName = `${triggerName}_fn`;
      await client.unsafe(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.cliente_nome = 'Rollback sintético' THEN RAISE EXCEPTION 'rollback fixture'; END IF; RETURN NEW; END $$`);
      await client.unsafe(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON quote_revisions FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
      const leadBeforeRollback = (await db.select().from(quoteLeads).where(eq(quoteLeads.id, lead.id)))[0];
      const dealBeforeRollback = (await db.select().from(crmDeals).where(eq(crmDeals.id, lead.crmDealId!)))[0];
      try {
        await assert.rejects(() => quotationRepository.createDraft({
          quoteLeadId: lead.id,
          crmDealId: lead.crmDealId,
          nome: 'Rollback sintético',
          items: [{ item_code: sku, qty: '1.000' }],
        }));
      } finally {
        await client.unsafe(`DROP TRIGGER ${triggerName} ON quote_revisions`);
        await client.unsafe(`DROP FUNCTION ${functionName}()`);
      }
      const leadAfterRollback = (await db.select().from(quoteLeads).where(eq(quoteLeads.id, lead.id)))[0];
      const dealAfterRollback = (await db.select().from(crmDeals).where(eq(crmDeals.id, lead.crmDealId!)))[0];
      assert.equal(leadAfterRollback?.quotationId, leadBeforeRollback?.quotationId);
      assert.equal(dealAfterRollback?.quotationId, dealBeforeRollback?.quotationId);
      assert.equal(
        (await db.select().from(clients).where(eq(clients.nome, 'Rollback sintético'))).length,
        0,
      );
      assert.equal(
        (await readQuotationOrigin(db, { quotationId: secondForSameSubmission.quotation_uuid }))
          .status,
        'linked',
      );

      const secondLead = await leadRepository.ingestSiteSubmission({
        externalId: secondExternalId,
        payloadFingerprint: 'b'.repeat(64),
        originalCreatedAt: '2026-09-01T11:30:00.000Z',
        nome: 'Contato sintético',
        email: `origem-${suffix}@example.test`,
        whatsapp: '5511999991111',
        produto: 'Outro pedido sintético',
        quantidade: '20',
        consent: { given: true, source: 'site_quote_form' },
      });
      assert.ok(secondLead.crmDealId);
      leadIds.push(secondLead.id);
      dealIds.push(secondLead.crmDealId);

      const historicalUnlinked = await quotationRepository.createDraft({
        nome: 'Contato sintético',
        email: `ORIGEM-${suffix}@example.test`,
        telefone: '(11) 99999-1111',
        items: [{ item_code: sku, qty: '1.000' }],
      });
      createdIds.push(historicalUnlinked.quotation_uuid);
      createdClientIds.push(historicalUnlinked.cliente_id);
      assert.equal(
        (await readQuotationOrigin(db, { quotationId: historicalUnlinked.quotation_uuid })).status,
        'missing',
      );
      const candidates = await listQuotationOriginCandidates(db, {
        from: new Date('2026-09-02T00:00:00.000Z'),
        to: new Date('2026-09-03T00:00:00.000Z'),
        windowDays: 7,
      });
      const historicalCandidates = candidates.filter(
        (candidate) => candidate.quotationId === historicalUnlinked.quotation_uuid,
      );
      assert.equal(historicalCandidates.length, 2);
      assert.ok(historicalCandidates.every((candidate) => candidate.reasons.includes('email_normalized')));
      assert.equal(
        (await db.select().from(quotations).where(eq(quotations.id, historicalUnlinked.quotation_uuid)))[0]?.quoteLeadId,
        null,
      );

      await assert.rejects(
        () =>
          quotationRepository.createDraft({
            quoteLeadId: lead.id,
            crmDealId: secondLead.crmDealId,
            nome: 'Tentativa adulterada',
            items: [{ item_code: sku, qty: '1.000' }],
          }),
        (error: unknown) => error instanceof QuoteDraftConflictError,
      );

      const secondSubmissionQuotation = await quotationRepository.createDraft({
        quoteLeadId: secondLead.id,
        crmDealId: secondLead.crmDealId,
        nome: 'Mesmo contato, outra submissão',
        items: [{ item_code: sku, qty: '3.000' }],
      });
      createdIds.push(secondSubmissionQuotation.quotation_uuid);
      createdClientIds.push(secondSubmissionQuotation.cliente_id);
      assert.equal(
        (
          await db
            .select({ quoteLeadId: quotations.quoteLeadId })
            .from(quotations)
            .where(eq(quotations.id, secondSubmissionQuotation.quotation_uuid))
        )[0]?.quoteLeadId,
        secondLead.id,
      );

      await db
        .update(crmDeals)
        .set({ quoteLeadId: lead.id })
        .where(eq(crmDeals.id, secondLead.crmDealId));
      assert.deepEqual(
        await readQuotationOrigin(db, {
          quotationId: secondSubmissionQuotation.quotation_uuid,
        }),
        {
          status: 'conflict',
          source: null,
          sourceLabel: 'Origem conflitante',
          quotationNumber: secondSubmissionQuotation.quotation_id,
          salesOrderNumber: null,
          reason: 'deal_origin_conflict',
        },
      );

      const originalDateLead = await leadRepository.ingestSiteSubmission({
        externalId: dateExternalId,
        payloadFingerprint: 'e'.repeat(64),
        originalCreatedAt: '2026-01-10T12:00:00.000Z',
        nome: 'Contato temporal sintético',
        email: `temporal-${suffix}@example.test`,
        whatsapp: '5511999993333',
        produto: 'Produto sintético',
        quantidade: '5',
        consent: { given: true, source: 'site_quote_form' },
      });
      assert.ok(originalDateLead.crmDealId);
      leadIds.push(originalDateLead.id);
      dealIds.push(originalDateLead.crmDealId);

      const januaryQuotationRepository = createPostgresQuoteDraftRepository(() => db, {
        now: () => new Date('2026-01-11T12:00:00.000Z'),
      });
      const januaryQuotation = await januaryQuotationRepository.createDraft({
        nome: 'Contato temporal sintético',
        email: `TEMPORAL-${suffix}@example.test`,
        telefone: '5511999993333',
        items: [{ item_code: sku, qty: '1.000' }],
      });
      createdIds.push(januaryQuotation.quotation_uuid);
      createdClientIds.push(januaryQuotation.cliente_id);

      const septemberQuotation = await quotationRepository.createDraft({
        nome: 'Contato temporal sintético',
        email: `temporal-${suffix}@example.test`,
        telefone: '5511999993333',
        items: [{ item_code: sku, qty: '1.000' }],
      });
      createdIds.push(septemberQuotation.quotation_uuid);
      createdClientIds.push(septemberQuotation.cliente_id);

      const januaryCandidates = await listQuotationOriginCandidates(db, {
        from: new Date('2026-01-11T00:00:00.000Z'),
        to: new Date('2026-01-12T00:00:00.000Z'),
        windowDays: 2,
      });
      assert.deepEqual(
        januaryCandidates
          .filter((candidate) => candidate.quotationId === januaryQuotation.quotation_uuid)
          .map((candidate) => candidate.quoteLeadId),
        [originalDateLead.id],
      );

      const septemberCandidates = await listQuotationOriginCandidates(db, {
        from: new Date('2026-09-02T00:00:00.000Z'),
        to: new Date('2026-09-03T00:00:00.000Z'),
        windowDays: 2,
      });
      assert.equal(
        septemberCandidates.some((candidate) => candidate.quotationId === septemberQuotation.quotation_uuid),
        false,
      );
    } finally {
      const ownedLeads = await db
        .select({ id: quoteLeads.id, crmDealId: quoteLeads.crmDealId })
        .from(quoteLeads)
        .where(inArray(quoteLeads.externalId, [externalId, secondExternalId, dateExternalId]));
      for (const lead of ownedLeads) {
        await db
          .update(quoteLeads)
          .set({ crmDealId: null, quotationId: null })
          .where(eq(quoteLeads.id, lead.id));
        if (lead.crmDealId) {
          await db
            .update(crmDeals)
            .set({ quoteLeadId: null, quotationId: null })
            .where(eq(crmDeals.id, lead.crmDealId));
        }
      }
      if (createdIds.length) {
        if (orderIds.length) await db.delete(salesOrders).where(inArray(salesOrders.id, orderIds));
        await db.delete(quotations).where(inArray(quotations.id, createdIds));
      }
      if (dealIds.length) await db.delete(crmDeals).where(inArray(crmDeals.id, dealIds));
      if (leadIds.length) await db.delete(quoteLeads).where(inArray(quoteLeads.id, leadIds));
      if (createdClientIds.length) {
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
      }
      await db.delete(productActivityEvents).where(eq(productActivityEvents.productSku, sku));
      await db.delete(products).where(eq(products.sku, sku));
      await client.end({ timeout: 5 });
    }
  },
);

test(
  'historical report rejects invalid site evidence without losing valid original dates',
  { concurrency: false, skip: !TEST_DATABASE_URL, timeout: 35_000 },
  async () => {
    const connection = postgres(TEST_DATABASE_URL!, {
      max: 2,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const database = drizzle(connection, { schema });
    const quotationIds: string[] = [];
    const clientIds: string[] = [];
    const leadIds: string[] = [];
    const januaryAt = new Date('2026-01-11T12:00:00.000Z');
    const septemberAt = new Date('2026-09-02T12:00:00.000Z');
    const reportPrefix = `invalid-evidence-${randomUUID().slice(0, 8)}`;
    let fixtureFields: Awaited<ReturnType<typeof ensureFixtureTemplateVersion>>;

    try {
      await migrate(database, { migrationsFolder });
      fixtureFields = await ensureFixtureTemplateVersion(database);

      const validJanuaryLeadId = randomUUID();
      const validJanuaryEmail = `${reportPrefix}-january@example.test`;
      await insertReportLead(database, {
        id: validJanuaryLeadId,
        email: validJanuaryEmail,
        source: 'site_form',
        originalCreatedAt: '2026-01-10T12:00:00.000Z',
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      });
      leadIds.push(validJanuaryLeadId);
      const januaryQuotation = await insertReportQuotation(database, fixtureFields, {
        id: randomUUID(),
        businessNumber: 'ORC-20320001',
        revisionId: randomUUID(),
        clientId: randomUUID(),
        createdAt: januaryAt,
        email: validJanuaryEmail,
      });
      quotationIds.push(januaryQuotation.quotationId);
      clientIds.push(januaryQuotation.clientId);

      const invalidEvidence = [
        '2026-13-01T12:00:00.000Z',
        '2026-02-29T12:00:00.000Z',
        '2026-04-31T12:00:00.000Z',
        '2026-01-10T24:00:00.000Z',
        '2026-01-10T12:60:00.000Z',
        '2026-01-10T23:59:60.000Z',
        'not-a-timestamp',
        null,
        undefined,
      ];
      for (const [index, originalCreatedAt] of invalidEvidence.entries()) {
        const email = `${reportPrefix}-invalid-${index}@example.test`;
        const leadId = randomUUID();
        await insertReportLead(database, {
          id: leadId,
          email,
          source: 'site_form',
          originalCreatedAt,
          createdAt: septemberAt,
        });
        leadIds.push(leadId);
        const quotation = await insertReportQuotation(database, fixtureFields, {
          id: randomUUID(),
          businessNumber: `ORC-${String(20320002 + index).padStart(8, '0')}`,
          revisionId: randomUUID(),
          clientId: randomUUID(),
          createdAt: septemberAt,
          email,
        });
        quotationIds.push(quotation.quotationId);
        clientIds.push(quotation.clientId);
      }

      const validLeapLeadId = randomUUID();
      const validLeapEmail = `${reportPrefix}-leap@example.test`;
      await insertReportLead(database, {
        id: validLeapLeadId,
        email: validLeapEmail,
        source: 'site_form',
        originalCreatedAt: '2024-02-29T12:00:00.000Z',
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      });
      leadIds.push(validLeapLeadId);
      const leapQuotation = await insertReportQuotation(database, fixtureFields, {
        id: randomUUID(),
        businessNumber: 'ORC-20320011',
        revisionId: randomUUID(),
        clientId: randomUUID(),
        createdAt: new Date('2024-02-29T13:00:00.000Z'),
        email: validLeapEmail,
      });
      quotationIds.push(leapQuotation.quotationId);
      clientIds.push(leapQuotation.clientId);

      const nonSiteLeadId = randomUUID();
      const nonSiteEmail = `${reportPrefix}-non-site@example.test`;
      await insertReportLead(database, {
        id: nonSiteLeadId,
        email: nonSiteEmail,
        source: 'typebot',
        createdAt: septemberAt,
      });
      leadIds.push(nonSiteLeadId);
      const nonSiteQuotation = await insertReportQuotation(database, fixtureFields, {
        id: randomUUID(),
        businessNumber: 'ORC-20320012',
        revisionId: randomUUID(),
        clientId: randomUUID(),
        createdAt: septemberAt,
        email: nonSiteEmail,
      });
      quotationIds.push(nonSiteQuotation.quotationId);
      clientIds.push(nonSiteQuotation.clientId);

      const januaryCandidates = await listQuotationOriginCandidates(database, {
        from: new Date('2026-01-11T00:00:00.000Z'),
        to: new Date('2026-01-12T00:00:00.000Z'),
        windowDays: 2,
      });
      assert.deepEqual(
        januaryCandidates
          .filter((candidate) => candidate.quotationId === januaryQuotation.quotationId)
          .map((candidate) => candidate.quoteLeadId),
        [validJanuaryLeadId],
      );

      const leapCandidates = await listQuotationOriginCandidates(database, {
        from: new Date('2024-02-29T00:00:00.000Z'),
        to: new Date('2024-03-01T00:00:00.000Z'),
        windowDays: 1,
      });
      assert.deepEqual(
        leapCandidates
          .filter((candidate) => candidate.quotationId === leapQuotation.quotationId)
          .map((candidate) => candidate.quoteLeadId),
        [validLeapLeadId],
      );

      const septemberReport = await readQuotationOriginCandidateReport(database, {
        from: new Date('2026-09-02T00:00:00.000Z'),
        to: new Date('2026-09-03T00:00:00.000Z'),
        windowDays: 0,
      });
      const septemberCandidates = septemberReport.candidates;
      assert.deepEqual(septemberReport.invalidEvidence, { missing: 2, invalid: 7 });
      assert.equal(
        septemberCandidates.some((candidate) =>
          quotationIds.includes(candidate.quotationId) &&
          candidate.quoteLeadId !== nonSiteLeadId
        ),
        false,
      );
      assert.deepEqual(
        septemberCandidates
          .filter((candidate) => candidate.quotationId === nonSiteQuotation.quotationId)
          .map((candidate) => candidate.quoteLeadId),
        [nonSiteLeadId],
      );
    } finally {
      if (quotationIds.length) {
        await database.delete(quotations).where(inArray(quotations.id, quotationIds));
      }
      if (leadIds.length) {
        await database.delete(quoteLeads).where(inArray(quoteLeads.id, leadIds));
      }
      if (clientIds.length) {
        await database.delete(clients).where(inArray(clients.id, clientIds));
      }
      await connection.end({ timeout: 5 });
    }
  },
);

test(
  'historical report keeps quotation and lead pages in one PostgreSQL snapshot',
  { concurrency: false, skip: !TEST_DATABASE_URL, timeout: 35_000 },
  async () => {
    const connection = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const writerConnection = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const database = drizzle(connection, { schema });
    const writerDatabase = drizzle(writerConnection, { schema });
    const reportAt = new Date('2026-09-02T12:00:00.000Z');
    const quotationIds = [
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000004',
    ];
    const revisionIds = [
      '10000000-0000-4000-8000-000000000101',
      '10000000-0000-4000-8000-000000000102',
      '20000000-0000-4000-8000-000000000201',
      '30000000-0000-4000-8000-000000000301',
      '40000000-0000-4000-8000-000000000401',
    ];
    const clientIds = [
      '10000000-0000-4000-8000-000000001001',
      '20000000-0000-4000-8000-000000002002',
      '30000000-0000-4000-8000-000000003003',
      '40000000-0000-4000-8000-000000004004',
    ];
    const leadIds = [
      '10000000-0000-4000-8000-000000010001',
      '20000000-0000-4000-8000-000000020002',
      '30000000-0000-4000-8000-000000030003',
      '40000000-0000-4000-8000-000000040004',
    ];
    const insertedQuotationId = '15000000-0000-4000-8000-000000000005';
    const insertedRevisionId = '15000000-0000-4000-8000-000000000505';
    const insertedClientId = '15000000-0000-4000-8000-000000005005';
    const insertedLeadId = '05000000-0000-4000-8000-000000000005';
    const emails = [
      'snapshot-one@example.test',
      'snapshot-two@example.test',
      'snapshot-three@example.test',
      'snapshot-four@example.test',
    ];
    let fixtureFields: Awaited<ReturnType<typeof ensureFixtureTemplateVersion>>;
    let mutationCompleted = false;

    try {
      await migrate(database, { migrationsFolder });
      fixtureFields = await ensureFixtureTemplateVersion(database);
      for (const [index, leadId] of leadIds.entries()) {
        await insertReportLead(database, {
          id: leadId,
          email: emails[index],
          source: 'typebot',
          createdAt: reportAt,
        });
      }
      await insertReportQuotation(database, fixtureFields, {
        id: quotationIds[0],
        businessNumber: 'ORC-20310001',
        revisionId: revisionIds[0],
        clientId: clientIds[0],
        createdAt: reportAt,
        email: 'snapshot-one-old@example.test',
        version: 1,
      });
      await insertReportRevision(database, fixtureFields, {
        quotationId: quotationIds[0],
        revisionId: revisionIds[1],
        createdAt: reportAt,
        email: emails[0],
        version: 2,
      });
      for (const [index, quotationId] of quotationIds.slice(1).entries()) {
        await insertReportQuotation(database, fixtureFields, {
          id: quotationId,
          businessNumber: `ORC-2031000${index + 2}`,
          revisionId: revisionIds[index + 2],
          clientId: clientIds[index + 1],
          createdAt: reportAt,
          email: emails[index + 1],
        });
      }

      const instrumented = instrumentReportDatabase(database, async () => {
        await writerDatabase.transaction(async (transaction) => {
          await insertReportLead(transaction as unknown as ReportDatabase, {
            id: insertedLeadId,
            email: 'snapshot-inserted@example.test',
            source: 'typebot',
            createdAt: reportAt,
          });
          await insertReportQuotation(transaction as unknown as ReportDatabase, fixtureFields, {
            id: insertedQuotationId,
            businessNumber: 'ORC-20310005',
            revisionId: insertedRevisionId,
            clientId: insertedClientId,
            createdAt: reportAt,
            email: 'snapshot-inserted@example.test',
          });
          await transaction
            .delete(quotations)
            .where(eq(quotations.id, quotationIds[1]));
          await transaction
            .update(quoteRevisions)
            .set({ clienteEmail: 'snapshot-updated@example.test' })
            .where(eq(quoteRevisions.id, revisionIds[3]));
          await transaction
            .delete(quoteLeads)
            .where(eq(quoteLeads.id, leadIds[3]));
        });
        mutationCompleted = true;
      });

      const listCandidatesWithOptions = listQuotationOriginCandidates as unknown as (
        database: ReportDatabase,
        input: { from: Date; to: Date; windowDays: number },
        options?: { pageSize?: number },
      ) => Promise<Awaited<ReturnType<typeof listQuotationOriginCandidates>>>;
      const candidates = await listCandidatesWithOptions(
        instrumented.database as ReportDatabase,
        {
          from: new Date('2026-09-02T00:00:00.000Z'),
          to: new Date('2026-09-03T00:00:00.000Z'),
          windowDays: 0,
        },
        { pageSize: 1 },
      );

      assert.equal(mutationCompleted, true);
      assert.ok(instrumented.getSelectCount() >= 2);
      assert.equal(instrumented.getSelectCountAtMutation(), 1);
      assert.deepEqual(instrumented.getTransactionConfig(), {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      });
      assert.deepEqual(
        candidates
          .map((candidate) => `${candidate.quotationId}:${candidate.quoteLeadId}`)
          .sort(),
        quotationIds
          .map((quotationId, index) => `${quotationId}:${leadIds[index]}`)
          .sort(),
      );
      assert.equal(new Set(candidates.map((candidate) => candidate.quotationId)).size, 4);
      assert.equal(candidates.some((candidate) => candidate.quotationId === insertedQuotationId), false);
      assert.equal(
        (await database.select().from(quotations).where(eq(quotations.id, quotationIds[1]))).length,
        0,
      );
      assert.equal(
        (await database.select().from(quotations).where(eq(quotations.id, insertedQuotationId))).length,
        1,
      );
      assert.equal(
        (await database.select().from(quoteLeads).where(eq(quoteLeads.id, insertedLeadId))).length,
        1,
      );
      assert.equal(
        (await database.select().from(quotations).where(inArray(quotations.quoteLeadId, leadIds))).length,
        0,
      );
    } finally {
      await database.delete(quotations).where(
        inArray(quotations.id, [...quotationIds, insertedQuotationId]),
      );
      await database.delete(quoteLeads).where(
        inArray(quoteLeads.id, [...leadIds, insertedLeadId]),
      );
      await database.delete(clients).where(
        inArray(clients.id, [...clientIds, insertedClientId]),
      );
      await writerConnection.end({ timeout: 5 });
      await connection.end({ timeout: 5 });
    }
  },
);
