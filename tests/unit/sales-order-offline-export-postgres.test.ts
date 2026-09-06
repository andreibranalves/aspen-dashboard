import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../api/_infrastructure/db/schema.js';
import {
  appSettings,
  clients,
  crmDeals,
  products,
  productActivityEvents,
  quoteLeads,
  quoteRevisions,
  quotations,
  salesOrderOfflineExportAttempts,
  salesOrderOfflineExports,
  salesOrders,
} from '../../api/_infrastructure/db/schema.js';
import { createPostgresQuoteLeadRepository } from '../../api/_infrastructure/db/repositories/quote-leads-repository.js';
import { createPostgresQuoteDraftRepository } from '../../api/_infrastructure/db/repositories/quote-repository.js';
import { createPostgresQuoteDraftManagementRepository } from '../../api/_infrastructure/db/repositories/quote-draft-management-repository.js';
import { createPostgresQuotationLifecycleRepository } from '../../api/_infrastructure/db/repositories/quotation-lifecycle-repository.js';
import { createPostgresSalesOrderOfflineExportRepository } from '../../api/_infrastructure/db/repositories/sales-order-offline-export-repository.js';
import { createAdsOfflineService } from '../../api/_modules/ads-offline.js';
import {
  buildOfflinePayload,
  GOOGLE_DATA_MANAGER_SCOPE,
  selectOfflineOrder,
} from '../../api/_modules/ads-offline-core.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_modules/quotation-template-catalog.js';

import { parsePostgresUrl, postgresIdentity } from '../../scripts/postgres-target.mjs';
import { resolveDisposableTestDatabaseUrl } from '../support/disposable-postgres.js';

const TEST_DATABASE_URL = resolveDisposableTestDatabaseUrl(process.env, [
  'TEST_DATABASE_URL',
]);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle'
);
const NOW = new Date('2026-09-01T12:00:00.000Z');
const DESTINATION = {
  operatingAccountId: '1234567890',
  productDestinationId: '9876543210',
  productDestinationType: 'UPLOAD_CLICKS' as const,
};
const RUNTIME_TARGET = {
  target: 'synthetic-disposable',
  owner: 'synthetic-operator',
  databaseFingerprint: createHash('sha256')
    .update(
      TEST_DATABASE_URL
        ? postgresIdentity(parsePostgresUrl(TEST_DATABASE_URL))
        : '127.0.0.1|55434|aspen_test'
    )
    .digest('hex'),
  deploymentRef: 'synthetic-deployment',
};
const PREFLIGHT_PROOF = {
  ...RUNTIME_TARGET,
  ...DESTINATION,
  oauthScope: GOOGLE_DATA_MANAGER_SCOPE,
  verifiedAt: NOW.toISOString(),
};
const CONSENT = {
  adUserData: 'CONSENT_GRANTED',
  adPersonalization: 'CONSENT_GRANTED',
  policyVersion: 'ads-policy-v1',
  reviewedAt: '2026-08-31T12:00:00.000Z',
  source: 'site_quote_form',
  evidenceId: 'synthetic-consent',
};

function hasPostgresConstraint(name: string) {
  return (error: unknown) => {
    const cause = (error as { cause?: { constraint_name?: string } })?.cause;
    return cause?.constraint_name === name;
  };
}

