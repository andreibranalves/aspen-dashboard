import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Factory } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import ErrorState from '@/components/shared/ErrorState';
import { EmptyState } from '@/components/shared/EmptyState';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { formatBRL } from '@/lib/formatting/formatters';
import { cn } from '@/lib/utils';
import {
  ADVANCE_LABELS,
  PRODUCTION_STAGES,
  PRODUCTION_STAGE_LABELS,
  SALES_ORDERS_CHANGED_EVENT,
  fetchProductionBoard,
  needsAttention,
  type ProductionOrder,
  type ProductionStage,
} from '@/features/sales-orders/production';
import { projectProductionOrder } from '@/features/sales-orders/salesOrderViewModel';
import { AdvanceStageDialog, DeadlineBar, useAdvanceStage } from './ProductionControls';

function ProductionCard({
  order,
  onAdvance,
}: {
  order: ProductionOrder;
  onAdvance: () => void;
}) {
  const attention = needsAttention(order.production.state);
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-card border bg-surface p-3 shadow-xs',
        order.production.state === 'atrasado'
          ? 'border-destructive/50'
          : attention
            ? 'border-warning/50'
            : 'border-line'
      )}
      aria-label={`Pedido ${order.order_number}`}
    >
      <a
        href={`#/sales-orders/${encodeURIComponent(order.id)}`}
        className="flex min-w-0 items-start justify-between gap-2 rounded-control hover:text-primary focus-inset"
        aria-label={`Abrir pedido ${order.order_number}`}
      >
        <span className="min-w-0 space-y-0.5">
          <span className="block truncate text-sm font-medium">{order.customer_name || 'Cliente não identificado'}</span>
          <span className="block font-mono text-2xs text-fg-muted">{order.order_number}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-fg-muted" aria-hidden="true" />
      </a>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-sans font-semibold tabular-nums">{formatBRL(order.grand_total)}</span>
        {order.production_stage !== 'entregue' && (
          <Button variant="outline" size="sm" onClick={onAdvance}>
            {ADVANCE_LABELS[order.production_stage]}
          </Button>
        )}
      </div>
      <DeadlineBar order={order} />
    </article>
  );
}

export default function ProductionBoard({ navigate }: { navigate: (path: string) => void }) {
  const [items, setItems] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [advancing, setAdvancing] = useState<ProductionOrder | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (quiet = false) => {
    const current = ++generation.current;
    if (!quiet) setLoading(true);
    setError(false);
    try {
      const result = await fetchProductionBoard();
      if (current !== generation.current) return;
      if (!Array.isArray(result?.items)) throw new Error('Resposta inválida.');
      setItems(
        result.items.map(projectProductionOrder).filter((item): item is ProductionOrder => item !== null)
      );
    } catch {
      if (current === generation.current) setError(true);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load(true);
    window.addEventListener(SALES_ORDERS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SALES_ORDERS_CHANGED_EVENT, refresh);
  }, [load]);

  // O evento de mudança recarrega o quadro; o avanço não precisa aplicar a resposta.
  const advance = useAdvanceStage(useCallback(() => undefined, []));

  if (loading) return <SkeletonTable cols={5} rows={6} size="lg" />;
  if (error) return <ErrorState title="Não foi possível carregar a produção" onRetry={() => void load()} />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Factory}
        title="Nenhum pedido em produção."
        actions={
          <Button variant="outline" onClick={() => navigate('/quotations')}>
            Ver orçamentos
          </Button>
        }
      />
    );
  }

  const byStage = new Map<ProductionStage, ProductionOrder[]>(PRODUCTION_STAGES.map((stage) => [stage, []]));
  for (const item of items) byStage.get(item.production_stage)?.push(item);

  return (
    <>
      <div className="overflow-x-auto pb-2">
        <div className="flex w-max gap-3">
          {PRODUCTION_STAGES.map((stage) => {
            const orders = byStage.get(stage) ?? [];
            return (
              <section
                key={stage}
                className="flex w-[15rem] shrink-0 flex-col gap-3 rounded-card bg-surface-subtle p-3"
                aria-labelledby={`production-stage-${stage}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Heading level="section" id={`production-stage-${stage}`}>
                    {PRODUCTION_STAGE_LABELS[stage]}
                  </Heading>
                  <span className="text-xs tabular-nums text-fg-muted">{orders.length}</span>
                </div>
                {orders.map((order) => (
                  <ProductionCard
                    key={order.id}
                    order={order}
                    onAdvance={() => setAdvancing(order)}
                  />
                ))}
              </section>
            );
          })}
        </div>
      </div>
      <AdvanceStageDialog order={advancing} onClose={() => setAdvancing(null)} onAdvance={advance} />
    </>
  );
}
