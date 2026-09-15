import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from '../client.js';
import { createDbDeadline, runBoundedStatement, type DbDeadline } from '../deadline.js';
import { addBusinessDays, calendarDateInSaoPaulo } from '../../../_shared/calendar-sao-paulo.js';
import {
  buildDefaultFollowUpMessage,
  evaluateFollowUp,
  followUpReasonLabel,
  followUpVisibleListView,
  parseFollowUpTrackingStartedAt,
  type DismissReason,
  type FollowUpEvaluation,
  type FollowUpListView,
  type FollowUpPersistedState,
  type FollowUpProjectionState,
} from '../../../_modules/quotation-follow-up-state.js';
import {
  advanceConfirmedFollowUp,
  applyAssociateResponseTransition,
  applyInboundResponseTransition,
  applyVerifyConversationTransition,
  ASSOCIATE_RESPONSE_REASON_CODE,
} from './opportunity-actions-repository.js';
import { classifyInboundAssociation } from '../../../_modules/commercial-inbound-association.js';
import { followUpAttemptNumber, followUpCycleNumber } from './follow-up-cycle.js';
import {
  commercialInboundEvents,
  quotationFollowUpAttemptHistory,
  quotationFollowUps,
} from '../schema.js';

type Database = AppDatabase | Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type DatabaseProvider = () => AppDatabase;

export class InputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}
export class ConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = 'Orçamento não encontrado.') {
    super(message);
    this.name = 'NotFoundError';
  }
}
export class RepositoryError extends Error {
  readonly statusCode = 503;
  constructor(message = 'Não foi possível atualizar a fila de follow-up. Tente novamente.') {
    super(message);
    this.name = 'RepositoryError';
  }
}

export interface FollowUpListInput {
  view?: FollowUpListView;
  page?: number;
  pageSize?: number;
  trackingStartedAt?: Date;
  now?: Date;
}
export interface FollowUpProjection {
  quotationId: string;
  revisionId: string;
  deliveryId: string;
  cycleNumber: number;
  attemptNumber: 1 | 2;
  sourceActionId: string | null;
  businessNumber: string;
  clientName: string;
  amount: string;
  instance: string;
  providerConversationId: string;
  canonicalPhone: string;
  deliveryCreatedAt: Date;
  firstProviderReceiptAt: Date | null;
  dueAt: Date | null;
  eligibilityVersion: string | null;
  state: FollowUpProjectionState | FollowUpPersistedState;
  reason: string;
  reasonLabel: string;
  followUpId: string | null;
  approvedOpportunityId?: string | null;
  messageSnapshot: string | null;
  closedReason: string | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  updatedAt: Date;
}
export interface FollowUpGetOptions {
  trackingStartedAt?: Date;
  now?: Date;
  expectedOpportunityId?: string;
  expectedActionId?: string;
}
export interface FollowUpListResult {
  data: FollowUpProjection[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ApproveInput {
  quotationId: string;
  eligibilityVersion: string;
  message: string;
  trackingStartedAt?: Date;
  now?: Date;
}
export interface DismissInput {
  quotationId: string;
  eligibilityVersion: string;
  reason: DismissReason;
  trackingStartedAt?: Date;
  now?: Date;
}
export interface FollowUpRecord extends FollowUpProjection {
  state: FollowUpPersistedState;
}
export interface ClaimedFollowUp {
  followUp: FollowUpRecord;
  leaseToken: string;
}
export interface AcceptedDeliveryCandidate {
  deliveryId: string;
  revisionId: string;
  phone: string;
  providerMessageId: string;
  // Provider acceptance clock of the first accepted step. Used as the activity
  // `occurredAt` so re-projecting the same acceptance on a retry is a no-op
  // instead of advancing the durable activity clock.
  acceptedAt: Date | null;
}
export interface AwaitingReceiptCandidate {
  followUpId: string;
  deliveryId: string;
  revisionId: string;
  phone: string;
  providerMessageId: string;
  receivedAt: Date;
}
export interface CandidatePage<T> {
  data: T[];
  // True when the source was truncated by the caller's limit, i.e. durable work
  // remains even after this slice. Callers must never report `remaining: false`
  // while a saturated source still has candidates.
  hasMore: boolean;
}
export type ProjectionAttemptOptions = { deadline?: DbDeadline; timeoutMs?: number };
export interface QuotationFollowUpRepository {
  list(input?: FollowUpListInput): Promise<FollowUpListResult>;
  get(quotationId: string, options?: FollowUpGetOptions): Promise<FollowUpProjection | null>;
  approve(input: ApproveInput): Promise<FollowUpRecord>;
  dismiss(input: DismissInput): Promise<FollowUpRecord>;
  upsertAwaitingReceiptFromAcceptedDelivery?(
    input: {
      deliveryId: string;
      revisionId: string;
      phone: string;
      providerMessageId: string;
    },
    options?: ProjectionAttemptOptions
  ): Promise<void>;
  listAcceptedDeliveriesMissingFollowUp?(
    filter?: {
      deliveryId?: string;
      limit?: number;
    },
    options?: ProjectionAttemptOptions
  ): Promise<CandidatePage<AcceptedDeliveryCandidate>>;
  markAcceptanceProjectionAttempt?(
    input: { deliveryId: string },
    options?: ProjectionAttemptOptions
  ): Promise<void>;
  listAwaitingReceiptWithCompletedDelivery?(
    filter?: {
      deliveryId?: string;
      limit?: number;
    },
    options?: ProjectionAttemptOptions
  ): Promise<CandidatePage<AwaitingReceiptCandidate>>;
  markReceiptProjectionAttempt?(
    input: { followUpId: string },
    options?: ProjectionAttemptOptions
  ): Promise<void>;
  upsertFromDeliveryReceipt?(
    input: {
      deliveryId: string;
      revisionId: string;
      phone: string;
      providerConversationId: string;
      allStepsDelivered: boolean;
      receivedAt: Date;
    },
    options?: ProjectionAttemptOptions
  ): Promise<void>;
  applyConversationToOpenFollowUps?(input: {
    instance: string;
    providerConversationId: string;
    providerMessageId: string;
    fromMe: boolean;
    occurredAt: Date;
    identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict';
    canonicalPhone: string | null;
  }): Promise<void>;
  promoteDueWaitingToReady?(now?: Date): Promise<number>;
  claimApproved(id?: string): Promise<ClaimedFollowUp | null>;
  markTransportStarted(id: string, leaseToken: string): Promise<boolean>;
  completeSent(input: {
    id: string;
    leaseToken: string;
    providerMessageId: string;
    now?: Date;
  }): Promise<FollowUpRecord | null>;
  completeFailed(input: { id: string; leaseToken: string; reason: 'provider_rejected' | 'rate_limited' }): Promise<FollowUpRecord | null>;
  completeNeedsReview(input: {
    id: string;
    leaseToken: string;
    reason?: 'transport_ambiguous' | 'lease_expired_after_transport';
  }): Promise<FollowUpRecord | null>;
  reapExpiredLeases(limit?: number): Promise<number>;
  countApprovalsTodayUtc(now?: Date): Promise<number>;
}

const STALE = 'A fila mudou. Recarregue e tente novamente.';
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_APPROVED_CANDIDATES_PER_CLAIM = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_KEYS = [
  'opportunityId',
  'sourceActionId',
  'sourceActionState',
  'sourceActionVersion',
  'sourceActionUpdatedAt',
  'clientId',
  'clientName',
  'quotationId',
  'quotationStatus',
  'revisionId',
  'businessNumber',
  'amount',
  'deliveryCreatedAt',
  'deliveryState',
  'completionSource',
  'blockedAt',
  'contactBlockedAt',
  'crmUpdatedAt',
  'crmStatus',
  'deliveryId',
  'firstProviderReceiptAt',
  'identityStatus',
  'activityUpdatedAt',
  'activityConversationId',
  'currentCanonicalPhone',
  'ingestionBlockedAt',
  'ingestionHealthUpdatedAt',
  'lastInboundAt',
  'lastInboundId',
  'lastOutboundAt',
  'lastOutboundId',
  'quotationUpdatedAt',
  'approvedCanonicalPhone',
  'approvedProviderConversationId',
  'unresolvedLidWatermark',
  'followUpCycleNumber',
  'followUpAttemptNumber',
  'followUpSourceActionId',
  'followUpStage',
] as const;
const DISMISSED_MESSAGE_SNAPSHOT = 'dispensado';

function asDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}
function requiredDate(value: unknown, label: string): Date {
  const date = asDate(value);
  if (!date) throw new RepositoryError(`Data inválida em ${label}.`);
  return date;
}
function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new InputError(`${label} inválido.`);
  return value;
}
function cleanMessage(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 4000 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return (code <= 31 && code !== 9 && code !== 10) || code === 127;
    })
  ) {
    throw new InputError('Mensagem inválida.');
  }
  return value.trim();
}
function page(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new InputError('Página inválida.');
  return value;
}
function configuredInstance(): string {
  return String(process.env.EVOLUTION_INSTANCE || '').trim();
}
function tracking(value?: Date): Date | null {
  return value === undefined ? parseFollowUpTrackingStartedAt(process.env.QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT) : asDate(value);
}
function factValue(row: Record<string, unknown>, key: string): string | null {
  const snake = key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
  const value = row[key] ?? row[snake];
  if (value == null) return null;
  return asDate(value)?.toISOString() ?? String(value);
}
function hash(row: Record<string, unknown>): string {
  const facts: Record<string, string | null> = {};
  for (const key of HASH_KEYS) facts[key] = factValue(row, key);
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}
function digits(value: unknown): string {
  return String(value || '').replace(/[^0-9]/g, '');
}

function acceptedCanonicalPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (/@(?:g\.us|broadcast|status)$/i.test(raw)) return null;
  if (/@lid$/i.test(raw)) return null;
  if (raw.includes('@') && !/^\d{10,15}@s\.whatsapp\.net$/i.test(raw)) return null;
  if (!raw.includes('@') && !/^\+?[0-9().\s-]+$/.test(raw)) return null;
  const phone = digits(raw);
  return /^\d{10,15}$/.test(phone) ? phone : null;
}
function acceptedLidConversation(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || /@(?:g\.us|broadcast|status)$/i.test(raw)) return null;
  return /@lid$/i.test(raw) ? raw : null;
}
function iso(value: Date): string {
  return value.toISOString();
}

function postProposalDueDate(receivedAt: Date): string {
  return addBusinessDays(calendarDateInSaoPaulo(receivedAt), 2);
}
function projection(
  row: Record<string, unknown>,
  state: FollowUpProjectionState | FollowUpPersistedState,
  evaluation?: FollowUpEvaluation,
): FollowUpProjection {
    const clientName = String(row.client_name);
    const businessNumber = String(row.business_number);
    const persistedConversation = String(row.follow_up_provider_conversation_id || '').trim();
    const canonicalPhone = digits(
        row.follow_up_id != null
            ? row.follow_up_canonical_phone
            : row.canonical_phone || (acceptedLidConversation(persistedConversation) ? '' : row.delivery_phone),
    );
    const conversation = persistedConversation ||
        String(row.activity_conversation_id || row.provider_conversation_id || '').trim() ||
        (canonicalPhone ? `${canonicalPhone}@s.whatsapp.net` : '');
    const reason = evaluation && (evaluation.kind === 'cancel' || evaluation.kind === 'hold')
        ? evaluation.reason
        : row.reason == null
            ? row.closed_reason == null && state === 'held' && !canonicalPhone
                ? 'identity_unresolved'
                : row.closed_reason == null
                    ? state
                    : String(row.closed_reason)
            : String(row.reason);
    const snapshot = row.message_snapshot == null
        ? state === 'ready' || state === 'waiting'
            ? buildDefaultFollowUpMessage({ clientName, businessNumber })
            : null
        : String(row.message_snapshot);
    const persisted = row.follow_up_id != null;
    const firstProviderReceiptAt = asDate(persisted ? row.follow_up_first_provider_receipt_at : row.first_provider_receipt_at);
    const dueAt = asDate(persisted ? row.follow_up_due_at : row.due_at);
    return {
        quotationId: String(row.quotation_id),
        revisionId: String(row.follow_up_revision_id || row.revision_id),
        deliveryId: String(row.follow_up_delivery_id || row.delivery_id),
        cycleNumber: Number(row.follow_up_cycle_number || 1),
        attemptNumber: (Number(row.follow_up_attempt_number || 1) === 2 ? 2 : 1) as 1 | 2,
        sourceActionId:
            row.follow_up_source_action_id == null ? null : String(row.follow_up_source_action_id),
        businessNumber,
        clientName,
        amount: String(row.amount),
        instance: String(row.instance),
        providerConversationId: conversation,
        canonicalPhone,
        deliveryCreatedAt: requiredDate(row.delivery_created_at, 'entrega'),
        firstProviderReceiptAt,
        dueAt,
        eligibilityVersion: row.follow_up_eligibility_version == null && row.eligibility_version == null
            ? state === 'awaiting_receipt'
                ? null
                : hash(row)
            : String(row.follow_up_eligibility_version ?? row.eligibility_version),
        state,
        reason,
        reasonLabel: followUpReasonLabel(reason),
        followUpId: row.follow_up_id ? String(row.follow_up_id) : null,
        approvedOpportunityId:
            row.approved_opportunity_id == null ? null : String(row.approved_opportunity_id),
        messageSnapshot: snapshot,
        closedReason: row.closed_reason == null ? null : String(row.closed_reason),
        approvedAt: asDate(row.approved_at),
        sentAt: asDate(row.sent_at),
        updatedAt: requiredDate(row.follow_up_updated_at || row.updated_at || row.quotationUpdatedAt, 'atualização'),
    };
}
function record(row: Record<string, unknown>): FollowUpRecord {
    return projection(row, row.follow_up_state as FollowUpPersistedState) as FollowUpRecord;
}
function unique(error: unknown): boolean {
    let current: unknown = error;
    for (let index = 0; index < 4 && current && typeof current === 'object'; index += 1) {
        if ('code' in current && current.code === '23505')
            return true;
        current = 'cause' in current ? current.cause : undefined;
    }
    return false;
}
function projectionDeadline(options: ProjectionAttemptOptions = {}): DbDeadline | null {
  if (options.deadline) return options.deadline;
  if (typeof options.timeoutMs === 'number') return createDbDeadline(options.timeoutMs);
  return null;
}

async function runUnbounded<T = Record<string, unknown>>(
  db: Database,
  fragment: SQL,
): Promise<T[]> {
  return Array.from(await db.execute(fragment)) as T[];
}

