import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import { routes } from '../../api/_app/routes.js';
import { closeDatabase } from '../../api/_infrastructure/db/client.js';
import { createNodeHandler } from '../../api/_http/node-adapter.js';
import { createSiteQuoteLeadsHandler } from '../../api/_modules/site-quote-leads.js';
import { createPostgresQuoteLeadRepository } from '../../api/_infrastructure/db/repositories/quote-leads-repository.js';
import { createPostgresQuoteDraftRepository } from '../../api/_infrastructure/db/repositories/quote-repository.js';
import { createPostgresQuoteDraftManagementRepository } from '../../api/_infrastructure/db/repositories/quote-draft-management-repository.js';
import { createPostgresQuotationLifecycleRepository } from '../../api/_infrastructure/db/repositories/quotation-lifecycle-repository.js';
import { createPostgresSalesOrderOfflineExportRepository } from '../../api/_infrastructure/db/repositories/sales-order-offline-export-repository.js';
import { selectOfflineOrder } from '../../api/_modules/ads-offline-core.js';
import { runAdsOffline } from '../../scripts/ads-offline.mjs';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_modules/quotation-template-catalog.js';
import {
  appSettings,
  clients,
  crmDeals,
  products,
  productActivityEvents,
  quoteLeads,
  quoteRevisions,
  quotations,
  salesOrders,
} from '../../api/_infrastructure/db/schema.js';

import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
const NOW = new Date('2026-09-01T12:00:00.000Z');
const TOKEN = 'c'.repeat(32);
// Unique per run: the disposable database may hold leftovers from other lanes.
const SUBMISSION_ID = randomUUID();
const EXTERNAL_ID = `siteQuote.${SUBMISSION_ID}`;
// Byte-a-byte click id: leading/trailing whitespace must survive ingest intact.
const GCLID = '  SyntheticOpaque Click 2026-09  ';
// Canonical grant per issue #208 contract.
const AD_CONSENT = {
  adUserData: 'CONSENT_GRANTED',
  adPersonalization: 'CONSENT_GRANTED',
  policyVersion: '2026-08-18',
  reviewedAt: '2026-08-31T12:00:00.000Z',
  source: 'site_cookie_preferences',
  evidenceId: 'synthetic-consent-208',
};

function ingestEvent(consent: unknown, overrides: Record<string, unknown> = {}) {
  return {
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
    queryStringParameters: {},
    body: JSON.stringify({
      externalId: EXTERNAL_ID,
      payloadFingerprint: 'a'.repeat(64),
      originalCreatedAt: '2026-08-31T11:00:00.000Z',
      nome: 'Cliente Sintético 208',
      email: 'synthetic-208@example.invalid',
      whatsapp: '21999990208',
      produto: 'Cangas',
      quantidade: '2',
      mensagem: 'Evento sintético 208',
      gclid: GCLID,
      consent,
      ...overrides,
    }),
  };
}

function siteSubmissionOf(raw: unknown): Record<string, unknown> {
  return ((raw as { siteSubmission?: Record<string, unknown> })?.siteSubmission || {}) as Record<
    string,
    unknown
  >;
}

