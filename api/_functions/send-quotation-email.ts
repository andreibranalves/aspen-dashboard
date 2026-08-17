import { randomBytes } from 'node:crypto';

import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { isIssuedQuotationStatus } from '../_lib/quotation-status.js';
import {
  createPostgresQuotationEmailDeliveryRepository,
  QuotationEmailDeliveryConflictError,
  QuotationEmailDeliveryInputError,
  QuotationEmailDeliveryNotFoundError,
  type QuotationEmailDelivery,
  type QuotationEmailDeliveryRepository,
} from '../_db/quotation-email-delivery-repository.js';
import { createQuotationTemplateRepository } from '../_db/quotation-template-repository.js';
import { normalizeClientEmail } from './client-schema.js';
import { issuePublicQuotationToken } from './public-quotation.js';
import {
  ResendTransportError,
  sendQuotationEmailViaResend,
} from './lib/quotation-email.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AMBIGUOUS_ERROR = 'O resultado do envio não pôde ser confirmado. Tente novamente.';
const INTERNAL_ERROR = 'Erro interno. Tente novamente.';

type QuotationSnapshotRepository = ReturnType<typeof createQuotationTemplateRepository>;

type PublicQuotationToken = Awaited<ReturnType<typeof issuePublicQuotationToken>>;

export interface SendQuotationEmailDependencies {
  deliveries?: QuotationEmailDeliveryRepository;
  snapshots?: QuotationSnapshotRepository;
  issueToken?: typeof issuePublicQuotationToken;
  transport?: typeof sendQuotationEmailViaResend;
  token?: () => string;
  now?: () => Date;
  env?: typeof process.env;
}

function json(statusCode: number, body: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseBody(event: FunctionEvent): Record<string, unknown> {
  try {
    const value = JSON.parse(event.body || '');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new QuotationEmailDeliveryInputError('JSON inválido.');
  }
}

function uuid(value: unknown, message: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!UUID.test(result)) throw new QuotationEmailDeliveryInputError(message);
  return result;
}

function recipient(value: unknown): string {
  try {
    const normalized = normalizeClientEmail(value);
    if (!normalized) throw new Error();
    return normalized;
  } catch {
    throw new QuotationEmailDeliveryInputError('E-mail inválido.');
  }
}

function publicBaseUrl(event: FunctionEvent): string {
  const headers = event.headers || {};
  const forwardedProto = String(headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
    throw new Error('Origem da aplicação indisponível.');
  }
  return `${forwardedProto === 'http' ? 'http' : 'https'}://${host}`;
}

function acceptedResponse(delivery: QuotationEmailDelivery): FunctionResult {
  const acceptedAt = delivery.acceptedAt instanceof Date && !Number.isNaN(delivery.acceptedAt.getTime())
    ? delivery.acceptedAt.toISOString()
    : null;
  return json(200, {
    success: true,
    delivery: {
      state: 'accepted',
      recipient: delivery.recipient,
      accepted_at: acceptedAt,
    },
  });
}

function ambiguousResponse(): FunctionResult {
  return json(503, { error: AMBIGUOUS_ERROR, retry_same_attempt: true });
}

function internalErrorResponse(): FunctionResult {
  return json(500, { error: INTERNAL_ERROR });
}

function publicMessage(kind: ResendTransportError['kind']): string {
  if (kind === 'configuration') return 'Envio por e-mail não configurado.';
  if (kind === 'rejected') return 'A Resend não aceitou o e-mail.';
  return AMBIGUOUS_ERROR;
}

function logFailure(attemptId: string, revisionId: string, category: string): void {
  console.error(
    `[send-quotation-email] attemptId=${attemptId} revisionId=${revisionId} category=${category}`
  );
}

function repositoryErrorResponse(error: unknown): FunctionResult | null {
  if (error instanceof QuotationEmailDeliveryInputError) {
    return json(error.statusCode, { error: error.message });
  }
  if (error instanceof QuotationEmailDeliveryConflictError) {
    return json(error.statusCode, { error: error.message });
  }
  if (error instanceof QuotationEmailDeliveryNotFoundError) {
    return json(error.statusCode, { error: error.message });
  }
  return null;
}

async function markFailed(
  deliveries: QuotationEmailDeliveryRepository,
  attemptId: string,
  revisionId: string,
  publicError: string,
): Promise<boolean> {
  try {
    const failed = await deliveries.markFailed({ attemptId, publicError });
    if (failed?.state === 'failed') return true;
  } catch {
    // Keep the pending attempt retryable when failure persistence is unconfirmed.
  }
  logFailure(attemptId, revisionId, 'markFailed');
  return false;
}

