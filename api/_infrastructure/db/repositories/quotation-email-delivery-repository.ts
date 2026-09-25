import { and, eq } from 'drizzle-orm';

import {
  isRenderedQuotationEmail,
  type RenderedQuotationEmail,
} from '../../../_modules/quotation-email-renderer.js';
import { getDatabase, type AppDatabase } from '../client.js';
import { promoteDealOnProviderAcceptance } from './crm-deals-repository.js';
import { quotationEmailDeliveries } from '../schema.js';
import { safeErrorSummary } from '../../../_shared/safe-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DatabaseProvider = () => AppDatabase;
type QuotationEmailTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type QuotationEmailDatabase = AppDatabase | QuotationEmailTransaction;
type QuotationEmailDeliveryRow = typeof quotationEmailDeliveries.$inferSelect;
type ReserveInput = {
  attemptId: string;
  revisionId: string;
  recipient: string;
  publicToken: string;
  templateSnapshot: RenderedQuotationEmail;
};
type AcceptedInput = { attemptId: string; providerEmailId: string };
type FailedInput = { attemptId: string; publicError: string };

export type QuotationEmailDeliveryState = 'pending' | 'accepted' | 'failed';

export interface QuotationEmailDelivery {
  id: string;
  revisionId: string;
  recipient: string;
  publicToken: string | null;
  state: QuotationEmailDeliveryState;
  providerEmailId: string | null;
  publicError: string | null;
  templateSnapshot: RenderedQuotationEmail | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotationEmailDeliveryRepository {
  get(attemptId: string): Promise<QuotationEmailDelivery | null>;
  reserve(
    input: ReserveInput
  ): Promise<{ kind: 'reserved' | 'existing'; delivery: QuotationEmailDelivery }>;
  markAccepted(input: AcceptedInput): Promise<QuotationEmailDelivery>;
  markFailed(input: FailedInput): Promise<QuotationEmailDelivery>;
}

export class QuotationEmailDeliveryInputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'QuotationEmailDeliveryInputError';
  }
}

export class QuotationEmailDeliveryConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'QuotationEmailDeliveryConflictError';
  }
}

export class QuotationEmailDeliveryNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = 'Tentativa de envio não encontrada.') {
    super(message);
    this.name = 'QuotationEmailDeliveryNotFoundError';
  }
}

export class QuotationEmailDeliveryRepositoryError extends Error {
  readonly statusCode = 503;
  readonly expose = false;
  constructor(message = 'Não foi possível registrar o envio. Tente novamente.') {
    super(message);
    this.name = 'QuotationEmailDeliveryRepositoryError';
  }
}

function stripControlCharacters(value: string, replacement = ''): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? replacement : character;
    })
    .join('');
}

function uuid(value: unknown, message: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!UUID.test(result)) throw new QuotationEmailDeliveryInputError(message);
  return result;
}

function validateReserveInput(input: ReserveInput): ReserveInput {
  const candidate = input as Partial<ReserveInput> | null | undefined;
  const attemptId = uuid(candidate?.attemptId, 'Identificador da tentativa inválido.');
  const revisionId = uuid(candidate?.revisionId, 'Identificador da revisão inválido.');
  if (typeof candidate?.recipient !== 'string') {
    throw new QuotationEmailDeliveryInputError('Destinatário inválido.');
  }
  const recipient = candidate.recipient.trim();
  if (!recipient || recipient.length > 254 || stripControlCharacters(recipient) !== recipient) {
    throw new QuotationEmailDeliveryInputError('Destinatário inválido.');
  }
  if (typeof candidate.publicToken !== 'string') {
    throw new QuotationEmailDeliveryInputError('Token público inválido.');
  }
  const publicToken = candidate.publicToken.trim();
  if (!publicToken || stripControlCharacters(publicToken) !== publicToken) {
    throw new QuotationEmailDeliveryInputError('Token público inválido.');
  }
  if (!isRenderedQuotationEmail(candidate?.templateSnapshot)) {
    throw new QuotationEmailDeliveryInputError('Conteúdo de e-mail inválido.');
  }
  return {
    attemptId,
    revisionId,
    recipient,
    publicToken,
    templateSnapshot: {
      subject: candidate.templateSnapshot.subject,
      html: candidate.templateSnapshot.html,
      text: candidate.templateSnapshot.text,
    },
  };
}

