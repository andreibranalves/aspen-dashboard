import { and, desc, eq, inArray } from 'drizzle-orm';

import { getDatabase } from '../_db/client.js';
import { quotationOutboxEvents } from '../_db/schema.js';
import { isProductionEnvironment } from '../_lib/auth.js';
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';

function json(statusCode: number, body: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

const EXTERNAL_PROVIDER_ENV_VARS = [
  'OUTBOX_N8N_URL',
  'N8N_OUTBOX_WEBHOOK_URL',
  'OUTBOX_EVOLUTION_URL',
  'OUTBOX_CRM_URL',
] as const;

function enabled(): boolean {
  const productionDeployment = process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV === 'production'
    : isProductionEnvironment(process.env);
  return (
    !productionDeployment &&
    process.env.STAGING_E2E === '1' &&
    process.env.STAGING_EXTERNAL_PROVIDERS_DISABLED === '1' &&
    process.env.STAGING_EGRESS_BLOCKED === '1' &&
    EXTERNAL_PROVIDER_ENV_VARS.every((name) => !String(process.env[name] || '').trim())
  );
}

function header(event: FunctionEvent, name: string): string {
  const headers = event.headers || {};
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return typeof value === 'string' ? value.trim() : '';
}

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (!enabled()) return json(404, { error: 'Endpoint não encontrado.' });
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'DELETE') {
    return json(405, { error: 'Método não permitido.' });
  }

  const expectedAccount = String(process.env.STAGING_E2E_USERNAME || '').trim();
  if (!expectedAccount || header(event, 'x-e2e-username') !== expectedAccount) {
    return json(403, { error: 'Identidade de teste não autorizada.' });
  }

  const quotationId = String(event.queryStringParameters?.quotation_id || '').trim();
  if (!quotationId || quotationId.length > 255) {
    return json(400, { error: 'Identificador do orçamento obrigatório.' });
  }

  try {
    const database = getDatabase();
    if (event.httpMethod === 'DELETE') {
      await database
        .delete(quotationOutboxEvents)
        .where(
          and(
            eq(quotationOutboxEvents.aggregateId, quotationId),
            inArray(quotationOutboxEvents.status, ['pending', 'retry']),
          ),
        );
      return { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };
    }

    const rows = await database
      .select({
        eventType: quotationOutboxEvents.eventType,
        provider: quotationOutboxEvents.provider,
        aggregateId: quotationOutboxEvents.aggregateId,
        payloadReference: quotationOutboxEvents.payloadReference,
        idempotencyKey: quotationOutboxEvents.idempotencyKey,
        status: quotationOutboxEvents.status,
        attempts: quotationOutboxEvents.attempts,
        nextAttemptAt: quotationOutboxEvents.nextAttemptAt,
        createdAt: quotationOutboxEvents.createdAt,
      })
      .from(quotationOutboxEvents)
      .where(eq(quotationOutboxEvents.aggregateId, quotationId))
      .orderBy(desc(quotationOutboxEvents.createdAt))
      .limit(100);

    return json(200, {
      identity_attested: true,
      providers_disabled: true,
      events: rows.map((row) => ({
        event_type: row.eventType,
        provider: row.provider,
        quotation_id: row.aggregateId,
        revision_id: row.payloadReference.revisionId,
        business_number: row.payloadReference.businessNumber,
        idempotency_key: row.idempotencyKey,
        status: row.status,
        attempts: row.attempts,
        next_attempt_at: row.nextAttemptAt,
        created_at: row.createdAt,
      })),
    });
  } catch (error) {
    console.error(`[quotation-outbox-inspect] failed (${error instanceof Error ? error.name : typeof error})`);
    return json(503, { error: 'Não foi possível consultar o outbox de staging.' });
  }
}
