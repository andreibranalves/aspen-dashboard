import { createHash } from 'node:crypto';
import { assertExternalWritesAllowed } from '../../../_shared/external-writes.js';

export type MetaLeadEvent = {
  eventId: string;
  email?: string;
  phone?: string;
  eventSourceUrl?: string | null;
  quantity?: string | null;
};

export function hashForMeta(value: string) {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

export async function sendMetaLeadEvent(event: MetaLeadEvent) {
  const accessToken = String(process.env.META_CAPI_ACCESS_TOKEN || '').trim();
  if (!accessToken) return { sent: false, reason: 'missing_token' } as const;
  assertExternalWritesAllowed('meta-capi');

  const pixelId = String(process.env.META_PIXEL_ID || '565904716543317').trim();
  const userData: Record<string, string[]> = {};
  if (event.email) userData.em = [hashForMeta(event.email)];
  if (event.phone) userData.ph = [hashForMeta(event.phone.replace(/\D/g, ''))];

  const url = `https://graph.facebook.com/v25.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [
        {
          event_name: 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          event_id: event.eventId,
          action_source: 'website',
          event_source_url:
            event.eventSourceUrl || 'https://aspenestamparia.com/orcamento-corporativo',
          user_data: userData,
          custom_data: {
            content_name: 'qualified_typebot_lead',
            lead_type: 'corporate_quote',
            quantity: event.quantity || '',
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[meta-capi] failed', response.status, text);
    return { sent: false, reason: 'request_failed' } as const;
  }
  return { sent: true } as const;
}
