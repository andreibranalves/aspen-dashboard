// Contrato canônico de orçamento, lado consumidor (frontend).
// Espelha api/_modules/quotation-contract.ts — um único nome por conceito
// (revisão, estado, expiração, valores, token de concorrência).
// Fonte normativa: #124; remoção dos aliases antigos no backend: #126.

export type QuotationStatus = 'rascunho' | 'emitido' | 'aprovado' | 'perdido';

export interface CanonicalQuotationItem {
  code: string;
  sku: string;
  quantity: string;
  name: string;
  description: string;
  unit: string;
  category: string | null;
  brand: string | null;
  unitPrice: string;
  lineTotal: string;
  manualRate: boolean;
}

export interface CanonicalQuotationRevisionEntry {
  revisionId: string;
  revision: number;
  createdAt: string;
  validadeDias: number;
  subtotal: string;
  total: string;
  status: QuotationStatus;
  expired: boolean;
}

export interface CanonicalQuotationBase {
  revisionId: string;
  revision: number;
  status: QuotationStatus;
  clienteId: string;
  cliente: string;
  data: string;
  /** Data de expiração canônica (ISO). */
  validade: string;
  validadeDias: number;
  subtotal: string;
  /** Valor total canônico. */
  total: string;
  frete: string;
  /** Indicador de expiração canônico. */
  expired: boolean;
  /** Token de concorrência otimista. */
  concurrencyToken: string;
  updatedAt: string;
}

export interface CanonicalQuotationListRow extends CanonicalQuotationBase {
  id: string;
  businessNumber: string;
  name: string;
  emailSent: boolean;
}

export interface CanonicalQuotationDetail extends CanonicalQuotationBase {
  id: string;
  businessNumber: string;
  name: string;
  emailSent: boolean;
  emailSentAt: string | null;
  pagamento: string;
  entrega: string;
  observacoes: string;
  prazoProducao: string;
  prazoProducaoDias: number;
  acrescimoPercent: number;
  templateKey: string;
  templateHash: string;
  items: CanonicalQuotationItem[];
  revisionHistory: CanonicalQuotationRevisionEntry[];
}
