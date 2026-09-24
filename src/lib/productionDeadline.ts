// Espelho de api/_modules/production-deadline.ts; o servidor gera o texto salvo.
export const DEFAULT_PRODUCTION_DAYS = 20;
export const MAX_PRODUCTION_DAYS = 365;
export const MAX_SURCHARGE_PERCENT = 200;

export function productionDeadlineText(days: number, complement: string): string {
  const range = days >= 10 ? `${days - 5} a ${days} dias úteis` : `até ${days} dias úteis`;
  const suffix = complement.trim();
  return suffix ? `${range} ${suffix}` : range;
}

export function isProductionDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_PRODUCTION_DAYS;
}

export function isSurchargePercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_SURCHARGE_PERCENT;
}
