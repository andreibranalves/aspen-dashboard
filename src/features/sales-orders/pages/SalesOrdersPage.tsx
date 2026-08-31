import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Search, ShoppingCart, TrendingUp, DollarSign, Package, AlertTriangle } from 'lucide-react';
import { apiGet } from '@/lib/api/api';
import { formatBRL, formatDate } from '@/lib/formatting/formatters';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import PageToolbar from '@/components/shared/PageToolbar';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { projectSalesOrderListRow, type ProjectedSalesOrderListRow } from '@/lib/localProjections';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { FilterChip } from '@/components/ui/filter-chip';
import { Select } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  parseHashAllowedInteger,
  parseHashOption,
  parseHashPositiveInteger,
  parseHashString,
  useHashQueryState,
} from '@/hooks/useHashQueryState';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

const STATUS_LABELS: Record<string, string> = {
  Draft: 'Rascunho',
  'To Deliver and Bill': 'A entregar e faturar',
  'To Bill': 'A faturar',
  'To Deliver': 'A entregar',
  Completed: 'Concluído',
  Cancelled: 'Cancelado',
  Closed: 'Fechado',
};

interface PeriodOption {
  value: string;
  label: string;
}

const PERIODS: PeriodOption[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'month', label: 'Mês atual' },
];

const STATUSES = [
  '',
  'Draft',
  'To Deliver and Bill',
  'To Bill',
  'To Deliver',
  'Completed',
  'Cancelled',
  'Closed',
];
const STATUS_DISPLAY = [
  'Todos',
  'Rascunho',
  'A entregar e faturar',
  'A faturar',
  'A entregar',
  'Concluído',
  'Cancelado',
  'Fechado',
];
const parseSalesOrderPeriod = parseHashOption<string>(PERIODS.map((option) => option.value));
const parseSalesOrderStatus = parseHashOption<string>(STATUSES);
const parseSalesOrderLimit = parseHashAllowedInteger([10, 25, 50, 100]);

function formatSalesOrderDate(value: string): string {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return dateOnly ? `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}` : formatDate(value);
}

interface SalesOrdersPageProps {
  navigate: (path: string) => void;
}

interface DashboardSummary {
  total_revenue: number;
  revenue_delta: number | null;
  orders_count: number;
  orders_delta: number | null;
  avg_ticket: number;
  avg_ticket_delta: number | null;
  open_orders: number;
  conversion_rate: number;
  conversion_delta: number | null;
}

type SalesOrderItem = ProjectedSalesOrderListRow;

interface OrdersResponse {
  items?: unknown;
  has_more?: unknown;
}

function projectDashboardSummary(value: unknown): DashboardSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (
    response.success !== true ||
    !response.summary ||
    typeof response.summary !== 'object' ||
    Array.isArray(response.summary)
  )
    return null;
  const summary = response.summary as Record<string, unknown>;
  const money = (field: unknown): number | null =>
    typeof field === 'number' && Number.isFinite(field) && field >= 0 ? field : null;
  const count = (field: unknown): number | null =>
    typeof field === 'number' && Number.isSafeInteger(field) && field >= 0 ? field : null;
  const delta = (field: unknown): number | null =>
    typeof field === 'number' && Number.isFinite(field) ? field : null;
  const totalRevenue = money(summary.total_revenue);
  const ordersCount = count(summary.orders_count);
  const avgTicket = money(summary.avg_ticket);
  const openOrders = count(summary.open_orders);
  const conversionRate = delta(summary.conversion_rate);
  // Sem período anterior comparável o backend envia o delta como null — o
  // resumo continua válido; a UI apenas omite a linha de delta.
  const revenueDelta = delta(summary.revenue_delta);
  const ordersDelta = delta(summary.orders_delta);
  const avgTicketDelta = delta(summary.avg_ticket_delta);
  const conversionDelta = delta(summary.conversion_delta);
  if (
    totalRevenue === null ||
    ordersCount === null ||
    avgTicket === null ||
    openOrders === null ||
    conversionRate === null ||
    conversionRate < 0 ||
    conversionRate > 1
  )
    return null;
  return {
    total_revenue: totalRevenue,
    revenue_delta: revenueDelta,
    orders_count: ordersCount,
    orders_delta: ordersDelta,
    avg_ticket: avgTicket,
    avg_ticket_delta: avgTicketDelta,
    open_orders: openOrders,
    conversion_rate: conversionRate,
    conversion_delta: conversionDelta,
  };
}

