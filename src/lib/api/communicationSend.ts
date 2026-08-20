export interface SendContext {
  quotationId: string;
  revisionId: string;
  flowId: string;
}

export interface DeliveryOutcome {
  deliveryAccepted?: boolean;
}

export type SendAttemptResult<T> =
  | { kind: 'completed'; response: T }
  | { kind: 'accepted' };

const SEND_LOCK_KEY_PREFIX = 'aspen:whatsapp-send:';

function recordKey(context: SendContext): string {
  return [context.quotationId, context.revisionId, context.flowId]
    .map((value) => encodeURIComponent(value))
    .join('|');
}

export function sendContextKey(context: SendContext): string {
  return `v2|${recordKey(context)}`;
}

export function isSendableQuotationStatus(status: unknown): boolean {
  return status === 'emitido' || status === 'enviado' || status === 'aprovado';
}

export function sendIdempotencyKey(context: SendContext): string {
  return `${SEND_LOCK_KEY_PREFIX}${sendContextKey(context)}`;
}

type WebLock = { name?: string };
type WebLockManagerLike = {
  request(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: WebLock | null) => Promise<void>,
  ): Promise<void>;
};

function webLocks(): WebLockManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  const candidate = (navigator as Navigator & { locks?: unknown }).locks;
  if (!candidate || typeof candidate !== 'object') return null;
  const request = (candidate as { request?: unknown }).request;
  return typeof request === 'function' ? candidate as WebLockManagerLike : null;
}

function acceptedError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { deliveryAccepted?: unknown }).deliveryAccepted === true);
}

async function attempt<T>(
  context: SendContext,
  send: (idempotencyKey: string) => Promise<T>,
): Promise<SendAttemptResult<T>> {
  try {
    const response = await send(sendIdempotencyKey(context));
    const accepted = Boolean(
      response
      && typeof response === 'object'
      && (response as DeliveryOutcome).deliveryAccepted === true,
    );
    return accepted ? { kind: 'accepted' } : { kind: 'completed', response };
  } catch (error) {
    if (acceptedError(error)) return { kind: 'accepted' };
    throw error;
  }
}

/** Web Locks are only an optimization; backend reservation owns correctness. */
export async function executeWithSendLock<T>(
  context: SendContext,
  send: (idempotencyKey: string) => Promise<T>,
): Promise<SendAttemptResult<T>> {
  if (!context.quotationId || !context.revisionId || !context.flowId) {
    throw new Error('Identidade local do orçamento, revisão e fluxo são obrigatórias.');
  }
  const locks = webLocks();
  if (!locks) return attempt(context, send);

  let result: SendAttemptResult<T> | undefined;
  let callbackStarted = false;
  try {
    await locks.request(
      `${SEND_LOCK_KEY_PREFIX}${sendContextKey(context)}`,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (lock) {
          callbackStarted = true;
          result = await attempt(context, send);
        }
      },
    );
  } catch (error) {
    // If the callback ran, propagate its backend result/error instead of duplicating it.
    if (callbackStarted) throw error;
    // Web Locks rejection before callback is only an optimization failure.
    return attempt(context, send);
  }
  return result || attempt(context, send);
}
