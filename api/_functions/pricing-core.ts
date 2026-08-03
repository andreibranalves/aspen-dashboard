/**
 * Exact pricing primitives shared by the PostgreSQL pricing handlers.
 *
 * PostgreSQL keeps money as NUMERIC(14,2) and quantities as NUMERIC(14,3).
 * These helpers deliberately parse decimal text into BigInt scaled integers;
 * a JavaScript number is accepted at the HTTP boundary for compatibility, but
 * is never used as the source of truth for comparisons or calculations.
 */

export const MONEY_SCALE = 2;
export const QUANTITY_SCALE = 3;
export const URGENT_NUMERATOR = 130n;
export const URGENT_DENOMINATOR = 100n;

export class PricingValidationError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'PricingValidationError';
  }
}

export class PricingUnavailableError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message = 'Preço não disponível para este produto.') {
    super(message);
    this.name = 'PricingUnavailableError';
  }
}

export interface PricingTierInput {
  minimum_quantity?: string | number | null;
  minimumQuantity?: string | number | null;
  quantidade_minima?: string | number | null;
  minimo?: string | number | null;
  faixa?: string | number | null;
  qty?: string | number | null;
  unit_price?: string | number | null;
  unitPrice?: string | number | null;
  preco?: string | number | null;
  preco_unitario?: string | number | null;
  rate?: string | number | null;
}

export interface PricingTier {
  minimum_quantity: string;
  unit_price: string;
  /** Scaled integer quantity, exposed for exact comparisons in application code. */
  minimum_quantity_scaled: bigint;
  /** Integer cents. */
  unit_price_cents: bigint;
}

export interface ProductPricingInput {
  preco_base?: string | number | null;
  base_price?: string | number | null;
  precoBase?: string | number | null;
  precos?: PricingTierInput[];
  tiers?: PricingTierInput[];
}

export interface NormalizedProductPricing {
  preco_base: string | null;
  base_price_cents: bigint | null;
  precos: PricingTier[];
}

export interface PricingResolution {
  rate: string;
  rate_cents: bigint;
  source: 'base' | 'tier';
  minimum_quantity: string | null;
  urgent: boolean;
}

function decimalParts(value: unknown, label: string): { integer: string; fraction: string } {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new PricingValidationError(`${label} deve ser um número válido.`);
  }
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new PricingValidationError(`${label} deve ser um número válido.`);
  }

  const raw = String(value).trim();
  if (!raw || raw.includes('e') || raw.includes('E')) {
    throw new PricingValidationError(`${label} deve ser um número decimal válido.`);
  }
  // Accept the common Brazilian comma form only when it is unambiguous. The
  // persisted representation remains a dot-decimal string.
  const normalized = raw.includes(',') && !raw.includes('.') ? raw.replace(',', '.') : raw;
  const match = /^(?:\+)?(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new PricingValidationError(`${label} deve ser um número decimal válido.`);
  return { integer: match[1], fraction: match[2] || '' };
}

export function parseScaledInteger(value: unknown, scale: number, label: string): bigint {
  const { integer, fraction } = decimalParts(value, label);
  if (fraction.length > scale) {
    throw new PricingValidationError(`${label} deve ter no máximo ${scale} casas decimais.`);
  }
  const padded = fraction.padEnd(scale, '0');
  return BigInt(integer) * 10n ** BigInt(scale) + BigInt(padded || '0');
}

export function parseMoneyCents(value: unknown, label = 'Preço'): bigint {
  const cents = parseScaledInteger(value, MONEY_SCALE, label);
  if (cents <= 0n) throw new PricingValidationError(`${label} deve ser maior que zero.`);
  // NUMERIC(14,2) allows 12 integer digits plus two decimal places.
  if (cents > 99999999999999n) {
    throw new PricingValidationError(`${label} está fora do limite permitido.`);
  }
  return cents;
}

export function parseQuantityScaled(value: unknown, label = 'Quantidade'): bigint {
  const quantity = parseScaledInteger(value, QUANTITY_SCALE, label);
  if (quantity <= 0n) throw new PricingValidationError(`${label} deve ser maior que zero.`);
  if (quantity > 99999999999999n) {
    throw new PricingValidationError(`${label} está fora do limite permitido.`);
  }
  return quantity;
}

