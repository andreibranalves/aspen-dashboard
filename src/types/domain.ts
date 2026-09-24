// Shared first-party domain types used across the frontend.

import type { Address } from '@/lib/clientMetadata';

export interface Product {
  sku: string;
  item_code?: string;
  nome?: string;
  item_name?: string;
  descricao?: string;
  unidade?: string;
  stock_uom?: string;
  preco_minimo?: number | string;
  preco_base?: number | string | null;
  precos?: Array<{
    minimum_quantity?: number | string;
    unit_price?: number | string;
    faixa?: number | string;
    qty?: number | string;
    rate?: number | string;
  }>;
  pricing_available?: boolean;
  categoria?: string;
  marca?: string | null;
  ativo?: boolean;
  imagem?: string | null;
  criado_em?: string | null;
  atualizado_em?: string | null;
  arquivado_em?: string | null;
  modificado_em?: string | null;
}

export interface ProductsApiResponse {
  data?: Product[];
  pagination?: {
    total_pages?: number;
    total?: number;
    page?: number;
    limit?: number;
  };
}

export interface OrcamentoResponse {
  success?: boolean;
  cliente?: string;
  quotation_id?: string;
  quote_id?: string;
  quotation_uuid?: string;
  revision_id?: string;
  revision?: number;
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
  concurrency_token?: string;
  deal_id?: string;
  pdf_url?: string;
  public_url?: string | null;
  publicUrl?: string | null;
}

export interface LeadCreateResponse {
  created?: string;
  name?: string;
  id?: string;
}

export interface DraftItem {
  item_code: string;
  qty: number;
  rate: number | null;
  item_name?: string;
  _rateManual?: boolean;
  /** Preço automático sem acréscimo, para mostrar a base no card. */
  _baseRate?: number;
}

export interface DraftEdited {
  nome: string;
  empresa?: string;
  email: string;
  telefone: string;
  acrescimo_percent: number;
  origem: string;
  cnpj: string;
  endereco: Address;
  items: DraftItem[];
  /** Ausente usa o padrão das Configurações no servidor. */
  prazo_producao_dias?: number;
  /** Trecho em que o cliente mencionou prazo; não altera preço nem prazo. */
  prazo_pedido?: string;
  pagamento?: string;
  entrega?: string;
  observacoes?: string;
  frete?: string;
  validade_dias?: number;
  template_key?: string;
  _showAddr?: boolean;
  client_id?: string;
  /** Operator decision that the current identity is a new client. It is never
   * proof that no client exists, never restored after a reload and never sent
   * together with an existing link. */
  confirm_new_client?: boolean;
  quote_lead_id?: string;
  crm_deal_id?: string;
  opportunity_id?: string;
  new_demand?: boolean;
  demand_summary?: string;
}

export interface Draft {
  index: number;
  original: Record<string, unknown>;
  edited: DraftEdited;
  approved: boolean;
  discarded: boolean;
  status?: 'processing' | 'done' | 'error';
  result?: { success: boolean; data?: Record<string, unknown>; error?: string };
  /** Stable creation key generated before the first dispatch. A retry with the
   * same key and content replays the original draft instead of duplicating it. */
  creationRequestId?: string;
}

export interface QuotationIssueProjection {
  quotationId: string;
  businessNumber: string;
  revisionId: string;
  revisionNumber: number;
  status: 'emitido';
  issuedAt: string;
  validUntil: string;
  pdfUrl: string;
}

export interface QuotationSavedSnapshot {
  items: DraftItem[];
  frete: string;
  total: string;
}

export interface StoredAutoQuoteDraft extends Draft {
  issueIdempotencyKey?: string;
  issueDispatchStarted?: boolean;
  issueRecoveryRequired?: boolean;
  issueOrigin?: 'conversation' | 'manual';
  issue?: QuotationIssueProjection;
  sourceQuotationId?: string;
  sourceRevisionId?: string;
  saved?: {
    quotationId: string;
    businessNumber: string;
    revisionId: string;
    concurrencyToken: string;
    snapshot?: QuotationSavedSnapshot;
  };
}

export interface ProductSearchEntry {
  term?: string;
  results?: Product[];
  loading?: boolean;
  open?: boolean;
}

export interface DashboardSummary {
  total_revenue?: number;
  revenue_delta?: number;
  orders_count?: number;
  orders_delta?: number;
  avg_ticket?: number;
  avg_ticket_delta?: number;
  open_orders?: number;
  conversion_rate?: number;
  conversion_delta?: number;
}

export interface TopProduct {
  sku?: string;
  product?: string;
  name?: string;
  quantity?: number;
  qty?: number;
  revenue?: number;
  total?: number;
  orders?: number;
  order_count?: number;
}

export interface TopCustomer {
  name?: string;
  customer?: string;
  revenue?: number;
  total?: number;
  orders?: number;
  order_count?: number;
}

export interface SalesByDay {
  date?: string;
  revenue?: number;
  total?: number;
  orders?: number;
}

export interface DashboardData {
  success?: boolean;
  period?: {
    label?: string;
    from?: string;
    to?: string;
  };
  summary?: DashboardSummary;
  top_products?: TopProduct[];
  top_customers?: TopCustomer[];
  sales_by_day?: SalesByDay[];
}