test(
  'PostgreSQL validates offline export snapshots, claims, attempts, diagnostics, and review fences',
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
    const suffix = randomUUID().slice(0, 8);
    const sku = `OFFLINE-${suffix}`;
    const createdOrderIds: string[] = [];
    const createdQuotationIds: string[] = [];
    const createdLeadIds: string[] = [];
    const createdDealIds: string[] = [];
    const createdClientIds: string[] = [];
    const createdExportIds: string[] = [];
    let previousSettings: typeof appSettings.$inferSelect | undefined;
    let bodyError: unknown;
    let clock = NOW;

    async function createApprovedOrder(label: string): Promise<{
      order: typeof salesOrders.$inferSelect;
      quotationId: string;
      revisionId: string;
      leadId: string;
      dealId: string;
    }> {
      const leadRepository = createPostgresQuoteLeadRepository(() => database, {
        now: () => new Date('2026-08-31T12:00:00.000Z'),
      });
      const lead = await leadRepository.ingestSiteSubmission({
        externalId: `offline.${suffix}.${label}`,
        payloadFingerprint: `${String(createdLeadIds.length).padStart(2, '0')}${'a'.repeat(62)}`,
        originalCreatedAt: '2026-08-31T11:00:00.000Z',
        nome: `Contato sintético ${label}`,
        email: `offline-${suffix}-${label}@example.test`,
        whatsapp: `55119999${String(createdLeadIds.length + 1000).padStart(6, '0')}`,
        produto: 'Produto offline sintético',
        quantidade: '2',
        consent: CONSENT,
        gclid: `opaque-gclid-${label}`,
      });
      assert.ok(lead.crmDealId);
      createdLeadIds.push(lead.id);
      createdDealIds.push(lead.crmDealId);

      const draftRepository = createPostgresQuoteDraftRepository(() => database, {
        now: () => new Date('2026-08-31T12:00:00.000Z'),
      });
      const draft = await draftRepository.createDraft({
        quote_lead_id: lead.id,
        crm_deal_id: lead.crmDealId,
        nome: `Cliente sintético ${label}`,
        email: `client-${suffix}-${label}@example.test`,
        telefone: `55118888${String(createdLeadIds.length + 1000).padStart(6, '0')}`,
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
      assert.equal(order.quotationRevisionId, draft.revision_id);
      return {
        order,
        quotationId: draft.quotation_uuid,
        revisionId: draft.revision_id,
        leadId: lead.id,
        dealId: lead.crmDealId,
      };
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
        nome: 'Produto offline sintético',
        descricao: 'Fixture sem PII operacional',
        unidade: 'Und',
        precoBase: '61.70',
        ativo: true,
      });

      const primary = await createApprovedOrder('primary');
      const retryable = await createApprovedOrder('retryable');
      const accepted = await createApprovedOrder('accepted');
      const expired = await createApprovedOrder('expired');
      const cancelledBeforeAttempt = await createApprovedOrder('cancel-before');
      const partialDiagnostic = await createApprovedOrder('partial');
      const conflict = await createApprovedOrder('conflict');

      const repository = createPostgresSalesOrderOfflineExportRepository(() => database, {
        now: () => clock,
        retryDelayMs: 1_000,
        leaseMs: 1_000,
      });
      const evidence = await repository.listOrderEvidence({
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-09-02T00:00:00.000Z'),
      });
      assert.equal(evidence.length, 7);
      const primaryEvidence = evidence.find((item) => item.salesOrderId === primary.order.id);
      assert.ok(primaryEvidence);
      assert.equal(primaryEvidence.originStatus, 'linked');
      assert.equal(primaryEvidence.lineageVerified, true);
      assert.equal(primaryEvidence.quoteLeadId, primary.leadId);
      assert.equal(primaryEvidence.revisionQuotationId, primary.quotationId);
      assert.match(String(primaryEvidence.total), /^\d+\.\d{2}$/);
      assert.equal(primaryEvidence.createdAt?.toISOString(), NOW.toISOString());
      const primarySelection = selectOfflineOrder(primaryEvidence, {
        approvedOrderIds: new Set([primary.order.id]),
      });
      assert.equal(primarySelection.status, 'eligible');
      assert.equal(primarySelection.adIdentifier, 'opaque-gclid-primary');

      const makePayload = (item: typeof primaryEvidence) => {
        const selection = selectOfflineOrder(item, { approvedOrderIds: new Set([item.salesOrderId]) });
        assert.equal(selection.status, 'eligible');
        return buildOfflinePayload(
          {
            salesOrderId: item.salesOrderId,
            quoteLeadId: item.quoteLeadId!,
            originSource: item.originSource!,
            eventTimestamp: selection.eventTimestamp!,
            conversionValue: selection.conversionValue!,
            adIdentifierType: selection.adIdentifierType!,
            adIdentifier: selection.adIdentifier!,
            consentEvidence: selection.consentEvidence!,
          },
          DESTINATION
        );
      };
      const prepare = async (item: typeof primaryEvidence, state: 'prepared' | 'needs_review' = 'prepared') => {
        const selection = selectOfflineOrder(item, { approvedOrderIds: new Set([item.salesOrderId]) });
        const payload = makePayload(item);
        const row = await repository.prepare({
          salesOrderId: item.salesOrderId,
          quoteLeadId: item.quoteLeadId!,
          originSource: item.originSource!,
          eventTimestamp: selection.eventTimestamp!,
          conversionValue: selection.conversionValue!,
          adIdentifierType: selection.adIdentifierType!,
          adIdentifier: selection.adIdentifier!,
          consentEvidence: state === 'prepared' ? { ...selection.consentEvidence! } : { status: 'review_required' },
          payloadFingerprint: payload.payloadFingerprint,
          destinationAccountId: DESTINATION.operatingAccountId,
          destinationActionId: DESTINATION.productDestinationId,
          state,
          reviewReason: state === 'prepared' ? null : 'consent_review_required',
          createdAt: NOW,
        });
        createdExportIds.push(row.id);
        return row;
      };

      const primaryExport = await prepare(primaryEvidence);
      const samePrimaryExport = await prepare(primaryEvidence);
      assert.equal(samePrimaryExport.id, primaryExport.id);
      await assert.rejects(
        () => repository.prepare({
          salesOrderId: primaryEvidence.salesOrderId,
          quoteLeadId: primaryEvidence.quoteLeadId!,
          originSource: primaryEvidence.originSource!,
          eventTimestamp: primarySelection.eventTimestamp!,
          conversionValue: '999.99',
          adIdentifierType: primarySelection.adIdentifierType!,
          adIdentifier: primarySelection.adIdentifier!,
          consentEvidence: { ...primarySelection.consentEvidence! },
          payloadFingerprint: 'c'.repeat(64),
          destinationAccountId: DESTINATION.operatingAccountId,
          destinationActionId: DESTINATION.productDestinationId,
          state: 'prepared',
          reviewReason: null,
          createdAt: NOW,
        }),
        /snapshot/i,
      );

      const [claimA, claimB] = await Promise.all([
        repository.claim(primaryExport.id, { now: NOW, leaseMs: 60_000 }),
        repository.claim(primaryExport.id, { now: NOW, leaseMs: 60_000 }),
      ]);
      assert.equal(Number(Boolean(claimA)) + Number(Boolean(claimB)), 1);
      const primaryClaim = claimA || claimB;
      assert.ok(primaryClaim);
      assert.equal(primaryClaim.attempt.attemptNo, 1);
      assert.equal(
        await repository.recordTransportOutcome({
          exportId: primaryExport.id,
          attemptId: primaryClaim.attempt.id,
          leaseToken: primaryClaim.leaseToken,
          outcome: {
            kind: 'error',
            error: { kind: 'ambiguous', code: 'GOOGLE_DM_TIMEOUT', detail: 'network result unknown' },
          },
          now: NOW,
        }),
        true
      );
      const unknown = await repository.get(primaryExport.id);
      assert.equal(unknown?.state, 'needs_review');
      assert.equal(unknown?.reviewReason, 'result_unknown');
      const [unknownAttempt] = await database
        .select()
        .from(salesOrderOfflineExportAttempts)
        .where(eq(salesOrderOfflineExportAttempts.exportId, primaryExport.id));
      assert.equal(unknownAttempt?.attemptState, 'unknown');
      assert.equal(
        await repository.recordTransportOutcome({
          exportId: primaryExport.id,
          attemptId: primaryClaim.attempt.id,
          leaseToken: primaryClaim.leaseToken,
          outcome: {
            kind: 'accepted',
            result: { kind: 'accepted', requestId: 'stale-request', httpStatus: 200, fieldWarnings: [] },
          },
          now: NOW,
        }),
        false
      );

      const retryExport = await prepare(evidence.find((item) => item.salesOrderId === retryable.order.id)!);
      const retryClaim = await repository.claim(retryExport.id, { now: NOW, leaseMs: 60_000 });
      assert.ok(retryClaim);
      const retryAt = new Date(NOW.getTime() + 1_000);
      await repository.recordTransportOutcome({
        exportId: retryExport.id,
        attemptId: retryClaim.attempt.id,
        leaseToken: retryClaim.leaseToken,
        outcome: {
          kind: 'error',
          error: { kind: 'transient', code: 'GOOGLE_DM_HTTP_429', httpStatus: 429 },
          retryAt,
        },
        now: NOW,
      });
      assert.equal((await repository.claim(retryExport.id, { now: NOW }))?.attempt.attemptNo, undefined);
      const retryClaimTwo = await repository.claim(retryExport.id, { now: retryAt, leaseMs: 60_000 });
      assert.ok(retryClaimTwo);
      assert.equal(retryClaimTwo.attempt.attemptNo, 2);
      const retryAtTwo = new Date(retryAt.getTime() + 1_000);
      await repository.recordTransportOutcome({
        exportId: retryExport.id,
        attemptId: retryClaimTwo.attempt.id,
        leaseToken: retryClaimTwo.leaseToken,
        outcome: {
          kind: 'error',
          error: { kind: 'transient', code: 'GOOGLE_DM_HTTP_503', httpStatus: 503 },
          retryAt: retryAtTwo,
        },
        now: retryAt,
      });
      const retryClaimThree = await repository.claim(retryExport.id, { now: retryAtTwo, leaseMs: 60_000 });
      assert.ok(retryClaimThree);
      assert.equal(retryClaimThree.attempt.attemptNo, 3);
      await repository.recordTransportOutcome({
        exportId: retryExport.id,
        attemptId: retryClaimThree.attempt.id,
        leaseToken: retryClaimThree.leaseToken,
        outcome: {
          kind: 'error',
          error: { kind: 'transient', code: 'GOOGLE_DM_HTTP_503', httpStatus: 503 },
          retryAt: new Date(retryAtTwo.getTime() + 1_000),
        },
        now: retryAtTwo,
      });
      const retryAttempts = await database
        .select()
        .from(salesOrderOfflineExportAttempts)
        .where(eq(salesOrderOfflineExportAttempts.exportId, retryExport.id));
      assert.deepEqual(retryAttempts.map((item) => item.attemptState).sort(), ['failed', 'failed', 'failed']);
      assert.deepEqual(retryAttempts.map((item) => item.attemptNo).sort((left, right) => left - right), [1, 2, 3]);
      assert.equal((await repository.get(retryExport.id))?.state, 'failed');
      assert.equal((await repository.get(retryExport.id))?.nextAttemptAt, null);

      const acceptedExport = await prepare(evidence.find((item) => item.salesOrderId === accepted.order.id)!);
      let ingestCalls = 0;
      let diagnosticCalls = 0;
      const acceptedService = createAdsOfflineService({
        repository,
        destination: DESTINATION,
        transport: {
          ingest: async () => {
            ingestCalls += 1;
            return {
              kind: 'accepted' as const,
              requestId: 'request-accepted-synthetic',
              httpStatus: 200 as const,
              fieldWarnings: [{
                field: 'events[0]',
                reason: 'WARNING_REASON_GENERIC',
                description: 'Authorization: Bearer synthetic-secret',
              }],
            };
          },
          retrieveStatus: async (requestId) => {
            diagnosticCalls += 1;
            assert.equal(requestId, 'request-accepted-synthetic');
            return { status: 'success' as const };
          },
        },
        now: () => NOW,
      });
      const applyReport = await acceptedService.apply({
        from: new Date('2026-09-01T00:00:00Z'),
        to: new Date('2026-09-02T00:00:00Z'),
        approvedOrderIds: new Set([accepted.order.id]),
        preflightProof: PREFLIGHT_PROOF,
        runtimeTarget: RUNTIME_TARGET,
      });
      assert.equal(
        applyReport.rows.find((row) => row.salesOrderId === accepted.order.id)?.category,
        'accepted_pending_diagnostic'
      );
      assert.equal(ingestCalls, 1);
      assert.equal((await repository.get(acceptedExport.id))?.state, 'accepted_pending_diagnostic');
      await repository.recordDiagnostic({
        exportId: acceptedExport.id,
        attemptId: (await repository.getLatestAcceptedAttempt(acceptedExport.id))!.id,
        requestId: 'request-accepted-synthetic',
        result: { status: 'processing' },
        checkedAt: NOW,
      });
      assert.equal((await repository.get(acceptedExport.id))?.state, 'accepted_pending_diagnostic');
      assert.equal(await acceptedService.diagnose({
        exportId: acceptedExport.id,
        preflightProof: PREFLIGHT_PROOF,
        runtimeTarget: RUNTIME_TARGET,
      }), true);
      assert.equal(diagnosticCalls, 1);
      assert.equal((await repository.get(acceptedExport.id))?.state, 'processed');
      const [acceptedAttempt] = await database
        .select()
        .from(salesOrderOfflineExportAttempts)
        .where(eq(salesOrderOfflineExportAttempts.exportId, acceptedExport.id));
      assert.equal(acceptedAttempt?.diagnosticStatus, 'success');
      assert.deepEqual(acceptedAttempt?.fieldWarnings, [
        { code: 'GOOGLE_DM_FIELD_WARNING', field: 'events[0]', reason: 'WARNING_REASON_GENERIC' },
      ]);
      await database
        .update(salesOrders)
        .set({ grandTotal: '999.99' })
        .where(eq(salesOrders.id, accepted.order.id));
      const changedEvidence = (await repository.listOrderEvidence({
        from: new Date('2026-09-01T00:00:00Z'),
        to: new Date('2026-09-02T00:00:00Z'),
      })).find((item) => item.salesOrderId === accepted.order.id);
      assert.ok(changedEvidence);
      const changedSelection = selectOfflineOrder(changedEvidence, {
        approvedOrderIds: new Set([accepted.order.id]),
      });
      const changedPayload = buildOfflinePayload(
        {
          salesOrderId: changedEvidence.salesOrderId,
          quoteLeadId: changedEvidence.quoteLeadId!,
          originSource: changedEvidence.originSource!,
          eventTimestamp: changedSelection.eventTimestamp!,
          conversionValue: changedSelection.conversionValue!,
          adIdentifierType: changedSelection.adIdentifierType!,
          adIdentifier: changedSelection.adIdentifier!,
          consentEvidence: changedSelection.consentEvidence!,
        },
        DESTINATION
      );
      assert.equal(
        await repository.reconcileSnapshot({
          exportId: acceptedExport.id,
          snapshot: {
            salesOrderId: changedEvidence.salesOrderId,
            quoteLeadId: changedEvidence.quoteLeadId!,
            originSource: changedEvidence.originSource!,
            eventTimestamp: changedSelection.eventTimestamp!,
            conversionValue: changedSelection.conversionValue!,
            adIdentifierType: changedSelection.adIdentifierType!,
            adIdentifier: changedSelection.adIdentifier!,
            consentEvidence: { ...changedSelection.consentEvidence! },
            payloadFingerprint: changedPayload.payloadFingerprint,
            destinationAccountId: DESTINATION.operatingAccountId,
            destinationActionId: DESTINATION.productDestinationId,
            state: 'prepared',
            reviewReason: null,
            createdAt: NOW,
          },
          now: NOW,
        }),
        'needs_review'
      );
      assert.equal((await repository.get(acceptedExport.id))?.reviewReason, 'correction_after_attempt');

      const partialExport = await prepare(evidence.find((item) => item.salesOrderId === partialDiagnostic.order.id)!);
      const partialClaim = await repository.claim(partialExport.id, { now: NOW, leaseMs: 60_000 });
      assert.ok(partialClaim);
      await repository.recordTransportOutcome({
        exportId: partialExport.id,
        attemptId: partialClaim.attempt.id,
        leaseToken: partialClaim.leaseToken,
        outcome: { kind: 'accepted', result: { kind: 'accepted', requestId: 'request-partial', httpStatus: 200, fieldWarnings: [] } },
        now: NOW,
      });
      await repository.recordDiagnostic({
        exportId: partialExport.id,
        attemptId: partialClaim.attempt.id,
        requestId: 'request-partial',
        result: {
          status: 'partial_success',
          errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_INVALID_EVENT', recordCount: 2 }],
          warningCounts: [{ reason: 'PROCESSING_WARNING_REASON_INTERNAL_ERROR', recordCount: 1 }],
        },
        checkedAt: NOW,
      });
      assert.equal((await repository.get(partialExport.id))?.state, 'needs_review');
      assert.equal((await repository.get(partialExport.id))?.reviewReason, 'diagnostic_partial_success');
      const [partialAttempt] = await database
        .select()
        .from(salesOrderOfflineExportAttempts)
        .where(eq(salesOrderOfflineExportAttempts.id, partialClaim.attempt.id));
      assert.deepEqual(partialAttempt?.fieldWarnings, [
        { code: 'GOOGLE_DM_DIAGNOSTIC_ERROR_COUNT', reason: 'PROCESSING_ERROR_REASON_INVALID_EVENT', recordCount: 2 },
        { code: 'GOOGLE_DM_DIAGNOSTIC_WARNING_COUNT', reason: 'PROCESSING_WARNING_REASON_INTERNAL_ERROR', recordCount: 1 },
      ]);

      const expiredExport = await prepare(evidence.find((item) => item.salesOrderId === expired.order.id)!);
      const expiredClaim = await repository.claim(expiredExport.id, { now: NOW, leaseMs: 1_000 });
      assert.ok(expiredClaim);
      const afterLease = new Date(NOW.getTime() + 2_000);
      assert.equal(await repository.recoverExpiredSending(afterLease), 1);
      assert.equal((await repository.get(expiredExport.id))?.reviewReason, 'lease_expired_after_transport');
      assert.equal(
        await repository.recordTransportOutcome({
          exportId: expiredExport.id,
          attemptId: expiredClaim.attempt.id,
          leaseToken: expiredClaim.leaseToken,
          outcome: { kind: 'accepted', result: { kind: 'accepted', requestId: 'stale-after-lease', httpStatus: 200, fieldWarnings: [] } },
          now: afterLease,
        }),
        false
      );

      const cancelledExport = await prepare(evidence.find((item) => item.salesOrderId === cancelledBeforeAttempt.order.id)!);
      assert.equal(await repository.cancelOrReview({ exportId: cancelledExport.id, kind: 'cancellation', now: NOW }), 'deleted');
      assert.equal(await repository.get(cancelledExport.id), null);
      createdExportIds.splice(createdExportIds.indexOf(cancelledExport.id), 1);
      assert.equal(await repository.cancelOrReview({ exportId: acceptedExport.id, kind: 'cancellation', now: NOW }), 'needs_review');
      assert.equal((await repository.get(acceptedExport.id))?.reviewReason, 'cancellation_after_attempt');
      assert.equal(await repository.cancelOrReview({ exportId: primaryExport.id, kind: 'correction', now: NOW }), 'needs_review');
      assert.equal((await repository.get(primaryExport.id))?.reviewReason, 'correction_after_attempt');

      await database
        .update(salesOrders)
        .set({ quotationRevisionId: primary.revisionId })
        .where(eq(salesOrders.id, conflict.order.id));
      const conflictEvidence = (await repository.listOrderEvidence({ from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-02T00:00:00Z') }))
        .find((item) => item.salesOrderId === conflict.order.id);
      assert.ok(conflictEvidence);
      assert.equal(conflictEvidence.originStatus, 'conflict');
      assert.equal(selectOfflineOrder(conflictEvidence, { approvedOrderIds: new Set([conflict.order.id]) }).status, 'excluded');

      const reviewSnapshot = await prepare(evidence.find((item) => item.salesOrderId === conflict.order.id)!, 'needs_review');
      assert.equal(reviewSnapshot.reviewReason, 'consent_review_required');
      await assert.rejects(
        () => database.insert(salesOrderOfflineExportAttempts).values({
          id: randomUUID(),
          exportId: reviewSnapshot.id,
          attemptNo: 99,
          correlationId: randomUUID(),
          attemptState: 'started',
          startedAt: NOW,
          finishedAt: NOW,
        }),
        hasPostgresConstraint('sales_order_offline_export_attempts_finished_check'),
      );
      await assert.rejects(
        () => database.insert(salesOrderOfflineExports).values({
          id: randomUUID(),
          salesOrderId: retryable.order.id,
          quoteLeadId: retryable.leadId,
          originSource: 'site_form',
          eventType: 'pedido_iniciado',
          destinationAccountId: '2222222222',
          destinationActionId: '3333333333',
          transactionId: `aspen-pedido-iniciado:${retryable.order.id}`,
          eventTimestamp: NOW,
          conversionValue: '1.00',
          currency: 'BRL',
          eventSource: 'OTHER',
          adIdentifierType: 'gclid',
          adIdentifier: 'opaque-review',
          consentEvidence: { status: 'review_required' },
          payloadFingerprint: 'd'.repeat(64),
          state: 'needs_review',
          reviewReason: null,
          createdAt: NOW,
          updatedAt: NOW,
        }),
        hasPostgresConstraint('sales_order_offline_exports_review_reason_check'),
      );
      await assert.rejects(
        () => database.delete(salesOrders).where(eq(salesOrders.id, primary.order.id)),
        hasPostgresConstraint('sales_order_offline_exports_sales_order_id_sales_orders_id_fk'),
      );

      let transportCalls = 0;
      const beforeExports = await database
        .select({ count: sql<number>`count(*)::int` })
        .from(salesOrderOfflineExports);
      const service = createAdsOfflineService({
        repository,
        destination: DESTINATION,
        transport: {
          ingest: async () => {
            transportCalls += 1;
            throw new Error('transport must not run in dry-run');
          },
          retrieveStatus: async () => {
            transportCalls += 1;
            throw new Error('diagnostic must not run in dry-run');
          },
        },
        now: () => NOW,
      });
      const dryRun = await service.preview({
        from: new Date('2026-09-01T00:00:00Z'),
        to: new Date('2026-09-02T00:00:00Z'),
        approvedOrderIds: new Set([primary.order.id]),
      });
      const afterExports = await database
        .select({ count: sql<number>`count(*)::int` })
        .from(salesOrderOfflineExports);
      assert.equal(afterExports[0]?.count, beforeExports[0]?.count);
      assert.equal(transportCalls, 0);
      assert.ok(dryRun.rows.every((row) => !row.reasons.includes('dry_run_write')));

      const payload = makePayload(primaryEvidence);
      assert.equal(payload.payload.events[0].conversionValue, Number(primaryEvidence.total));
      assert.equal(payload.payload.events[0].eventTimestamp, NOW.toISOString());
      assert.equal(JSON.stringify(payload.payload).includes('example.test'), false);
      assert.equal(JSON.stringify(payload.payload).includes('opaque-gclid-primary'), true);
      assert.equal(JSON.stringify(payload.payload).includes('nome'), false);
    } catch (error) {
      bodyError = error;
      throw error;
    } finally {
      let cleanupError: unknown;
      try {
        if (createdExportIds.length) {
          await database
            .delete(salesOrderOfflineExportAttempts)
            .where(inArray(salesOrderOfflineExportAttempts.exportId, createdExportIds));
          await database
            .delete(salesOrderOfflineExports)
            .where(inArray(salesOrderOfflineExports.id, createdExportIds));
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
        console.error(`[ads-offline-test] cleanup failed (${error instanceof Error ? error.name : typeof error})`);
      }
      await client.end({ timeout: 5 });
      await lockClient`SELECT pg_advisory_unlock(hashtext('aspen-quotation-postgres-tests'))`;
      await lockClient.end({ timeout: 5 });
      if (cleanupError && !bodyError) throw cleanupError;
    }
  }
);
