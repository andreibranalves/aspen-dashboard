/**
 * Formatters — portados do dashboard.html original.
 */

/** R$\u00a01.455,30 (nbsp após o símbolo evita quebra de linha; pontos nos milhares, vírgula decimal) */
export function formatBRL(value: string | number | null | undefined): string {
  const num = Number(value);
  if (Number.isNaN(num)) return 'R$\u00a00,00';
  const [int, dec] = Math.abs(num).toFixed(2).split('.');
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${num < 0 ? '-' : ''}R$\u00a0${intFormatted},${dec}`;
}

export function normalizePhoneDigits(phone: unknown, maxDigits = 15): string {
  return String(phone ?? '')
    .replace(/\D/g, '')
    .slice(0, maxDigits);
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

/** Nome Próprio → Cada Palavra Capitalizada */
export function capitalize(str: unknown): string {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** ISO date → DD/MM/YYYY */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('pt-BR');
}

/** Bom dia / Boa tarde / Boa noite */
export function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
