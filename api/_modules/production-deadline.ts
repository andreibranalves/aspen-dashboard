/**
 * Prazo comunicado: sempre derivado do Prazo de produção numérico. A cópia do
 * frontend fica em src/lib/productionDeadline.ts e precisa gerar o mesmo texto.
 */
export const DEFAULT_PRODUCTION_DAYS = 20;
export const MIN_PRODUCTION_DAYS = 1;
export const MAX_PRODUCTION_DAYS = 365;
export const DEFAULT_PRODUCTION_DEADLINE_COMPLEMENT =
  'após confirmação do pagamento e aprovação da arte.';
export const MAX_PRODUCTION_DEADLINE_COMPLEMENT_LENGTH = 300;

export class ProductionDeadlineValidationError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message = `Informe um prazo de produção entre ${MIN_PRODUCTION_DAYS} e ${MAX_PRODUCTION_DAYS} dias úteis.`) {
    super(message);
    this.name = 'ProductionDeadlineValidationError';
  }
}

export function isProductionDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_PRODUCTION_DAYS &&
    value <= MAX_PRODUCTION_DAYS
  );
}

/** Ausente usa o padrão informado; presente e inválido é erro. */
export function parseProductionDays(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!isProductionDays(parsed)) throw new ProductionDeadlineValidationError();
  return parsed;
}

export function productionDeadlineText(days: number, complement: string): string {
  const range = days >= 10 ? `${days - 5} a ${days} dias úteis` : `até ${days} dias úteis`;
  const suffix = complement.trim();
  return suffix ? `${range} ${suffix}` : range;
}
