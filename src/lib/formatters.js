/**
 * Formatters — portados do dashboard.html original.
 */

/** R$ 1.455,30 (pontos nos milhares, vírgula decimal) */
export function formatBRL(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 'R$ 0,00';
  const [int, dec] = Math.abs(num).toFixed(2).split('.');
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${num < 0 ? '-' : ''}R$ ${intFormatted},${dec}`;
}

export function normalizePhoneDigits(phone, maxDigits = 11) {
  return String(phone ?? '').replace(/\D/g, '').slice(0, maxDigits);
}

/** (99) 99999-9999 */
export function fmtPhone(phone) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function formatPhoneInput(phone) {
  return fmtPhone(normalizePhoneDigits(phone));
}

/** Nome Próprio → Cada Palavra Capitalizada */
export function capitalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** ISO date → DD/MM/YYYY */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('pt-BR');
}

/** Bom dia / Boa tarde / Boa noite */
export function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
