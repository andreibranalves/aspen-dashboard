import { createHash } from 'node:crypto';

export const KV_PREFIX = 'aspen:communication';
export const KV_KEY_FLOWS: string = `${KV_PREFIX}:flows`;
export const KV_KEY_FLOWS_SELECTED: string = `${KV_PREFIX}:flows:selected`;
export const KV_KEY_MEDIA_PREFIX: string = `${KV_PREFIX}:media-assets:`;
export const KV_KEY_SEND_EVENTS_PREFIX: string = `${KV_PREFIX}:send-events:`;

export const ALLOWED_MIME_TYPES: string[] = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];

export const MAX_SIZE_IMAGE = 5 * 1024 * 1024;
export const MAX_SIZE_VIDEO = 16 * 1024 * 1024;

export function mediaGroupPathSegment(value: string): string {
  return createHash('sha256')
    .update(value.trim().toLocaleLowerCase('pt-BR'))
    .digest('hex')
    .slice(0, 32);
}

export const FLOW_CONTEXTS: string[] = [
  'already_talking',
  'email_first_contact',
  'form_first_contact',
  'manual',
];

export const STEP_TYPES = {
  TEXT: 'text',
  DOCUMENT: 'document',
  PRODUCT_MEDIA: 'product_media',
} as const;

export function createId(prefix = 'media'): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  return `${prefix}_${ts}${rand}`;
}

// ponytail: `any` for the raw input object — this is a sanitizer boundary, unknown would just add casts
export function createMediaAsset(raw: Record<string, unknown>): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: raw.id || createId('media'),
    title: String(raw.title || '').trim(),
    description: String(raw.description || '').trim(),
    product_group: String(raw.product_group || '')
      .trim()
      .toLowerCase(),
    product_code: raw.product_code ? String(raw.product_code).trim().toUpperCase() : null,
    kind:
      raw.kind ||
      (String(raw.content_type || (raw as Record<string, string>).mimeType || '').startsWith(
        'video/'
      )
        ? 'video'
        : 'image'),
    blob_url: String(
      raw.blob_url || (raw as Record<string, string>).blobUrl || raw.url || ''
    ).trim(),
    pathname: String(raw.pathname || '').trim(),
    content_type: String(
      raw.content_type ||
        (raw as Record<string, string>).mimeType ||
        (raw as Record<string, string>).contentType ||
        ''
    ).trim(),
    size_bytes: Number.isFinite(
      raw.size_bytes || (raw as Record<string, number>).sizeBytes || raw.size
    )
      ? ((raw.size_bytes || (raw as Record<string, number>).sizeBytes || raw.size) as number)
      : 0,
    caption: String(raw.caption || '').trim(),
    active: raw.active !== false,
    sort_order: Number.isFinite(raw.sort_order || (raw as Record<string, number>).sortOrder)
      ? ((raw.sort_order || (raw as Record<string, number>).sortOrder) as number)
      : 0,
    created_at: raw.created_at || (raw as Record<string, string>).createdAt || now,
    updated_at: now,
    created_by: String(raw.created_by || (raw as Record<string, string>).createdBy || '').trim(),
  };
}

export function createStep(type = 'text'): Record<string, unknown> {
  const id = `step_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 4)}`;
  switch (type) {
    case STEP_TYPES.TEXT:
      return { id, type: 'text', template: '' };
    case STEP_TYPES.DOCUMENT:
      return { id, type: 'document', source: 'quotation_pdf', caption: '' };
    case STEP_TYPES.PRODUCT_MEDIA:
      return {
        id,
        type: 'product_media',
        selection: 'product_group',
        max_items: 1,
        caption_template: '',
      };
    default:
      return { id, type: 'text', template: '' };
  }
}

export function createFlow(raw: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: raw.id || `flow_${Date.now().toString(36)}`,
    name: raw.name || 'Novo Fluxo',
    description: raw.description || '',
    context: FLOW_CONTEXTS.includes(raw.context as string) ? raw.context : 'manual',
    channel: 'whatsapp',
    vendor_name: raw.vendor_name || 'Juliana',
    enabled: raw.enabled !== false,
    delay_min_seconds: Number.isFinite(raw.delay_min_seconds) ? raw.delay_min_seconds : 1,
    delay_max_seconds: Number.isFinite(raw.delay_max_seconds) ? raw.delay_max_seconds : 3,
    max_media_per_product_group: Number.isFinite(raw.max_media_per_product_group)
      ? raw.max_media_per_product_group
      : 1,
    steps: Array.isArray(raw.steps) ? raw.steps : [],
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