function factsSql(started: Date, instance: string): SQL {
    return sql `WITH latest AS (
    SELECT DISTINCT ON (q.id)
      q.id quotation_id,
      COALESCE(q.opportunity_id, crm.id) opportunity_id,
      q.client_id client_id,
      q.business_number,
      q.status quotation_status,
      q.updated_at "quotationUpdatedAt",
      c.nome client_name,
      c.arquivado client_archived,
      d.id delivery_id,
      d.id "deliveryId",
      d.revision_id,
      ${instance} instance,
      d.phone,
      regexp_replace(d.phone, '[^0-9]', '', 'g') delivery_phone,
      d.created_at delivery_created_at,
      d.state delivery_state,
      d.completion_source,
      qr.total amount,
      sr.first_provider_receipt_at,
      sr.first_provider_receipt_at "firstProviderReceiptAt",
      a.last_inbound_at "lastInboundAt",
      a.last_inbound_provider_message_id "lastInboundId",
      a.last_outbound_at "lastOutboundAt",
      a.last_outbound_provider_message_id "lastOutboundId",
      COALESCE(a.canonical_phone, regexp_replace(d.phone, '[^0-9]', '', 'g')) canonical_phone,
      COALESCE(a.canonical_phone, regexp_replace(d.phone, '[^0-9]', '', 'g')) "currentCanonicalPhone",
      a.provider_conversation_id activity_conversation_id,
      a.identity_status,
      a.updated_at "activityUpdatedAt",
      a.blocked_at "blockedAt",
      blocked.blocked_at contact_blocked_at,
      blocked.blocked_at IS NOT NULL contact_blocked,
      crm.status crm_status,
      crm.updated_at "crmUpdatedAt",
      crm.follow_up_stage,
      source_action.created_action_id source_action_id,
      source_action.state source_action_state,
      source_action.version source_action_version,
      source_action.updated_at source_action_updated_at,
      f.id follow_up_id,
      f.cycle_number follow_up_cycle_number,
      f.attempt_number follow_up_attempt_number,
      f.source_action_id follow_up_source_action_id,
      f.state follow_up_state,
      f.delivery_id follow_up_delivery_id,
      f.revision_id follow_up_revision_id,
      f.provider_conversation_id follow_up_provider_conversation_id,
      f.canonical_phone follow_up_canonical_phone,
      f.canonical_phone "approvedCanonicalPhone",
      f.provider_conversation_id "approvedProviderConversationId",
      f.approved_opportunity_id,
      f.eligibility_version follow_up_eligibility_version,
      f.first_provider_receipt_at follow_up_first_provider_receipt_at,
      f.due_at follow_up_due_at,
      f.message_snapshot,
      f.closed_reason,
      f.approved_at,
      f.sent_at,
      f.updated_at follow_up_updated_at,
      ih.blocked_at ingestion_blocked_at,
      ih.updated_at "ingestionHealthUpdatedAt",
      lid.unresolved_lid_watermark "unresolvedLidWatermark",
      COALESCE(sr.first_provider_receipt_at + interval '24 hours', NULL) due_at,
      (inbound.after_anchor IS TRUE) inbound_after_anchor,
      (outbound.after_anchor IS TRUE) outbound_after_anchor
    FROM quotation_follow_ups f
    JOIN quotations q ON q.id = f.quotation_id
    JOIN clients c ON c.id = q.client_id
    JOIN LATERAL (
      SELECT d.* FROM quotation_deliveries d
      JOIN quote_revisions dr ON dr.id = d.revision_id
      WHERE dr.quotation_id = q.id
        AND (
          d.id = f.delivery_id
          OR d.created_at >= ${iso(started)}::timestamptz
        )
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT 1
    ) d ON true
    LEFT JOIN LATERAL (
      SELECT r.* FROM quote_revisions r
      WHERE r.id = COALESCE(f.revision_id, d.revision_id)
         OR (r.quotation_id = q.id AND r.status = 'emitido')
      ORDER BY CASE WHEN r.id = COALESCE(f.revision_id, d.revision_id) THEN 0 ELSE 1 END, r.version DESC
      LIMIT 1
    ) qr ON true
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN COUNT(*) > 0
          AND COUNT(*) FILTER (WHERE s.delivered_at IS NULL AND s.read_at IS NULL) = 0
          THEN MAX(COALESCE(s.delivered_at, s.read_at))
        ELSE NULL
      END first_provider_receipt_at
      FROM quotation_delivery_steps s
      WHERE s.delivery_id = d.id
    ) sr ON true
    LEFT JOIN LATERAL (
      SELECT a.* FROM whatsapp_contact_activity a
      WHERE a.instance = ${instance}
        AND a.canonical_phone = regexp_replace(d.phone, '[^0-9]', '', 'g')
      ORDER BY a.updated_at DESC LIMIT 1
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT blocked.blocked_at FROM whatsapp_contact_activity blocked
      WHERE blocked.canonical_phone = regexp_replace(d.phone, '[^0-9]', '', 'g')
        AND blocked.blocked_at IS NOT NULL
      LIMIT 1
    ) blocked ON true
    LEFT JOIN LATERAL (
      SELECT cd.* FROM crm_deals cd
      WHERE cd.id = q.opportunity_id
         OR (q.opportunity_id IS NULL AND cd.quotation_id = q.id)
      ORDER BY cd.updated_at DESC, cd.id DESC LIMIT 1
    ) crm ON true
    LEFT JOIN LATERAL (
      SELECT action.id created_action_id, action.state, action.version, action.updated_at
      FROM opportunity_next_actions action
      WHERE action.id = f.source_action_id
      UNION ALL
      SELECT anchor.created_action_id, action.state, action.version, action.updated_at
      FROM opportunity_delivery_anchors anchor
      LEFT JOIN opportunity_next_actions action ON action.id = anchor.created_action_id
      WHERE f.source_action_id IS NULL
        AND anchor.opportunity_id = COALESCE(q.opportunity_id, crm.id)
        AND anchor.quotation_id = q.id
      ORDER BY updated_at DESC NULLS LAST, created_action_id DESC
      LIMIT 1
    ) source_action ON true
    LEFT JOIN whatsapp_follow_up_ingestion_health ih ON ih.instance = ${instance}
    LEFT JOIN LATERAL (
      SELECT MAX(GREATEST(COALESCE(x.last_inbound_at, '-infinity'::timestamptz),
        COALESCE(x.last_outbound_at, '-infinity'::timestamptz))) unresolved_lid_watermark
      FROM whatsapp_contact_activity x
      WHERE x.instance = ${instance} AND x.identity_status = 'unresolved'
        AND x.provider_conversation_id LIKE '%@lid'
        AND GREATEST(COALESCE(x.last_inbound_at, '-infinity'::timestamptz),
          COALESCE(x.last_outbound_at, '-infinity'::timestamptz)) >
          (SELECT MIN(ss.accepted_at) FROM quotation_delivery_steps ss WHERE ss.delivery_id = d.id)
        AND NOT (
          f.provider_conversation_id IS NOT NULL
          AND x.provider_conversation_id = f.provider_conversation_id
        )
        AND (
          x.canonical_phone IS NULL
          OR x.canonical_phone NOT IN (f.canonical_phone, regexp_replace(d.phone, '[^0-9]', '', 'g'))
        )
    ) lid ON true
    LEFT JOIN LATERAL (
      SELECT true after_anchor FROM whatsapp_contact_activity x
      WHERE x.instance = ${instance}
        AND (
          (
            f.provider_conversation_id IS NOT NULL
            AND x.provider_conversation_id = f.provider_conversation_id
          )
          OR (
            x.provider_conversation_id LIKE '%@lid'
            AND x.canonical_phone IN (f.canonical_phone, regexp_replace(d.phone, '[^0-9]', '', 'g'))
          )
        )
        AND x.last_inbound_at > (SELECT MIN(ss.accepted_at) FROM quotation_delivery_steps ss WHERE ss.delivery_id = d.id)
      LIMIT 1
    ) inbound ON true
    LEFT JOIN LATERAL (
      SELECT after_anchor FROM (
        SELECT true after_anchor FROM whatsapp_contact_activity x
        WHERE x.instance = ${instance}
          AND x.canonical_phone = regexp_replace(d.phone, '[^0-9]', '', 'g')
          AND x.last_outbound_at > (SELECT MIN(ss.accepted_at) FROM quotation_delivery_steps ss WHERE ss.delivery_id = d.id)
          AND NOT EXISTS (
            SELECT 1 FROM quotation_delivery_steps own
            WHERE own.delivery_id = d.id AND own.provider_message_id = x.last_outbound_provider_message_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM quotation_follow_ups own_follow_up
            WHERE own_follow_up.quotation_id = q.id
              AND own_follow_up.provider_message_id = x.last_outbound_provider_message_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM quotation_follow_up_attempt_history own_history
            WHERE own_history.quotation_id = q.id
              AND own_history.provider_message_id = x.last_outbound_provider_message_id
          )
        UNION ALL
        SELECT true FROM quotation_delivery_steps other
        JOIN quotation_deliveries od ON od.id = other.delivery_id
        JOIN quote_revisions orv ON orv.id = od.revision_id
        WHERE orv.quotation_id = q.id AND od.id <> d.id
          AND other.accepted_at > (SELECT MIN(ss.accepted_at) FROM quotation_delivery_steps ss WHERE ss.delivery_id = d.id)
      ) extra
      LIMIT 1
    ) outbound ON true
    WHERE f.instance = ${instance}
      AND q.updated_at IS NOT NULL
    ORDER BY q.id
  )
  SELECT * FROM latest`;
}
function evaluate(row: Record<string, unknown>, now: Date, started: Date): FollowUpEvaluation {
    const persistedConversation = String(row.follow_up_provider_conversation_id || '').trim();
    const phone = digits(
        row.follow_up_id != null
            ? row.follow_up_canonical_phone
            : row.canonical_phone || (acceptedLidConversation(persistedConversation) ? '' : row.delivery_phone),
    );
    const identityResolved = phone.length >= 10 && phone.length <= 15;
    const persisted = row.follow_up_id != null;
    const firstProviderReceiptAt = asDate(persisted ? row.follow_up_first_provider_receipt_at : row.first_provider_receipt_at);
    return evaluateFollowUp({
        now,
        trackingStartedAt: started,
        persistedState: (row.follow_up_state as FollowUpPersistedState) || null,
        persistedDueAt: persisted ? asDate(row.follow_up_due_at) : null,
        latestDelivery: {
            id: String(row.delivery_id),
            state: String(row.delivery_state),
            completionSource: row.completion_source == null ? null : String(row.completion_source),
            createdAt: requiredDate(row.delivery_created_at, 'entrega'),
            firstProviderReceiptAt,
        },
        quotationStatus: String(row.quotation_status),
        crmStatus: row.crm_status == null ? null : String(row.crm_status),
        clientArchived: Boolean(row.client_archived),
        identityResolved,
        contactBlocked: Boolean(row.contact_blocked || row.blockedAt),
        ingestionBlocked: Boolean(row.ingestion_blocked_at),
        unresolvedIdentityBarrier: Boolean(row.unresolvedLidWatermark),
        inboundAfterAnchor: Boolean(row.inbound_after_anchor),
        outboundAfterAnchor: Boolean(row.outbound_after_anchor),
        commercialFollowUpStage: row.follow_up_stage == null ? undefined : Number(row.follow_up_stage),
        followUpAttempt: row.follow_up_attempt_number == null ? undefined : Number(row.follow_up_attempt_number),
    });
}
function visibleState(
  row: Record<string, unknown>,
  evaluation: FollowUpEvaluation,
): FollowUpProjection['state'] {
    if (evaluation.kind === 'cancel')
        return 'cancelled';
    if (evaluation.kind === 'hold')
        return 'held';
    if (evaluation.kind === 'awaiting_receipt')
        return 'awaiting_receipt';
    if (evaluation.kind === 'waiting')
        return 'waiting';
    if (evaluation.kind === 'ready')
        return 'ready';
    return (row.follow_up_state || evaluation.kind) as FollowUpProjection['state'];
}
async function rows(db: Database, started: Date): Promise<Record<string, unknown>[]> {
    const instance = configuredInstance();
    if (!instance)
        return [];
    const result = await db.execute(factsSql(started, instance));
    return Array.from(result) as Record<string, unknown>[];
}

