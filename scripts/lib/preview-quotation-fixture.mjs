import postgres from 'postgres';
import { parsePostgresUrl, postgresIdentity } from '../postgres-target.mjs';

// Deve coincidir com o lock de escrita de quotations do app.
const QUOTATION_WRITE_LOCK_KEY = 8417392051842n;

const BUSINESS_NUMBER_PATTERN = /^ORC-[0-9]{8}$/;
const DB_OPTIONS = Object.freeze({
  max: 1,
  prepare: false,
  connect_timeout: 5,
  idle_timeout: 5,
  query_timeout: 10_000,
  transaction_timeout: 15_000,
});
const BLOCKED_REFERENCE_KEYS = Object.freeze([
  'issuedDocuments',
  'opportunityDeliveryAnchors',
  'quotationDeliveries',
  'quotationEmailDeliveries',
  'quotationFollowUps',
  'quotationIssueRequests',
  'salesOrders',
]);

export class PreviewQuotationFixtureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PreviewQuotationFixtureError';
  }
}

export function validatePreviewQuotationFixtureConfig(env = process.env) {
  if (String(env.APP_ENV || '').trim() !== 'preview') {
    throw new PreviewQuotationFixtureError('APP_ENV=preview é obrigatório para restaurar a fixture.');
  }
  if (String(env.EXTERNAL_WRITES_ENABLED || '').trim() !== '0') {
    throw new PreviewQuotationFixtureError('EXTERNAL_WRITES_ENABLED=0 é obrigatório para restaurar a fixture.');
  }
  if (String(env.PREVIEW_FIXTURE_RESET || '').trim() !== '1') {
    throw new PreviewQuotationFixtureError('PREVIEW_FIXTURE_RESET=1 é obrigatório para restaurar a fixture.');
  }

  const primaryBusinessNumber = String(env.KNOWN_POSTGRES_QUOTATION_ID || '').trim();
  if (!primaryBusinessNumber) {
    throw new PreviewQuotationFixtureError('KNOWN_POSTGRES_QUOTATION_ID é obrigatório para restaurar a fixture.');
  }

  const businessNumber = String(env.KNOWN_POSTGRES_SCRATCH_QUOTATION_ID || '').trim();
  if (!BUSINESS_NUMBER_PATTERN.test(businessNumber)) {
    throw new PreviewQuotationFixtureError('KNOWN_POSTGRES_SCRATCH_QUOTATION_ID tem formato inválido.');
  }
  if (primaryBusinessNumber.toLowerCase() === businessNumber.toLowerCase()) {
    throw new PreviewQuotationFixtureError('Os IDs primário e scratch não podem identificar o mesmo orçamento.');
  }

  const databaseUrl = String(env.DATABASE_URL || '').trim();
  const productionDatabaseUrl = String(env.PRODUCTION_DATABASE_URL || '').trim();
  if (!databaseUrl || !productionDatabaseUrl) {
    throw new PreviewQuotationFixtureError('DATABASE_URL e PRODUCTION_DATABASE_URL são obrigatórias para a fixture.');
  }

  let database;
  let production;
  try {
    database = parsePostgresUrl(databaseUrl, 'DATABASE_URL');
    production = parsePostgresUrl(productionDatabaseUrl, 'PRODUCTION_DATABASE_URL');
  } catch {
    throw new PreviewQuotationFixtureError('Os alvos PostgreSQL da fixture são inválidos.');
  }
  if (postgresIdentity(database) === postgresIdentity(production)) {
    throw new PreviewQuotationFixtureError('Preview e produção não podem compartilhar o mesmo banco.');
  }

  return Object.freeze({ businessNumber, databaseUrl });
}

function fixedStateError() {
  return new PreviewQuotationFixtureError('Estado da fixture Preview não é um dos estados permitidos.');
}

function countForRevision(issuedDocuments, revisionId) {
  return Number(issuedDocuments.find((row) => row.revision_id === revisionId)?.count || 0);
}

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isCommerciallyValid(quotation, revision, now) {
  const quotationIssuedAt = validDate(quotation?.issued_at);
  const revisionIssuedAt = validDate(revision?.issued_at);
  const current = validDate(now);
  const days = Number(revision?.validade_dias);
  if (!quotationIssuedAt || !revisionIssuedAt || !current || !Number.isInteger(days) || days < 1 || days > 365) {
    return false;
  }
  const validUntil = revisionIssuedAt.getTime() + days * 24 * 60 * 60 * 1000;
  return validUntil >= current.getTime();
}

function isR1(revision) {
  return revision?.version === 1 && revision?.status === 'emitido' && Boolean(revision?.issued_at);
}

