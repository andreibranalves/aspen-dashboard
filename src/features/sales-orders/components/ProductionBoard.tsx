import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api/api';
import { formatBRL } from '@/lib/formatting/formatters';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import ErrorState from '@/components/shared/ErrorState';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { STAGES, type ProductionOrder } from '../productionTypes';

export default function ProductionBoard({ navigate }: { navigate: (path: string) => void }) {
  const [items, setItems] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await apiGet<{ items: ProductionOrder[] }>('/production-orders');
      setItems(result.items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  return <PageShell className="space-y-5">
    <PageHeader title="Pedidos" />
    {loading && <p className="text-sm text-fg-muted">Carregando produção…</p>}
    {!loading && error && <ErrorState title="Não foi possível carregar a produção" onRetry={() => void reload()} />}
    {!loading && !error && items.length === 0 && <p className="text-sm text-fg-muted">Nenhum pedido no quadro.</p>}
    {!loading && !error && <div className="grid gap-4 lg:grid-cols-5">
      {STAGES.map((stage) => <section key={stage} aria-label={stage} className="min-w-0 space-y-3">
        <Heading level="section">{stage} <span className="text-fg-muted">{items.filter((item) => item.stage === stage).length}</span></Heading>
        {items.filter((item) => item.stage === stage).map((item) => <Button
          key={item.id} type="button" onClick={() => navigate(`/sales-orders/${encodeURIComponent(item.id)}`)}
          variant="outline" className="h-auto w-full flex-col items-start text-left shadow-xs"
        >
          <span className="block text-xs font-semibold">{item.id}</span>
          <span className="block truncate text-sm">{item.customer_name}</span>
          <span className="block text-sm font-medium">{formatBRL(item.grand_total)}</span>
          {item.due_date && <span className="block text-xs text-fg-muted">Prazo {item.due_date.split('-').reverse().join('/')}</span>}
          {item.alert && <span className={`block text-xs font-semibold ${item.alert === 'atrasado' ? 'text-destructive' : 'text-warning'}`}>{item.alert}</span>}
          {item.stalled_days !== null && <span className="block text-xs text-fg-muted">Parado há {item.stalled_days} dias</span>}
        </Button>)}
      </section>)}
    </div>}
  </PageShell>;
}