async function transportFailure(
  error: unknown,
  deliveries: QuotationEmailDeliveryRepository,
  attemptId: string,
  revisionId: string,
): Promise<FunctionResult> {
  if (error instanceof ResendTransportError) {
    logFailure(attemptId, revisionId, error.kind);
    if (
      error.kind !== 'uncertain' &&
      !(await markFailed(deliveries, attemptId, revisionId, publicMessage(error.kind)))
    ) {
      return ambiguousResponse();
    }
    if (error.kind === 'rejected') {
      return json(502, {
        error: 'A Resend não aceitou o e-mail.',
        retry_same_attempt: false,
      });
    }
    if (error.kind === 'configuration') {
      return json(503, {
        error: 'Envio por e-mail não configurado.',
        retry_same_attempt: false,
      });
    }
    return ambiguousResponse();
  }
  logFailure(attemptId, revisionId, 'transport');
  return ambiguousResponse();
}

export async function handler(
  event: FunctionEvent,
  dependencies: SendQuotationEmailDependencies = {},
): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });

  let attemptId = '';
  let revisionId = '';
  try {
    const input = parseBody(event);
    attemptId = uuid(input.attempt_id, 'Identificador da tentativa inválido.');
    revisionId = uuid(input.revision_id, 'Identificador da revisão inválido.');
    const normalizedRecipient = recipient(input.recipient);
    const now = dependencies.now || (() => new Date());
    const deliveries = dependencies.deliveries || createPostgresQuotationEmailDeliveryRepository(undefined, { now });
    const snapshots = dependencies.snapshots || createQuotationTemplateRepository();
    const issueToken = dependencies.issueToken || issuePublicQuotationToken;
    const transport = dependencies.transport || sendQuotationEmailViaResend;

    const existing = await deliveries.get(attemptId);
    if (existing && (existing.revisionId !== revisionId || existing.recipient !== normalizedRecipient)) {
      return json(409, {
        error: 'O identificador pertence a outra tentativa.',
        retry_same_attempt: false,
      });
    }
    if (existing?.state === 'accepted') return acceptedResponse(existing);
    if (existing?.state === 'failed') {
      return json(409, {
        error: 'Crie uma nova tentativa para reenviar o e-mail.',
        retry_same_attempt: false,
      });
    }

    const snapshot = await snapshots.get(revisionId);
    if (!snapshot) return json(404, { error: 'Revisão do orçamento não encontrada.' });
    if (!isIssuedQuotationStatus(snapshot.revision.status)) {
      return json(409, { error: 'Emita o orçamento antes de enviar por e-mail.' });
    }

    const reservation = await deliveries.reserve({
      attemptId,
      revisionId,
      recipient: normalizedRecipient,
      publicToken: (dependencies.token || (() => randomBytes(32).toString('base64url')))(),
    });
    if (
      reservation.delivery.revisionId !== revisionId ||
      reservation.delivery.recipient !== normalizedRecipient
    ) {
      return json(409, {
        error: 'O identificador pertence a outra tentativa.',
        retry_same_attempt: false,
      });
    }
    if (reservation.delivery.state === 'accepted') return acceptedResponse(reservation.delivery);
    if (reservation.delivery.state === 'failed') {
      return json(409, {
        error: 'Crie uma nova tentativa para reenviar o e-mail.',
        retry_same_attempt: false,
      });
    }
    const publicToken = reservation.delivery.publicToken;
    if (!publicToken) {
      return json(409, {
        error: 'A tentativa não pode mais ser enviada.',
        retry_same_attempt: false,
      });
    }

    const tokenInput: Parameters<typeof issuePublicQuotationToken>[0] = {
      revisionId,
      repository: snapshots,
      token: () => publicToken,
      now: () => now().getTime(),
    };
    const token: PublicQuotationToken = await issueToken(tokenInput);
    const baseUrl = publicBaseUrl(event);
    const publicUrl = `${baseUrl}/api/public-quotation?token=${encodeURIComponent(token.token)}`;
    const attachmentUrl = `${publicUrl}&format=pdf`;

    let sent: { id: string };
    try {
      sent = await transport(
        {
          recipient: normalizedRecipient,
          customerName: snapshot.revision.clienteNome || 'Cliente',
          businessNumber: snapshot.quotation.businessNumber,
          publicUrl,
          attachmentUrl,
          attemptId,
        },
        { env: dependencies.env },
      );
    } catch (error) {
      return transportFailure(error, deliveries, attemptId, revisionId);
    }

    try {
      const accepted = await deliveries.markAccepted({ attemptId, providerEmailId: sent.id });
      return acceptedResponse(accepted);
    } catch {
      logFailure(attemptId, revisionId, 'markAccepted');
      return ambiguousResponse();
    }
  } catch (error) {
    const response = repositoryErrorResponse(error);
    if (response) return response;
    logFailure(attemptId, revisionId, 'persistence');
    return internalErrorResponse();
  }
}