function isBaseline(state, now) {
  const quotation = state?.quotation;
  const [revision] = state?.revisions || [];
  return Boolean(
    quotation?.status === 'emitido' &&
      quotation?.loss_reason == null &&
      (state?.revisions || []).length === 1 &&
      isR1(revision) &&
      isCommerciallyValid(quotation, revision, now) &&
      !state.draft,
  );
}

function isRestrictedRestoreState(state, now) {
  const quotation = state?.quotation;
  const revisions = state?.revisions || [];
  const revisionOne = revisions.find((revision) => revision.version === 1);
  const revisionTwo = revisions.find((revision) => revision.version === 2);
  const draft = state?.draft;
  const blocked = draft?.blockedReferences;
  const blockedCount = BLOCKED_REFERENCE_KEYS.reduce(
    (total, key) => total + Number(blocked?.[key] || 0),
    0,
  );

  return Boolean(
    quotation?.status === 'rascunho' &&
      quotation?.loss_reason == null &&
      revisions.length === 2 &&
      revisionOne &&
      revisionTwo &&
      revisionOne.id !== revisionTwo.id &&
      isR1(revisionOne) &&
      revisionTwo.version === 2 &&
      revisionTwo.status === 'rascunho' &&
      revisionTwo.issued_at == null &&
      countForRevision(state.issuedDocuments || [], revisionTwo.id) === 0 &&
      isCommerciallyValid(quotation, revisionOne, now) &&
      Number.isInteger(Number(draft?.itemCount)) &&
      Number(draft.itemCount) > 0 &&
      (Number(draft.activityEventCount) === Number(draft.itemCount) ||
        Number(draft.activityEventCount) === Number(draft.itemCount) * 2) &&
      blockedCount === 0,
  );
}

export function planPreviewQuotationReset(state, now = new Date()) {
  if (isBaseline(state, now)) return { kind: 'noop' };
  if (!isRestrictedRestoreState(state, now)) throw fixedStateError();

  const revisionTwo = state.revisions.find((revision) => revision.version === 2);
  return {
    kind: 'restore',
    quotationId: state.quotation.id,
    draftRevisionId: revisionTwo.id,
    activityReferencePrefix: `orcamento:${state.quotation.id}:${revisionTwo.id}:`,
    itemCount: Number(state.draft.itemCount),
    activityEventCount: Number(state.draft.activityEventCount),
  };
}

