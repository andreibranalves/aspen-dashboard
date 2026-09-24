// Contrato de produção do pedido; regras autoritativas em
// api/_modules/sales-order-production.ts e vocabulário em CONTEXT.md.

export const PRODUCTION_STAGES = [
  'aguardando_entrada',
  'aguardando_arte',
  'em_producao',
  'pronto',
  'entregue',
] as const;

export type ProductionStage = (typeof PRODUCTION_STAGES)[number];
export type DeadlineState = 'sem_prazo' | 'no_prazo' | 'em_risco' | 'atrasado' | 'concluido';

export const PRODUCTION_STAGE_LABELS: Record<ProductionStage, string> = {
  aguardando_entrada: 'Aguardando entrada',
  aguardando_arte: 'Aguardando arte',
  em_producao: 'Em produção',
  pronto: 'Pronto',
  entregue: 'Entregue',
};

/** Rótulo do passo que leva à próxima etapa. */
export const ADVANCE_LABELS: Record<ProductionStage, string> = {
  aguardando_entrada: 'Entrada recebida',
  aguardando_arte: 'Arte aprovada',
  em_producao: 'Pronto',
  pronto: 'Entregue',
  entregue: '',
};

export const DEADLINE_STATE_LABELS: Record<DeadlineState, string> = {
  sem_prazo: 'Sem prazo',
  no_prazo: 'No prazo',
  em_risco: 'Em risco',
  atrasado: 'Atrasado',
  concluido: 'Concluído',
};

export interface ProductionTimeline {
  deadline: string | null;
  total_days: number | null;
  elapsed_days: number | null;
  state: DeadlineState;
  stalled_days: number | null;
}

export interface ProductionOrder {
  id: string;
  order_number: string;
  customer_name: string;
  grand_total: number;
  status: string;
  date: string;
  production_stage: ProductionStage;
  production: ProductionTimeline;
  production_days: number;
  deadline_manual: boolean;
  deposit_received_on: string | null;
  deposit_amount: number | null;
  art_approved_on: string | null;
  ready_on: string | null;
  delivered_on: string | null;
  balance_received_on: string | null;
  received_amount: number;
}

export interface SalesOrderNote {
  id: string;
  kind: 'note' | 'stage';
  body: string;
  created_at: string;
  updated_at: string;
  undoable: boolean;
}

export type ProductionAction =
  | { action: 'advance'; expected_stage: ProductionStage; date: string; deposit_amount?: number }
  | { action: 'undo'; note_id: string }
  | ({ action: 'update' } & Partial<{
      deposit_received_on: string;
      deposit_amount: number;
      art_approved_on: string;
      production_days: number;
      deadline: string | null;
      ready_on: string;
      delivered_on: string;
      balance_received_on: string | null;
    }>)
  | { action: 'add_note'; body: string }
  | { action: 'edit_note'; note_id: string; body: string }
  | { action: 'delete_note'; note_id: string };

export function nextStage(stage: ProductionStage): ProductionStage | null {
  const index = PRODUCTION_STAGES.indexOf(stage);
  return index >= 0 && index < PRODUCTION_STAGES.length - 1 ? PRODUCTION_STAGES[index + 1] : null;
}

export function stageReached(current: ProductionStage, target: ProductionStage): boolean {
  return PRODUCTION_STAGES.indexOf(current) >= PRODUCTION_STAGES.indexOf(target);
}

export function needsAttention(state: DeadlineState): boolean {
  return state === 'em_risco' || state === 'atrasado';
}

export function saldoOpen(order: Pick<ProductionOrder, 'balance_received_on' | 'received_amount' | 'grand_total'>): boolean {
  return !order.balance_received_on && order.received_amount < order.grand_total;
}

export function defaultDeposit(grandTotal: number): number {
  return Math.round(grandTotal * 50) / 100;
}

/** Data civil de hoje em São Paulo (AAAA-MM-DD). */
export function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
