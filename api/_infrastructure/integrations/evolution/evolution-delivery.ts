export type EvolutionDeliveryResult = {
  accepted: true;
  providerMessageId: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A 200 response can still carry an explicit dispatch failure. Status must be
 * checked before any id-based acceptance, otherwise an ERROR payload with a
 * message key would be persisted as a confirmed provider acceptance.
 */
const PROVIDER_FAILURE_STATUSES: readonly string[] = ['ERROR', 'FAILED', 'FAILURE'];

/** Evolution success responses must carry an explicit acceptance signal or message key. */
export function normalizeEvolutionDelivery(body: unknown): EvolutionDeliveryResult | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (PROVIDER_FAILURE_STATUSES.includes(text(record.status).toUpperCase())) return null;
  const key = record.key && typeof record.key === 'object'
    ? record.key as Record<string, unknown>
    : {};
  const providerMessageId = text(
    record.provider_message_id ||
      record.providerMessageId ||
      record.message_id ||
      record.messageId ||
      key.id,
  );
  if (record.accepted === false) return null;
  if (record.accepted === true) {
    return { accepted: true, providerMessageId: providerMessageId || 'accepted' };
  }
  if (providerMessageId && (record.key || record.status || record.message)) {
    return { accepted: true, providerMessageId };
  }
  return null;
}
