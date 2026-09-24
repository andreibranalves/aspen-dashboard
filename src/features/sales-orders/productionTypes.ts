export const STAGES = ['aguardando entrada', 'aguardando arte', 'em produção', 'pronto', 'entregue'] as const;
export type Stage = (typeof STAGES)[number];
export interface ProductionOrder {
  id: string;
  customer_name: string;
  stage: Stage;
  stage_changed_at: string;
  art_approved_date: string | null;
  production_days: number;
  due_date: string | null;
  due_date_override: string | null;
  alert: 'atrasado' | 'em risco' | null;
  stalled_days: number | null;
  entry_received_date: string | null;
  entry_received_amount: number;
  balance_received_date: string | null;
  received_amount: number;
  grand_total: number;
  undo_token: string | null;
  delivered_at: string | null;
  notes?: Array<{ id: string; kind: 'note' | 'stage'; content: string; created_at: string; updated_at: string }>;
}
