import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/** Parsing preserves the supplied number; renumbering is only a match suggestion. */
export function parseContactPhone(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || !/^[+\d\s().-]+$/.test(raw)) return '';
  const digits = raw.replace(/\D/g, '');
  const international = raw.startsWith('+') || digits.length > 11;
  const parsed = parsePhoneNumberFromString(international ? `+${digits}` : raw, { defaultCountry: 'BR', extract: false });
  return parsed?.isPossible() ? parsed.number.slice(1) : '';
}

/** Never use these candidates to rewrite a delivery address or merge clients. */
export function brazilMobileAlternative(phone: string): string | null {
  if (!/^55[1-9]\d(?:[6-9]\d{7}|9[6-9]\d{7})$/.test(phone)) return null;
  const alternative = phone.length === 12 ? `${phone.slice(0, 4)}9${phone.slice(4)}` : `${phone.slice(0, 4)}${phone.slice(5)}`;
  const modern = phone.length === 13 ? phone : alternative;
  const parsed = parsePhoneNumberFromString(`+${modern}`);
  return parsed?.country === 'BR' && parsed.isValid() && parsed.getType() === 'MOBILE' ? alternative : null;
}

export function conversationId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim().toLowerCase();
  return /^\d{5,20}@(lid|s\.whatsapp\.net|c\.us)$/.test(raw) ? raw.replace(/@c\.us$/, '@s.whatsapp.net') : '';
}
