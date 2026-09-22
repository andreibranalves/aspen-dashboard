import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Check, DollarSign, FileText, Truck } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api/api';
import { formatBRL, formatDate } from '@/lib/formatting/formatters';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import SkeletonDetail from '@/components/shared/SkeletonDetail';
import { Button } from '@/components/ui/button';
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

const STATUS_LABELS: Record<string, string> = {
  Draft: 'Rascunho',
  'On Hold': 'Em espera',
  'To Pay': 'A pagar',
  'To Deliver and Bill': 'A entregar e faturar',
  'To Bill': 'A faturar',
  'To Deliver': 'A entregar',
  Completed: 'Concluído',
  Cancelled: 'Cancelado',
  Closed: 'Fechado',
};

interface SalesOrderDetailPageProps {
  id: string;
  navigate: (path: string) => void;
}

function formatSalesOrderDate(value: string): string {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return dateOnly ? `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}` : formatDate(value);
}

function ProgressMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value?: number;
  tone: 'primary' | 'success';
}) {
  const width = value === undefined ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="font-sans text-xs tabular-nums text-fg-muted">
          {value === undefined ? '—' : `${value}%`}
        </span>
      </div>
      {value !== undefined && (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
          <div
            className={`h-full rounded-full transition-all ${tone === 'success' ? 'bg-success' : 'bg-primary'}`}
            style={{ width: `${width}%` }}
          />
        </div>
      )}
    </div>
  );
}

