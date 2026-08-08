export type EvolutionDeliveryResult = {
  accepted: true;
  providerMessageId: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Evolution success responses must carry an explicit acceptance signal or message key. */
export function normalizeEvolutionDelivery(body: unknown): EvolutionDeliveryResult | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
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
  if (record.accepted === true) {
    return { accepted: true, providerMessageId: providerMessageId || 'accepted' };
  }
  if (providerMessageId && (record.key || record.status || record.message)) {
    return { accepted: true, providerMessageId };
  }
  return null;
}