function validateAcceptedInput(input: AcceptedInput): AcceptedInput {
  const candidate = input as Partial<AcceptedInput> | null | undefined;
  const attemptId = uuid(candidate?.attemptId, 'Identificador da tentativa inválido.');
  if (typeof candidate?.providerEmailId !== 'string') {
    throw new QuotationEmailDeliveryInputError('Identificador do provedor inválido.');
  }
  const providerEmailId = candidate.providerEmailId.trim();
  if (
    !providerEmailId ||
    providerEmailId.length > 255 ||
    stripControlCharacters(providerEmailId) !== providerEmailId
  ) {
    throw new QuotationEmailDeliveryInputError('Identificador do provedor inválido.');
  }
  return { attemptId, providerEmailId };
}

function validateFailedInput(input: FailedInput): FailedInput {
  const candidate = input as Partial<FailedInput> | null | undefined;
  const attemptId = uuid(candidate?.attemptId, 'Identificador da tentativa inválido.');
  if (typeof candidate?.publicError !== 'string') {
    throw new QuotationEmailDeliveryInputError('Erro público inválido.');
  }
  const publicError = stripControlCharacters(candidate.publicError, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!publicError || publicError.length > 500) {
    throw new QuotationEmailDeliveryInputError('Erro público inválido.');
  }
  return { attemptId, publicError };
}

