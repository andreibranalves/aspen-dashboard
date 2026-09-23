// Neutral WhatsApp transport phone normalization shared by delivery, identity
// and conversation modules. Holds no business rule and never touches storage.

const PHONE_JID_RE = /^\d+@(s\.whatsapp\.net|c\.us)$/i;

export function normalizeWhatsappPhone(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@') && !PHONE_JID_RE.test(raw)) return '';

  const beforeAt = raw.split('@')[0];
  let digits = beforeAt.replace(/\D/g, '');
  if (!digits || digits.length < 10 || digits.length > 15) return '';
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }
  return digits;
}

export function normalizeWhatsappPhoneFromRemoteJid(value: unknown): string {
  const raw = String(value || '').trim();
  return PHONE_JID_RE.test(raw) ? normalizeWhatsappPhone(raw) : '';
}