function ItemTable({ items }: { items: SalesOrderItemView[] }) {
  return (
    <Table className="min-w-[600px] xl:min-w-0">
      <TableHeader>
        <TableRow>
          <TableHead>SKU</TableHead>
          <TableHead>Produto</TableHead>
          <TableHead className="text-center">Quantidade</TableHead>
          <TableHead className="text-center">Valor unitário</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, index) => {
          const amount = item.amount ?? item.qty * item.rate;
          return (
            <TableRow key={`${item.item_code}-${index}`}>
              <TableCell className="font-mono text-xs">{item.item_code}</TableCell>
              <TableCell>{item.item_name || item.item_code}</TableCell>
              <TableCell className="text-center">{item.qty}</TableCell>
              <TableCell className="text-center font-sans tabular-nums">
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<'billed' | 'delivered' | null>(null);
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
  const markProgress = useCallback(
    async (field: 'billed' | 'delivered') => {
      setUpdating(field);
      setActionError(null);
      try {
        const result = await apiPatch<unknown>(`/sales-orders?id=${encodeURIComponent(id)}`, {
          [field === 'billed' ? 'per_billed' : 'per_delivered']: 100,
        });
        const projected = projectSalesOrderDetail(result);
        if (!projected) throw new Error('Resposta inválida ao atualizar pedido.');
        setData(projected);
      } catch {
        setActionError('Não foi possível atualizar o pedido. Tente novamente.');
      } finally {
        setUpdating(null);
      }
    },
    [id]
  );

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  if (loading) return <SkeletonDetail />;

  if (error) {
    return (
      <PageShell>
        <PageHeader title="Pedido" />
        <div
          className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-surface px-4 py-16 text-center text-fg-muted"
          role="alert"
        >
          <AlertTriangle size={32} className="text-destructive/60" aria-hidden="true" />
          <p className="text-sm text-destructive">Erro ao carregar pedido</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => void fetchDetail()}>
            Tentar novamente
          </Button>
        </div>
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
  const statusLabel = STATUS_LABELS[data.status] || data.status;
  const orderIsReadOnly =
    data.status === 'Draft' || data.status === 'Cancelled' || data.status === 'Closed';
  const billedBlockedReason = orderIsReadOnly
    ? 'Pedido não pode ser alterado neste status.'
    : data.per_billed !== undefined && data.per_billed >= 100
      ? 'Pedido já está faturado.'
      : undefined;
  const deliveredBlockedReason = orderIsReadOnly
    ? 'Pedido não pode ser alterado neste status.'
    : data.per_delivered !== undefined && data.per_delivered >= 100
      ? 'Pedido já está entregue.'
      : undefined;

  return (
    <PageShell>
      <PageHeader title={data.id} />

      <div className="space-y-3">
        <section
          className="rounded-lg border border-border-subtle bg-surface p-5"
          aria-labelledby="sales-order-customer-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="sales-order-customer-title" className="text-base font-semibold">
              Cliente
            </h2>
            <StatusBadge status={data.status} label={statusLabel} />
          </div>
          <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-sm font-medium">{data.customer_name || 'Cliente não identificado'}</p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">Data do pedido</p>
              <p className="mt-1 text-sm font-medium">
                {orderDate ? formatSalesOrderDate(orderDate) : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">Prazo de entrega</p>
              <p className="mt-1 text-sm font-medium">
                {data.delivery_date ? formatSalesOrderDate(data.delivery_date) : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">Origem</p>
              <p
                className={`mt-1 text-sm font-medium ${data.quotation_origin?.status === 'conflict' ? 'text-destructive' : ''}`}
              >
                {data.quotation_origin?.sourceLabel || data.source_quotation || 'Não informada'}
              </p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section
            className="min-w-0 rounded-lg border border-border-subtle bg-surface"
            aria-labelledby="sales-order-items-title"
          >
            <div className="px-5 py-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="sales-order-items-title" className="text-base font-semibold">
                  Itens do pedido
                </h2>
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

            <div className="border-t border-border-subtle px-5 py-4">
              <h2 className="text-base font-semibold">Andamento operacional</h2>
              <div
                role="region"
                aria-label="Progresso do pedido"
                className="mt-4 grid gap-4 sm:grid-cols-2"
              >
                <ProgressMetric label="Faturamento" value={data.per_billed} tone="success" />
                <ProgressMetric label="Entrega" value={data.per_delivered} tone="primary" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {billedBlockedReason && (
                  <span id="sales-order-billed-reason" className="sr-only">
                    {billedBlockedReason}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Marcar faturado"
                  aria-describedby={billedBlockedReason ? 'sales-order-billed-reason' : undefined}
                  title={billedBlockedReason}
                  disabled={Boolean(billedBlockedReason) || updating !== null}
                  onClick={() => void markProgress('billed')}
                >
                  <DollarSign size={14} aria-hidden="true" /> Marcar faturado
                </Button>
                {deliveredBlockedReason && (
                  <span id="sales-order-delivered-reason" className="sr-only">
                    {deliveredBlockedReason}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Marcar entregue"
                  aria-describedby={deliveredBlockedReason ? 'sales-order-delivered-reason' : undefined}
                  title={deliveredBlockedReason}
                  disabled={Boolean(deliveredBlockedReason) || updating !== null}
                  onClick={() => void markProgress('delivered')}
                >
                  <Truck size={14} aria-hidden="true" /> Marcar entregue
                </Button>
              </div>
              {actionError && (
                <p className="mt-3 text-sm text-destructive" role="alert">
                  {actionError}
                </p>
              )}
            </div>
          </section>

          <aside
            className="rounded-lg border border-border-subtle bg-sage p-5 text-page"
            aria-labelledby="sales-order-values-title"
          >
            <h2 id="sales-order-values-title" className="text-base font-semibold">
              Valores do pedido
            </h2>
            <div className="mt-4 border-t border-page/15 pt-4">
              <span className="text-xs opacity-75">Total</span>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {grandTotal === undefined ? '—' : formatBRL(grandTotal)}
              </p>
            </div>
            {data.source_quotation && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 w-full border-page/25 text-page hover:bg-page/10"
                onClick={() =>
                  navigate(`/quotations/${encodeURIComponent(data.source_quotation || '')}`)
                }
              >
                <FileText size={14} aria-hidden="true" /> Abrir orçamento {data.source_quotation}
              </Button>
            )}
            {data.status === 'Completed' && (
              <div className="mt-4 flex items-center gap-1.5 text-xs font-medium">
                <Check size={14} aria-hidden="true" />
                <span>Concluído</span>
              </div>
            )}
          </aside>
        </div>
      </div>
    </PageShell>
  );
}
