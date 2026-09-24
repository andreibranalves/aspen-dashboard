import { useEffect, useState } from 'react';
import { apiGet, apiPatch } from '@/lib/api/api';
import type { ProductionAction, ProductionOrder } from './productionModel';

export * from './productionModel';

export const SALES_ORDERS_CHANGED_EVENT = 'aspen:sales-orders-changed';

export function fetchProductionBoard(): Promise<{ items: ProductionOrder[]; attention_count: number }> {
  return apiGet('/sales-orders?view=production');
}

export async function applyProductionAction<T = unknown>(
  orderId: string,
  action: ProductionAction
): Promise<T> {
  const result = await apiPatch<T>(`/sales-orders?id=${encodeURIComponent(orderId)}`, action);
  window.dispatchEvent(new Event(SALES_ORDERS_CHANGED_EVENT));
  return result;
}

/** Pedidos em risco + atrasados, para o número do item Pedidos no menu. */
export function useProductionAttentionCount(route: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => {
      apiGet<{ attention_count?: unknown }>('/sales-orders?view=alerts')
        .then((result) => {
          const value = Number(result?.attention_count);
          if (active) setCount(Number.isSafeInteger(value) && value > 0 ? value : 0);
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener(SALES_ORDERS_CHANGED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(SALES_ORDERS_CHANGED_EVENT, load);
    };
  }, [route]);
  return count;
}
