// Regras de produção do pedido: etapas, prazo final, alertas e recebimentos.
// Vocabulário em CONTEXT.md (seção Produção).
import {
  addProductionBusinessDays,
  calendarDaysBetween,
  productionBusinessDaysBetween,
} from '../_shared/calendar-sao-paulo.js';

export const PRODUCTION_STAGES = [
  'aguardando_entrada',
  'aguardando_arte',
  'em_producao',
  'pronto',
  'entregue',
] as const;

export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export const PRODUCTION_STAGE_LABELS: Record<ProductionStage, string> = {
  aguardando_entrada: 'Aguardando entrada',
  aguardando_arte: 'Aguardando arte',
  em_producao: 'Em produção',
  pronto: 'Pronto',
  entregue: 'Entregue',
};

export const DEFAULT_PRODUCTION_DAYS = 20;
export const DEFAULT_DEPOSIT_RATIO = 0.5;
/** Entregue sai do quadro depois deste número de dias corridos. */
export const DELIVERED_BOARD_DAYS = 7;
const AT_RISK_RATIO = 0.75;

export type DeadlineState = 'sem_prazo' | 'no_prazo' | 'em_risco' | 'atrasado' | 'concluido';

export function isProductionStage(value: unknown): value is ProductionStage {
  return typeof value === 'string' && (PRODUCTION_STAGES as readonly string[]).includes(value);
}

export function nextProductionStage(stage: ProductionStage): ProductionStage | null {
  const index = PRODUCTION_STAGES.indexOf(stage);
  return index >= 0 && index < PRODUCTION_STAGES.length - 1 ? PRODUCTION_STAGES[index + 1] : null;
}

export function stageReached(current: ProductionStage, target: ProductionStage): boolean {
  return PRODUCTION_STAGES.indexOf(current) >= PRODUCTION_STAGES.indexOf(target);
}

export function productionDeadline(artApprovedOn: string, productionDays: number): string {
  return addProductionBusinessDays(artApprovedOn, productionDays);
}

/** Dias consumidos a partir dos quais o pedido fica em risco (75% do prazo). */
export function atRiskThreshold(totalDays: number): number {
  return Math.ceil(totalDays * AT_RISK_RATIO);
}

export interface ProductionFacts {
  stage: ProductionStage;
  artApprovedOn: string | null;
  deadline: string | null;
  readyOn: string | null;
  stageChangedOn: string;
}

export interface ProductionTimeline {
  deadline: string | null;
  total_days: number | null;
  elapsed_days: number | null;
  state: DeadlineState;
  stalled_days: number | null;
}

export function productionTimeline(facts: ProductionFacts, today: string): ProductionTimeline {
  const stalled =
    facts.stage === 'aguardando_entrada' || facts.stage === 'aguardando_arte'
      ? Math.max(0, calendarDaysBetween(facts.stageChangedOn, today))
      : null;
  if (!facts.artApprovedOn || !facts.deadline) {
    return {
      deadline: null,
      total_days: null,
      elapsed_days: null,
      state: stageReached(facts.stage, 'pronto') ? 'concluido' : 'sem_prazo',
      stalled_days: stalled,
    };
  }
  const totalDays = Math.max(1, productionBusinessDaysBetween(facts.artApprovedOn, facts.deadline));
  const done = stageReached(facts.stage, 'pronto');
  const end = done ? facts.readyOn || today : today;
  const elapsed = productionBusinessDaysBetween(facts.artApprovedOn, end);
  let state: DeadlineState;
  if (done) state = 'concluido';
  else if (today > facts.deadline) state = 'atrasado';
  else if (elapsed >= atRiskThreshold(totalDays)) state = 'em_risco';
  else state = 'no_prazo';
  return {
    deadline: facts.deadline,
    total_days: totalDays,
    elapsed_days: elapsed,
    state,
    stalled_days: stalled,
  };
}

export function needsAttention(state: DeadlineState): boolean {
  return state === 'em_risco' || state === 'atrasado';
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function defaultDepositAmount(grandTotal: number): number {
  return round2(grandTotal * DEFAULT_DEPOSIT_RATIO);
}

export function receivedAmount(
  grandTotal: number,
  depositAmount: number | null,
  balanceReceivedOn: string | null
): number {
  if (balanceReceivedOn) return round2(grandTotal);
  return round2(Math.min(grandTotal, depositAmount ?? 0));
}

/** Percentual faturado derivado do valor recebido. */
export function billedPercent(
  grandTotal: number,
  depositAmount: number | null,
  balanceReceivedOn: string | null
): number {
  if (balanceReceivedOn) return 100;
  if (grandTotal <= 0) return 0;
  return Math.min(100, round2(((depositAmount ?? 0) / grandTotal) * 100));
}
