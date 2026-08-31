export interface GoogleSpendResult {
  amount: number;
  available: boolean;
}

export interface ProfitInput {
  faturamento: number;
  custo: number;
  google: GoogleSpendResult;
  metaAmount: number;
  includeMeta: boolean;
  aliquotaPercent: number;
}

export interface ProfitBreakdown {
  faturamento: number;
  custo: number;
  ads: number;
  ads_google: number;
  ads_meta: number;
  imposto: number;
  lucro: number;
  ads_google_unavailable: boolean;
}

export function roundMoney(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function parseAliquotaPercent(value: string | number | null | undefined): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return number;
}

export function composeProfit(input: ProfitInput): ProfitBreakdown {
  const faturamento = roundMoney(input.faturamento);
  const custo = roundMoney(input.custo);
  const adsGoogle = input.google.available ? roundMoney(input.google.amount) : 0;
  const adsMeta = input.includeMeta ? roundMoney(input.metaAmount) : 0;
  const ads = roundMoney(adsGoogle + adsMeta);
  const imposto = roundMoney((faturamento * parseAliquotaPercent(input.aliquotaPercent)) / 100);
  const lucro = roundMoney(faturamento - custo - ads - imposto);
  return {
    faturamento,
    custo,
    ads,
    ads_google: adsGoogle,
    ads_meta: adsMeta,
    imposto,
    lucro,
    ads_google_unavailable: !input.google.available,
  };
}

export function productMargin(faturamento: number, custo: number): number {
  if (faturamento <= 0) return 0;
  return roundMoney((faturamento - custo) / faturamento);
}