async function lockOpportunity(
  db: Database,
  opportunityId: string | null,
  quotationId: string,
): Promise<void> {
  const lockKey = opportunityId || quotationId;
  await db.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0))
  `);
  if (opportunityId) {
    await db.execute(sql`
      SELECT id FROM crm_deals WHERE id = ${opportunityId} FOR UPDATE
    `);
  }
}

type LockedFollowUpContext = {
  quotationId: string;
  opportunityId: string | null;
  approvedOpportunityId: string | null;
};

async function lockFollowUpContext(
  db: Database,
  followUpId: string,
): Promise<LockedFollowUpContext | null> {
  const contextResult = await db.execute(sql`
    SELECT
      f.id,
      q.id AS quotation_id,
      COALESCE(q.opportunity_id, legacy.id) AS opportunity_id,
      f.approved_opportunity_id
    FROM quotation_follow_ups f
    JOIN quotations q ON q.id = f.quotation_id
    LEFT JOIN LATERAL (
      SELECT cd.id
      FROM crm_deals cd
      WHERE q.opportunity_id IS NULL
        AND cd.quotation_id = q.id
      ORDER BY cd.updated_at DESC, cd.id DESC
      LIMIT 1
    ) legacy ON true
    WHERE f.id = ${followUpId}
  `);
  const context = Array.from(contextResult) as Record<string, unknown>[];
  if (!context.length) return null;
  const quotationId = String(context[0].quotation_id);
  const opportunityId = context[0].opportunity_id == null ? null : String(context[0].opportunity_id);
  await lockOpportunity(db, opportunityId, quotationId);

  const result = await db.execute(sql`
    SELECT
      f.id,
      q.id AS quotation_id,
      COALESCE(q.opportunity_id, legacy.id) AS opportunity_id,
      f.approved_opportunity_id
    FROM quotation_follow_ups f
    JOIN quotations q ON q.id = f.quotation_id
    JOIN clients cl ON cl.id = q.client_id
    JOIN quotation_deliveries delivery ON delivery.id = f.delivery_id
    LEFT JOIN LATERAL (
      SELECT cd.id
      FROM crm_deals cd
      WHERE q.opportunity_id IS NULL
        AND cd.quotation_id = q.id
      ORDER BY cd.updated_at DESC, cd.id DESC
      LIMIT 1
    ) legacy ON true
    WHERE f.id = ${followUpId}
    FOR UPDATE OF f, q, cl, delivery
  `);
  const locked = Array.from(result) as Record<string, unknown>[];
  if (!locked.length) return null;
  const lockedOpportunityId = locked[0].opportunity_id == null ? null : String(locked[0].opportunity_id);
  if (lockedOpportunityId !== opportunityId) {
    await lockOpportunity(db, lockedOpportunityId, quotationId);
  }
  return {
    quotationId,
    opportunityId: lockedOpportunityId,
    approvedOpportunityId:
      locked[0].approved_opportunity_id == null ? null : String(locked[0].approved_opportunity_id),
  };
}

async function retireForeignInstanceAuthorizations(
  db: Database,
  currentInstance: string,
  now: Date,
  opportunityId?: string | null,
): Promise<void> {
  const hasOpportunityFilter = opportunityId !== undefined;
  const opportunityFilter = !hasOpportunityFilter
    ? sql``
    : opportunityId
      ? sql`AND COALESCE(f.approved_opportunity_id, q.opportunity_id, legacy.id) = ${opportunityId}`
      : sql`AND false`;
  const updateOpportunityFilter = !hasOpportunityFilter
    ? sql``
    : opportunityId
      ? sql`AND COALESCE(
        f.approved_opportunity_id,
        (SELECT q.opportunity_id FROM quotations q WHERE q.id = f.quotation_id),
        (SELECT cd.id
         FROM crm_deals cd
         WHERE (SELECT q.opportunity_id FROM quotations q WHERE q.id = f.quotation_id) IS NULL
           AND cd.quotation_id = f.quotation_id
         ORDER BY cd.updated_at DESC, cd.id DESC
         LIMIT 1)
      ) = ${opportunityId}`
      : sql`AND false`;
  const foreignRows = Array.from(await db.execute(sql`
    SELECT
      f.id,
      q.id AS quotation_id,
      q.opportunity_id AS quotation_opportunity_id,
      legacy.id AS legacy_opportunity_id,
      f.approved_opportunity_id
    FROM quotation_follow_ups f
    JOIN quotations q ON q.id = f.quotation_id
    LEFT JOIN LATERAL (
      SELECT cd.id
      FROM crm_deals cd
      WHERE q.opportunity_id IS NULL
        AND cd.quotation_id = q.id
      ORDER BY cd.updated_at DESC, cd.id DESC
      LIMIT 1
    ) legacy ON true
    WHERE f.instance <> ${currentInstance}
      AND f.state IN ('approved', 'processing')
      ${opportunityFilter}
    ORDER BY f.id
  `)) as Record<string, unknown>[];

  if (!foreignRows.length) return;

  const lockKeys = new Map<string, { opportunityId: string | null; quotationId: string }>();
  for (const row of foreignRows) {
    const quotationId = String(row.quotation_id);
    const currentOpportunityId = row.quotation_opportunity_id ?? row.legacy_opportunity_id;
    const approvedOpportunityId = row.approved_opportunity_id;
    for (const value of [currentOpportunityId, approvedOpportunityId]) {
      if (value != null) {
        const idValue = String(value);
        lockKeys.set(`opportunity:${idValue}`, { opportunityId: idValue, quotationId });
      }
    }
    if (currentOpportunityId == null && approvedOpportunityId == null) {
      lockKeys.set(`quotation:${quotationId}`, { opportunityId: null, quotationId });
    }
  }

  for (const key of [...lockKeys.keys()].sort()) {
    const lock = lockKeys.get(key)!;
    await lockOpportunity(db, lock.opportunityId, lock.quotationId);
  }
  for (const row of foreignRows) {
    const locked = await lockFollowUpContext(db, String(row.id));
    if (locked?.approvedOpportunityId && locked.approvedOpportunityId !== locked.opportunityId) {
      await lockOpportunity(db, locked.approvedOpportunityId, locked.quotationId);
    }
  }

  await db.execute(sql`
    UPDATE quotation_follow_ups AS f
    SET state = CASE
          WHEN f.state = 'processing' AND f.transport_started_at IS NOT NULL THEN 'needs_review'
          ELSE 'cancelled'
        END,
        approved_opportunity_id = CASE
          WHEN f.state = 'processing' AND f.transport_started_at IS NOT NULL THEN f.approved_opportunity_id
          ELSE NULL
        END,
        eligibility_version = CASE
          WHEN f.state = 'processing' AND f.transport_started_at IS NOT NULL THEN f.eligibility_version
          ELSE NULL
        END,
        message_snapshot = CASE
          WHEN f.state = 'processing' AND f.transport_started_at IS NOT NULL THEN f.message_snapshot
          ELSE NULL
        END,
        approved_at = CASE
          WHEN f.state = 'processing' AND f.transport_started_at IS NOT NULL THEN f.approved_at
          ELSE NULL
        END,
        closed_reason = CASE
          WHEN f.state = 'processing' AND f.transport_started_at IS NOT NULL
            THEN CASE
              WHEN f.lease_until IS NULL THEN 'transport_ambiguous'
              ELSE 'lease_expired_after_transport'
            END
          ELSE 'instance_changed'
        END,
        closed_at = ${iso(now)}::timestamptz,
        lease_token = NULL,
        lease_until = NULL,
        transport_started_at = CASE
          WHEN f.state = 'processing' AND f.transport_started_at IS NOT NULL THEN f.transport_started_at
          ELSE NULL
        END,
        updated_at = ${iso(now)}::timestamptz
    WHERE instance <> ${currentInstance}
      AND (
        state = 'approved'
        OR (
          state = 'processing'
          AND (
            transport_started_at IS NULL
            OR lease_until IS NULL
            OR lease_until <= ${iso(now)}::timestamptz
          )
        )
      )
      ${updateOpportunityFilter}
  `);
}

async function holdUnprojectableProcessing(
  db: Database,
  followUpId: string,
  leaseToken: string,
  now: Date,
): Promise<void> {
  await db.execute(sql`
    UPDATE quotation_follow_ups
    SET state = 'held',
        approved_opportunity_id = NULL,
        eligibility_version = NULL,
        message_snapshot = NULL,
        approved_at = NULL,
        lease_token = NULL,
        lease_until = NULL,
        transport_started_at = NULL,
        updated_at = ${iso(now)}::timestamptz
    WHERE id = ${followUpId}
      AND state = 'processing'
      AND lease_token = ${leaseToken}
  `);
}


async function suspendUndeliveredApprovalsForPhone(
  tx: Database,
  phone: string,
  occurredAt: Date,
  closedReason: string,
): Promise<void> {
  await tx.execute(sql`
    UPDATE quotation_follow_ups f
    SET state = 'cancelled',
        closed_reason = ${closedReason},
        closed_at = ${iso(occurredAt)}::timestamptz,
        approved_opportunity_id = NULL,
        eligibility_version = NULL,
        message_snapshot = NULL,
        approved_at = NULL,
        lease_token = NULL,
        lease_until = NULL,
        transport_started_at = NULL,
        updated_at = ${iso(occurredAt)}::timestamptz
    WHERE (
        f.state = 'approved'
        OR (f.state = 'processing' AND f.transport_started_at IS NULL)
      )
      AND f.canonical_phone = ${phone}
  `);
}

async function findExistingClientReview(
  tx: Database,
  clientId: string | null,
  reasonCode: string,
  opportunityIds: string[],
  canonicalPhone: string,
): Promise<{ actionId: string; opportunityId: string } | null> {
  const scopeFilter = clientId
    ? sql`d.client_id = ${clientId}::uuid`
    : sql`a.opportunity_id IN (${sql.join(
        opportunityIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})`;
  const rows = Array.from(
    await tx.execute(sql`
      SELECT a.id, a.opportunity_id
      FROM opportunity_next_actions a
      INNER JOIN crm_deals d ON d.id = a.opportunity_id
      WHERE ${scopeFilter}
        AND a.state = 'active'
        AND a.reason_code = ${reasonCode}
        AND a.association_phone = ${canonicalPhone}
      ORDER BY a.opportunity_id ASC
      LIMIT 1
    `),
  ) as Record<string, unknown>[];
  return rows.length
    ? { actionId: String(rows[0].id), opportunityId: String(rows[0].opportunity_id) }
    : null;
}

async function listOpenOpportunityIdsForConversation(
  tx: Database,
  instance: string,
  conversation: string,
): Promise<Array<{ opportunityId: string; clientId: string | null }>> {
  const rows = Array.from(
    await tx.execute(sql`
      SELECT DISTINCT
        COALESCE(q.opportunity_id, legacy.id) AS opportunity_id,
        COALESCE(q.client_id, legacy.client_id) AS client_id
      FROM quotation_follow_ups f
      JOIN quotations q ON q.id = f.quotation_id
      JOIN clients cl ON cl.id = q.client_id
      LEFT JOIN LATERAL (
        SELECT cd.id, cd.client_id
        FROM crm_deals cd
        WHERE q.opportunity_id IS NULL AND cd.quotation_id = q.id
        ORDER BY cd.updated_at DESC, cd.id DESC
        LIMIT 1
      ) legacy ON true
      WHERE f.instance = ${instance}
        AND f.provider_conversation_id = ${conversation}
        AND cl.arquivado IS NOT TRUE
        AND COALESCE(q.opportunity_id, legacy.id) IS NOT NULL
        AND COALESCE(
          (SELECT cd.status FROM crm_deals cd WHERE cd.id = COALESCE(q.opportunity_id, legacy.id)),
          ''
        ) NOT IN ('Pedido Fechado', 'Perdido')
      ORDER BY 1
    `),
  ) as Record<string, unknown>[];
  return rows.map((row) => ({
    opportunityId: String(row.opportunity_id),
    clientId: row.client_id == null ? null : String(row.client_id),
  }));
}

async function listOpenOpportunityIdsForPhone(
  tx: Database,
  phone: string,
): Promise<Array<{ opportunityId: string; clientId: string | null }>> {
  const rows = Array.from(
    await tx.execute(sql`
      SELECT DISTINCT
        deal.id AS opportunity_id,
        deal.client_id
      FROM crm_deals deal
      LEFT JOIN clients client ON client.id = deal.client_id
      WHERE deal.status NOT IN ('Pedido Fechado', 'Perdido')
        AND client.arquivado IS NOT TRUE
        AND (
          deal.telefone = ${phone}
          OR client.telefone = ${phone}
          OR EXISTS (
            SELECT 1
            FROM quotations quotation
            JOIN quote_revisions revision ON revision.quotation_id = quotation.id
            JOIN quotation_deliveries delivery ON delivery.revision_id = revision.id
            WHERE (quotation.opportunity_id = deal.id OR quotation.id = deal.quotation_id)
              AND regexp_replace(delivery.phone, '[^0-9]', '', 'g') = ${phone}
          )
        )
      ORDER BY 1
    `),
  ) as Record<string, unknown>[];
  return rows.map((row) => ({
    opportunityId: String(row.opportunity_id),
    clientId: row.client_id == null ? null : String(row.client_id),
  }));
}

async function applyAmbiguousInboundInTransaction(
  tx: Database,
  input: {
    phone: string;
    occurredAt: Date;
    providerMessageId: string;
    candidateOpportunityIds: string[];
  },
): Promise<string | null> {
  const candidates = [
    ...new Set(input.candidateOpportunityIds.map((id) => id.trim()).filter(Boolean)),
  ].sort();
  if (candidates.length < 2) return null;
  await suspendUndeliveredApprovalsForPhone(
    tx,
    input.phone,
    input.occurredAt,
    'inbound_after_anchor',
  );
  const candidateRows = Array.from(
    await tx.execute(sql`
      SELECT id, client_id
      FROM crm_deals
      WHERE id IN (${sql.join(candidates.map((id) => sql`${id}::uuid`), sql`, `)})
        AND status NOT IN ('Pedido Fechado', 'Perdido')
      ORDER BY id
    `),
  ) as Record<string, unknown>[];
  const byClient = new Map<string, { clientId: string | null; opportunityIds: string[] }>();
  for (const row of candidateRows) {
    const opportunityId = String(row.id);
    const clientId = row.client_id == null ? null : String(row.client_id);
    // Clientless pre-proposal demands on the same E.164 share one review group:
    // the association is keyed by phone, never by a client the deal may not have.
    const key = clientId ? `client:${clientId}` : `phone:${input.phone}`;
    const group = byClient.get(key) || { clientId, opportunityIds: [] };
    group.opportunityIds.push(opportunityId);
    byClient.set(key, group);
  }
  for (const opportunityId of candidateRows.map((row) => String(row.id)).sort()) {
    await lockOpportunity(tx, opportunityId, opportunityId);
  }
  let firstAlertOpportunityId: string | null = null;
  for (const { clientId, opportunityIds } of byClient.values()) {
    const existing = await findExistingClientReview(
      tx,
      clientId,
      ASSOCIATE_RESPONSE_REASON_CODE,
      opportunityIds,
      input.phone,
    );
    const hostOpportunityId = existing?.opportunityId || opportunityIds[0];
    let alertActionId = existing?.actionId || null;
    if (!existing) {
      const transition = await applyAssociateResponseTransition({
        database: tx as never,
        opportunityId: hostOpportunityId,
        occurredAt: input.occurredAt,
        idFactory: randomUUID,
        actor: 'system',
      });
      alertActionId = transition.successor?.actionId || transition.actionId;
      await tx.execute(sql`
        UPDATE opportunity_next_actions
        SET association_client_id = ${
          clientId ? sql`${clientId}::uuid` : sql`NULL`
        },
            association_phone = ${input.phone},
            association_provider_message_id = ${input.providerMessageId}
        WHERE id = ${alertActionId}::uuid
          AND state = 'active'
          AND reason_code = ${ASSOCIATE_RESPONSE_REASON_CODE}
      `);
    }
    if (alertActionId) {
      await tx.execute(sql`
        UPDATE opportunity_next_actions
        SET state = 'suspended',
            updated_at = ${iso(input.occurredAt)}::timestamptz,
            transition_actor = 'system',
            transition_at = ${iso(input.occurredAt)}::timestamptz,
            transition_origin = 'event',
            transition_reason = 'Resposta ambígua aguardando associação',
            replaced_by_id = ${alertActionId}::uuid
        WHERE opportunity_id IN (${sql.join(opportunityIds.map((id) => sql`${id}::uuid`), sql`, `)})
          AND opportunity_id <> ${hostOpportunityId}::uuid
          AND state = 'active'
      `);
    }
    firstAlertOpportunityId ||= hostOpportunityId;
  }
  return firstAlertOpportunityId;
}

async function claimCommercialInboundEvent(
  tx: Database,
  input: {
    instance: string;
    providerMessageId: string;
    occurredAt: Date;
    providerConversationId?: string | null;
    canonicalPhone: string | null;
  },
): Promise<boolean> {
  const inserted = await tx
    .insert(commercialInboundEvents)
    .values({
      id: randomUUID(),
      instance: input.instance,
      providerMessageId: input.providerMessageId,
      providerConversationId: input.providerConversationId || null,
      canonicalPhone: input.canonicalPhone,
      occurredAt: input.occurredAt,
      createdAt: new Date(),
    })
    .onConflictDoNothing({
      target: [commercialInboundEvents.instance, commercialInboundEvents.providerMessageId],
    })
    .returning({ id: commercialInboundEvents.id });
  return inserted.length === 1;
}

async function applyConfirmedInboundInTransaction(
  tx: Database,
  input: { canonicalPhone: string; occurredAt: Date; providerMessageId: string },
): Promise<{ handledOpportunityIds: string[] }> {
  const linked = await listOpenOpportunityIdsForPhone(tx, input.canonicalPhone);
  const opportunityIds = linked.map((row) => row.opportunityId).sort();
  const classification = classifyInboundAssociation({
    identityStatus: 'verified',
    canonicalPhone: input.canonicalPhone,
    linkedOpportunityIds: opportunityIds,
  });
  if (classification.outcome === 'ambiguous') {
    await applyAmbiguousInboundInTransaction(tx, {
      phone: input.canonicalPhone,
      occurredAt: input.occurredAt,
      providerMessageId: input.providerMessageId,
      candidateOpportunityIds: classification.candidateOpportunityIds,
    });
    return { handledOpportunityIds: [] };
  }
  if (classification.outcome !== 'unambiguous') {
    return { handledOpportunityIds: [] };
  }
  const opportunityId = classification.opportunityId;
  await lockOpportunity(tx, opportunityId, opportunityId);
  await suspendUndeliveredApprovalsForPhone(
    tx,
    input.canonicalPhone,
    input.occurredAt,
    'inbound_after_anchor',
  );
  await applyInboundResponseTransition({
    database: tx,
    opportunityId,
    occurredAt: input.occurredAt,
    idFactory: randomUUID,
    actor: 'system',
  });
  return { handledOpportunityIds: [opportunityId] };
}

async function applyUncertainInboundInTransaction(
  tx: Database,
  input: {
    instance: string;
    occurredAt: Date;
    providerConversationId: string;
    canonicalPhone: string | null;
  },
): Promise<{ alertOpportunityId: string | null }> {
  let linked = input.canonicalPhone
    ? await listOpenOpportunityIdsForPhone(tx, input.canonicalPhone)
    : [];
  if (linked.length === 0 && input.providerConversationId) {
    linked = await listOpenOpportunityIdsForConversation(
      tx,
      input.instance,
      input.providerConversationId,
    );
  }
  if (linked.length === 0) return { alertOpportunityId: null };
  const opportunityIds = linked.map((row) => row.opportunityId).sort();
  for (const opportunityId of opportunityIds) {
    await lockOpportunity(tx, opportunityId, opportunityId);
  }
  if (input.canonicalPhone) {
    await suspendUndeliveredApprovalsForPhone(
      tx,
      input.canonicalPhone,
      input.occurredAt,
      'inbound_after_anchor',
    );
  }
  let firstAlertOpportunityId: string | null = null;
  for (const opportunityId of opportunityIds) {
    await applyVerifyConversationTransition({
      database: tx as never,
      opportunityId,
      occurredAt: input.occurredAt,
      idFactory: randomUUID,
      actor: 'system',
    });
    firstAlertOpportunityId ||= opportunityId;
  }
  return { alertOpportunityId: firstAlertOpportunityId };
}

export function createPostgresQuotationFollowUpRepository(
  getDb: DatabaseProvider = getDatabase,
): QuotationFollowUpRepository {
    const currentRows = async (db: Database, started: Date, now: Date) => (await rows(db, started)).map((row) => ({ row, e: evaluate(row, now, started) }));
    const currentCandidate = (candidates: Array<{ row: Record<string, unknown>; e: FollowUpEvaluation }>) => {
        const sorted = [...candidates].sort((left, right) => {
            const cycleDifference = Number(right.row.follow_up_cycle_number || 1) - Number(left.row.follow_up_cycle_number || 1);
            if (cycleDifference) return cycleDifference;
            const attemptDifference = Number(right.row.follow_up_attempt_number || 1) - Number(left.row.follow_up_attempt_number || 1);
            if (attemptDifference) return attemptDifference;
            const updatedDifference = (asDate(right.row.follow_up_updated_at)?.getTime() || 0) - (asDate(left.row.follow_up_updated_at)?.getTime() || 0);
            if (updatedDifference) return updatedDifference;
            return String(right.row.follow_up_id || '').localeCompare(String(left.row.follow_up_id || ''));
        });
        const cycle = Number(sorted[0]?.row.follow_up_cycle_number || 1);
        const attempt = Number(sorted[0]?.row.follow_up_attempt_number || 1);
        const latest = sorted.filter(({ row }) =>
            Number(row.follow_up_cycle_number || 1) === cycle &&
            Number(row.follow_up_attempt_number || 1) === attempt,
        );
        const active = latest.filter(({ row }) => ['awaiting_receipt', 'waiting', 'ready', 'held', 'approved', 'processing'].includes(String(row.follow_up_state)));
        return (active.length ? active : latest)[0];
    };
    const currentRowsByQuotation = (candidates: Array<{ row: Record<string, unknown>; e: FollowUpEvaluation }>) => {
        const selected = new Map<string, { row: Record<string, unknown>; e: FollowUpEvaluation }>();
        for (const candidate of candidates) {
            const quotationId = String(candidate.row.quotation_id);
            const previous = selected.get(quotationId);
            if (!previous || currentCandidate([previous, candidate]) === candidate) {
                selected.set(quotationId, candidate);
            }
        }
        return [...selected.values()];
    };
    const loadRecord = async (db: Database, quotationId: string, started: Date, now: Date) => {
        const found = currentCandidate((await currentRows(db, started, now)).filter(({ row }) => String(row.quotation_id) === quotationId));
        if (!found || !found.row.follow_up_state)
            return null;
        return record(found.row);
    };
    const loadRecordById = async (db: Database, followUpId: string, started: Date, now: Date) => {
        const found = (await currentRows(db, started, now)).find(({ row }) => String(row.follow_up_id) === followUpId);
        return found?.row.follow_up_state ? record(found.row) : null;
    };
    const loadCompletedReplay = async (
        db: Database,
        followUpId: string,
        providerMessageId: string,
        started: Date,
        now: Date,
    ) => {
        const [history] = await db
            .select()
            .from(quotationFollowUpAttemptHistory)
            .where(
                and(
                    eq(quotationFollowUpAttemptHistory.followUpId, followUpId),
                    eq(quotationFollowUpAttemptHistory.providerMessageId, providerMessageId),
                ),
            )
            .limit(1);
        const current = await loadRecordById(db, followUpId, started, now);
        if (!current || !history) return current;
        return {
            ...current,
            cycleNumber: Number(history.cycleNumber),
            attemptNumber: (Number(history.attemptNumber) === 2 ? 2 : 1) as 1 | 2,
            sourceActionId: history.sourceActionId,
            firstProviderReceiptAt: asDate(history.firstProviderReceiptAt),
            dueAt: asDate(history.dueAt),
            eligibilityVersion: history.eligibilityVersion,
            messageSnapshot: history.messageSnapshot,
            state: 'sent' as const,
            closedReason: history.closedReason,
            approvedAt: asDate(history.approvedAt),
            sentAt: asDate(history.sentAt),
            updatedAt: asDate(history.confirmedAt) || current.updatedAt,
        };
    };
    const repository: QuotationFollowUpRepository = {
        async list(input: FollowUpListInput = {}) {
            const started = tracking(input.trackingStartedAt);
            const p = page(input.page, 1);
            const size = Math.min(MAX_PAGE_SIZE, page(input.pageSize, DEFAULT_PAGE_SIZE));
            if (!started || !configuredInstance())
                return { data: [], total: 0, page: p, pageSize: size };
            const now = input.now instanceof Date ? input.now : new Date();
            if (input.view && !['ready', 'waiting', 'sent', 'dismissed', 'attention'].includes(input.view)) {
                throw new InputError('Visualização inválida.');
            }
            try {
                const all = currentRowsByQuotation(await currentRows(getDb(), started, now));
                const filtered = all.filter(({ row, e }) => {
                    const view = followUpVisibleListView((row.follow_up_state as FollowUpPersistedState) || null, e);
                    return view !== null && (!input.view || view === input.view);
                });
                const data = filtered.map(({ row, e }) => projection(row, visibleState(row, e), e));
                return { data: data.slice((p - 1) * size, p * size), total: data.length, page: p, pageSize: size };
            }
            catch (error) {
                if (error instanceof InputError)
                    throw error;
                throw new RepositoryError();
            }
        },
        async get(quotationId: string, options: FollowUpGetOptions = {}) {
            const quotation = id(quotationId, 'quotation_id');
            const expectedOpportunity = options.expectedOpportunityId === undefined
                ? undefined
                : id(options.expectedOpportunityId, 'Oportunidade');
            const expectedAction = options.expectedActionId === undefined
                ? undefined
                : id(options.expectedActionId, 'Ação');
            if ((expectedOpportunity === undefined) !== (expectedAction === undefined)) {
                throw new InputError('Oportunidade e ação de origem são obrigatórias.');
            }
            const started = tracking(options.trackingStartedAt);
            if (!started || !configuredInstance())
                return null;
            const now = options.now instanceof Date ? options.now : new Date();
            try {
                const found = currentCandidate((await currentRows(getDb(), started, now)).filter(({ row }) => String(row.quotation_id) === quotation));
                if (!found) {
                    return null;
                }
                if (expectedOpportunity !== undefined &&
                    (String(found.row.opportunity_id || '') !== expectedOpportunity ||
                        String(found.row.source_action_id || '') !== expectedAction ||
                        String(found.row.source_action_state || '') !== 'active')) {
                    throw new ConflictError(STALE);
                }
                if (!followUpVisibleListView((found.row.follow_up_state as FollowUpPersistedState) || null, found.e)) {
                    return null;
                }
                return projection(found.row, visibleState(found.row, found.e), found.e);
            }
            catch (error) {
                if (error instanceof InputError || error instanceof ConflictError)
                    throw error;
                throw new RepositoryError();
            }
        },
        async approve(input: ApproveInput) {
            const quotationId = id(input.quotationId, 'quotation_id');
            const expected = String(input.eligibilityVersion || '');
            const text = cleanMessage(input.message);
            const started = tracking(input.trackingStartedAt);
            const currentInstance = configuredInstance();
            if (!started || !currentInstance) {
                throw new ConflictError('Follow-up indisponível sem data de início do rastreamento.');
            }
            const now = input.now instanceof Date ? input.now : new Date();
            try {
                return await getDb().transaction(async (tx) => {
                    let found = currentCandidate((await currentRows(tx, started, now)).filter(({ row }) => String(row.quotation_id) === quotationId));
                    if (!found)
                        throw new NotFoundError();
                    if (!found.row.follow_up_id)
                        throw new ConflictError(STALE);
                    if (!await lockFollowUpContext(tx, String(found.row.follow_up_id)))
                        throw new ConflictError(STALE);
                    found = currentCandidate((await currentRows(tx, started, now)).filter(({ row }) => String(row.quotation_id) === quotationId));
                    if (!found)
                        throw new ConflictError(STALE);
                    if (found.e.kind !== 'ready' ||
                        !['ready', 'waiting', 'held'].includes(String(found.row.follow_up_state))) {
                        throw new ConflictError(STALE);
                    }
                    const currentVersion = hash(found.row);
                    if (currentVersion !== expected)
                        throw new ConflictError(STALE);
                    const opportunityId = found.row.opportunity_id == null ? null : String(found.row.opportunity_id);
                    await retireForeignInstanceAuthorizations(tx, currentInstance, now, opportunityId);
                    const dueAt = asDate(found.row.follow_up_due_at);
                    const updated = await tx.execute(sql `UPDATE quotation_follow_ups SET
              approved_opportunity_id = ${opportunityId}, eligibility_version = ${currentVersion}, message_snapshot = ${text}, state = 'approved',
              approved_at = ${iso(now)}::timestamptz, closed_reason = NULL, closed_at = NULL,
              lease_token = NULL, lease_until = NULL, transport_started_at = NULL,
              updated_at = ${iso(now)}::timestamptz
            WHERE id = ${String(found.row.follow_up_id)}
              AND delivery_id = ${String(found.row.delivery_id)}
              AND state IN ('ready', 'waiting', 'held')
              ${dueAt ? sql `AND due_at = ${iso(dueAt)}::timestamptz` : sql ``}
            RETURNING id`);
                    if (!Array.from(updated).length)
                        throw new ConflictError(STALE);
                    const approved = await loadRecord(tx, quotationId, started, now);
                    if (!approved)
                        throw new RepositoryError();
                    return approved;
                });
            }
            catch (error) {
                if (error instanceof InputError || error instanceof ConflictError || error instanceof NotFoundError)
                    throw error;
                if (unique(error)) throw new ConflictError(STALE);
                throw new RepositoryError();
            }
        },
        async dismiss(input: DismissInput) {
            const quotationId = id(input.quotationId, 'quotation_id');
            const expected = String(input.eligibilityVersion || '');
            const started = tracking(input.trackingStartedAt);
            if (!started || !configuredInstance()) {
                throw new ConflictError('Follow-up indisponível sem data de início do rastreamento.');
            }
            const now = input.now instanceof Date ? input.now : new Date();
            try {
                return await getDb().transaction(async (tx) => {
                    const found = currentCandidate((await currentRows(tx, started, now)).filter(({ row }) => String(row.quotation_id) === quotationId));
                    if (!found)
                        throw new NotFoundError();
                    if (!found.row.follow_up_id)
                        throw new ConflictError(STALE);
                    const persistedState = String(found.row.follow_up_state);
                    const evaluationAllowed = ['awaiting_receipt', 'waiting', 'ready', 'hold'].includes(found.e.kind);
                    const persistedAllowed = ['awaiting_receipt', 'waiting', 'ready', 'held'].includes(persistedState);
                    if (!evaluationAllowed && !persistedAllowed)
                        throw new ConflictError(STALE);
                    const projected = projection(found.row, visibleState(found.row, found.e));
                    if (projected.eligibilityVersion !== expected &&
                        !(projected.eligibilityVersion === null && expected === '')) {
                        throw new ConflictError(STALE);
                    }
                    const updated = await tx.execute(sql `UPDATE quotation_follow_ups SET
              eligibility_version = ${expected || null}, message_snapshot = ${DISMISSED_MESSAGE_SNAPSHOT},
              state = 'dismissed', closed_reason = ${input.reason}, closed_at = ${iso(now)}::timestamptz,
              lease_token = NULL, lease_until = NULL, transport_started_at = NULL,
              updated_at = ${iso(now)}::timestamptz
            WHERE id = ${String(found.row.follow_up_id)}
              AND state IN ('awaiting_receipt', 'waiting', 'ready', 'held')
            RETURNING id`);
                    if (!Array.from(updated).length)
                        throw new ConflictError(STALE);
                    if (input.reason === 'do_not_contact') {
                        const blockedPhone = String(projected.canonicalPhone || '');
                        await tx.execute(sql `
              SELECT pg_advisory_xact_lock(hashtextextended(${blockedPhone}::text, 0))
            `);
                        await tx.execute(sql `INSERT INTO whatsapp_contact_activity (
              id, instance, provider_conversation_id, canonical_phone, identity_status, blocked_at, block_reason, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, ${found.row.instance}, ${projected.providerConversationId}, ${blockedPhone},
              'derived', ${iso(now)}::timestamptz, 'do_not_contact', ${iso(now)}::timestamptz, ${iso(now)}::timestamptz
            )
            ON CONFLICT (instance, provider_conversation_id) DO UPDATE SET
              canonical_phone = EXCLUDED.canonical_phone,
              blocked_at = EXCLUDED.blocked_at,
              block_reason = EXCLUDED.block_reason,
              updated_at = EXCLUDED.updated_at`);
                        // Same phone, every conversation and undelivered send
                        // authorization across opportunities of this contact.
                        await tx.execute(sql `UPDATE whatsapp_contact_activity
              SET blocked_at = ${iso(now)}::timestamptz,
                  block_reason = 'do_not_contact',
                  updated_at = ${iso(now)}::timestamptz
              WHERE canonical_phone = ${blockedPhone}`);
                        await tx.execute(sql `UPDATE quotation_follow_ups
              SET state = 'cancelled',
                  closed_reason = 'contact_blocked',
                  closed_at = ${iso(now)}::timestamptz,
                  approved_opportunity_id = NULL,
                  eligibility_version = NULL,
                  message_snapshot = NULL,
                  approved_at = NULL,
                  lease_token = NULL,
                  lease_until = NULL,
                  transport_started_at = NULL,
                  updated_at = ${iso(now)}::timestamptz
              WHERE canonical_phone = ${blockedPhone}
                AND (
                  state = 'approved'
                  OR (state = 'processing' AND transport_started_at IS NULL)
                )`);
                        await tx.execute(sql `INSERT INTO whatsapp_contact_block_events (
              id, instance, canonical_phone, provider_conversation_id, event_type, actor, reason, occurred_at, created_at
            ) VALUES (
              ${randomUUID()}, ${found.row.instance}, ${blockedPhone}, ${projected.providerConversationId},
              'blocked', 'operator', 'Não contatar',
              ${iso(now)}::timestamptz, ${iso(now)}::timestamptz
            )`);
                    }
                    const dismissed = await loadRecord(tx, quotationId, started, now);
                    if (!dismissed)
                        throw new RepositoryError();
                    return dismissed;
                });
            }
            catch (error) {
                if (error instanceof InputError || error instanceof ConflictError || error instanceof NotFoundError)
                    throw error;
                throw new RepositoryError();
            }
        },
        async upsertAwaitingReceiptFromAcceptedDelivery(
            input: {
                deliveryId: string;
                revisionId: string;
                phone: string;
                providerMessageId: string;
            },
            options: ProjectionAttemptOptions = {}
        ) {
            const deliveryId = id(input.deliveryId, 'delivery_id');
            const revisionId = id(input.revisionId, 'revision_id');
            const providerMessageId = typeof input.providerMessageId === 'string' ? input.providerMessageId.trim() : '';
            if (!providerMessageId)
                throw new InputError('Identificador da mensagem inválido.');
            const lidConversation = acceptedLidConversation(input.phone);
            const canonicalPhone = acceptedCanonicalPhone(input.phone);
            if (!canonicalPhone && !lidConversation)
                return;
            const instance = configuredInstance();
            if (!instance)
                throw new RepositoryError();
            const now = new Date();
            const conversation = lidConversation || `${canonicalPhone}@s.whatsapp.net`;
            const phoneValue = canonicalPhone || '';
            const identityUnresolved = !canonicalPhone;
            // One atomic statement: `source` takes the per-quotation advisory lock
            // and the client row lock, and `upsert` folds the acceptance in the
            // same statement. A queued or slow execution is cancelled directly by
            // the deadline, so no JavaScript callback can hold the sole pooled
            // connection past the caller's return.
            const fragment = sql `
          WITH source AS MATERIALIZED (
            SELECT q.id AS quotation_id, pg_advisory_xact_lock(hashtextextended(
              COALESCE(q.opportunity_id::text, legacy.id::text, q.id::text), 0
            )) AS lock
            FROM quotation_deliveries d
            JOIN quote_revisions r ON r.id = d.revision_id
            JOIN quotations q ON q.id = r.quotation_id
            JOIN clients cl ON cl.id = q.client_id
            LEFT JOIN LATERAL (
              SELECT cd.id
              FROM crm_deals cd
              WHERE q.opportunity_id IS NULL AND cd.quotation_id = q.id
              ORDER BY cd.updated_at DESC, cd.id DESC
              LIMIT 1
            ) legacy ON true
            WHERE d.id = ${deliveryId} AND d.revision_id = ${revisionId}
            FOR UPDATE OF cl
          ),
          upsert AS (
            INSERT INTO quotation_follow_ups (
              id, quotation_id, revision_id, delivery_id, instance, provider_conversation_id,
              cycle_number, attempt_number, source_action_id,
              canonical_phone, eligibility_version, message_snapshot, state, closed_reason,
              first_provider_receipt_at, due_at, approved_at, sent_at, closed_at,
              provider_message_id, lease_token, lease_until, transport_started_at, created_at, updated_at
            )
            SELECT
              ${randomUUID()}, q.id, r.id, d.id, ${instance}, ${conversation},
              ${followUpCycleNumber(sql`COALESCE(q.opportunity_id, cd.id)`)}, ${followUpAttemptNumber(sql`cd.follow_up_stage`)}, NULL,
              ${phoneValue}, NULL, NULL,
              CASE
                WHEN cl.arquivado THEN 'cancelled'
                WHEN q.status IS DISTINCT FROM 'emitido' THEN 'cancelled'
                WHEN cd.id IS NULL THEN 'cancelled'
                WHEN ${identityUnresolved} THEN 'held'
                ELSE 'awaiting_receipt'
              END,
              CASE
                WHEN cl.arquivado THEN 'client_archived'
                WHEN q.status IS DISTINCT FROM 'emitido' THEN 'quotation_not_issued'
                WHEN cd.id IS NULL THEN 'crm_not_eligible'
                WHEN ${identityUnresolved} THEN NULL
                ELSE NULL
              END,
              NULL, NULL, NULL, NULL,
              CASE
                WHEN cl.arquivado OR q.status IS DISTINCT FROM 'emitido' OR cd.id IS NULL
                  THEN ${iso(now)}::timestamptz
                ELSE NULL
              END,
              NULL, NULL, NULL, NULL,
              ${iso(now)}::timestamptz, ${iso(now)}::timestamptz
            FROM quotation_deliveries d
            JOIN quote_revisions r ON r.id = d.revision_id
            JOIN quotations q ON q.id = r.quotation_id
            JOIN clients cl ON cl.id = q.client_id
              LEFT JOIN crm_deals cd ON cd.status = 'Orcamento Enviado'
                AND (cd.id = q.opportunity_id OR (q.opportunity_id IS NULL AND cd.quotation_id = q.id))
            WHERE d.id = ${deliveryId} AND d.revision_id = ${revisionId}
              AND EXISTS (SELECT 1 FROM source)
            ON CONFLICT (quotation_id) DO UPDATE SET
              revision_id = EXCLUDED.revision_id,
              delivery_id = EXCLUDED.delivery_id,
              instance = EXCLUDED.instance,
              provider_conversation_id = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND LOWER(RIGHT(TRIM(quotation_follow_ups.provider_conversation_id), 4)) = '@lid'
                  THEN quotation_follow_ups.provider_conversation_id
                WHEN LOWER(RIGHT(TRIM(EXCLUDED.provider_conversation_id), 4)) = '@lid'
                  THEN EXCLUDED.provider_conversation_id
                ELSE EXCLUDED.provider_conversation_id
              END,
              canonical_phone = EXCLUDED.canonical_phone,
              eligibility_version = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND quotation_follow_ups.first_provider_receipt_at IS NOT NULL
                  THEN quotation_follow_ups.eligibility_version
                ELSE NULL
              END,
              message_snapshot = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND quotation_follow_ups.first_provider_receipt_at IS NOT NULL
                  THEN quotation_follow_ups.message_snapshot
                ELSE NULL
              END,
              state = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND quotation_follow_ups.first_provider_receipt_at IS NOT NULL
                  THEN quotation_follow_ups.state
                WHEN ${identityUnresolved} THEN 'held'
                ELSE 'awaiting_receipt'
              END,
              closed_reason = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND quotation_follow_ups.first_provider_receipt_at IS NOT NULL
                  THEN quotation_follow_ups.closed_reason
                WHEN ${identityUnresolved} THEN NULL
                ELSE NULL
              END,
              first_provider_receipt_at = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  THEN quotation_follow_ups.first_provider_receipt_at
                ELSE NULL
              END,
              due_at = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  THEN quotation_follow_ups.due_at
                ELSE NULL
              END,
              approved_at = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND quotation_follow_ups.first_provider_receipt_at IS NOT NULL
                  THEN quotation_follow_ups.approved_at
                ELSE NULL
              END,
              sent_at = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND quotation_follow_ups.first_provider_receipt_at IS NOT NULL
                  THEN quotation_follow_ups.sent_at
                ELSE NULL
              END,
              closed_at = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND quotation_follow_ups.first_provider_receipt_at IS NOT NULL
                  THEN quotation_follow_ups.closed_at
                ELSE NULL
              END,
              provider_message_id = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND quotation_follow_ups.first_provider_receipt_at IS NOT NULL
                  THEN quotation_follow_ups.provider_message_id
                ELSE NULL
              END,
              lease_token = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND quotation_follow_ups.first_provider_receipt_at IS NOT NULL
                  THEN quotation_follow_ups.lease_token
                ELSE NULL
              END,
              lease_until = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND quotation_follow_ups.first_provider_receipt_at IS NOT NULL
                  THEN quotation_follow_ups.lease_until
                ELSE NULL
              END,
              transport_started_at = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND quotation_follow_ups.first_provider_receipt_at IS NOT NULL
                  THEN quotation_follow_ups.transport_started_at
                ELSE NULL
              END,
              updated_at = EXCLUDED.updated_at
            WHERE (
                quotation_follow_ups.state IN ('awaiting_receipt', 'waiting', 'ready', 'held')
                OR (
                  quotation_follow_ups.state = 'cancelled'
                  AND quotation_follow_ups.closed_reason IN (
                    'delivery_incomplete',
                    'missing_provider_receipt',
                    'newer_delivery_in_flight'
                  )
                  AND quotation_follow_ups.delivery_id IS DISTINCT FROM EXCLUDED.delivery_id
                )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM quotation_deliveries current_delivery
                JOIN quotation_deliveries incoming_delivery ON incoming_delivery.id = EXCLUDED.delivery_id
                WHERE current_delivery.id = quotation_follow_ups.delivery_id
                  AND (current_delivery.created_at, current_delivery.id) >
                      (incoming_delivery.created_at, incoming_delivery.id)
              )
            RETURNING id
          )
          SELECT (SELECT COUNT(*) FROM source) AS source_count
        `;
            try {
                const deadline = projectionDeadline(options);
                const result = deadline
                    ? await runBoundedStatement<Record<string, unknown>>(getDb(), deadline, fragment)
                    : await runUnbounded(getDb(), fragment);
                const sourceCount = Number(result[0]?.source_count ?? result[0]?.sourceCount ?? 0);
                if (sourceCount === 0)
                    // The delivery/revision pair vanished between planning and projection.
                    throw new RepositoryError();
            }
            catch (error) {
                if (error instanceof InputError || error instanceof RepositoryError)
                    throw error;
                throw new RepositoryError();
            }
        },
        async listAcceptedDeliveriesMissingFollowUp(
            filter: { deliveryId?: string; limit?: number } = {},
            options: ProjectionAttemptOptions = {}
        ) {
            const started = tracking();
            if (!started)
                return { data: [], hasMore: false };
            const deliveryId = filter.deliveryId ? id(filter.deliveryId, 'delivery_id') : null;
            const limit = filter.limit === undefined ? 50 : Math.min(Math.max(1, Math.trunc(filter.limit)), 100);
            const fragment = sql `
          SELECT d.id AS delivery_id, d.revision_id, d.phone, s.provider_message_id, s.accepted_at
          FROM quotation_deliveries d
          JOIN quote_revisions r ON r.id = d.revision_id
          JOIN quotations q ON q.id = r.quotation_id
          JOIN LATERAL (
            SELECT st.provider_message_id, st.accepted_at
            FROM quotation_delivery_steps st
            WHERE st.delivery_id = d.id
              AND st.accepted_at IS NOT NULL
              AND NULLIF(BTRIM(st.provider_message_id), '') IS NOT NULL
            ORDER BY st.position
            LIMIT 1
          ) s ON true
          WHERE d.created_at >= ${iso(started)}::timestamptz
            AND d.phone NOT ILIKE '%@g.us'
            AND d.phone NOT ILIKE '%status%'
            AND d.phone NOT ILIKE '%broadcast%'
            AND (
              (
                regexp_replace(d.phone, '[^0-9]', '', 'g') ~ '^[0-9]{10,15}$'
                AND d.phone NOT ILIKE '%@lid'
              )
              OR d.phone ILIKE '%@lid'
            )
            ${deliveryId ? sql `AND d.id = ${deliveryId}` : sql ``}
            AND (
              NOT EXISTS (
                SELECT 1 FROM quotation_follow_ups f WHERE f.quotation_id = q.id
              )
              OR EXISTS (
                SELECT 1
                FROM quotation_follow_ups f
                JOIN quotation_deliveries current_delivery ON current_delivery.id = f.delivery_id
                WHERE f.quotation_id = q.id
                  AND (
                    f.state IN ('awaiting_receipt', 'waiting', 'ready', 'held')
                    OR (
                      f.state = 'cancelled'
                      AND f.closed_reason IN (
                        'delivery_incomplete',
                        'missing_provider_receipt',
                        'newer_delivery_in_flight'
                      )
                    )
                  )
                  AND f.delivery_id IS DISTINCT FROM d.id
                  AND (d.created_at, d.id) > (current_delivery.created_at, current_delivery.id)
              )
            )
          ORDER BY d.follow_up_projection_attempted_at ASC NULLS FIRST,
                   d.created_at ASC,
                   d.id ASC
          LIMIT ${limit + 1}
        `;
            try {
                const deadline = projectionDeadline(options);
                const rows = deadline
                    ? await runBoundedStatement<Record<string, unknown>>(getDb(), deadline, fragment)
                    : await runUnbounded(getDb(), fragment);
                const hasMore = rows.length > limit;
                const window = hasMore ? rows.slice(0, limit) : rows;
                const data = window.flatMap((row) => {
                    const nextDeliveryId = String(row.delivery_id || row.deliveryId || '');
                    const revisionId = String(row.revision_id || row.revisionId || '');
                    const phone = String(row.phone || '');
                    const providerMessageId = String(row.provider_message_id || row.providerMessageId || '').trim();
                    const acceptedAt = asDate(row.accepted_at ?? row.acceptedAt);
                    if (!UUID.test(nextDeliveryId) || !UUID.test(revisionId) || !providerMessageId)
                        return [];
                    return [{ deliveryId: nextDeliveryId, revisionId, phone, providerMessageId, acceptedAt }];
                });
                return { data, hasMore };
            }
            catch (error) {
                if (error instanceof InputError || error instanceof RepositoryError)
                    throw error;
                throw new RepositoryError();
            }
        },
        // Records that the acceptance projection was attempted for this delivery.
        // The durable marker rotates a persistently failing candidate to the tail
        // of the next slice, so 51+ poison candidates cannot starve later work
        // across invocations and across process restarts. It touches only this
        // dedicated column, never the delivery's business clock (`updated_at`),
        // so the resolution deadline is untouched.
        async markAcceptanceProjectionAttempt(
            input: { deliveryId: string },
            options: ProjectionAttemptOptions = {}
        ) {
            const deliveryId = id(input?.deliveryId, 'delivery_id');
            const fragment = sql `
          UPDATE quotation_deliveries
          SET follow_up_projection_attempted_at = now()
          WHERE id = ${deliveryId}
        `;
            try {
                const deadline = projectionDeadline(options);
                if (deadline)
                    await runBoundedStatement(getDb(), deadline, fragment);
                else
                    await runUnbounded(getDb(), fragment);
            }
            catch (error) {
                if (error instanceof InputError || error instanceof RepositoryError)
                    throw error;
                throw new RepositoryError();
            }
        },
        // A delivered outbox step is durable proof that the provider confirmed
        // the message; if the follow-up projection that records it failed after
        // the receipt was folded, the candidate stays `awaiting_receipt` forever
        // because the normal path only writes once and no provider replay is
        // guaranteed. This query is the durable retry source: it returns exactly
        // those candidates, together with the step's receipt clock (itself the
        // durable inbox `received_at`), so the worker can project again.
        //
        // Ordering by `updated_at` (the row's own last durable touch, bumped by
        // every projection attempt) makes the slice rotate: a persistently
        // failing row moves to the tail instead of occupying the head of every
        // invocation, so it can neither starve later candidates nor monopolize
        // the worker. The caller bounds the slice and re-reads the next window.
        async listAwaitingReceiptWithCompletedDelivery(
            filter: { deliveryId?: string; limit?: number } = {},
            options: ProjectionAttemptOptions = {}
        ) {
            const deliveryId = filter.deliveryId ? id(filter.deliveryId, 'delivery_id') : null;
            const limit = filter.limit === undefined ? 50 : Math.min(Math.max(1, Math.trunc(filter.limit)), 100);
            const fragment = sql `
          SELECT f.id AS follow_up_id, d.id AS delivery_id, d.revision_id, d.phone,
                 s.provider_message_id, sr.received_at
          FROM quotation_follow_ups f
          JOIN quotation_deliveries d ON d.id = f.delivery_id
          JOIN LATERAL (
            SELECT st.provider_message_id
            FROM quotation_delivery_steps st
            WHERE st.delivery_id = d.id
              AND NULLIF(BTRIM(st.provider_message_id), '') IS NOT NULL
            ORDER BY st.position
            LIMIT 1
          ) s ON true
          JOIN LATERAL (
            SELECT CASE
              WHEN COUNT(*) > 0
                AND COUNT(*) FILTER (WHERE st.delivered_at IS NULL AND st.read_at IS NULL) = 0
                THEN MAX(COALESCE(st.delivered_at, st.read_at))
            END AS received_at
            FROM quotation_delivery_steps st
            WHERE st.delivery_id = d.id
          ) sr ON true
          WHERE f.state = 'awaiting_receipt'
            AND d.state = 'delivered'
            AND d.completion_source = 'provider_receipt'
            AND sr.received_at IS NOT NULL
            AND d.phone NOT ILIKE '%@g.us'
            AND d.phone NOT ILIKE '%status%'
            AND d.phone NOT ILIKE '%broadcast%'
            ${deliveryId ? sql `AND d.id = ${deliveryId}` : sql ``}
          ORDER BY f.updated_at ASC, f.id ASC
          LIMIT ${limit + 1}
        `;
            try {
                const deadline = projectionDeadline(options);
                const rows = deadline
                    ? await runBoundedStatement<Record<string, unknown>>(getDb(), deadline, fragment)
                    : await runUnbounded(getDb(), fragment);
                const hasMore = rows.length > limit;
                const window = hasMore ? rows.slice(0, limit) : rows;
                const data = window.flatMap((row) => {
                    const followUpId = String(row.follow_up_id || row.followUpId || '');
                    const nextDeliveryId = String(row.delivery_id || row.deliveryId || '');
                    const revisionId = String(row.revision_id || row.revisionId || '');
                    const phone = String(row.phone || '');
                    const providerMessageId = String(row.provider_message_id || row.providerMessageId || '').trim();
                    const receivedAt = asDate(row.received_at ?? row.receivedAt);
                    if (!UUID.test(followUpId) || !UUID.test(nextDeliveryId) || !UUID.test(revisionId) || !providerMessageId || !receivedAt)
                        return [];
                    return [{ followUpId, deliveryId: nextDeliveryId, revisionId, phone, providerMessageId, receivedAt }];
                });
                return { data, hasMore };
            }
            catch (error) {
                if (error instanceof InputError || error instanceof RepositoryError)
                    throw error;
                throw new RepositoryError();
            }
        },
        // Records that the worker attempted to project this candidate, which is
        // what gives the retry slice its rotation. The projection itself is
        // idempotent, so a concurrent duplicate attempt is harmless.
        async markReceiptProjectionAttempt(
            input: { followUpId: string },
            options: ProjectionAttemptOptions = {}
        ) {
            const followUpId = id(input?.followUpId, 'follow_up_id');
            const fragment = sql `
          UPDATE quotation_follow_ups
          SET updated_at = now()
          WHERE id = ${followUpId}
        `;
            try {
                const deadline = projectionDeadline(options);
                if (deadline)
                    await runBoundedStatement(getDb(), deadline, fragment);
                else
                    await runUnbounded(getDb(), fragment);
            }
            catch (error) {
                if (error instanceof InputError || error instanceof RepositoryError)
                    throw error;
                throw new RepositoryError();
            }
        },
        async upsertFromDeliveryReceipt(
            input: {
                deliveryId: string;
                revisionId: string;
                phone: string;
                providerConversationId: string;
                allStepsDelivered: boolean;
                receivedAt: Date;
            },
            options: ProjectionAttemptOptions = {}
        ) {
            const deliveryId = id(input.deliveryId, 'delivery_id');
            const revisionId = id(input.revisionId, 'revision_id');
            const canonicalPhone = acceptedCanonicalPhone(input.phone);
            const lidConversation =
                acceptedLidConversation(input.providerConversationId) || acceptedLidConversation(input.phone);
            if (!canonicalPhone && !lidConversation)
                return;
            const providerConversationId = lidConversation ||
                String(input.providerConversationId || '').trim() ||
                `${canonicalPhone}@s.whatsapp.net`;
            const phoneValue = canonicalPhone || '';
            const identityUnresolved = !canonicalPhone;
            const validProviderConversation = /^\d{10,15}@s\.whatsapp\.net$/i.test(providerConversationId);
            const receivedAt = requiredDate(input.receivedAt, 'recibo');
            const instance = configuredInstance();
            if (!instance)
                throw new RepositoryError();
            const firstReceipt = input.allStepsDelivered ? receivedAt : null;
            const dueAt = firstReceipt ? new Date(firstReceipt.getTime() + 24 * 60 * 60 * 1000) : null;
            const now = new Date();
            const postProposalDueDateValue = input.allStepsDelivered
                ? postProposalDueDate(receivedAt)
                : null;
            const commercialActionId = randomUUID();
            const commercialReason = 'Entrega confirmada da proposta';
            // One atomic statement: the source CTE locks the client and linked
            // opportunity, the technical queue upsert and commercial projection
            // are data-modifying CTEs in the same PostgreSQL statement. A failed
            // commercial insert therefore rolls back the technical projection
            // too, while the durable delivery remains the reconciliation source.
            const fragment = sql `
          WITH source AS MATERIALIZED (
            SELECT
              q.id AS quotation_id,
              r.id AS revision_id,
              d.id AS delivery_id,
              COALESCE(q.opportunity_id, cd.id) AS opportunity_id,
              d.state AS delivery_state,
              d.completion_source,
              q.status AS quotation_status,
              cl.arquivado AS client_archived,
              cd.id AS linked_opportunity_id,
              cd.status AS opportunity_status,
              pg_advisory_xact_lock(hashtextextended(
                COALESCE(q.opportunity_id::text, cd.id::text, q.id::text), 0
              )) AS lock
            FROM quotation_deliveries d
            JOIN quote_revisions r ON r.id = d.revision_id
            JOIN quotations q ON q.id = r.quotation_id
            JOIN clients cl ON cl.id = q.client_id
            LEFT JOIN LATERAL (
              SELECT cd.*
              FROM crm_deals cd
              WHERE cd.id = q.opportunity_id
                OR (q.opportunity_id IS NULL AND cd.quotation_id = q.id)
              ORDER BY cd.updated_at DESC, cd.id DESC
              LIMIT 1
            ) cd ON true
            WHERE d.id = ${deliveryId} AND d.revision_id = ${revisionId}
            FOR UPDATE OF cl
          ),
          upsert AS (
            INSERT INTO quotation_follow_ups (
              id, quotation_id, revision_id, delivery_id, instance, provider_conversation_id,
              cycle_number, attempt_number, source_action_id,
              canonical_phone, eligibility_version, message_snapshot, state, closed_reason,
              first_provider_receipt_at, due_at, approved_at, sent_at, closed_at,
              provider_message_id, lease_token, lease_until, transport_started_at, created_at, updated_at
            )
            SELECT
              ${randomUUID()}, q.id, r.id, d.id, ${instance}, ${providerConversationId},
              ${followUpCycleNumber(sql`COALESCE(q.opportunity_id, cd.id)`)}, ${followUpAttemptNumber(sql`cd.follow_up_stage`)}, NULL,
              ${phoneValue}, NULL, NULL,
              CASE
                WHEN cl.arquivado THEN 'cancelled'
                WHEN q.status IS DISTINCT FROM 'emitido' THEN 'cancelled'
                WHEN cd.id IS NULL THEN 'cancelled'
                WHEN ${identityUnresolved} THEN 'held'
                ELSE ${firstReceipt ? 'waiting' : 'awaiting_receipt'}
              END,
              CASE
                WHEN cl.arquivado THEN 'client_archived'
                WHEN q.status IS DISTINCT FROM 'emitido' THEN 'quotation_not_issued'
                WHEN cd.id IS NULL THEN 'crm_not_eligible'
                WHEN ${identityUnresolved} THEN NULL
                ELSE NULL
              END,
              ${firstReceipt ? iso(firstReceipt) : null}::timestamptz,
              ${dueAt ? iso(dueAt) : null}::timestamptz,
              NULL, NULL,
              CASE
                WHEN cl.arquivado OR q.status IS DISTINCT FROM 'emitido' OR cd.id IS NULL
                  THEN ${iso(now)}::timestamptz
                ELSE NULL
              END,
              NULL, NULL, NULL, NULL,
              ${iso(now)}::timestamptz, ${iso(now)}::timestamptz
            FROM quotation_deliveries d
            JOIN quote_revisions r ON r.id = d.revision_id
            JOIN quotations q ON q.id = r.quotation_id
            JOIN clients cl ON cl.id = q.client_id
            LEFT JOIN crm_deals cd ON cd.status = 'Orcamento Enviado'
              AND (cd.id = q.opportunity_id OR (q.opportunity_id IS NULL AND cd.quotation_id = q.id))
            WHERE d.id = ${deliveryId} AND d.revision_id = ${revisionId}
              AND EXISTS (SELECT 1 FROM source)
            ON CONFLICT (quotation_id) DO UPDATE SET
              revision_id = EXCLUDED.revision_id,
              delivery_id = EXCLUDED.delivery_id,
              instance = EXCLUDED.instance,
              provider_conversation_id = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  AND LOWER(RIGHT(TRIM(quotation_follow_ups.provider_conversation_id), 4)) = '@lid'
                  THEN quotation_follow_ups.provider_conversation_id
                WHEN LOWER(RIGHT(TRIM(EXCLUDED.provider_conversation_id), 4)) = '@lid'
                  THEN EXCLUDED.provider_conversation_id
                ELSE EXCLUDED.provider_conversation_id
              END,
              canonical_phone = EXCLUDED.canonical_phone,
              state = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  THEN CASE
                    WHEN quotation_follow_ups.state = 'awaiting_receipt'
                      AND EXCLUDED.first_provider_receipt_at IS NOT NULL
                      THEN 'waiting'
                    ELSE quotation_follow_ups.state
                  END
                ELSE EXCLUDED.state
              END,
              first_provider_receipt_at = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  THEN COALESCE(
                    quotation_follow_ups.first_provider_receipt_at,
                    EXCLUDED.first_provider_receipt_at
                  )
                ELSE EXCLUDED.first_provider_receipt_at
              END,
              due_at = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  THEN COALESCE(quotation_follow_ups.due_at, EXCLUDED.due_at)
                ELSE EXCLUDED.due_at
              END,
              closed_reason = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  THEN quotation_follow_ups.closed_reason
                ELSE NULL
              END,
              closed_at = CASE
                WHEN quotation_follow_ups.delivery_id = EXCLUDED.delivery_id
                  THEN quotation_follow_ups.closed_at
                ELSE NULL
              END,
              updated_at = EXCLUDED.updated_at
            WHERE (
                quotation_follow_ups.state IN ('awaiting_receipt', 'waiting', 'ready', 'held')
                OR (
                  quotation_follow_ups.state = 'cancelled'
                  AND quotation_follow_ups.closed_reason IN (
                    'delivery_incomplete',
                    'missing_provider_receipt',
                    'newer_delivery_in_flight'
                  )
                  AND quotation_follow_ups.delivery_id IS DISTINCT FROM EXCLUDED.delivery_id
                )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM quotation_deliveries current_delivery
                JOIN quotation_deliveries incoming_delivery ON incoming_delivery.id = EXCLUDED.delivery_id
                WHERE current_delivery.id = quotation_follow_ups.delivery_id
                  AND (current_delivery.created_at, current_delivery.id) >
                      (incoming_delivery.created_at, incoming_delivery.id)
              )
            RETURNING id
          ),
          opportunity_lock AS MATERIALIZED (
            SELECT cd.id AS opportunity_id
            FROM crm_deals cd
            JOIN source ON source.opportunity_id = cd.id
            FOR UPDATE OF cd
          ),
          commercial_source AS MATERIALIZED (
            SELECT source.*
            FROM source
            CROSS JOIN (SELECT COUNT(*) AS technical_count FROM upsert) technical
            CROSS JOIN (SELECT COUNT(*) AS locked_count FROM opportunity_lock) locked
            WHERE ${input.allStepsDelivered}
              AND source.delivery_state = 'delivered'
              AND source.completion_source = 'provider_receipt'
              AND source.opportunity_id IS NOT NULL
              AND source.linked_opportunity_id IS NOT NULL
              AND source.opportunity_status NOT IN ('Pedido Fechado', 'Perdido')
              AND source.quotation_status = 'emitido'
          ),
          anchor_context AS MATERIALIZED (
            SELECT
              source.opportunity_id,
              source.quotation_id,
              source.revision_id,
              source.delivery_id,
              source.client_archived,
              anchor.receipt_at AS anchor_receipt_at,
              anchor.created_action_id AS anchor_created_action_id,
              true AS anchor_exists
            FROM commercial_source source
            JOIN opportunity_delivery_anchors anchor
              ON anchor.opportunity_id = source.opportunity_id
            UNION ALL
            SELECT
              source.opportunity_id,
              source.quotation_id,
              source.revision_id,
              source.delivery_id,
              source.client_archived,
              ${iso(receivedAt)}::timestamptz AS anchor_receipt_at,
              NULL AS anchor_created_action_id,
              false AS anchor_exists
            FROM commercial_source source
            WHERE NOT EXISTS (
              SELECT 1
              FROM opportunity_delivery_anchors existing_anchor
              WHERE existing_anchor.opportunity_id = source.opportunity_id
            )
          ),
          action_context AS MATERIALIZED (
            SELECT
              anchor_context.opportunity_id,
              anchor_context.quotation_id,
              anchor_context.revision_id,
              anchor_context.delivery_id,
              anchor_context.client_archived,
              anchor_context.anchor_receipt_at,
              anchor_context.anchor_created_action_id,
              anchor_context.anchor_exists,
              active_action.id AS active_action_id,
              active_action.origin AS active_action_origin,
              active_action.kind AS active_action_kind,
              active_action.version AS active_action_version,
              EXISTS (
                SELECT 1
                FROM whatsapp_contact_activity activity
                WHERE activity.blocked_at IS NOT NULL
                  AND activity.canonical_phone = ${phoneValue}
              ) AS contact_blocked,
              EXISTS (
                SELECT 1
                FROM whatsapp_contact_activity activity
                WHERE activity.instance = ${instance}
                  AND (
                    activity.provider_conversation_id = ${providerConversationId}
                    OR activity.canonical_phone = ${phoneValue}
                  )
                  AND activity.identity_status NOT IN ('verified', 'derived')
              ) AS identity_unresolved,
              EXISTS (
                SELECT 1
                FROM whatsapp_contact_activity activity
                WHERE activity.instance = ${instance}
                  AND activity.identity_status IN ('verified', 'derived')
                  AND activity.last_inbound_at > anchor_context.anchor_receipt_at
                  AND (
                    activity.provider_conversation_id = ${providerConversationId}
                    OR activity.canonical_phone = ${phoneValue}
                  )
              ) AS inbound_after_anchor,
              EXISTS (
                SELECT 1
                FROM manual_contact_events manual_event
                WHERE manual_event.opportunity_id = anchor_context.opportunity_id
                  AND manual_event.occurred_at >= anchor_context.anchor_receipt_at
              ) AS has_manual_continuity
            FROM anchor_context
            LEFT JOIN LATERAL (
              SELECT action.*
              FROM opportunity_next_actions action
              WHERE action.opportunity_id = anchor_context.opportunity_id
                AND action.state = 'active'
              ORDER BY action.updated_at DESC, action.created_at DESC, action.id DESC
              LIMIT 1
            ) active_action ON true
          ),
          old_action_cancellation AS (
            UPDATE opportunity_next_actions old_action
            SET state = 'cancelled',
                updated_at = ${iso(now)}::timestamptz,
                transition_actor = 'system',
                transition_at = ${iso(now)}::timestamptz,
                transition_origin = 'event',
                transition_reason = CASE
                  WHEN context.inbound_after_anchor THEN 'Cliente respondeu após a entrega'
                  WHEN context.contact_blocked THEN 'Contato bloqueado'
                  ELSE 'Identidade do contato não resolvida'
                END,
                replaced_by_id = NULL
            FROM action_context context
            WHERE old_action.id = context.anchor_created_action_id
              AND old_action.state = 'active'
              AND old_action.origin = 'event'
              AND old_action.kind = 'customer_contact'
              AND context.anchor_created_action_id IS NOT NULL
              AND (
                context.inbound_after_anchor
                OR context.contact_blocked
                OR context.identity_unresolved
              )
            RETURNING old_action.id
          ),
          action_schedule AS (
            SELECT
              context.*,
              CASE
                WHEN context.anchor_receipt_at = ${iso(receivedAt)}::timestamptz
                  THEN ${postProposalDueDateValue}::date
                ELSE (
                  context.anchor_receipt_at AT TIME ZONE 'America/Sao_Paulo'
                )::date + CASE EXTRACT(DOW FROM (
                  context.anchor_receipt_at AT TIME ZONE 'America/Sao_Paulo'
                ))::int
                  WHEN 0 THEN 2
                  WHEN 1 THEN 2
                  WHEN 2 THEN 2
                  WHEN 3 THEN 2
                  WHEN 4 THEN 4
                  WHEN 5 THEN 4
                  ELSE 3
                END
              END AS due_date
            FROM action_context context
            CROSS JOIN (SELECT COUNT(*) AS cancelled_count FROM old_action_cancellation) cancelled
            WHERE ${validProviderConversation}
              AND context.anchor_created_action_id IS NULL
              AND context.client_archived = false
              AND context.contact_blocked = false
              AND context.identity_unresolved = false
              AND context.inbound_after_anchor = false
              AND context.has_manual_continuity = false
              AND (
                context.active_action_id IS NULL
                OR (
                  context.active_action_origin = 'automatic'
                  AND context.active_action_kind = 'first_contact'
                )
              )
          ),
          replace_automatic_action AS (
            UPDATE opportunity_next_actions old_action
            SET state = 'superseded',
                updated_at = ${iso(now)}::timestamptz,
                transition_actor = 'system',
                transition_at = ${iso(now)}::timestamptz,
                transition_origin = 'event',
                transition_reason = ${commercialReason},
                replaced_by_id = ${commercialActionId}
            FROM action_schedule schedule
            WHERE old_action.id = schedule.active_action_id
              AND old_action.state = 'active'
              AND old_action.origin = 'automatic'
              AND old_action.kind = 'first_contact'
            RETURNING old_action.id
          ),
          create_commercial_action AS (
            INSERT INTO opportunity_next_actions (
              id, opportunity_id, kind, reason_code, origin, state, due_at,
              due_date, due_time, schedule_type, version, actor, reason,
              created_at, updated_at
            )
            SELECT
              ${commercialActionId}, schedule.opportunity_id, 'customer_contact',
              'proposal_delivery_confirmed', 'event', 'active',
              (schedule.due_date::timestamp AT TIME ZONE 'America/Sao_Paulo'),
              schedule.due_date, NULL, 'date_only',
              CASE
                WHEN schedule.active_action_id IS NULL THEN 1
                ELSE schedule.active_action_version + 1
              END,
              'system', ${commercialReason}, ${iso(now)}::timestamptz,
              ${iso(now)}::timestamptz
            FROM action_schedule schedule
            CROSS JOIN (SELECT COUNT(*) AS replaced_count FROM replace_automatic_action) replaced
            ON CONFLICT DO NOTHING
            RETURNING id, opportunity_id
          ),
          anchor_insert AS (
            INSERT INTO opportunity_delivery_anchors (
              opportunity_id, quotation_id, revision_id, delivery_id, receipt_at,
              created_action_id, created_at
            )
            SELECT
              context.opportunity_id,
              context.quotation_id,
              context.revision_id,
              context.delivery_id,
              context.anchor_receipt_at,
              action.id,
              ${iso(now)}::timestamptz
            FROM action_context context
            LEFT JOIN create_commercial_action action
              ON action.opportunity_id = context.opportunity_id
            WHERE context.anchor_exists = false
            ON CONFLICT (opportunity_id) DO NOTHING
            RETURNING opportunity_id
          ),
          link_existing_action AS (
            UPDATE opportunity_delivery_anchors anchor
            SET created_action_id = action.id
            FROM action_context context
            JOIN create_commercial_action action
              ON action.opportunity_id = context.opportunity_id
            WHERE anchor.opportunity_id = context.opportunity_id
              AND context.anchor_exists = true
              AND context.anchor_created_action_id IS NULL
              AND anchor.created_action_id IS NULL
            RETURNING anchor.opportunity_id
          )
          SELECT
            (SELECT COUNT(*) FROM source) AS source_count,
            (SELECT COUNT(*) FROM upsert) AS technical_upsert_count,
            (SELECT COUNT(*) FROM anchor_insert) +
              (SELECT COUNT(*) FROM link_existing_action) AS commercial_action_count
        `;
            try {
                const deadline = projectionDeadline(options);
                const result = deadline
                    ? await runBoundedStatement<Record<string, unknown>>(getDb(), deadline, fragment)
                    : await runUnbounded(getDb(), fragment);
                const sourceCount = Number(result[0]?.source_count ?? result[0]?.sourceCount ?? 0);
                if (sourceCount === 0)
                    // The delivery/revision pair vanished between planning and projection.
                    throw new RepositoryError();
            }
            catch (error) {
                if (error instanceof InputError || error instanceof RepositoryError)
                    throw error;
                throw new RepositoryError();
            }
        },
        async applyConversationToOpenFollowUps(input: {
            instance: string;
            providerConversationId: string;
            providerMessageId: string;
            fromMe: boolean;
            occurredAt: Date;
            identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict';
            canonicalPhone: string | null;
        }) {
            const instance = String(input.instance || '').trim();
            const conversation = String(input.providerConversationId || '').trim();
            const providerMessageId = String(input.providerMessageId || '').trim();
            const occurredAt = requiredDate(input.occurredAt, 'atividade');
            const phone = acceptedCanonicalPhone(input.canonicalPhone);
            const isUnresolvedLid = input.identityStatus === 'unresolved' && /@lid$/i.test(conversation);
            const validConversation = /^(?:\d{10,15}@s\.whatsapp\.net|[^@\s]+@lid)$/i.test(conversation);
            if (!instance ||
                instance !== configuredInstance() ||
                !validConversation ||
                !providerMessageId)
                return;
            try {
                await getDb().transaction(async (tx) => {
                  if (!input.fromMe) {
                    const claimed = await claimCommercialInboundEvent(tx, {
                      instance,
                      providerMessageId,
                      providerConversationId: conversation,
                      canonicalPhone: phone,
                      occurredAt,
                    });
                    if (!claimed) return;
                  }
                  // Take the opportunity locks in the same (advisory-first) order
                  // as the claim path before touching follow-up rows, otherwise a
                  // concurrent claimApproved deadlocks against the bulk UPDATE below.
                  const linkedOpportunities = [
                    ...(phone ? await listOpenOpportunityIdsForPhone(tx, phone) : []),
                    ...(await listOpenOpportunityIdsForConversation(tx, instance, conversation)),
                  ].sort((left, right) => left.opportunityId.localeCompare(right.opportunityId));
                  const lockedOpportunities = new Set<string>();
                  for (const { opportunityId } of linkedOpportunities) {
                    if (lockedOpportunities.has(opportunityId)) continue;
                    lockedOpportunities.add(opportunityId);
                    await lockOpportunity(tx, opportunityId, opportunityId);
                  }
                  const holdsRow = sql`(${isUnresolvedLid}
                    AND NOT (
                      f.provider_conversation_id = ${conversation}
                      OR (
                        ${phone || null}::text IS NOT NULL
                        AND f.canonical_phone = ${phone || null}
                      )
                    ))`;
                  await tx.execute(sql `UPDATE quotation_follow_ups f
          SET state = CASE WHEN ${holdsRow} THEN 'held' ELSE 'cancelled' END,
              closed_reason = CASE
                WHEN ${holdsRow} THEN NULL
                WHEN ${input.fromMe} THEN 'outbound_after_anchor'
                ELSE 'inbound_after_anchor'
              END,
              closed_at = CASE
                WHEN ${holdsRow} THEN NULL
                ELSE ${iso(occurredAt)}::timestamptz
              END,
              approved_opportunity_id = CASE WHEN ${holdsRow} THEN f.approved_opportunity_id ELSE NULL END,
              eligibility_version = CASE WHEN ${holdsRow} THEN f.eligibility_version ELSE NULL END,
              message_snapshot = CASE WHEN ${holdsRow} THEN f.message_snapshot ELSE NULL END,
              approved_at = CASE WHEN ${holdsRow} THEN f.approved_at ELSE NULL END,
              lease_token = CASE WHEN ${holdsRow} THEN f.lease_token ELSE NULL END,
              lease_until = CASE WHEN ${holdsRow} THEN f.lease_until ELSE NULL END,
              updated_at = ${iso(occurredAt)}::timestamptz
          WHERE f.instance = ${instance}
            AND ${iso(occurredAt)}::timestamptz > COALESCE(
              (SELECT MIN(s.accepted_at) FROM quotation_delivery_steps s WHERE s.delivery_id = f.delivery_id),
              ${iso(occurredAt)}::timestamptz
            )
            AND (
              (
                (
                  f.state IN ('awaiting_receipt', 'waiting', 'ready', 'held', 'approved')
                  OR (f.state = 'processing' AND f.transport_started_at IS NULL)
                )
                AND (
                  f.provider_conversation_id = ${conversation}
                  OR (
                    ${phone || null}::text IS NOT NULL
                    AND f.canonical_phone = ${phone || null}
                  )
                )
                AND (
                  ${input.fromMe ? true : false} = false
                  OR (
                    NOT EXISTS (
                      SELECT 1 FROM quotation_delivery_steps own
                      WHERE own.delivery_id = f.delivery_id AND own.provider_message_id = ${providerMessageId}
                    )
                    AND NOT EXISTS (
                      SELECT 1
                      FROM quotation_follow_ups own_follow_up
                      WHERE own_follow_up.quotation_id = f.quotation_id
                        AND own_follow_up.provider_message_id = ${providerMessageId}
                    )
                  )
                )
              )
              OR (
                f.state IN ('awaiting_receipt', 'waiting', 'ready', 'held')
                AND ${isUnresolvedLid}
                AND NOT (
                  f.provider_conversation_id = ${conversation}
                  OR (
                    ${phone || null}::text IS NOT NULL
                    AND f.canonical_phone = ${phone || null}
                  )
                )
              )
            )`);
                  if (!input.fromMe) {
                    if (
                      phone &&
                      (input.identityStatus === 'verified' || input.identityStatus === 'derived')
                    ) {
                      await applyConfirmedInboundInTransaction(tx, {
                        canonicalPhone: phone,
                        occurredAt,
                        providerMessageId,
                      });
                    } else {
                      await applyUncertainInboundInTransaction(tx, {
                        instance,
                        providerConversationId: conversation,
                        occurredAt,
                        canonicalPhone: phone,
                      });
                    }
                  }
                });
            }
            catch {
                throw new RepositoryError();
            }
        },
        async promoteDueWaitingToReady(inputNow: Date = new Date()) {
            const started = tracking();
            if (!started || !configuredInstance())
                return 0;
            const now = inputNow instanceof Date ? inputNow : new Date(inputNow);
            if (Number.isNaN(now.getTime()))
                throw new InputError('Data inválida.');
            try {
                return await getDb().transaction(async (tx) => {
                    const due = (await currentRows(tx, started, now)).filter(({ row, e }) => (row.follow_up_state === 'waiting' && e.kind === 'ready') ||
                        (row.follow_up_state === 'held' &&
                            (e.kind === 'ready' || e.kind === 'waiting' || e.kind === 'awaiting_receipt')));
                    let promoted = 0;
                    for (const { row, e } of due) {
                        const nextState = e.kind === 'awaiting_receipt' ? 'awaiting_receipt' : e.kind === 'waiting' ? 'waiting' : 'ready';
                        const dueAt = asDate(row.follow_up_due_at);
                        const result = await tx.execute(sql `UPDATE quotation_follow_ups
              SET state = ${nextState},
                  closed_reason = NULL,
                  closed_at = NULL,
                  updated_at = ${iso(now)}::timestamptz
              WHERE id = ${String(row.follow_up_id)}
                AND delivery_id = ${String(row.delivery_id)}
                AND state IN ('waiting', 'held')
                ${dueAt && nextState !== 'awaiting_receipt' ? sql `AND due_at = ${iso(dueAt)}::timestamptz` : sql ``}
              RETURNING id`);
                        promoted += Array.from(result).length;
                    }
                    return promoted;
                });
            }
            catch (error) {
                if (error instanceof InputError)
                    throw error;
                throw new RepositoryError();
            }
        },
        async claimApproved(optionalId?: string) {
            const now = new Date();
            const until = new Date(now.getTime() + 90_000);
            const token = randomUUID();
            const idClause = optionalId ? sql `AND id = ${id(optionalId, 'Follow-up')}` : sql ``;
            const candidateLimit = optionalId ? 1 : MAX_APPROVED_CANDIDATES_PER_CLAIM;
            const started = tracking();
            const currentInstance = configuredInstance();
            if (!started || !currentInstance)
                return null;
            try {
                return await getDb().transaction(async (tx) => {
                    await retireForeignInstanceAuthorizations(tx, currentInstance, now);
                    const candidates = Array.from(await tx.execute(sql `SELECT id
              FROM quotation_follow_ups
              WHERE instance = ${currentInstance}
                AND state = 'approved'
                AND (lease_until IS NULL OR lease_until < ${iso(now)}::timestamptz) ${idClause}
              ORDER BY approved_at ASC NULLS LAST, id ASC
              LIMIT ${candidateLimit}
              `)) as Record<string, unknown>[];
                    for (const candidate of candidates) {
                        const candidateId = String(candidate.id || '');
                        const locked = await lockFollowUpContext(tx, candidateId);
                        if (!locked)
                            continue;
                        const result = await tx.execute(sql `UPDATE quotation_follow_ups SET
                state = 'processing', lease_token = ${token}, lease_until = ${iso(until)}::timestamptz,
                updated_at = ${iso(now)}::timestamptz
              WHERE id = ${candidateId} AND state = 'approved'
                AND (lease_until IS NULL OR lease_until < ${iso(now)}::timestamptz)
              RETURNING id`);
                        if (!Array.from(result).length)
                            continue;

                        const found = (await currentRows(tx, started, now)).find(
                            ({ row }) => String(row.follow_up_id) === candidateId,
                        );
                        if (!found) {
                            await holdUnprojectableProcessing(tx, candidateId, token, now);
                            if (optionalId)
                                return null;
                            continue;
                        }

                        if (found.e.kind === 'cancel') {
                            await tx.execute(sql `UPDATE quotation_follow_ups SET
                state = 'cancelled', approved_opportunity_id = NULL, eligibility_version = NULL,
                message_snapshot = NULL, approved_at = NULL, closed_reason = ${found.e.reason},
                closed_at = ${iso(now)}::timestamptz,
                lease_token = NULL, lease_until = NULL, transport_started_at = NULL,
                updated_at = ${iso(now)}::timestamptz
              WHERE id = ${candidateId} AND state = 'processing' AND lease_token = ${token}`);
                            if (optionalId)
                                return null;
                            continue;
                        }
                        if (found.e.kind === 'hold') {
                            await tx.execute(sql `UPDATE quotation_follow_ups SET
                state = 'held', approved_opportunity_id = NULL, eligibility_version = NULL,
                message_snapshot = NULL, approved_at = NULL, closed_reason = NULL, closed_at = NULL,
                lease_token = NULL, lease_until = NULL, transport_started_at = NULL,
                updated_at = ${iso(now)}::timestamptz
              WHERE id = ${candidateId} AND state = 'processing' AND lease_token = ${token}`);
                            if (optionalId)
                                return null;
                            continue;
                        }
                        if (found.e.kind === 'absent') {
                            await tx.execute(sql `UPDATE quotation_follow_ups SET
                state = 'cancelled', approved_opportunity_id = NULL, eligibility_version = NULL,
                message_snapshot = NULL, approved_at = NULL, closed_reason = ${found.e.reason},
                closed_at = ${iso(now)}::timestamptz,
                lease_token = NULL, lease_until = NULL, transport_started_at = NULL,
                updated_at = ${iso(now)}::timestamptz
              WHERE id = ${candidateId} AND state = 'processing' AND lease_token = ${token}`);
                            if (optionalId)
                                return null;
                            continue;
                        }

                        const currentVersion = hash(found.row);
                        const currentOpportunity = found.row.opportunity_id == null
                            ? null
                            : String(found.row.opportunity_id);
                        const approvedOpportunity = found.row.approved_opportunity_id == null
                            ? null
                            : String(found.row.approved_opportunity_id);
                        const approvalMatches =
                            currentVersion === String(found.row.follow_up_eligibility_version || '') &&
                            currentOpportunity === approvedOpportunity;
                        if (found.e.kind !== 'eligible_to_send' || !approvalMatches) {
                            await tx.execute(sql `UPDATE quotation_follow_ups SET
                state = 'ready', approved_opportunity_id = NULL, eligibility_version = NULL,
                message_snapshot = NULL, approved_at = NULL, closed_reason = NULL, closed_at = NULL,
                lease_token = NULL, lease_until = NULL, transport_started_at = NULL,
                updated_at = ${iso(now)}::timestamptz
              WHERE id = ${candidateId} AND state = 'processing' AND lease_token = ${token}`);
                            if (optionalId)
                                return null;
                            continue;
                        }
                        return {
                            followUp: record({
                                ...found.row,
                                follow_up_state: 'processing',
                                follow_up_id: candidateId,
                            }),
                            leaseToken: token,
                        };
                    }
                    return null;
                });
            }
            catch {
                throw new RepositoryError();
            }
        },
        async markTransportStarted(quotationFollowUpId: string, leaseToken: string) {
            const idValue = id(quotationFollowUpId, 'Follow-up');
            const token = id(leaseToken, 'Lease');
            const now = new Date();
            const started = tracking();
            if (!started || !configuredInstance())
                return false;
            try {
                return await getDb().transaction(async (tx) => {
                    const locked = await lockFollowUpContext(tx, idValue);
                    if (!locked)
                        return false;
                    await tx.execute(sql `SELECT activity.id
              FROM whatsapp_contact_activity activity
              JOIN quotation_follow_ups f ON f.id = ${idValue}
              JOIN quotation_deliveries delivery ON delivery.id = f.delivery_id
              WHERE activity.canonical_phone = regexp_replace(delivery.phone, '[^0-9]', '', 'g')
              FOR UPDATE OF activity`);
                    await tx.execute(sql `SELECT step.id
              FROM quotation_delivery_steps step
              JOIN quotation_follow_ups f ON f.delivery_id = step.delivery_id
              WHERE f.id = ${idValue}
              FOR UPDATE OF step`);
                    await tx.execute(sql `SELECT instance
              FROM whatsapp_follow_up_ingestion_health
              WHERE instance = ${configuredInstance()}
              FOR UPDATE`);

                    const found = (await currentRows(tx, started, now)).find(
                        ({ row }) => String(row.follow_up_id) === idValue,
                    );
                    if (!found) {
                        await holdUnprojectableProcessing(tx, idValue, token, now);
                        return false;
                    }
                    if (found.e.kind === 'cancel') {
                        await tx.execute(sql `UPDATE quotation_follow_ups SET
                state = 'cancelled', approved_opportunity_id = NULL, eligibility_version = NULL,
                message_snapshot = NULL, approved_at = NULL, closed_reason = ${found.e.reason},
                closed_at = ${iso(now)}::timestamptz,
                lease_token = NULL, lease_until = NULL, transport_started_at = NULL,
                updated_at = ${iso(now)}::timestamptz
              WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token}`);
                        return false;
                    }
                    if (found.e.kind === 'hold') {
                        await tx.execute(sql `UPDATE quotation_follow_ups SET
                state = 'held', approved_opportunity_id = NULL, eligibility_version = NULL,
                message_snapshot = NULL, approved_at = NULL, closed_reason = NULL, closed_at = NULL,
                lease_token = NULL, lease_until = NULL, transport_started_at = NULL,
                updated_at = ${iso(now)}::timestamptz
              WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token}`);
                        return false;
                    }
                    const currentVersion = hash(found.row);
                    const currentOpportunity = found.row.opportunity_id == null
                        ? null
                        : String(found.row.opportunity_id);
                    const approvedOpportunity = found.row.approved_opportunity_id == null
                        ? null
                        : String(found.row.approved_opportunity_id);
                    const approvalMatches =
                        found.e.kind === 'eligible_to_send' &&
                        currentVersion === String(found.row.follow_up_eligibility_version || '') &&
                        currentOpportunity === approvedOpportunity;
                    if (!approvalMatches) {
                        await tx.execute(sql `UPDATE quotation_follow_ups SET
                state = 'ready', approved_opportunity_id = NULL, eligibility_version = NULL,
                message_snapshot = NULL, approved_at = NULL, closed_reason = NULL, closed_at = NULL,
                lease_token = NULL, lease_until = NULL, transport_started_at = NULL,
                updated_at = ${iso(now)}::timestamptz
              WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token}`);
                        return false;
                    }
                    const result = await tx.execute(sql `UPDATE quotation_follow_ups SET
                transport_started_at = ${iso(now)}::timestamptz, updated_at = ${iso(now)}::timestamptz
              WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token}
                AND lease_until > ${iso(now)}::timestamptz
                AND transport_started_at IS NULL
                AND eligibility_version = ${currentVersion}
                AND approved_opportunity_id IS NOT DISTINCT FROM ${currentOpportunity}::uuid
              RETURNING id`);
                    return Array.from(result).length > 0;
                });
            }
            catch {
                throw new RepositoryError();
            }
        },
        async completeSent(input: {
            id: string;
            leaseToken: string;
            providerMessageId: string;
            now?: Date;
        }) {
            const idValue = id(input.id, 'Follow-up');
            const token = id(input.leaseToken, 'Lease');
            const provider = typeof input.providerMessageId === 'string' ? input.providerMessageId.trim() : '';
            if (!provider)
                throw new InputError('Identificador da mensagem inválido.');
            const now = input.now instanceof Date ? input.now : new Date();
            const started = tracking();
            if (!started)
                throw new RepositoryError();
            try {
                return await getDb().transaction(async (tx) => {
                    const contextResult = await tx.execute(sql `
              SELECT
                f.id,
                f.quotation_id,
                f.revision_id,
                f.delivery_id,
                f.cycle_number,
                f.attempt_number,
                f.instance,
                f.provider_conversation_id,
                f.canonical_phone,
                f.first_provider_receipt_at,
                f.state,
                f.lease_token,
                f.lease_until,
                f.provider_message_id,
                f.source_action_id,
                COALESCE(q.opportunity_id, legacy.id) AS opportunity_id,
                crm.follow_up_stage
              FROM quotation_follow_ups f
              JOIN quotations q ON q.id = f.quotation_id
              JOIN clients cl ON cl.id = q.client_id
              JOIN quotation_deliveries delivery ON delivery.id = f.delivery_id
              LEFT JOIN LATERAL (
                SELECT cd.id
                FROM crm_deals cd
                WHERE q.opportunity_id IS NULL AND cd.quotation_id = q.id
                ORDER BY cd.updated_at DESC, cd.id DESC
                LIMIT 1
              ) legacy ON true
              LEFT JOIN crm_deals crm ON crm.id = COALESCE(q.opportunity_id, legacy.id)
              WHERE f.id = ${idValue}
            `);
                    const context = Array.from(contextResult) as Record<string, unknown>[];
                    if (!context.length)
                        return null;
                    const quotationId = String(context[0].quotation_id);
                    const opportunityId = context[0].opportunity_id == null ? null : String(context[0].opportunity_id);
                    await lockOpportunity(tx, opportunityId, quotationId);
                    const lockedResult = await tx.execute(sql `
              SELECT
                f.id,
                f.quotation_id,
                f.revision_id,
                f.delivery_id,
                f.cycle_number,
                f.attempt_number,
                f.instance,
                f.provider_conversation_id,
                f.canonical_phone,
                f.first_provider_receipt_at,
                f.state,
                f.lease_token,
                f.lease_until,
                f.provider_message_id,
                f.source_action_id,
                COALESCE(q.opportunity_id, legacy.id) AS opportunity_id,
                crm.follow_up_stage
              FROM quotation_follow_ups f
              JOIN quotations q ON q.id = f.quotation_id
              JOIN clients cl ON cl.id = q.client_id
              JOIN quotation_deliveries delivery ON delivery.id = f.delivery_id
              LEFT JOIN LATERAL (
                SELECT cd.id
                FROM crm_deals cd
                WHERE q.opportunity_id IS NULL AND cd.quotation_id = q.id
                ORDER BY cd.updated_at DESC, cd.id DESC
                LIMIT 1
              ) legacy ON true
              LEFT JOIN crm_deals crm ON crm.id = COALESCE(q.opportunity_id, legacy.id)
              WHERE f.id = ${idValue}
              FOR UPDATE OF f, q, cl, delivery
            `);
                    const locked = Array.from(lockedResult) as Record<string, unknown>[];
                    if (!locked.length)
                        return null;
                    const row = locked[0];
                    const persistedState = String(row.state);
                    if (persistedState === 'sent' && String(row.provider_message_id || '') === provider) {
                        return loadRecordById(tx, idValue, started, now);
                    }
                    const historyReplay = await tx.execute(sql`
              SELECT id
              FROM quotation_follow_up_attempt_history
              WHERE follow_up_id = ${idValue}
                AND provider_message_id = ${provider}
              LIMIT 1
                    `);
                    if (Array.from(historyReplay).length) {
                        return loadCompletedReplay(tx, idValue, provider, started, now);
                    }
                    if (persistedState !== 'processing' || String(row.lease_token || '') !== token) {
                        return null;
                    }
                    const leaseUntil = asDate(row.lease_until);
                    if (!leaseUntil || leaseUntil.getTime() <= now.getTime())
                        return null;

                    const completed = await tx.execute(sql `UPDATE quotation_follow_ups SET
              state = 'sent', provider_message_id = ${provider}, sent_at = ${iso(now)}::timestamptz,
              closed_at = ${iso(now)}::timestamptz, lease_token = NULL, lease_until = NULL,
              updated_at = ${iso(now)}::timestamptz
            WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token}
              AND lease_until > ${iso(now)}::timestamptz
            RETURNING id`);
                    if (!Array.from(completed).length)
                        return null;

                    const persistedAttempt = Number(row.attempt_number || 1);
                    const stage = Number(row.follow_up_stage || 0);
                    // An alternative proposal may have been materialized while
                    // the opportunity was still at stage 0. Once the first
                    // follow-up is confirmed, that still-open candidate is the
                    // second return even though its row predates the stage
                    // transition.
                    const attempt = persistedAttempt === 1 && stage === 1 ? 2 : persistedAttempt;
                    const expectedStage = attempt - 1;
                    if ((attempt !== 1 && attempt !== 2) || stage !== expectedStage || !opportunityId) {
                        return loadRecordById(tx, idValue, started, now);
                    }

                    const [current] = await tx
                        .select()
                        .from(quotationFollowUps)
                        .where(eq(quotationFollowUps.id, idValue))
                        .limit(1);
                    if (!current) return null;
                    await advanceConfirmedFollowUp({
                        database: tx,
                        opportunityId,
                        current,
                        stage,
                        attemptNumber: attempt as 1 | 2,
                        confirmedAt: now,
                        source: 'worker',
                        actor: 'system',
                        providerMessageId: provider,
                        idFactory: randomUUID,
                    });
                    return loadRecordById(tx, idValue, started, now);
                });
            }
            catch (error) {
                if (unique(error))
                    throw new ConflictError('Identificador da mensagem já utilizado.');
                throw new RepositoryError();
            }
        },
        async completeFailed(input: { id: string; leaseToken: string; reason: 'provider_rejected' | 'rate_limited' }) {
            const idValue = id(input.id, 'Follow-up');
            const token = id(input.leaseToken, 'Lease');
            if (!['provider_rejected', 'rate_limited'].includes(input.reason))
                throw new InputError('Motivo inválido.');
            const now = new Date();
            const started = tracking();
            if (!started)
                throw new RepositoryError();
            try {
                const result = await getDb().execute(sql `UPDATE quotation_follow_ups SET
            state = 'failed', closed_reason = ${input.reason}, closed_at = ${iso(now)}::timestamptz,
            lease_token = NULL, lease_until = NULL, updated_at = ${iso(now)}::timestamptz
          WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token} AND lease_until > ${iso(now)}::timestamptz
          RETURNING quotation_id`);
                const row = Array.from(result)[0];
                return row ? loadRecord(getDb(), String(row.quotation_id), started, now) : null;
            }
            catch {
                throw new RepositoryError();
            }
        },
        async completeNeedsReview(input: {
            id: string;
            leaseToken: string;
            reason?: 'transport_ambiguous' | 'lease_expired_after_transport';
        }) {
            const idValue = id(input.id, 'Follow-up');
            const token = id(input.leaseToken, 'Lease');
            const reason = input.reason || 'transport_ambiguous';
            if (!['transport_ambiguous', 'lease_expired_after_transport'].includes(reason)) {
                throw new InputError('Motivo inválido.');
            }
            const now = new Date();
            const started = tracking();
            if (!started)
                throw new RepositoryError();
            try {
                const result = await getDb().execute(sql `UPDATE quotation_follow_ups SET
            state = 'needs_review', closed_reason = ${reason}, closed_at = ${iso(now)}::timestamptz,
            lease_token = NULL, lease_until = NULL, updated_at = ${iso(now)}::timestamptz
          WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token} AND lease_until > ${iso(now)}::timestamptz
          RETURNING quotation_id`);
                const row = Array.from(result)[0];
                return row ? loadRecord(getDb(), String(row.quotation_id), started, now) : null;
            }
            catch {
                throw new RepositoryError();
            }
        },
        async reapExpiredLeases(limit = 50) {
            if (!Number.isInteger(limit) || limit < 1)
                throw new InputError('Limite inválido.');
            try {
                const result = await getDb().execute(sql `WITH expired AS (
            SELECT id, transport_started_at FROM quotation_follow_ups
            WHERE state = 'processing' AND lease_until IS NOT NULL AND lease_until <= now()
            ORDER BY lease_until
            LIMIT ${Math.min(limit, 100)}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE quotation_follow_ups f SET
            state = CASE WHEN e.transport_started_at IS NULL THEN 'approved' ELSE 'needs_review' END,
            closed_reason = CASE WHEN e.transport_started_at IS NULL THEN NULL ELSE 'lease_expired_after_transport' END,
            closed_at = CASE WHEN e.transport_started_at IS NULL THEN NULL ELSE now() END,
            lease_token = NULL,
            lease_until = NULL,
            updated_at = now()
          FROM expired e
          WHERE f.id = e.id
            AND f.state = 'processing'
            AND f.lease_until IS NOT NULL
            AND f.lease_until <= now()
          RETURNING f.id`);
                return Array.from(result).length;
            }
            catch {
                throw new RepositoryError();
            }
        },
        async countApprovalsTodayUtc(now: Date = new Date()) {
            try {
                const result = await getDb().execute(sql `SELECT count(*)::int count FROM quotation_follow_ups
          WHERE approved_at >= date_trunc('day', ${iso(now)}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
            AND approved_at < date_trunc('day', ${iso(now)}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 day'`);
                return Number(Array.from(result)[0]?.count || 0);
            }
            catch {
                throw new RepositoryError();
            }
        },
    };
    return repository;
}
export const createQuotationFollowUpRepository = createPostgresQuotationFollowUpRepository;
