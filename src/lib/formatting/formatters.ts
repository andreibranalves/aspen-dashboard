/**
 * Formatters — portados do dashboard.html original.
 */

/** R$\u00a01.455,30 (nbsp após o símbolo evita quebra de linha; pontos nos milhares, vírgula decimal) */
export function formatBRL(value: string | number | null | undefined): string {
  const num = Number(value);
  if (Number.isNaN(num)) return 'R$\u00a00,00';
  return `${num < 0 ? '-' : ''}R$\u00a0${formatDecimalBR(Math.abs(num))}`;
}

/** 1.234,56 \u2014 n\u00famero pt-BR sem s\u00edmbolo, para campos e tabelas. */
export function formatDecimalBR(value: number, fractionDigits = 2): string {
  const [int, dec] = Math.abs(value).toFixed(fractionDigits).split('.');
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${value < 0 ? '-' : ''}${intFormatted}${dec ? `,${dec}` : ''}`;
}

/**
 * L\u00ea um n\u00famero digitado em pt-BR ("1.234,56", "1234,5") e aceita o ponto
 * decimal quando n\u00e3o h\u00e1 v\u00edrgula e ele n\u00e3o separa milhares ("0.5", "12.90").
 */
export function parseDecimalBR(text: string): number | null {
  const raw = text.replace(/[R$\s\u00a0]/g, '');
  if (!raw) return null;
  const thousandsOnly = !raw.includes(',') && /^-?\d{1,3}(\.\d{3})+$/.test(raw);
  const normalized = raw.includes(',') || thousandsOnly ? raw.replace(/\./g, '').replace(',', '.') : raw;
  if (!/^-?\d*\.?\d*$/.test(normalized) || !/\d/.test(normalized)) return null;
  return Number(normalized);
}

/** 12,5% \u2014 com `signed`, +12,5% para varia\u00e7\u00f5es. */
export function formatPercent(value: number, { digits = 1, signed = false } = {}): string {
  return `${signed && value > 0 ? '+' : ''}${formatDecimalBR(value, digits)}%`;
}

export function normalizePhoneDigits(phone: unknown, maxDigits = 15): string {
  return String(phone ?? '')
    .replace(/\D/g, '')
    .slice(0, maxDigits);
}

/** Customer numbers without a country code use Brazil. Preserve explicit
 * international prefixes and the supplied subscriber digits. */
export function whatsappContactUrl(phone: unknown): string {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const national = !raw.startsWith('+') && (digits.length === 10 || digits.length === 11);
  return `https://wa.me/${national ? `55${digits}` : digits}`;
}

/** Formats Brazilian phone in local style: (XX) XXXXX-XXXX or (XX) XXXX-XXXX. */
export function fmtPhone(phone: unknown): string {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return '';

  // Guard: 14+ digits without 55 prefix is not a Brazilian phone (likely a LID)
  if (digits.length >= 14 && !digits.startsWith('55')) return '';

  // Canonical Brazilian numbers may arrive with country code 55. Drop it for local display.
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return fmtPhone(digits.slice(2));
  }

  // International with 55 prefix but unexpected length — preserve explicit prefix.
  if (digits.startsWith('55') && digits.length >= 14) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    return `(55) ${ddd} ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  }

  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function formatPhoneInput(phone: unknown): string {
  return fmtPhone(normalizePhoneDigits(phone));
}

/** ISO timestamp → data e hora brasileiras, no fuso operacional. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

/** Nome Próprio → Cada Palavra Capitalizada */
export function capitalize(str: unknown): string {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** ISO date → DD/MM/YYYY, sem deslocar datas civis por timezone. */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (calendarDate) {
    const [, year, month, day] = calendarDate;
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateStr
      ? `${day}/${month}/${year}`
      : dateStr;
  }
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return String(dateStr);
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Bom dia / Boa tarde / Boa noite */
export function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
