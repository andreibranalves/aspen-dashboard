import { createHash, randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from '../client.js';
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
  messageSnapshot: string | null;
  closedReason: string | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  updatedAt: Date;
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
export interface QuotationFollowUpRepository {
  list(input?: FollowUpListInput): Promise<FollowUpListResult>;
  get(quotationId: string, options?: { trackingStartedAt?: Date; now?: Date }): Promise<FollowUpProjection | null>;
  approve(input: ApproveInput): Promise<FollowUpRecord>;
  dismiss(input: DismissInput): Promise<FollowUpRecord>;
  upsertAwaitingReceiptFromAcceptedDelivery?(input: {
    deliveryId: string;
    revisionId: string;
    phone: string;
    providerMessageId: string;
  }): Promise<void>;
  listAcceptedDeliveriesMissingFollowUp?(filter?: {
    deliveryId?: string;
  }): Promise<
    Array<{
      deliveryId: string;
      revisionId: string;
      phone: string;
      providerMessageId: string;
    }>
  >;
  upsertFromDeliveryReceipt?(input: {
    deliveryId: string;
    revisionId: string;
    phone: string;
    providerConversationId: string;
    allStepsDelivered: boolean;
    receivedAt: Date;
  }): Promise<void>;
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
  completeSent(input: { id: string; leaseToken: string; providerMessageId: string }): Promise<FollowUpRecord | null>;
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_KEYS = [
  'blockedAt',
  'crmUpdatedAt',
  'deliveryId',
  'firstProviderReceiptAt',
  'ingestionHealthUpdatedAt',
  'lastInboundAt',
  'lastInboundId',
  'lastOutboundAt',
  'lastOutboundId',
  'quotationUpdatedAt',
  'unresolvedLidWatermark',
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
function factsSql(started: Date, instance: string): SQL {
    return sql `WITH latest AS (
    SELECT DISTINCT ON (q.id)
      q.id quotation_id,
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
      a.provider_conversation_id activity_conversation_id,
      a.identity_status,
      a.blocked_at "blockedAt",
      blocked.blocked_at IS NOT NULL contact_blocked,
      crm.status crm_status,
      crm.updated_at "crmUpdatedAt",
      f.id follow_up_id,
      f.state follow_up_state,
      f.delivery_id follow_up_delivery_id,
      f.revision_id follow_up_revision_id,
      f.provider_conversation_id follow_up_provider_conversation_id,
      f.canonical_phone follow_up_canonical_phone,
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
      SELECT 1 blocked_at FROM whatsapp_contact_activity blocked
      WHERE blocked.instance = ${instance}
        AND blocked.canonical_phone = regexp_replace(d.phone, '[^0-9]', '', 'g')
        AND blocked.blocked_at IS NOT NULL
      LIMIT 1
    ) blocked ON true
    LEFT JOIN LATERAL (
      SELECT cd.* FROM crm_deals cd WHERE cd.quotation_id = q.id
      ORDER BY cd.updated_at DESC LIMIT 1
    ) crm ON true
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
export function createPostgresQuotationFollowUpRepository(
  getDb: DatabaseProvider = getDatabase,
): QuotationFollowUpRepository {
    const currentRows = async (db: Database, started: Date, now: Date) => (await rows(db, started)).map((row) => ({ row, e: evaluate(row, now, started) }));
    const loadRecord = async (db: Database, quotationId: string, started: Date, now: Date) => {
        const found = (await currentRows(db, started, now)).find(({ row }) => String(row.quotation_id) === quotationId);
        if (!found || !found.row.follow_up_state)
            return null;
        return record(found.row);
    };
    return {
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
                const all = await currentRows(getDb(), started, now);
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
        async get(quotationId: string, options: { trackingStartedAt?: Date; now?: Date } = {}) {
            const quotation = id(quotationId, 'quotation_id');
            const started = tracking(options.trackingStartedAt);
            if (!started || !configuredInstance())
                return null;
            const now = options.now instanceof Date ? options.now : new Date();
            try {
                const found = (await currentRows(getDb(), started, now)).find(({ row }) => String(row.quotation_id) === quotation);
                if (!found || !followUpVisibleListView((found.row.follow_up_state as FollowUpPersistedState) || null, found.e)) {
                    return null;
                }
                return projection(found.row, visibleState(found.row, found.e), found.e);
            }
            catch {
                throw new RepositoryError();
            }
        },
        async approve(input: ApproveInput) {
            const quotationId = id(input.quotationId, 'quotation_id');
            const expected = String(input.eligibilityVersion || '');
            const text = cleanMessage(input.message);
            const started = tracking(input.trackingStartedAt);
            if (!started || !configuredInstance()) {
                throw new ConflictError('Follow-up indisponível sem data de início do rastreamento.');
            }
            const now = input.now instanceof Date ? input.now : new Date();
            try {
                return await getDb().transaction(async (tx) => {
                    const found = (await currentRows(tx, started, now)).find(({ row }) => String(row.quotation_id) === quotationId);
                    if (!found)
                        throw new NotFoundError();
                    if (!found.row.follow_up_id)
                        throw new ConflictError(STALE);
                    if (found.e.kind !== 'ready' ||
                        !['ready', 'waiting', 'held'].includes(String(found.row.follow_up_state))) {
                        throw new ConflictError(STALE);
                    }
                    const projected = projection(found.row, visibleState(found.row, found.e));
                    if (projected.eligibilityVersion !== expected)
                        throw new ConflictError(STALE);
                    const dueAt = asDate(found.row.follow_up_due_at);
                    const updated = await tx.execute(sql `UPDATE quotation_follow_ups SET
              eligibility_version = ${expected}, message_snapshot = ${text}, state = 'approved',
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
                    const found = (await currentRows(tx, started, now)).find(({ row }) => String(row.quotation_id) === quotationId);
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
                        await tx.execute(sql `INSERT INTO whatsapp_contact_activity (
              id, instance, provider_conversation_id, canonical_phone, identity_status, blocked_at, block_reason, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, ${found.row.instance}, ${projected.providerConversationId}, ${projected.canonicalPhone},
              'derived', ${iso(now)}::timestamptz, 'do_not_contact', ${iso(now)}::timestamptz, ${iso(now)}::timestamptz
            )
            ON CONFLICT (instance, provider_conversation_id) DO UPDATE SET
              blocked_at = EXCLUDED.blocked_at,
              block_reason = EXCLUDED.block_reason,
              updated_at = EXCLUDED.updated_at`);
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
        async upsertAwaitingReceiptFromAcceptedDelivery(input: {
            deliveryId: string;
            revisionId: string;
            phone: string;
            providerMessageId: string;
        }) {
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
            try {
                await getDb().transaction(async (tx) => {
                    const source = Array.from(await tx.execute(sql `
              SELECT q.id, pg_advisory_xact_lock(hashtextextended(q.id::text, 0))
              FROM quotation_deliveries d
              JOIN quote_revisions r ON r.id = d.revision_id
              JOIN quotations q ON q.id = r.quotation_id
              JOIN clients cl ON cl.id = q.client_id
              WHERE d.id = ${deliveryId} AND d.revision_id = ${revisionId}
              FOR UPDATE OF cl
            `));
                    if (!source.length)
                        throw new RepositoryError();
                    const result = await tx.execute(sql `
            INSERT INTO quotation_follow_ups (
              id, quotation_id, revision_id, delivery_id, instance, provider_conversation_id,
              canonical_phone, eligibility_version, message_snapshot, state, closed_reason,
              first_provider_receipt_at, due_at, approved_at, sent_at, closed_at,
              provider_message_id, lease_token, lease_until, transport_started_at, created_at, updated_at
            )
            SELECT
              ${randomUUID()}, q.id, r.id, d.id, ${instance}, ${conversation},
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
            LEFT JOIN crm_deals cd ON cd.quotation_id = q.id AND cd.status = 'Orcamento Enviado'
            WHERE d.id = ${deliveryId} AND d.revision_id = ${revisionId}
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
          `);
                    if (!Array.from(result).length) {
                        // A newer accepted delivery already owns this quotation's candidate.
                        return;
                    }
                });
            }
            catch (error) {
                if (error instanceof InputError || error instanceof RepositoryError)
                    throw error;
                throw new RepositoryError();
            }
        },
        async listAcceptedDeliveriesMissingFollowUp(filter: { deliveryId?: string } = {}) {
            const started = tracking();
            if (!started)
                return [];
            const deliveryId = filter.deliveryId ? id(filter.deliveryId, 'delivery_id') : null;
            try {
                const result = await getDb().execute(sql `
          SELECT d.id AS delivery_id, d.revision_id, d.phone, s.provider_message_id
          FROM quotation_deliveries d
          JOIN quote_revisions r ON r.id = d.revision_id
          JOIN quotations q ON q.id = r.quotation_id
          JOIN LATERAL (
            SELECT st.provider_message_id
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
          ORDER BY d.created_at ASC
          LIMIT 50
        `);
                return Array.from(result).flatMap((row) => {
                    const nextDeliveryId = String(row.delivery_id || row.deliveryId || '');
                    const revisionId = String(row.revision_id || row.revisionId || '');
                    const phone = String(row.phone || '');
                    const providerMessageId = String(row.provider_message_id || row.providerMessageId || '').trim();
                    if (!UUID.test(nextDeliveryId) || !UUID.test(revisionId) || !providerMessageId)
                        return [];
                    return [{ deliveryId: nextDeliveryId, revisionId, phone, providerMessageId }];
                });
            }
            catch {
                throw new RepositoryError();
            }
        },
        async upsertFromDeliveryReceipt(input: {
            deliveryId: string;
            revisionId: string;
            phone: string;
            providerConversationId: string;
            allStepsDelivered: boolean;
            receivedAt: Date;
        }) {
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
            const receivedAt = requiredDate(input.receivedAt, 'recibo');
            const instance = configuredInstance();
            if (!instance)
                throw new RepositoryError();
            const firstReceipt = input.allStepsDelivered ? receivedAt : null;
            const dueAt = firstReceipt ? new Date(firstReceipt.getTime() + 24 * 60 * 60 * 1000) : null;
            const now = new Date();
            try {
                await getDb().transaction(async (tx) => {
                    const source = Array.from(await tx.execute(sql `
              SELECT q.id, pg_advisory_xact_lock(hashtextextended(q.id::text, 0))
              FROM quotation_deliveries d
              JOIN quote_revisions r ON r.id = d.revision_id
              JOIN quotations q ON q.id = r.quotation_id
              JOIN clients cl ON cl.id = q.client_id
              WHERE d.id = ${deliveryId} AND d.revision_id = ${revisionId}
              FOR UPDATE OF cl
            `));
                    if (!source.length)
                        throw new RepositoryError();
                    await tx.execute(sql `
            INSERT INTO quotation_follow_ups (
              id, quotation_id, revision_id, delivery_id, instance, provider_conversation_id,
              canonical_phone, eligibility_version, message_snapshot, state, closed_reason,
              first_provider_receipt_at, due_at, approved_at, sent_at, closed_at,
              provider_message_id, lease_token, lease_until, transport_started_at, created_at, updated_at
            )
            SELECT
              ${randomUUID()}, q.id, r.id, d.id, ${instance}, ${providerConversationId},
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
            LEFT JOIN crm_deals cd ON cd.quotation_id = q.id AND cd.status = 'Orcamento Enviado'
            WHERE d.id = ${deliveryId} AND d.revision_id = ${revisionId}
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
          `);
                });
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
                await getDb().execute(sql `UPDATE quotation_follow_ups f
          SET state = CASE
                WHEN ${isUnresolvedLid}
                  AND NOT (
                    f.provider_conversation_id = ${conversation}
                    OR (
                      ${phone || null} IS NOT NULL
                      AND f.canonical_phone = ${phone || null}
                    )
                  )
                  THEN 'held'
                ELSE 'cancelled'
              END,
              closed_reason = CASE
                WHEN ${isUnresolvedLid}
                  AND NOT (
                    f.provider_conversation_id = ${conversation}
                    OR (
                      ${phone || null} IS NOT NULL
                      AND f.canonical_phone = ${phone || null}
                    )
                  )
                  THEN NULL
                WHEN ${input.fromMe} THEN 'outbound_after_anchor'
                ELSE 'inbound_after_anchor'
              END,
              closed_at = CASE
                WHEN ${isUnresolvedLid}
                  AND NOT (
                    f.provider_conversation_id = ${conversation}
                    OR (
                      ${phone || null} IS NOT NULL
                      AND f.canonical_phone = ${phone || null}
                    )
                  )
                  THEN NULL
                ELSE ${iso(occurredAt)}::timestamptz
              END,
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
                    ${phone || null} IS NOT NULL
                    AND f.canonical_phone = ${phone || null}
                  )
                )
                AND (
                  ${input.fromMe ? true : false} = false
                  OR NOT EXISTS (
                    SELECT 1 FROM quotation_delivery_steps own
                    WHERE own.delivery_id = f.delivery_id AND own.provider_message_id = ${providerMessageId}
                  )
                )
              )
              OR (
                f.state IN ('awaiting_receipt', 'waiting', 'ready', 'held')
                AND ${isUnresolvedLid}
                AND NOT (
                  f.provider_conversation_id = ${conversation}
                  OR (
                    ${phone || null} IS NOT NULL
                    AND f.canonical_phone = ${phone || null}
                  )
                )
              )
            )`);
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
            const started = tracking();
            if (!started || !configuredInstance())
                return null;
            try {
                return await getDb().transaction(async (tx) => {
                    const result = await tx.execute(sql `UPDATE quotation_follow_ups SET
              state = 'processing', lease_token = ${token}, lease_until = ${iso(until)}::timestamptz, updated_at = ${iso(now)}::timestamptz
            WHERE id IN (
              SELECT id FROM quotation_follow_ups
              WHERE state = 'approved' AND (lease_until IS NULL OR lease_until < ${iso(now)}::timestamptz) ${idClause}
              ORDER BY approved_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            RETURNING *`);
                    const claimed = Array.from(result)[0];
                    if (!claimed)
                        return null;
                    const found = (await currentRows(tx, started, now)).find(({ row }) => String(row.follow_up_id) === String(claimed.id));
                    if (!found)
                        return null;
                    if (found.e.kind === 'hold') {
                        await tx.execute(sql `UPDATE quotation_follow_ups SET
              state = 'approved', lease_token = NULL, lease_until = NULL, updated_at = ${iso(now)}::timestamptz
              WHERE id = ${claimed.id} AND state = 'processing'`);
                        return null;
                    }
                    if (found.e.kind === 'cancel') {
                        await tx.execute(sql `UPDATE quotation_follow_ups SET
              state = 'cancelled', closed_reason = ${found.e.reason}, closed_at = ${iso(now)}::timestamptz,
              lease_token = NULL, lease_until = NULL, updated_at = ${iso(now)}::timestamptz
              WHERE id = ${claimed.id} AND state = 'processing'`);
                        return null;
                    }
                    if (found.e.kind !== 'eligible_to_send')
                        return null;
                    return {
                        followUp: record({
                            ...found.row,
                            follow_up_state: 'processing',
                            follow_up_id: claimed.id,
                        }),
                        leaseToken: token,
                    };
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
            try {
                const result = await getDb().execute(sql `UPDATE quotation_follow_ups SET
            transport_started_at = ${iso(now)}::timestamptz, updated_at = ${iso(now)}::timestamptz
          WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token} AND lease_until > ${iso(now)}::timestamptz
          RETURNING id`);
                return Array.from(result).length > 0;
            }
            catch {
                throw new RepositoryError();
            }
        },
        async completeSent(input: { id: string; leaseToken: string; providerMessageId: string }) {
            const idValue = id(input.id, 'Follow-up');
            const token = id(input.leaseToken, 'Lease');
            const provider = typeof input.providerMessageId === 'string' ? input.providerMessageId.trim() : '';
            if (!provider)
                throw new InputError('Identificador da mensagem inválido.');
            const now = new Date();
            const started = tracking();
            if (!started)
                throw new RepositoryError();
            try {
                const result = await getDb().execute(sql `UPDATE quotation_follow_ups SET
            state = 'sent', provider_message_id = ${provider}, sent_at = ${iso(now)}::timestamptz, closed_at = ${iso(now)}::timestamptz,
            lease_token = NULL, lease_until = NULL, updated_at = ${iso(now)}::timestamptz
          WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token} AND lease_until > ${iso(now)}::timestamptz
          RETURNING quotation_id`);
                const row = Array.from(result)[0];
                return row ? loadRecord(getDb(), String(row.quotation_id), started, now) : null;
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
}
export const createQuotationFollowUpRepository = createPostgresQuotationFollowUpRepository;