test(
  'grant estrito sobrevive site → ingest → orçamento → pedido → dry-run sem transporte',
  { skip: !TEST_DATABASE_URL, concurrency: false },
  async () => {
    const lockClient = postgres(TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    await lockClient`SELECT pg_advisory_lock(hashtext('aspen-quotation-postgres-tests'))`;
    const client = postgres(TEST_DATABASE_URL!, {
      max: 4,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
    const database = drizzle(client, { schema });
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const suffix = randomUUID().slice(0, 8);
    const sku = `CONS-208-${suffix}`;
    const createdOrderIds: string[] = [];
    const createdQuotationIds: string[] = [];
    const createdLeadIds: string[] = [];
    const createdDealIds: string[] = [];
    const createdClientIds: string[] = [];
    const createdExportIds: string[] = [];
    let previousSettings: typeof appSettings.$inferSelect | undefined;
    let apiServer: ReturnType<typeof createServer> | null = null;
    const originalSiteQuoteRoute = routes['site-quote-leads'];
    let bodyError: unknown;
    let clock = NOW;

    async function createApprovedOrder(label: string) {
      const draftRepository = createPostgresQuoteDraftRepository(() => database, {
        now: () => new Date('2026-08-31T12:00:00.000Z'),
      });
      const lead = await database
        .select({ id: quoteLeads.id, crmDealId: quoteLeads.crmDealId })
        .from(quoteLeads)
        .where(and(eq(quoteLeads.externalId, EXTERNAL_ID), eq(quoteLeads.source, 'site_form')))
        .limit(1);
      assert.ok(lead[0]?.id && lead[0]?.crmDealId);
      createdLeadIds.push(lead[0]!.id);
      createdDealIds.push(lead[0]!.crmDealId!);
      const draft = await draftRepository.createDraft({
        quote_lead_id: lead[0]!.id,
        crm_deal_id: lead[0]!.crmDealId!,
        nome: `Cliente sintético 208 ${label}`,
        email: `client-208-${suffix}-${label}@example.test`,
        telefone: '5511888820 8'.replace(' ', ''),
        items: [{ item_code: sku, qty: '2.000' }],
      });
      createdQuotationIds.push(draft.quotation_uuid);
      createdClientIds.push(draft.cliente_id);
      await database
        .update(quotations)
        .set({ status: 'emitido' })
        .where(eq(quotations.id, draft.quotation_uuid));
      await database
        .update(quoteRevisions)
        .set({ status: 'emitido' })
        .where(eq(quoteRevisions.id, draft.revision_id));
      const management = createPostgresQuoteDraftManagementRepository(() => database);
      const issued = await management.get!(draft.quotation_uuid);
      assert.ok(issued);
      const lifecycle = createPostgresQuotationLifecycleRepository(() => database, {
        now: () => clock,
      });
      const approved = await lifecycle.setStatus(draft.quotation_uuid, {
        status: 'aprovado',
        concurrency_token: issued.concurrency_token,
      });
      assert.ok(approved.sales_order_id);
      const [order] = await database
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.quotationId, draft.quotation_uuid));
      assert.ok(order);
      createdOrderIds.push(order.id);
      return order;
    }

    try {
      await migrate(database, { migrationsFolder });
      [previousSettings] = await database
        .select()
        .from(appSettings)
        .where(eq(appSettings.singletonId, 1));
      await database
        .insert(appSettings)
        .values({ singletonId: 1, templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key })
        .onConflictDoUpdate({
          target: appSettings.singletonId,
          set: { templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key },
        });
      await database.insert(products).values({
        sku,
        nome: 'Produto consent sintético 208',
        descricao: 'Fixture sem PII operacional',
        unidade: 'Und',
        precoBase: '61.70',
        ativo: true,
      });

      // -- Real HTTP boundary: generic consent accepted; first snapshot immutable; old evidence blocked
      routes['site-quote-leads'] = createSiteQuoteLeadsHandler({
        environment: { QUOTE_LEADS_INGEST_TOKEN: TOKEN },
      });
      apiServer = createServer(createNodeHandler());
      apiServer.listen(0, '127.0.0.1');
      await once(apiServer, 'listening');
      const address = apiServer.address();
      assert.ok(address && typeof address === 'object');
      const postIngest = async (event: ReturnType<typeof ingestEvent>) =>
        fetch(`http://127.0.0.1:${address.port}/api/site-quote-leads`, {
          method: event.httpMethod,
          headers: event.headers,
          body: event.body,
        });
      // 1. Generic submission is the first snapshot (fingerprint computed by the Site includes consent shape).
      assert.equal(
        (await postIngest(ingestEvent({ given: true, source: 'site_quote_form' }))).status,
        201
      );
      // 2. Exact retry deduplicates.
      assert.equal(
        (await postIngest(ingestEvent({ given: true, source: 'site_quote_form' }))).status,
        200
      );
      // 3. Evidence grant for the same externalId (necessarily a different fingerprint, as on the Site) is refused.
      const conflict = await postIngest(
        ingestEvent(AD_CONSENT, { payloadFingerprint: 'b'.repeat(64) })
      );
      assert.equal(conflict.status, 409);
      // 4. Old policyVersion evidence is rejected at the boundary, never demoted to generic.
      const legacyGrant = await postIngest(
        ingestEvent(AD_CONSENT, {
          externalId: `siteQuote.${randomUUID()}`,
          payloadFingerprint: 'd'.repeat(64),
          consent: { ...AD_CONSENT, policyVersion: '2025-01-01' },
        })
      );
      assert.equal(legacyGrant.status, 400);

      // -- Durable state after ingest
      const leadRepository = createPostgresQuoteLeadRepository(() => database, {
        now: () => NOW,
      });
      const lead = await leadRepository.findByExternalId(EXTERNAL_ID, 'site_form');
      assert.ok(lead);
      assert.equal(lead.status, 'ready');
      const raw = siteSubmissionOf(lead.raw);
      // Generic consent preserved exactly; first snapshot immutable.
      assert.deepEqual(raw.consent, { given: true, source: 'site_quote_form' });
      assert.equal(raw.payloadFingerprint, 'a'.repeat(64));
      assert.equal(raw.originalCreatedAt, '2026-08-31T11:00:00.000Z');
      assert.equal(raw.primaryAdIdentifier, 'gclid');
      // Byte-a-byte: no trim, no normalization, no truncation.
      assert.equal(lead.attribution?.gclid, GCLID);

      // -- Opportunity → quotation → order chain
      const order = await createApprovedOrder('primary');
      assert.ok(order.quotationRevisionId);

      // -- Dry-run selection with fake/blocked Google transport
      const offlineRepository = createPostgresSalesOrderOfflineExportRepository(() => database, {
        now: () => clock,
      });
      const evidence = await offlineRepository.listOrderEvidence({
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-09-02T00:00:00.000Z'),
      });
      const orderEvidence = evidence.find((item) => item.salesOrderId === order.id);
      assert.ok(orderEvidence);
      assert.equal(orderEvidence.originStatus, 'linked');
      assert.equal(orderEvidence.lineageVerified, true);
      assert.equal(orderEvidence.originSource, 'site_form');

      // Generic consent is NOT promoted: selection requires the strict grant.
      const selection = selectOfflineOrder(orderEvidence, {
        approvedOrderIds: new Set([order.id]),
        now: NOW,
      });
      assert.equal(selection.status, 'needs_review');
      assert.equal(selection.reviewReason, 'consent_review_required');
      assert.equal(selection.consentEvidence, null);
      assert.equal(selection.adIdentifierType, 'gclid');
      assert.equal(selection.adIdentifier, GCLID);

      // Second submission with the strict evidence grant ingested fresh.
      const grantExternalId = `siteQuote.${randomUUID()}`;
      const grantResponse = await postIngest(
        ingestEvent(AD_CONSENT, {
          externalId: grantExternalId,
          payloadFingerprint: 'e'.repeat(64),
          whatsapp: '21999990209',
          email: 'synthetic-208-grant@example.invalid',
        })
      );
      assert.equal(grantResponse.status, 201);
      const grantLead = await leadRepository.findByExternalId(grantExternalId, 'site_form');
      assert.ok(grantLead);
      assert.deepEqual(siteSubmissionOf(grantLead.raw).consent, AD_CONSENT);

      const grantDraftRepository = createPostgresQuoteDraftRepository(() => database, {
        now: () => new Date('2026-08-31T12:00:00.000Z'),
      });
      const grantDraft = await grantDraftRepository.createDraft({
        quote_lead_id: grantLead.id,
        crm_deal_id: grantLead.crmDealId!,
        nome: 'Cliente sintético 208 grant',
        email: 'client-208-grant@example.test',
        telefone: '5511888820 9'.replace(' ', ''),
        items: [{ item_code: sku, qty: '2.000' }],
      });
      createdQuotationIds.push(grantDraft.quotation_uuid);
      createdClientIds.push(grantDraft.cliente_id);
      createdLeadIds.push(grantLead.id);
      createdDealIds.push(grantLead.crmDealId!);
      await database
        .update(quotations)
        .set({ status: 'emitido' })
        .where(eq(quotations.id, grantDraft.quotation_uuid));
      await database
        .update(quoteRevisions)
        .set({ status: 'emitido' })
        .where(eq(quoteRevisions.id, grantDraft.revision_id));
      const grantIssued = await createPostgresQuoteDraftManagementRepository(() => database).get!(
        grantDraft.quotation_uuid
      );
      assert.ok(grantIssued);
      clock = new Date(NOW.getTime() + 60_000);
      const grantApproved = await createPostgresQuotationLifecycleRepository(() => database, {
        now: () => clock,
      }).setStatus(grantDraft.quotation_uuid, {
        status: 'aprovado',
        concurrency_token: grantIssued.concurrency_token,
      });
      assert.ok(grantApproved.sales_order_id);
      const grantOrder = await database
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.quotationId, grantDraft.quotation_uuid))
        .limit(1);
      assert.ok(grantOrder[0]);
      createdOrderIds.push(grantOrder[0].id);

      // -- Real ads:offline --dry-run wiring: read-only, zero OAuth, zero transport
      const beforeLedgerCounts = await Promise.all([
        database.select({ id: schema.salesOrderOfflineExports.id }).from(schema.salesOrderOfflineExports),
        database
          .select({ id: schema.salesOrderOfflineExportAttempts.id })
          .from(schema.salesOrderOfflineExportAttempts),
      ]);
      let transportCalls = 0;
      let stdout = '';
      let stderr = '';
      const exitCode = await runAdsOffline({
        argv: [
          '--from',
          '2026-09-01T00:00:00.000Z',
          '--to',
          '2026-09-02T00:00:00.000Z',
          '--dry-run',
        ],
        env: {},
        createRepository: () => offlineRepository,
        createTransport: () => ({
          ingest: async () => {
            transportCalls += 1;
            throw new Error('Google bloqueado: dry-run não pode transportar');
          },
          retrieveStatus: async () => {
            transportCalls += 1;
            throw new Error('Google bloqueado: dry-run não pode diagnosticar');
          },
        }),
        closeDatabase: async () => undefined,
        stdout: {
          write: (value: string) => {
            stdout += value;
            return true;
          },
        } as typeof process.stdout,
        stderr: {
          write: (value: string) => {
            stderr += value;
            return true;
          },
        } as typeof process.stderr,
      });
      assert.equal(exitCode, 0);
      assert.equal(stderr, '');
      assert.equal(transportCalls, 0);
      const dryRun = JSON.parse(stdout) as {
        rows: Array<{
          salesOrderId: string;
          category: string;
          reasons: string[];
          adIdentifierType: string | null;
        }>;
      };
      const grantRow = dryRun.rows.find((row) => row.salesOrderId === grantOrder[0].id);
      assert.ok(grantRow);
      assert.equal(grantRow.adIdentifierType, 'gclid');
      assert.ok(grantRow.reasons.includes('reviewed_uuid_required'));
      const afterLedgerCounts = await Promise.all([
        database.select({ id: schema.salesOrderOfflineExports.id }).from(schema.salesOrderOfflineExports),
        database
          .select({ id: schema.salesOrderOfflineExportAttempts.id })
          .from(schema.salesOrderOfflineExportAttempts),
      ]);
      assert.deepEqual(afterLedgerCounts, beforeLedgerCounts);
    } catch (error) {
      bodyError = error;
      throw error;
    } finally {
      let cleanupError: unknown;
      try {
        routes['site-quote-leads'] = originalSiteQuoteRoute;
        if (apiServer) {
          apiServer.close();
          await once(apiServer, 'close');
        }
        if (createdExportIds.length) {
          await database
            .delete(schema.salesOrderOfflineExportAttempts)
            .where(inArray(schema.salesOrderOfflineExportAttempts.exportId, createdExportIds));
          await database
            .delete(schema.salesOrderOfflineExports)
            .where(inArray(schema.salesOrderOfflineExports.id, createdExportIds));
        }
        if (createdOrderIds.length) {
          await database.delete(salesOrders).where(inArray(salesOrders.id, createdOrderIds));
        }
        if (createdLeadIds.length) {
          await database
            .update(quoteLeads)
            .set({ quotationId: null, crmDealId: null })
            .where(inArray(quoteLeads.id, createdLeadIds));
        }
        if (createdDealIds.length) {
          await database
            .update(crmDeals)
            .set({ quotationId: null, quoteLeadId: null })
            .where(inArray(crmDeals.id, createdDealIds));
          await database.delete(crmDeals).where(inArray(crmDeals.id, createdDealIds));
        }
        if (createdQuotationIds.length) {
          await database.delete(quotations).where(inArray(quotations.id, createdQuotationIds));
        }
        if (createdLeadIds.length) {
          await database.delete(quoteLeads).where(inArray(quoteLeads.id, createdLeadIds));
        }
        if (createdClientIds.length) {
          await database.delete(clients).where(inArray(clients.id, createdClientIds));
        }
        await database
          .delete(productActivityEvents)
          .where(inArray(productActivityEvents.productSku, [sku]));
        await database.delete(products).where(eq(products.sku, sku));
        if (previousSettings) {
          await database
            .update(appSettings)
            .set({
              validadeDias: previousSettings.validadeDias,
              entrega: previousSettings.entrega,
              quotationSections: previousSettings.quotationSections,
              companyConfiguration: previousSettings.companyConfiguration,
              fretePadrao: previousSettings.fretePadrao,
              templatePadrao: previousSettings.templatePadrao,
              settingsVersion: previousSettings.settingsVersion,
            })
            .where(eq(appSettings.singletonId, 1));
        } else {
          await database.delete(appSettings).where(eq(appSettings.singletonId, 1));
        }
      } catch (error) {
        cleanupError = error;
        console.error(`[consent-208-test] cleanup failed (${error instanceof Error ? error.name : typeof error})`);
      }
      await client.end({ timeout: 5 });
      await lockClient`SELECT pg_advisory_unlock(hashtext('aspen-quotation-postgres-tests'))`;
      await lockClient.end({ timeout: 5 });
      delete process.env.DATABASE_URL;
      await closeDatabase();
      if (cleanupError && !bodyError) throw cleanupError;
    }
  }
);
