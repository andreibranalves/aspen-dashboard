// src/types/domain.ts
// Shared domain types used across the frontend.

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
  categoria?: string;
}

export interface ProductsApiResponse {
  data?: Product[];
  pagination?: {
    total_pages?: number;
    total?: number;
  };
}

export interface DraftItem {
  item_code: string;
  qty: number;
  rate: number | null;
  item_name?: string;
  _rateManual?: boolean;
}

export interface DraftEdited {
  nome: string;
  email: string;
  telefone: string;
  urgente: boolean;
  origem: string;
  cnpj: string;
  endereco: Address;
  items: DraftItem[];
  prazo_producao: string;
  _showAddr?: boolean;
}

export interface Draft {
  index: number;
  original: Record<string, unknown>;
  edited: DraftEdited;
  approved: boolean;
  discarded: boolean;
  status?: 'processing' | 'done' | 'error';
  result?: { success: boolean; data?: Record<string, unknown>; error?: string };
}

export interface ProductSearchEntry {
  term?: string;
  results?: Product[];
  loading?: boolean;
  open?: boolean;
}
