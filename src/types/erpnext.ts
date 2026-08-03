// src/types/erpnext.ts
// Shapes brutos vindos do ERPNext/Frappe. Campos opcionais e aliases são permitidos aqui.

export interface OrcamentoResponse {
  success?: boolean;
  cliente?: string;
  quotation_id?: string;
  quotation_name?: string;
  /** Stable first-party PostgreSQL identifiers returned by core quote drafts. */
  quote_id?: string;
  quotation_uuid?: string;
  revision_id?: string;
  quote_revision_id?: string;
  revision?: number;
  revision_number?: number;
  status?: string;
  cliente_id?: string;
  cliente_snapshot?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  subtotal?: string;
  frete?: string;
  total?: string;
  validade_dias?: number;
  pagamento?: string;
  entrega?: string;
  observacoes?: string;
  prazo_producao?: string;
  template_padrao?: string;
  core_mode?: boolean;
  source?: 'postgres' | 'frappe';
  deal_id?: string;
  pdf_url?: string;
}

export interface LeadCreateResponse {
  created?: string;
  name?: string;
  id?: string;
}
