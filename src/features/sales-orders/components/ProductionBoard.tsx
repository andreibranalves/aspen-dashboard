import { useCallback, useEffect, useRef, useState } from 'react';
import { Factory } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import ErrorState from '@/components/shared/ErrorState';
import { EmptyState } from '@/components/shared/EmptyState';
import SkeletonTable from '@/components/shared/SkeletonTable';
import StatusFilterBar from '@/components/shared/StatusFilterBar';
import { Text } from '@/components/ui/text';
import { MOBILE_MEDIA_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
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
        className="flex min-w-0 flex-col gap-0.5 rounded-control hover:text-primary focus-inset"
        aria-label={`Abrir pedido ${order.order_number}`}
      >
        <Text variant="title" truncate>{order.customer_name || 'Cliente não identificado'}</Text>
        <span className="flex items-baseline justify-between gap-2">
          <Text variant="id">{order.order_number}</Text>
          <Text variant="value" className="shrink-0">{formatBRL(order.grand_total)}</Text>
        </span>
      </a>
      <DeadlineBar order={order} />
      {order.production_stage !== 'entregue' && (
        <Button variant="outline" size="sm" className="w-full" onClick={onAdvance}>
          {ADVANCE_LABELS[order.production_stage]}
        </Button>
      )}
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
  // No celular o quadro vira uma etapa por vez, escolhida no filtro.
  const compact = useMediaQuery(MOBILE_MEDIA_QUERY);
  const [mobileStage, setMobileStage] = useState<ProductionStage | null>(null);

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

  const dialog = <AdvanceStageDialog order={advancing} onClose={() => setAdvancing(null)} onAdvance={advance} />;

  if (compact) {
    const stage = mobileStage ?? PRODUCTION_STAGES.find((candidate) => (byStage.get(candidate) ?? []).length > 0) ?? PRODUCTION_STAGES[0];
    const orders = byStage.get(stage) ?? [];
    return (
      <>
        <div className="flex flex-col gap-3">
          <StatusFilterBar
            label="Etapa de produção"
            value={stage}
            onValueChange={setMobileStage}
            options={PRODUCTION_STAGES.map((candidate) => ({
              value: candidate,
              label: PRODUCTION_STAGE_LABELS[candidate],
              count: (byStage.get(candidate) ?? []).length,
            }))}
          />
          {orders.length === 0 ? (
            <EmptyState icon={Factory} title="Nenhum pedido nesta etapa." variant="dashed" />
          ) : (
            orders.map((order) => <ProductionCard key={order.id} order={order} onAdvance={() => setAdvancing(order)} />)
          )}
        </div>
        {dialog}
      </>
    );
  }

  return (
    <>
      <div className="overflow-x-auto pb-2">
        <div className="flex w-max gap-3">
          {PRODUCTION_STAGES.map((stage) => {
            const orders = byStage.get(stage) ?? [];
            return (
              <section
                key={stage}
                // Etapa vazia fica estreita para as etapas com pedidos ganharem espaço.
                className={cn(
                  'flex shrink-0 flex-col gap-3 rounded-card bg-surface-subtle p-3',
                  orders.length > 0 ? 'w-[15rem]' : 'w-40'
                )}
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
      {dialog}
    </>
  );
}
