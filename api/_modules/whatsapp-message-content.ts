// Reads the displayable content of one Evolution/Baileys message. Shared by the
// live webhook and the backfill so both produce identical records.
//
// The body is kept verbatim (line breaks and spacing included): only identifiers
// and names are whitespace-normalized elsewhere, never message text.

export type WhatsappMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'unsupported';

export interface WhatsappMessageContent {
  type: WhatsappMessageType;
  body: string | null;
}

export const MAX_WHATSAPP_MESSAGE_BODY_CHARS = 65_536;
const MAX_PREVIEW_CHARS = 280;

// Envelope keys that carry protocol metadata next to the real content.
const METADATA_KEYS = new Set(['messageContextInfo', 'senderKeyDistributionMessage']);

// Protocol-level events that are not conversation entries (edits, deletions,
// reactions, poll votes, pins). They never become a timeline bubble.
const NON_CONVERSATIONAL_KEYS = new Set([
  'protocolMessage',
  'reactionMessage',
  'encReactionMessage',
  'pollUpdateMessage',
  'keepInChatMessage',
  'pinInChatMessage',
]);

// Wrappers whose `.message` holds the real content.
const WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function verbatim(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // PostgreSQL text cannot hold NUL; nothing else is altered.
  const cleaned = value.replaceAll(String.fromCharCode(0), '');
  if (!cleaned.trim()) return null;
  return cleaned.length > MAX_WHATSAPP_MESSAGE_BODY_CHARS
    ? cleaned.slice(0, MAX_WHATSAPP_MESSAGE_BODY_CHARS)
    : cleaned;
}

function unwrap(message: Record<string, unknown>): Record<string, unknown> {
  let current = message;
  for (let depth = 0; depth < 4; depth += 1) {
    const wrapperKey = WRAPPER_KEYS.find((key) => record(current[key]));
    if (!wrapperKey) return current;
    const inner = record(record(current[wrapperKey])?.message);
    if (!inner) return current;
    current = inner;
  }
  return current;
}

/**
 * Returns the content of a provider message, or `null` when the item is a
 * protocol event (reaction, edit, deletion…) that must not appear as a bubble.
 * Unknown content types stay visible as `unsupported`.
 */
export function readWhatsappMessageContent(item: Record<string, unknown>): WhatsappMessageContent | null {
  const envelope = record(item.message);
  if (!envelope) return { type: 'unsupported', body: null };
  const message = unwrap(envelope);
  const keys = Object.keys(message).filter((key) => !METADATA_KEYS.has(key));
  if (keys.length === 0) return { type: 'unsupported', body: null };
  if (keys.some((key) => NON_CONVERSATIONAL_KEYS.has(key))) return null;

  if (typeof message.conversation === 'string') {
    return { type: 'text', body: verbatim(message.conversation) };
  }
  const extended = record(message.extendedTextMessage);
  if (extended) return { type: 'text', body: verbatim(extended.text) };

  const image = record(message.imageMessage);
  if (image) return { type: 'image', body: verbatim(image.caption) };
  const video = record(message.videoMessage) || record(message.ptvMessage);
  if (video) return { type: 'video', body: verbatim(video.caption) };
  if (record(message.audioMessage) || record(message.pttMessage)) return { type: 'audio', body: null };
  const document = record(message.documentMessage);
  if (document) return { type: 'document', body: verbatim(document.caption) };
  if (record(message.stickerMessage)) return { type: 'sticker', body: null };
  if (record(message.locationMessage) || record(message.liveLocationMessage)) {
    return { type: 'location', body: null };
  }
  if (record(message.contactMessage) || record(message.contactsArrayMessage)) {
    return { type: 'contact', body: null };
  }
  return { type: 'unsupported', body: null };
}

const TYPE_PREVIEW: Record<WhatsappMessageType, string> = {
  text: '',
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
  sticker: 'Figurinha',
  location: 'Localização',
  contact: 'Contato',
  unsupported: 'Tipo de mensagem não suportado',
};

/** One-line list preview; the stored body itself is never altered. */
export function whatsappMessagePreview(content: WhatsappMessageContent): string {
  const text = content.body ? content.body.replace(/\s+/g, ' ').trim() : '';
  const preview = text || TYPE_PREVIEW[content.type];
  return preview.length > MAX_PREVIEW_CHARS ? `${preview.slice(0, MAX_PREVIEW_CHARS - 1)}…` : preview;
}