function toDelivery(row: QuotationEmailDeliveryRow): QuotationEmailDelivery {
  return {
    id: row.id,
    revisionId: row.revisionId,
    recipient: row.recipient,
    publicToken: row.publicToken ?? null,
    state: row.state as QuotationEmailDeliveryState,
    providerEmailId: row.providerEmailId ?? null,
    publicError: row.publicError ?? null,
    templateSnapshot: row.templateSnapshot && isRenderedQuotationEmail(row.templateSnapshot)
      ? row.templateSnapshot
      : null,
    acceptedAt: row.acceptedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function readDelivery(
  db: QuotationEmailDatabase,
  attemptId: string
): Promise<QuotationEmailDeliveryRow | null> {
  const [row] = await db
    .select()
    .from(quotationEmailDeliveries)
    .where(eq(quotationEmailDeliveries.id, attemptId))
    .limit(1);
  return row || null;
}

function isKnownError(error: unknown): boolean {
  return (
    error instanceof QuotationEmailDeliveryInputError ||
    error instanceof QuotationEmailDeliveryConflictError ||
    error instanceof QuotationEmailDeliveryNotFoundError ||
    error instanceof QuotationEmailDeliveryRepositoryError
  );
}

function rethrowRepositoryError(error: unknown, operation: string): never {
  if (isKnownError(error)) throw error;
  console.error(
    `[quotation-email-delivery] ${operation} failed (${safeErrorSummary(error)})`
  );
  throw new QuotationEmailDeliveryRepositoryError();
}

function resolveAccepted(
  row: QuotationEmailDeliveryRow,
  providerEmailId: string
): QuotationEmailDelivery {
  if (
    row.state === 'accepted' &&
    row.providerEmailId === providerEmailId &&
    row.publicToken == null &&
    row.publicError == null &&
    row.acceptedAt != null
  ) {
    return toDelivery(row);
  }
  if (row.state === 'accepted') {
    throw new QuotationEmailDeliveryConflictError(
      'A tentativa já foi aceita com outro identificador.'
    );
  }
  if (row.state === 'failed') {
    throw new QuotationEmailDeliveryConflictError('A tentativa já falhou.');
  }
  throw new QuotationEmailDeliveryConflictError(
    'A tentativa foi alterada por outra tentativa. Consulte o estado atual.'
  );
}

function resolveFailed(
  row: QuotationEmailDeliveryRow,
  publicError: string
): QuotationEmailDelivery {
  if (
    row.state === 'failed' &&
    row.publicError === publicError &&
    row.publicToken == null &&
    row.providerEmailId == null &&
    row.acceptedAt == null
  ) {
    return toDelivery(row);
  }
  if (row.state === 'accepted') {
    throw new QuotationEmailDeliveryConflictError('A tentativa já foi aceita.');
  }
  if (row.state === 'failed') {
    throw new QuotationEmailDeliveryConflictError('A tentativa já falhou com outro erro.');
  }
  throw new QuotationEmailDeliveryConflictError(
    'A tentativa foi alterada por outra tentativa. Consulte o estado atual.'
  );
}

async function transitionAccepted(
  db: QuotationEmailDatabase,
  input: AcceptedInput,
  current: Date
): Promise<QuotationEmailDelivery> {
  const normalized = validateAcceptedInput(input);
  const updated = await db
    .update(quotationEmailDeliveries)
    .set({
      state: 'accepted',
      providerEmailId: normalized.providerEmailId,
      publicError: null,
      publicToken: null,
      templateSnapshot: null,
      acceptedAt: current,
      updatedAt: current,
    })
    .where(
      and(
        eq(quotationEmailDeliveries.id, normalized.attemptId),
        eq(quotationEmailDeliveries.state, 'pending')
      )
    )
    .returning({ id: quotationEmailDeliveries.id });
  const row = await readDelivery(db, normalized.attemptId);
  if (!row) {
    if (updated.length === 0) throw new QuotationEmailDeliveryNotFoundError();
    throw new QuotationEmailDeliveryRepositoryError();
  }
  if (row.state === 'accepted') {
    // An accepted e-mail is the same authorization as an accepted WhatsApp
    // dispatch, and it runs in the same transaction that made the acceptance
    // durable: a crash cannot leave the acceptance without the promotion, and a
    // replay of an accepted attempt repairs a promotion that never committed.
    await promoteDealOnProviderAcceptance(db, { revisionId: row.revisionId }, { now: current });
  }
  return updated.length === 1 ? toDelivery(row) : resolveAccepted(row, normalized.providerEmailId);
}

async function transitionFailed(
  db: AppDatabase,
  input: FailedInput,
  current: Date
): Promise<QuotationEmailDelivery> {
  const normalized = validateFailedInput(input);
  const updated = await db
    .update(quotationEmailDeliveries)
    .set({
      state: 'failed',
      providerEmailId: null,
      publicError: normalized.publicError,
      publicToken: null,
      templateSnapshot: null,
      acceptedAt: null,
      updatedAt: current,
    })
    .where(
      and(
        eq(quotationEmailDeliveries.id, normalized.attemptId),
        eq(quotationEmailDeliveries.state, 'pending')
      )
    )
    .returning({ id: quotationEmailDeliveries.id });
  const row = await readDelivery(db, normalized.attemptId);
  if (!row) {
    if (updated.length === 0) throw new QuotationEmailDeliveryNotFoundError();
    throw new QuotationEmailDeliveryRepositoryError();
  }
  return updated.length === 1 ? toDelivery(row) : resolveFailed(row, normalized.publicError);
}

export function createPostgresQuotationEmailDeliveryRepository(
  getDb: DatabaseProvider = getDatabase,
  options: { now?: () => Date } = {}
): QuotationEmailDeliveryRepository {
  const now = options.now || (() => new Date());

  return {
    async get(attemptId) {
      const normalizedAttemptId = uuid(attemptId, 'Tentativa inválida.');
      try {
        const row = await readDelivery(getDb(), normalizedAttemptId);
        return row ? toDelivery(row) : null;
      } catch (error) {
        rethrowRepositoryError(error, 'get');
      }
    },

    async reserve(input) {
      const normalized = validateReserveInput(input);
      try {
        const db = getDb();
        const current = now();
        const [inserted] = await db
          .insert(quotationEmailDeliveries)
          .values({
            id: normalized.attemptId,
            revisionId: normalized.revisionId,
            recipient: normalized.recipient,
            publicToken: normalized.publicToken,
            state: 'pending',
            providerEmailId: null,
            publicError: null,
            templateSnapshot: normalized.templateSnapshot,
            acceptedAt: null,
            createdAt: current,
            updatedAt: current,
          })
          .onConflictDoNothing()
          .returning();
        const row = inserted || (await readDelivery(db, normalized.attemptId));
        if (!row)
          throw new QuotationEmailDeliveryRepositoryError('Não foi possível registrar o envio.');
        const delivery = toDelivery(row);
        if (
          delivery.revisionId !== normalized.revisionId ||
          delivery.recipient !== normalized.recipient
        ) {
          throw new QuotationEmailDeliveryConflictError(
            'O identificador pertence a outra tentativa.'
          );
        }
        return { kind: inserted ? 'reserved' : 'existing', delivery };
      } catch (error) {
        rethrowRepositoryError(error, 'reserve');
      }
    },

    async markAccepted(input) {
      const normalized = validateAcceptedInput(input);
      try {
        const db = getDb();
        return await db.transaction((tx) => transitionAccepted(tx, normalized, now()));
      } catch (error) {
        rethrowRepositoryError(error, 'markAccepted');
      }
    },

    async markFailed(input) {
      const normalized = validateFailedInput(input);
      try {
        return await transitionFailed(getDb(), normalized, now());
      } catch (error) {
        rethrowRepositoryError(error, 'markFailed');
      }
    },
  };
}
