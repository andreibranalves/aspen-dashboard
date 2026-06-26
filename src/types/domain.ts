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
}

export interface StaleQuotation {
  id?: string;
  customer?: string;
  client?: string;
  age?: number;
  days_old?: number;
  value?: number;
  total?: number;
  status?: string;
}

export interface DashboardData {
  summary?: DashboardSummary;
  top_products?: TopProduct[];
  top_customers?: TopCustomer[];
  sales_by_day?: SalesByDay[];
  stale_quotations?: StaleQuotation[];
}
