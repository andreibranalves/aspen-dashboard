import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api/api';

export interface OrderTemplateItem {
  sku: string;
  name: string;
  position: number;
}

export interface OrderTemplate {
  id: string;
  name: string;
  archived: boolean;
  items: OrderTemplateItem[];
  created_at: string;
  updated_at: string;
}

export function listOrderTemplates(): Promise<{ data: OrderTemplate[] }> {
  return apiGet<{ data: OrderTemplate[] }>('/order-templates');
}

export function createOrderTemplate(input: { name: string; skus: string[] }) {
  return apiPost<{ id: string }>('/order-templates', input);
}

export function updateOrderTemplate(id: string, input: { name: string; skus: string[] }) {
  return apiPut<{ id: string }>(`/order-templates?id=${encodeURIComponent(id)}`, input);
}

export function archiveOrderTemplate(id: string) {
  return apiDelete<{ archived: true }>(`/order-templates?id=${encodeURIComponent(id)}`);
}
