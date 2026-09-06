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
  readQuotationOrigin,
} from '../../api/_infrastructure/db/repositories/quotation-origin-repository.js';
import { createPostgresQuoteDraftManagementRepository } from '../../api/_infrastructure/db/repositories/quote-draft-management-repository.js';
import { createPostgresQuotationLifecycleRepository } from '../../api/_infrastructure/db/repositories/quotation-lifecycle-repository.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_modules/quotation-template-catalog.js';
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
    } finally {
      const ownedLeads = await db
        .select({ id: quoteLeads.id, crmDealId: quoteLeads.crmDealId })
        .from(quoteLeads)
        .where(inArray(quoteLeads.externalId, [externalId, secondExternalId]));
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
