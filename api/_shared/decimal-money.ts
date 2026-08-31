/**
 * Canonicalizes a non-negative decimal using string operations only so JavaScript
 * floats never become the source of truth for money or percentages.
 */
export function canonicalizeNonNegativeDecimal(
  value: unknown,
  options: { maxIntegerDigits: number }
): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  // Accept the unambiguous Brazilian comma form. Persisted money stays
  // a dot-decimal string so PostgreSQL NUMERIC is never locale-dependent.
  const unambiguous = input.includes(',') && !input.includes('.') ? input.replace(',', '.') : input;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(unambiguous);
  if (!match) return null;
  const integerPart = match[1];
  const fractionalPart = match[2] || '';
  if (integerPart.length > options.maxIntegerDigits) return null;
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');
  return `${normalizedInteger}.${fractionalPart.padEnd(2, '0')}`;
}

function decimalToCents(value: string): bigint {
  const [integerPart, fractionPart = '00'] = value.split('.');
  return BigInt(integerPart) * 100n + BigInt(fractionPart.padEnd(2, '0').slice(0, 2));
}

export function decimalDoesNotExceed(value: string, maxInclusive: string): boolean {
  return decimalToCents(value) <= decimalToCents(maxInclusive);
}