function numericCount(value) {
  const count = Number(value || 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : -1;
}

function firstRow(rows) {
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

async function readState(tx, quotationBusinessNumber, { includeDraftArtifacts = true } = {}) {
  const quotationRows = await tx`
    SELECT id, business_number, status, issued_at, loss_reason
    FROM quotations
    WHERE business_number = ${quotationBusinessNumber}
    FOR UPDATE
  `;
  const quotation = firstRow(quotationRows);
  if (!quotation) throw new PreviewQuotationFixtureError('Fixture de orçamento não encontrada.');

  const revisions = await tx`
    SELECT id, version, status, issued_at, validade_dias
    FROM quote_revisions
    WHERE quotation_id = ${quotation.id}::uuid
    ORDER BY version
    FOR UPDATE
  `;
  const issuedDocuments = await tx`
    SELECT revision_id, count(*)::integer AS count
    FROM issued_documents
    WHERE quotation_id = ${quotation.id}::uuid
    GROUP BY revision_id
  `;
  const state = { quotation, revisions, issuedDocuments };
  const revisionTwo = revisions.find((revision) => Number(revision.version) === 2);
  if (!includeDraftArtifacts || !revisionTwo) return state;

  const revisionId = revisionTwo.id;
  const activityReferencePrefix = `orcamento:${quotation.id}:${revisionId}:`;
  const [itemRows, eventRows, blockedRows] = await Promise.all([
    tx`
      SELECT count(*)::integer AS count
      FROM quote_revision_items
      WHERE revision_id = ${revisionId}::uuid
    `,
    tx`
      SELECT count(*)::integer AS count
      FROM product_activity_events
      WHERE reference_id LIKE ${`${activityReferencePrefix}%`}
    `,
    tx`
      SELECT
        (SELECT count(*) FROM issued_documents WHERE revision_id = ${revisionId}::uuid) AS issued_documents,
        (SELECT count(*) FROM opportunity_delivery_anchors WHERE revision_id = ${revisionId}::uuid) AS opportunity_delivery_anchors,
        (SELECT count(*) FROM quotation_deliveries WHERE revision_id = ${revisionId}::uuid) AS quotation_deliveries,
        (SELECT count(*) FROM quotation_email_deliveries WHERE revision_id = ${revisionId}::uuid) AS quotation_email_deliveries,
        (SELECT count(*) FROM quotation_follow_ups WHERE revision_id = ${revisionId}::uuid) AS quotation_follow_ups,
        (SELECT count(*) FROM quotation_issue_requests WHERE revision_id = ${revisionId}::uuid) AS quotation_issue_requests,
        (SELECT count(*) FROM sales_orders WHERE quotation_revision_id = ${revisionId}::uuid) AS sales_orders
    `,
  ]);
  const blocked = firstRow(blockedRows);
  state.draft = {
    itemCount: numericCount(firstRow(itemRows)?.count),
    activityEventCount: numericCount(firstRow(eventRows)?.count),
    blockedReferences: {
      issuedDocuments: numericCount(blocked?.issued_documents),
      opportunityDeliveryAnchors: numericCount(blocked?.opportunity_delivery_anchors),
      quotationDeliveries: numericCount(blocked?.quotation_deliveries),
      quotationEmailDeliveries: numericCount(blocked?.quotation_email_deliveries),
      quotationFollowUps: numericCount(blocked?.quotation_follow_ups),
      quotationIssueRequests: numericCount(blocked?.quotation_issue_requests),
      salesOrders: numericCount(blocked?.sales_orders),
    },
  };
  return state;
}

function ensureSingleDeleted(rows, expected) {
  return Array.isArray(rows) && rows.length === expected;
}

async function restoreInTransaction(tx, businessNumber, now) {
  await tx`SET LOCAL lock_timeout = '5s'`;
  await tx`SET LOCAL statement_timeout = '10s'`;
  await tx`SELECT pg_advisory_xact_lock(${QUOTATION_WRITE_LOCK_KEY}::bigint)`;

  const state = await readState(tx, businessNumber);
  const plan = planPreviewQuotationReset(state, now);
  if (plan.kind === 'noop') return plan;

  const deletedEvents = await tx`
    DELETE FROM product_activity_events
    WHERE reference_id LIKE ${`${plan.activityReferencePrefix}%`}
    RETURNING id
  `;
  if (!ensureSingleDeleted(deletedEvents, plan.activityEventCount)) throw fixedStateError();

  const deletedRevisions = await tx`
    DELETE FROM quote_revisions
    WHERE id = ${plan.draftRevisionId}::uuid
      AND quotation_id = ${plan.quotationId}::uuid
      AND version = 2
      AND status = 'rascunho'
    RETURNING id
  `;
  if (!ensureSingleDeleted(deletedRevisions, 1)) throw fixedStateError();

  const remainingDraftItems = await tx`
    SELECT count(*)::integer AS count
    FROM quote_revision_items
    WHERE revision_id = ${plan.draftRevisionId}::uuid
  `;
  if (numericCount(firstRow(remainingDraftItems)?.count) !== 0) throw fixedStateError();

  await tx`
    UPDATE quotations
    SET status = 'emitido', loss_reason = NULL, updated_at = now()
    WHERE id = ${plan.quotationId}::uuid
      AND status = 'rascunho'
  `;

  const finalState = await readState(tx, businessNumber, { includeDraftArtifacts: false });
  const originalIssuedAt = validDate(state.quotation.issued_at);
  const finalIssuedAt = validDate(finalState.quotation.issued_at);
  if (
    !isBaseline(finalState, now) ||
    !originalIssuedAt ||
    !finalIssuedAt ||
    finalIssuedAt.getTime() !== originalIssuedAt.getTime()
  ) throw fixedStateError();
  const remainingEvents = await tx`
    SELECT count(*)::integer AS count
    FROM product_activity_events
    WHERE reference_id LIKE ${`${plan.activityReferencePrefix}%`}
  `;
  if (numericCount(firstRow(remainingEvents)?.count) !== 0) throw fixedStateError();
  return plan;
}

export async function restorePreviewQuotationFixture(env = process.env, options = {}) {
  const config = validatePreviewQuotationFixtureConfig(env);
  const connect = options.connect || postgres;
  const now = options.now ? options.now() : new Date();
  let client;
  try {
    client = connect(config.databaseUrl, DB_OPTIONS);
    await client.begin((tx) => restoreInTransaction(tx, config.businessNumber, now));
  } catch (error) {
    if (error instanceof PreviewQuotationFixtureError) throw error;
    throw new PreviewQuotationFixtureError('Falha ao restaurar a fixture Preview.');
  } finally {
    if (client && typeof client.end === 'function') {
      try {
        await client.end({ timeout: 5 });
      } catch {
        // The operation result is already fixed and sanitized above.
      }
    }
  }
}