export default function SalesOrdersPage({ navigate }: SalesOrdersPageProps) {
  const [items, setItems] = useState<SalesOrderItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useHashQueryState('page', 1, parseHashPositiveInteger);
  const [limit, setLimit] = useHashQueryState('limit', 10, parseSalesOrderLimit);
  const [period, setPeriod] = useHashQueryState('period', '30d', parseSalesOrderPeriod);
  const [status, setStatus] = useHashQueryState('status', '', parseSalesOrderStatus);
  const [search, setSearch] = useHashQueryState('search', '', parseHashString);
  const [searchDraft, setSearchDraft] = useHashQueryState('searchDraft', search, parseHashString);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState<number>(1);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGenerationRef = useRef(0);
  const summaryRequestGenerationRef = useRef(0);

  const fetchSummary = useCallback(async () => {
    const requestGeneration = ++summaryRequestGenerationRef.current;
    setSummary(null);
    setSummaryError(null);
    try {
      const response = await apiGet<unknown>('/sales-dashboard?period=30d');
      if (requestGeneration !== summaryRequestGenerationRef.current) return;
      const projected = projectDashboardSummary(response);
      if (!projected) throw new Error('Resposta inválida ao carregar métricas de vendas.');
      setSummary(projected);
    } catch {
      if (requestGeneration !== summaryRequestGenerationRef.current) return;
      setSummaryError('Não foi possível carregar as métricas de vendas. Tente novamente.');
    }
  }, []);

  // ── Fetch summary on mount ──────────────────────────────────────────────────
  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  // ── Fetch orders ────────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (period) params.set('period', period);
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      const data = await apiGet<OrdersResponse>(`/sales-orders?${params}`);
      if (requestGeneration !== requestGenerationRef.current) return;
      if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') {
        throw new Error('Resposta inválida ao carregar pedidos.');
      }
      const projectedRows = data.items.map(projectSalesOrderListRow);
      if (projectedRows.some((row): row is null => row === null)) {
        throw new Error('Resposta inválida ao carregar pedidos.');
      }
      setItems(projectedRows as SalesOrderItem[]);
      setTotalPages(data.has_more ? page + 1 : page);
    } catch {
      if (requestGeneration !== requestGenerationRef.current) return;
      setError('Não foi possível carregar os pedidos. Tente novamente.');
    } finally {
      if (requestGeneration === requestGenerationRef.current) setLoading(false);
    }
  }, [page, limit, period, status, search]);

  // ── Initial load + refetch when filters change ──────────────────────────────
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // ── Debounced search ────────────────────────────────────────────────────────
  const onSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchDraft(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(val);
      setPage(1);
    }, 350);
  }, []);

  // ── Period change ───────────────────────────────────────────────────────────
  const onPeriodChange = useCallback((p: string) => {
    setPeriod(p);
    setPage(1);
  }, []);

  // ── Status change ───────────────────────────────────────────────────────────
  const onStatusChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setStatus(e.target.value);
    setPage(1);
  }, []);

  // ── Limit change ────────────────────────────────────────────────────────────
  const onLimitChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    const newLimit = parseInt(e.target.value, 10);
    setLimit(newLimit);
    setPage(1);
  }, []);

  // ── Format delivery info ────────────────────────────────────────────────────
  const formatDelivery = (item: SalesOrderItem) => {
    if (item.delivery_date) return formatSalesOrderDate(item.delivery_date);
    if (item.per_delivered !== undefined && item.per_delivered !== null) {
      return `${item.per_delivered}% entregue`;
    }
    return '—';
  };

  // ── Format local quotation relation ──────────────────────────────────────────
  const formatQuotation = (item: SalesOrderItem) => {
    if (item.source_quotation) {
      return (
        <button
          type="button"
          onClick={(e: MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            navigate(`/quotations/${encodeURIComponent(item.source_quotation!)}`);
          }}
          className="text-primary hover:underline text-sm"
        >
          {item.source_quotation}
        </button>
      );
    }
    return <span className="text-fg-muted">—</span>;
  };

  const clearFilters = useCallback(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearch('');
    setSearchDraft('');
    setStatus('');
    setPeriod('30d');
    setPage(1);
  }, []);
  const hasListFilters = Boolean(search || status || period !== '30d');
  const summaryData = summary;

  return (
    <PageShell>
      {/* PageHeader */}
      <PageHeader title="Pedidos" />

      {/* Summary cards */}
      {summaryError && (
        <div
          className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-surface px-4 py-6 text-fg-muted"
          role="alert"
        >
          <p className="text-sm text-destructive">Erro ao carregar métricas de vendas</p>
          <p className="text-sm">{summaryError}</p>
          <Button variant="outline" onClick={() => void fetchSummary()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {summaryData && (
        <div className="flex flex-wrap gap-3">
          <StatCard
            icon={DollarSign}
            label="Receita"
            className="flex-1"
            value={summaryData.orders_count === 0 ? '—' : formatBRL(summaryData.total_revenue)}
            metadata={
              summaryData.revenue_delta === null ||
              (summaryData.revenue_delta === 0 && !summaryData.total_revenue)
                ? undefined
                : summaryData.revenue_delta === 0
                  ? 'sem variação vs período anterior'
                  : `${summaryData.revenue_delta > 0 ? '+' : ''}${summaryData.revenue_delta}% vs período anterior`
            }
          />
          <StatCard
            icon={ShoppingCart}
            label="Pedidos"
            className="flex-1"
            value={String(summaryData.orders_count)}
          />
          <StatCard
            icon={TrendingUp}
            label="Ticket Médio"
            className="flex-1"
            value={summaryData.orders_count === 0 ? '—' : formatBRL(summaryData.avg_ticket)}
            metadata={
              summaryData.avg_ticket_delta === null ||
              (summaryData.avg_ticket_delta === 0 && !summaryData.avg_ticket)
                ? undefined
                : summaryData.avg_ticket_delta === 0
                  ? 'sem variação vs período anterior'
                  : `${summaryData.avg_ticket_delta > 0 ? '+' : ''}${summaryData.avg_ticket_delta}% vs período anterior`
            }
          />
          <StatCard
            icon={Package}
            label="Pedidos em aberto"
            className="flex-1"
            value={String(summaryData.open_orders)}
          />
        </div>
      )}

      {/* Filter row */}
      <PageToolbar>
        {/* Period chips */}
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <FilterChip
              key={p.value}
              selected={period === p.value}
              onClick={() => onPeriodChange(p.value)}
            >
              {p.label}
            </FilterChip>
          ))}
        </div>

        {/* Status select */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-fg-muted whitespace-nowrap">Status</span>
          <span id="order-status-label" className="sr-only">
            Status do pedido
          </span>
          <Select
            aria-labelledby="order-status-label"
            value={status}
            onChange={onStatusChange}
            title="Status do pedido"
          >
            {STATUSES.map((s, i) => (
              <option key={s} value={s}>
                {STATUS_DISPLAY[i]}
              </option>
            ))}
          </Select>
        </div>

        {/* Search */}
        <div className="relative max-w-md flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <Input
            placeholder="Buscar por Nº ou Cliente…"
            value={searchDraft}
            onChange={onSearchChange}
            className="pl-9"
            aria-label="Buscar pedidos"
          />
        </div>

        {/* Limit selector */}
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <span className="whitespace-nowrap">Itens por página</span>
          <Select value={limit} onChange={onLimitChange} aria-label="Itens por página">
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
      </PageToolbar>

      {/* Loading */}
      {loading && <SkeletonTable cols={7} rows={8} />}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <AlertTriangle size={32} className="text-destructive/60" aria-hidden="true" />
          <p>Erro ao carregar pedidos</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={fetchOrders}>
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && items.length === 0 && (
        <EmptyState
          icon={ShoppingCart}
          title={
            hasListFilters
              ? 'Nenhum pedido corresponde aos filtros.'
              : 'Os pedidos aparecem aqui quando um orçamento é convertido no CRM.'
          }
          description={
            hasListFilters
              ? 'Revise o período, status ou busca para consultar outros pedidos.'
              : undefined
          }
          actions={
            <>
              {hasListFilters && (
                <Button variant="outline" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              )}
              <Button asChild>
                <a href="#/manual">Novo orçamento</a>
              </Button>
              <Button variant="outline" onClick={() => navigate('/quotations')}>
                Ver orçamentos
              </Button>
            </>
          }
        />
      )}

      {/* ── Desktop Table (hidden on small screens) ── */}
      {!loading && !error && items.length > 0 && (
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Pedido</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Entrega</TableHead>
                <TableHead>Origem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer bg-surface"
                  tabIndex={0}
                  aria-label={`Abrir pedido ${row.id}`}
                  onClick={() => navigate(`/sales-orders/${encodeURIComponent(row.id)}`)}
                  onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    const target = event.target as HTMLElement;
                    if (target.closest('button, a, input, select')) return;
                    event.preventDefault();
                    navigate(`/sales-orders/${encodeURIComponent(row.id)}`);
                  }}
                >
                  <TableCell className="font-mono text-sm">{row.id}</TableCell>
                  <TableCell className="whitespace-nowrap text-fg-muted">
                    {row.date ? formatSalesOrderDate(row.date) : '—'}
                  </TableCell>
                  <TableCell>{row.customer_name || 'Cliente não identificado'}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBRL(row.grand_total)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={row.status || ''}
                      label={STATUS_LABELS[row.status || ''] || 'Status desconhecido'}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-fg-muted">{formatDelivery(row)}</TableCell>
                  <TableCell className="text-sm">{formatQuotation(row)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Mobile Cards (hidden on md+) ── */}
      {!loading && !error && items.length > 0 && (
        <div className="md:hidden space-y-3">
          {items.map((row) => (
            <div
              key={row.id}
              className="bg-surface rounded-lg border border-line shadow-sm p-4 space-y-3 cursor-pointer"
              tabIndex={0}
              role="link"
              aria-label={`Abrir pedido ${row.id}`}
              onClick={() => navigate(`/sales-orders/${encodeURIComponent(row.id)}`)}
              onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const target = event.target as HTMLElement;
                if (target.closest('button, a, input, select')) return;
                event.preventDefault();
                navigate(`/sales-orders/${encodeURIComponent(row.id)}`);
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm font-semibold truncate">{row.id}</span>
                <StatusBadge
                  status={row.status || ''}
                  label={STATUS_LABELS[row.status || ''] || 'Status desconhecido'}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg truncate">
                  {row.customer_name || 'Cliente não identificado'}
                </span>
                <span className="text-fg-muted text-xs">
                  {row.date ? formatSalesOrderDate(row.date) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold">{formatBRL(row.grand_total)}</span>
                <div className="text-xs text-fg-muted">{formatDelivery(row)}</div>
              </div>
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span>
                  Orçamento relacionado:{' '}
                  {row.source_quotation ? (
                    <button
                      type="button"
                      onClick={(e: MouseEvent<HTMLButtonElement>) => {
                        e.stopPropagation();
                        navigate(`/quotations/${encodeURIComponent(row.source_quotation || '')}`);
                      }}
                      className="text-primary hover:underline"
                    >
                      {row.source_quotation}
                    </button>
                  ) : (
                    '—'
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && items.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            Página {page} de {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹ Anterior
            </Button>
            <span className="text-sm text-fg-muted px-2">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próximo ›
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
