import { createHash, randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from '../client.js';
import {
  buildDefaultFollowUpMessage,
  evaluateFollowUp,
  followUpListView,
  parseFollowUpTrackingStartedAt,
  type DismissReason,
  type FollowUpEvaluation,
  type FollowUpListView,
  type FollowUpPersistedState,
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
  firstProviderReceiptAt: Date;
  dueAt: Date;
  eligibilityVersion: string;
  state: 'waiting' | 'ready' | FollowUpPersistedState;
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
function iso(value: Date): string {
  return value.toISOString();
}
function projection(
  row: Record<string, unknown>,
  state: 'waiting' | 'ready' | FollowUpPersistedState,
): FollowUpProjection {
  const clientName = String(row.client_name);
  const businessNumber = String(row.business_number);
  const canonicalPhone = digits(row.canonical_phone || row.delivery_phone);
  const conversation =
    String(row.activity_conversation_id || row.provider_conversation_id || '').trim() ||
    (canonicalPhone ? `${canonicalPhone}@s.whatsapp.net` : '');
  const snapshot =
    row.message_snapshot == null
      ? state === 'ready' || state === 'waiting'
        ? buildDefaultFollowUpMessage({ clientName, businessNumber })
        : null
      : String(row.message_snapshot);
  return {
    quotationId: String(row.quotation_id),
    revisionId: String(row.revision_id),
    deliveryId: String(row.delivery_id),
    businessNumber,
    clientName,
    amount: String(row.amount),
    instance: String(row.instance),
    providerConversationId: conversation,
    canonicalPhone,
    deliveryCreatedAt: requiredDate(row.delivery_created_at, 'entrega'),
    firstProviderReceiptAt: requiredDate(row.first_provider_receipt_at, 'recibo'),
    dueAt: requiredDate(row.due_at, 'vencimento'),
    eligibilityVersion: hash(row),
    state,
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
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function factsSql(started: Date, instance: string): SQL {
  return sql`WITH latest AS (
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
    FROM quotations q
    JOIN clients c ON c.id = q.client_id
    JOIN LATERAL (
      SELECT d.* FROM quotation_deliveries d
      JOIN quote_revisions dr ON dr.id = d.revision_id
      WHERE dr.quotation_id = q.id AND d.created_at >= ${iso(started)}::timestamptz
      ORDER BY d.created_at DESC, d.id DESC LIMIT 1
    ) d ON true
    JOIN LATERAL (
      SELECT r.* FROM quote_revisions r
      WHERE r.quotation_id = q.id AND r.status = 'emitido'
      ORDER BY r.version DESC LIMIT 1
    ) qr ON true
    LEFT JOIN LATERAL (
      SELECT MIN(COALESCE(s.delivered_at, s.read_at)) first_provider_receipt_at
      FROM quotation_delivery_steps s
      WHERE s.delivery_id = d.id AND (s.delivered_at IS NOT NULL OR s.read_at IS NOT NULL)
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
    LEFT JOIN quotation_follow_ups f ON f.quotation_id = q.id
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
    ) lid ON true
    LEFT JOIN LATERAL (
      SELECT true after_anchor FROM whatsapp_contact_activity x
      WHERE x.instance = ${instance}
        AND x.canonical_phone = regexp_replace(d.phone, '[^0-9]', '', 'g')
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
    WHERE q.updated_at IS NOT NULL
    ORDER BY q.id
  )
  SELECT * FROM latest`;
}

function evaluate(row: Record<string, unknown>, now: Date, started: Date): FollowUpEvaluation {
  const phone = digits(row.canonical_phone || row.delivery_phone);
  const identityStatus = String(row.identity_status || '');
  const identityResolved =
    (identityStatus === 'verified' || identityStatus === 'derived') &&
    phone.length >= 10 &&
    phone.length <= 15;
  return evaluateFollowUp({
    now,
    trackingStartedAt: started,
    persistedState: (row.follow_up_state as FollowUpPersistedState) || null,
    latestDelivery: {
      id: String(row.delivery_id),
      state: String(row.delivery_state),
      completionSource: row.completion_source == null ? null : String(row.completion_source),
      createdAt: requiredDate(row.delivery_created_at, 'entrega'),
      firstProviderReceiptAt: asDate(row.first_provider_receipt_at),
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

async function rows(db: Database, started: Date): Promise<Record<string, unknown>[]> {
  const instance = configuredInstance();
  if (!instance) return [];
  const result = await db.execute(factsSql(started, instance));
  return Array.from(result) as Record<string, unknown>[];
}

export function createPostgresQuotationFollowUpRepository(
  getDb: DatabaseProvider = getDatabase,
): QuotationFollowUpRepository {
  const currentRows = async (db: Database, started: Date, now: Date) =>
    (await rows(db, started)).map((row) => ({ row, e: evaluate(row, now, started) }));
  const loadRecord = async (db: Database, quotationId: string, started: Date, now: Date) => {
    const found = (await currentRows(db, started, now)).find(({ row }) => String(row.quotation_id) === quotationId);
    if (!found || !found.row.follow_up_state) return null;
    return record(found.row);
  };
  return {
    async list(input = {}) {
      const started = tracking(input.trackingStartedAt);
      const p = page(input.page, 1);
      const size = Math.min(MAX_PAGE_SIZE, page(input.pageSize, DEFAULT_PAGE_SIZE));
      if (!started || !configuredInstance()) return { data: [], total: 0, page: p, pageSize: size };
      const now = input.now instanceof Date ? input.now : new Date();
      if (input.view && !['ready', 'waiting', 'sent', 'dismissed', 'attention'].includes(input.view)) {
        throw new InputError('Visualização inválida.');
      }
      try {
        const all = await currentRows(getDb(), started, now);
        const filtered = all.filter(({ row, e }) => {
          if (!row.follow_up_state && e.kind !== 'ready' && e.kind !== 'waiting') return false;
          const view = row.follow_up_state ? followUpListView(row.follow_up_state as FollowUpPersistedState) : e.kind;
          return !input.view || view === input.view;
        });
        const data = filtered.map(({ row, e }) => projection(row, (row.follow_up_state || e.kind) as FollowUpProjection['state']));
        return { data: data.slice((p - 1) * size, p * size), total: data.length, page: p, pageSize: size };
      } catch (error) {
        if (error instanceof InputError) throw error;
        throw new RepositoryError();
      }
    },
    async get(quotationId, options = {}) {
      const quotation = id(quotationId, 'quotation_id');
      const started = tracking(options.trackingStartedAt);
      if (!started || !configuredInstance()) return null;
      const now = options.now instanceof Date ? options.now : new Date();
      try {
        const found = (await currentRows(getDb(), started, now)).find(({ row }) => String(row.quotation_id) === quotation);
        if (!found || (!found.row.follow_up_state && found.e.kind !== 'ready' && found.e.kind !== 'waiting')) {
          return null;
        }
        return projection(found.row, (found.row.follow_up_state || found.e.kind) as FollowUpProjection['state']);
      } catch {
        throw new RepositoryError();
      }
    },
    async approve(input) {
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
          if (!found) throw new NotFoundError();
          const projected = projection(found.row, found.e.kind === 'ready' ? 'ready' : 'waiting');
          if (projected.eligibilityVersion !== expected || found.e.kind !== 'ready') throw new ConflictError(STALE);
          const followUpId = randomUUID();
          await tx.execute(sql`INSERT INTO quotation_follow_ups (
            id, quotation_id, revision_id, delivery_id, instance, provider_conversation_id, canonical_phone,
            eligibility_version, message_snapshot, state, first_provider_receipt_at, due_at, approved_at, created_at, updated_at
          ) VALUES (
            ${followUpId}, ${quotationId}, ${found.row.revision_id}, ${found.row.delivery_id}, ${found.row.instance},
            ${projected.providerConversationId}, ${projected.canonicalPhone}, ${expected}, ${text}, 'approved',
            ${iso(projected.firstProviderReceiptAt)}::timestamptz, ${iso(projected.dueAt)}::timestamptz,
            ${iso(now)}::timestamptz, ${iso(now)}::timestamptz, ${iso(now)}::timestamptz
          )`);
          return {
            ...projected,
            followUpId,
            messageSnapshot: text,
            approvedAt: now,
            state: 'approved' as const,
            updatedAt: now,
          };
        });
      } catch (error) {
        if (error instanceof InputError || error instanceof ConflictError || error instanceof NotFoundError) throw error;
        if (unique(error)) throw new ConflictError('Este orçamento já possui um follow-up.');
        throw new RepositoryError();
      }
    },
    async dismiss(input) {
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
          if (!found) throw new NotFoundError();
          const projected = projection(found.row, found.e.kind === 'ready' ? 'ready' : 'waiting');
          if (projected.eligibilityVersion !== expected || !['ready', 'waiting'].includes(found.e.kind)) {
            throw new ConflictError(STALE);
          }
          const followUpId = randomUUID();
          await tx.execute(sql`INSERT INTO quotation_follow_ups (
            id, quotation_id, revision_id, delivery_id, instance, provider_conversation_id, canonical_phone,
            eligibility_version, message_snapshot, state, closed_reason, first_provider_receipt_at, due_at,
            closed_at, created_at, updated_at
          ) VALUES (
            ${followUpId}, ${quotationId}, ${found.row.revision_id}, ${found.row.delivery_id}, ${found.row.instance},
            ${projected.providerConversationId}, ${projected.canonicalPhone}, ${expected}, ${DISMISSED_MESSAGE_SNAPSHOT},
            'dismissed', ${input.reason}, ${iso(projected.firstProviderReceiptAt)}::timestamptz,
            ${iso(projected.dueAt)}::timestamptz, ${iso(now)}::timestamptz, ${iso(now)}::timestamptz, ${iso(now)}::timestamptz
          )`);
          if (input.reason === 'do_not_contact') {
            await tx.execute(sql`INSERT INTO whatsapp_contact_activity (
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
          return {
            ...projected,
            followUpId,
            messageSnapshot: DISMISSED_MESSAGE_SNAPSHOT,
            closedReason: input.reason,
            approvedAt: null,
            sentAt: null,
            state: 'dismissed' as const,
            updatedAt: now,
          };
        });
      } catch (error) {
        if (error instanceof InputError || error instanceof ConflictError || error instanceof NotFoundError) throw error;
        if (unique(error)) throw new ConflictError('Este orçamento já possui um follow-up.');
        throw new RepositoryError();
      }
    },
    async claimApproved(optionalId) {
      const now = new Date();
      const until = new Date(now.getTime() + 90_000);
      const token = randomUUID();
      const idClause = optionalId ? sql`AND id = ${id(optionalId, 'Follow-up')}` : sql``;
      const started = tracking();
      if (!started || !configuredInstance()) return null;
      try {
        return await getDb().transaction(async (tx) => {
          const result = await tx.execute(sql`UPDATE quotation_follow_ups SET
              state = 'processing', lease_token = ${token}, lease_until = ${iso(until)}::timestamptz, updated_at = ${iso(now)}::timestamptz
            WHERE id IN (
              SELECT id FROM quotation_follow_ups
              WHERE state = 'approved' AND (lease_until IS NULL OR lease_until < ${iso(now)}::timestamptz) ${idClause}
              ORDER BY approved_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            RETURNING *`);
          const claimed = Array.from(result)[0] as Record<string, unknown> | undefined;
          if (!claimed) return null;
          const found = (await currentRows(tx, started, now)).find(
            ({ row }) => String(row.follow_up_id) === String(claimed.id),
          );
          if (!found) return null;
          if (found.e.kind === 'hold') {
            await tx.execute(sql`UPDATE quotation_follow_ups SET
              state = 'approved', lease_token = NULL, lease_until = NULL, updated_at = ${iso(now)}::timestamptz
              WHERE id = ${claimed.id} AND state = 'processing'`);
            return null;
          }
          if (found.e.kind === 'cancel') {
            await tx.execute(sql`UPDATE quotation_follow_ups SET
              state = 'cancelled', closed_reason = ${found.e.reason}, closed_at = ${iso(now)}::timestamptz,
              lease_token = NULL, lease_until = NULL, updated_at = ${iso(now)}::timestamptz
              WHERE id = ${claimed.id} AND state = 'processing'`);
            return null;
          }
          if (found.e.kind !== 'eligible_to_send') return null;
          return {
            followUp: record({
              ...found.row,
              follow_up_state: 'processing',
              follow_up_id: claimed.id,
            }),
            leaseToken: token,
          };
        });
      } catch {
        throw new RepositoryError();
      }
    },
    async markTransportStarted(quotationFollowUpId, leaseToken) {
      const idValue = id(quotationFollowUpId, 'Follow-up');
      const token = id(leaseToken, 'Lease');
      const now = new Date();
      try {
        const result = await getDb().execute(sql`UPDATE quotation_follow_ups SET
            transport_started_at = ${iso(now)}::timestamptz, updated_at = ${iso(now)}::timestamptz
          WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token} AND lease_until > ${iso(now)}::timestamptz
          RETURNING id`);
        return Array.from(result).length > 0;
      } catch {
        throw new RepositoryError();
      }
    },
    async completeSent(input) {
      const idValue = id(input.id, 'Follow-up');
      const token = id(input.leaseToken, 'Lease');
      const provider = typeof input.providerMessageId === 'string' ? input.providerMessageId.trim() : '';
      if (!provider) throw new InputError('Identificador da mensagem inválido.');
      const now = new Date();
      const started = tracking();
      if (!started) throw new RepositoryError();
      try {
        const result = await getDb().execute(sql`UPDATE quotation_follow_ups SET
            state = 'sent', provider_message_id = ${provider}, sent_at = ${iso(now)}::timestamptz, closed_at = ${iso(now)}::timestamptz,
            lease_token = NULL, lease_until = NULL, updated_at = ${iso(now)}::timestamptz
          WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token} AND lease_until > ${iso(now)}::timestamptz
          RETURNING quotation_id`);
        const row = Array.from(result)[0] as Record<string, unknown> | undefined;
        return row ? loadRecord(getDb(), String(row.quotation_id), started, now) : null;
      } catch (error) {
        if (unique(error)) throw new ConflictError('Identificador da mensagem já utilizado.');
        throw new RepositoryError();
      }
    },
    async completeFailed(input) {
      const idValue = id(input.id, 'Follow-up');
      const token = id(input.leaseToken, 'Lease');
      if (!['provider_rejected', 'rate_limited'].includes(input.reason)) throw new InputError('Motivo inválido.');
      const now = new Date();
      const started = tracking();
      if (!started) throw new RepositoryError();
      try {
        const result = await getDb().execute(sql`UPDATE quotation_follow_ups SET
            state = 'failed', closed_reason = ${input.reason}, closed_at = ${iso(now)}::timestamptz,
            lease_token = NULL, lease_until = NULL, updated_at = ${iso(now)}::timestamptz
          WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token} AND lease_until > ${iso(now)}::timestamptz
          RETURNING quotation_id`);
        const row = Array.from(result)[0] as Record<string, unknown> | undefined;
        return row ? loadRecord(getDb(), String(row.quotation_id), started, now) : null;
      } catch {
        throw new RepositoryError();
      }
    },
    async completeNeedsReview(input) {
      const idValue = id(input.id, 'Follow-up');
      const token = id(input.leaseToken, 'Lease');
      const reason = input.reason || 'transport_ambiguous';
      if (!['transport_ambiguous', 'lease_expired_after_transport'].includes(reason)) {
        throw new InputError('Motivo inválido.');
      }
      const now = new Date();
      const started = tracking();
      if (!started) throw new RepositoryError();
      try {
        const result = await getDb().execute(sql`UPDATE quotation_follow_ups SET
            state = 'needs_review', closed_reason = ${reason}, closed_at = ${iso(now)}::timestamptz,
            lease_token = NULL, lease_until = NULL, updated_at = ${iso(now)}::timestamptz
          WHERE id = ${idValue} AND state = 'processing' AND lease_token = ${token} AND lease_until > ${iso(now)}::timestamptz
          RETURNING quotation_id`);
        const row = Array.from(result)[0] as Record<string, unknown> | undefined;
        return row ? loadRecord(getDb(), String(row.quotation_id), started, now) : null;
      } catch {
        throw new RepositoryError();
      }
    },
    async reapExpiredLeases(limit = 50) {
      if (!Number.isInteger(limit) || limit < 1) throw new InputError('Limite inválido.');
      try {
        const result = await getDb().execute(sql`WITH expired AS (
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
      } catch {
        throw new RepositoryError();
      }
    },
    async countApprovalsTodayUtc(now = new Date()) {
      try {
        const result = await getDb().execute(sql`SELECT count(*)::int count FROM quotation_follow_ups
          WHERE approved_at >= date_trunc('day', ${iso(now)}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
            AND approved_at < date_trunc('day', ${iso(now)}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 day'`);
        return Number((Array.from(result)[0] as { count?: unknown } | undefined)?.count || 0);
      } catch {
        throw new RepositoryError();
      }
    },
  };
}

export const createQuotationFollowUpRepository = createPostgresQuotationFollowUpRepository;