export function formatScaled(value: bigint, scale: number): string {
  const base = 10n ** BigInt(scale);
  const integer = value / base;
  const fraction = (value % base).toString().padStart(scale, '0');
  if (scale === 0) return integer.toString();
  return `${integer.toString()}.${fraction}`.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function formatMoneyCents(cents: bigint): string {
  const base = 100n;
  const integer = cents / base;
  const fraction = (cents % base).toString().padStart(2, '0');
  return `${integer.toString()}.${fraction}`;
}

function tierQuantityValue(tier: PricingTierInput): unknown {
  return tier.minimum_quantity ?? tier.minimumQuantity ?? tier.quantidade_minima ?? tier.minimo ?? tier.faixa ?? tier.qty;
}

function tierPriceValue(tier: PricingTierInput): unknown {
  return tier.unit_price ?? tier.unitPrice ?? tier.preco ?? tier.preco_unitario ?? tier.rate;
}

/** Validate, normalize and sort a complete pricing configuration. */
export function normalizeProductPricing(input: ProductPricingInput): NormalizedProductPricing {
  const baseValue = input.preco_base ?? input.base_price ?? input.precoBase ?? null;
  const basePriceCents = baseValue === null || baseValue === undefined || String(baseValue).trim() === ''
    ? null
    : parseMoneyCents(baseValue, 'Preço base');

  const rawTiers = input.precos ?? input.tiers ?? [];
  if (!Array.isArray(rawTiers)) {
    throw new PricingValidationError('Preços deve ser um array.');
  }

  const seen = new Set<bigint>();
  const precos: PricingTier[] = rawTiers.map((tier, index) => {
    if (!tier || typeof tier !== 'object') {
      throw new PricingValidationError(`Faixa ${index + 1} é inválida.`);
    }
    const minimumQuantityScaled = parseQuantityScaled(tierQuantityValue(tier), `Quantidade mínima da faixa ${index + 1}`);
    if (seen.has(minimumQuantityScaled)) {
      throw new PricingValidationError('Não é permitido repetir a quantidade mínima de uma faixa.');
    }
    seen.add(minimumQuantityScaled);
    const unitPriceCents = parseMoneyCents(tierPriceValue(tier), `Preço da faixa ${index + 1}`);
    return {
      minimum_quantity: formatScaled(minimumQuantityScaled, QUANTITY_SCALE),
      unit_price: formatMoneyCents(unitPriceCents),
      minimum_quantity_scaled: minimumQuantityScaled,
      unit_price_cents: unitPriceCents,
    };
  }).sort((left, right) => (left.minimum_quantity_scaled < right.minimum_quantity_scaled ? -1 : 1));

  return {
    preco_base: basePriceCents === null ? null : formatMoneyCents(basePriceCents),
    base_price_cents: basePriceCents,
    precos,
  };
}

/**
 * Resolve one quantity. A quantity below the first tier intentionally uses the
 * smallest tier for compatibility with the old fixed-bracket catalog.
 */
export function resolveProductPrice(
  pricing: ProductPricingInput | NormalizedProductPricing,
  quantity: string | number,
  urgent = false,
): PricingResolution {
  const normalized = 'base_price_cents' in pricing
    ? pricing as NormalizedProductPricing
    : normalizeProductPricing(pricing as ProductPricingInput);
  const requested = parseQuantityScaled(quantity, 'Quantidade');

  let selected: PricingTier | undefined;
  for (const tier of normalized.precos) {
    if (tier.minimum_quantity_scaled <= requested) selected = tier;
    else break;
  }
  if (!selected && normalized.precos.length > 0) selected = normalized.precos[0];

  const cents = selected?.unit_price_cents ?? normalized.base_price_cents;
  if (cents === null || cents === undefined || cents <= 0n) {
    throw new PricingUnavailableError();
  }
  const resolvedCents = urgent
    ? (cents * URGENT_NUMERATOR + URGENT_DENOMINATOR / 2n) / URGENT_DENOMINATOR
    : cents;
  return {
    rate: formatMoneyCents(resolvedCents),
    rate_cents: resolvedCents,
    source: selected ? 'tier' : 'base',
    minimum_quantity: selected?.minimum_quantity ?? null,
    urgent,
  };
}

export const resolveCorePrice = resolveProductPrice;
export const resolvePricing = resolveProductPrice;
export const resolvePrice = resolveProductPrice;
export const normalizePricing = normalizeProductPricing;
