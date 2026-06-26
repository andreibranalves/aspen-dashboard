// src/types/domain.ts
// Shared domain types used across the frontend.

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
