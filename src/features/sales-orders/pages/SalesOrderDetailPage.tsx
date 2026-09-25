import { useState, useEffect, useCallback } from 'react';
import { Check, FileText } from 'lucide-react';
import { apiGet } from '@/lib/api/api';
import { formatBRL, formatDate } from '@/lib/formatting/formatters';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import SkeletonDetail from '@/components/shared/SkeletonDetail';
import { Button } from '@/components/ui/button';
import ErrorState from '@/components/shared/ErrorState';
import { StatusBadge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  projectSalesOrderDetail,
  type SalesOrderDetailView,
  type SalesOrderItemView,
} from '@/features/sales-orders/salesOrderViewModel';
import { Heading } from '@/components/ui/heading';
import { salesOrderStatusLabel } from '@/lib/statusLabels';
import { NotesSection, ProductionSection } from '@/features/sales-orders/components/ProductionPanel';

interface SalesOrderDetailPageProps {
  id: string;
  navigate: (path: string) => void;
}

function formatSalesOrderDate(value: string): string {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return dateOnly ? `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}` : formatDate(value);
}

function ItemTable({ items }: { items: SalesOrderItemView[] }) {
  return (
    <Table className="min-w-[480px] xl:min-w-0">
      <TableHeader>
        <TableRow>
          <TableHead>Produto</TableHead>
          <TableHead className="text-center">Qtd.</TableHead>
          <TableHead className="text-right">Unitário</TableHead>
          <TableHead className="text-right">Subtotal</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, index) => {
          const amount = item.amount ?? item.qty * item.rate;
          return (
            <TableRow key={`${item.item_code}-${index}`}>
              <TableCell><span className="block text-sm font-medium">{item.item_name || item.item_code}</span><span className="mt-1 block font-mono text-xs text-fg-muted">{item.item_code}</span></TableCell>
              <TableCell className="text-center">{item.qty}</TableCell>
              <TableCell className="text-right font-sans tabular-nums">
                {formatBRL(item.rate)}
              </TableCell>
              <TableCell className="text-right font-sans tabular-nums">
                {formatBRL(amount)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default function SalesOrderDetailPage({ id, navigate }: SalesOrderDetailPageProps) {
  const [data, setData] = useState<SalesOrderDetailView | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<unknown>(`/sales-orders?id=${encodeURIComponent(id)}`);
      const projected = projectSalesOrderDetail(result);
      if (!projected) throw new Error('Resposta inválida ao carregar pedido.');
      setData(projected);
    } catch {
      setError('Não foi possível carregar o pedido. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [id]);
  const applyResult = useCallback((result: unknown) => {
    const projected = projectSalesOrderDetail(result);
    if (projected) setData(projected);
  }, []);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  if (loading) return <SkeletonDetail />;

  if (error) {
    return (
      <PageShell>
        <PageHeader title="Pedido" />
        <ErrorState title="Não foi possível carregar o pedido" onRetry={() => void fetchDetail()} />
      </PageShell>
    );
  }

  if (!data) return null;

  const items = data.items;
  const itemTotal = items?.reduce(
    (total, item) => total + (item.amount ?? item.qty * item.rate),
    0
  );
  const grandTotal =
    data.grand_total ?? data.rounded_total ?? (items && items.length > 0 ? itemTotal : undefined);
  const orderDate = data.date ?? data.data;
  const statusLabel = salesOrderStatusLabel(data.status);
  const orderIsReadOnly =
    data.status === 'Draft' || data.status === 'Cancelled' || data.status === 'Closed';

  return (
    <PageShell className="space-y-4">
      <PageHeader
        title={data.id}
        meta={
          <>
            <StatusBadge status={data.status} label={statusLabel} />
            {data.customer_name && <span className="font-medium text-fg">{data.customer_name}</span>}
            {orderDate && <span>{formatSalesOrderDate(orderDate)}</span>}
          </>
        }
        actions={
          data.source_quotation ? (
            <Button variant="outline" onClick={() => navigate(`/quotations/${encodeURIComponent(data.source_quotation || '')}`)}>
              <FileText aria-hidden="true" /> Ver orçamento de origem
            </Button>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <section className="rounded-card border border-line bg-surface p-5" aria-labelledby="sales-order-customer-title">
            <Heading level="section" id="sales-order-customer-title">Cliente</Heading>
            <div className="mt-5 flex items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-full bg-avatar-one text-xs font-semibold text-avatar-ink" aria-hidden="true">{(data.customer_name || '?').trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toLocaleUpperCase('pt-BR')}</div><div className="min-w-0"><p className="truncate text-sm font-medium">{data.customer_name || 'Cliente não identificado'}</p>{data.production?.production.deadline && <p className="text-xs text-fg-muted">Prazo final: {formatSalesOrderDate(data.production.production.deadline)}</p>}</div></div>
          </section>
          <section
            className="min-w-0 rounded-card border border-line bg-surface p-5"
            aria-labelledby="sales-order-items-title"
          >
            <div>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <Heading level="section" id="sales-order-items-title">
                  Itens do pedido
                </Heading>
                {data.omitted_items > 0 && (
                  <span className="text-xs text-fg-muted">
                    {data.omitted_items}{' '}
                    {data.omitted_items === 1 ? 'item não exibido' : 'itens não exibidos'} por falta
                    de dados confirmados.
                  </span>
                )}
              </div>
              {items === undefined ? (
                <p className="py-6 text-sm text-fg-muted">Itens não disponíveis para este pedido.</p>
              ) : items.length === 0 ? (
                <p className="py-6 text-sm text-fg-muted">Nenhum item registrado neste pedido.</p>
              ) : (
                <div className="overflow-x-auto">
                  <ItemTable items={items} />
                </div>
              )}
            </div>

          </section>
          {data.production && (
            <ProductionSection order={data.production} readOnly={orderIsReadOnly} onChanged={applyResult} />
          )}
          <NotesSection orderId={data.id} notes={data.notes} onChanged={applyResult} />
        </div>
        <div className="space-y-4">
          <aside
            className="rounded-card border border-line bg-surface p-5"
            aria-labelledby="sales-order-values-title"
          >
            <Heading level="section" id="sales-order-values-title">
              Valores do pedido
            </Heading>
            <dl className="mt-5 space-y-3 text-sm tabular-nums"><div className="flex justify-between gap-2"><dt className="text-fg-muted">Produtos</dt><dd>{itemTotal === undefined ? '—' : formatBRL(itemTotal)}</dd></div><div className="flex justify-between gap-2 border-t border-line pt-4 text-lg font-semibold"><dt>Total</dt><dd>{grandTotal === undefined ? '—' : formatBRL(grandTotal)}</dd></div></dl>
            {data.status === 'Completed' && (
              <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-success">
                <Check size={14} aria-hidden="true" />
                <span>Concluído</span>
              </div>
            )}
          </aside>
          <aside className="rounded-card border border-line bg-surface p-5" aria-label="Rastreabilidade do pedido"><Heading level="section">Rastreabilidade</Heading><div className="mt-5 border-l border-line pl-4 text-sm"><p className="font-medium">Pedido criado</p><p className="mt-1 text-xs text-fg-muted">{orderDate ? formatSalesOrderDate(orderDate) : 'Data não informada'}</p>{data.source_quotation && <p className="mt-5 font-medium">Origem: {data.source_quotation}</p>}{data.quotation_origin && <><p className="mt-5 font-medium">Origem do lead</p><p className={`mt-1 text-xs ${data.quotation_origin.status === 'conflict' ? 'text-destructive' : 'text-fg-muted'}`}>{data.quotation_origin.sourceLabel}</p></>}{data.quotation_origin?.status === 'conflict' && <p className="mt-2 text-xs text-destructive">Origem do orçamento divergente.</p>}</div></aside>
        </div>
      </div>
    </PageShell>
  );
}
