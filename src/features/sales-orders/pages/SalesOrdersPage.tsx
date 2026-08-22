import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
  type MouseEvent,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search, ShoppingCart, TrendingUp, DollarSign, Package, ChevronDown } from 'lucide-react';
import { apiGet } from '@/lib/api/api';
import { formatBRL } from '@/lib/formatting/formatters';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { projectSalesOrderListRow, type ProjectedSalesOrderListRow } from '@/lib/localProjections';
import { Button } from '@/components/ui/button';
import {
  parseHashAllowedInteger,
  parseHashOption,
  parseHashPositiveInteger,
  parseHashString,
  useHashQueryState,
} from '@/hooks/useHashQueryState';
import { Input } from '@/components/ui/input';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
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
  { value: 'month', label: 'Mês' },
];

const STATUSES = ['', 'Draft', 'To Deliver and Bill', 'To Bill', 'To Deliver', 'Completed', 'Cancelled', 'Closed'];
const STATUS_DISPLAY = ['Todos', 'Rascunho', 'A entregar e faturar', 'A faturar', 'A entregar', 'Concluído', 'Cancelado', 'Fechado'];
const parseSalesOrderPeriod = parseHashOption<string>(PERIODS.map((option) => option.value));
const parseSalesOrderStatus = parseHashOption<string>(STATUSES);
const parseSalesOrderLimit = parseHashAllowedInteger([10, 25, 50, 100]);

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
  if (response.success !== true || !response.summary || typeof response.summary !== 'object' || Array.isArray(response.summary)) return null;
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
    totalRevenue === null || ordersCount === null || avgTicket === null || openOrders === null ||
    conversionRate === null
  ) return null;
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

  const fetchSummary = useCallback(async () => {
    setSummary(null);
    setSummaryError(null);
    try {
      const response = await apiGet<unknown>('/sales-dashboard?period=30d');
      const projected = projectDashboardSummary(response);
      if (!projected) throw new Error('Resposta inválida ao carregar métricas de vendas.');
      setSummary(projected);
    } catch {
      setSummaryError('Não foi possível carregar as métricas de vendas. Tente novamente.');
    }
  }, []);

  // ── Fetch summary on mount ──────────────────────────────────────────────────
  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  // ── Fetch orders ────────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
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
      if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') {
        throw new Error('Resposta inválida ao carregar pedidos.');
      }
      const projectedRows = data.items.map(projectSalesOrderListRow);
      if (projectedRows.some((row): row is null => row === null)) {
        throw new Error('Resposta inválida ao carregar pedidos.');
      }
      setItems(projectedRows as SalesOrderItem[]);
      setTotalPages(data.has_more ? page + 1 : page);
    } catch (err) {
      setError((err as Error).message || 'Erro ao carregar pedidos.');
    } finally {
      setLoading(false);
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
    if (item.delivery_date) {
      const d = new Date(item.delivery_date);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('pt-BR');
      }
      return item.delivery_date;
    }
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

  // ── Summary card component ──────────────────────────────────────────────────
  interface SummaryCardProps {
    icon: LucideIcon;
    label: string;
    value: string;
    subtitle?: string;
    colorClass?: string;
  }

  const SummaryCard = ({ icon: Icon, label, value, subtitle, colorClass }: SummaryCardProps) => {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm flex-1 min-w-[160px]">
        <div className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          colorClass || 'bg-surface-muted text-fg-muted',
        )}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-fg-muted">{label}</p>
          <p className="text-lg font-semibold text-fg truncate">{value}</p>
          {subtitle && (
            <p className="text-xs text-fg-muted">{subtitle}</p>
          )}
        </div>
      </div>
    );
  };

  const summaryData = summary;

  return (
    <div className="space-y-4 pb-28 animate-fade-in max-w-[1060px] mx-auto">
      {/* PageHeader */}
      <PageHeader
        title="Pedidos"
        description={`Pedidos confirmados a partir de orçamentos convertidos no CRM — ${PERIODS.find((p) => p.value === period)?.label ?? period}.`}
      />

      {/* Summary cards */}
      {summaryError && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-surface px-4 py-6 text-fg-muted" role="alert">
          <p className="text-sm text-destructive">Erro ao carregar métricas de vendas</p>
          <p className="text-sm">{summaryError}</p>
          <Button variant="outline" onClick={() => void fetchSummary()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {summaryData && (
        <div className="flex flex-wrap gap-3">
          <SummaryCard
            icon={DollarSign}
            label="Receita"
            value={formatBRL(summaryData.total_revenue)}
            subtitle={summaryData.revenue_delta === null || (summaryData.revenue_delta === 0 && !summaryData.total_revenue) ? 'vs período anterior' : summaryData.revenue_delta === 0 ? 'sem variação vs período anterior' : `${summaryData.revenue_delta > 0 ? '+' : ''}${summaryData.revenue_delta}% vs período anterior`}
            colorClass="bg-success/10 text-success"
          />
          <SummaryCard
            icon={ShoppingCart}
            label="Pedidos"
            value={String(summaryData.orders_count)}
            colorClass="bg-primary/10 text-primary"
          />
          <SummaryCard
            icon={TrendingUp}
            label="Ticket Médio"
            value={summaryData.orders_count === 0 ? '—' : formatBRL(summaryData.avg_ticket)}
            subtitle={summaryData.avg_ticket_delta === null || (summaryData.avg_ticket_delta === 0 && !summaryData.avg_ticket) ? 'vs período anterior' : summaryData.avg_ticket_delta === 0 ? 'sem variação vs período anterior' : `${summaryData.avg_ticket_delta > 0 ? '+' : ''}${summaryData.avg_ticket_delta}% vs período anterior`}
            colorClass="tone-warning-soft"
          />
          <SummaryCard
            icon={Package}
            label="Pedidos em Aberto"
            value={String(summaryData.open_orders)}
            colorClass="tone-info-soft"
          />
        </div>
      )}

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Period chips */}
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => onPeriodChange(p.value)}
              className={cn(
                'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors',
                period === p.value
                  ? 'bg-primary text-on-solid'
                  : 'bg-surface-muted text-fg-muted hover:text-fg hover:bg-surface',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Status select */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-fg-muted whitespace-nowrap">Status</span>
          <div className="relative">
          <select
            aria-labelledby="order-status-label"
            value={status}
            onChange={onStatusChange}
            className="appearance-none border border-line rounded-full pl-3 pr-8 py-1.5 text-sm bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
            title="Status do pedido"
          >
            {STATUSES.map((s, i) => (
              <option key={s} value={s}>{STATUS_DISPLAY[i]}</option>
            ))}
          </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          </div>
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
          <select
            value={limit}
            onChange={onLimitChange}
            className="border border-line rounded-[10px] px-3 py-2 text-sm bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            {[10, 25, 50, 100].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading */}
      {loading && <SkeletonTable cols={7} rows={8} />}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <p className="text-lg">Erro ao carregar pedidos</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={fetchOrders}>
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && items.length === 0 && (
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <ShoppingCart size={36} className="text-fg-muted/40" />
          <p>{search ? 'Nenhum pedido encontrado para a busca.' : status !== 'todos' ? 'Nenhum pedido com esse status.' : 'Os pedidos aparecem aqui quando um orçamento é convertido no CRM.'}</p>
          <p className="text-sm">Os pedidos aparecem aqui quando um orçamento é convertido no CRM.</p>
          <Button variant="outline" onClick={() => navigate('/quotations')}>
            Ver orçamentos
          </Button>
        </div>
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
              {items.map(row => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer bg-surface"
                  onClick={() => navigate(`/sales-orders/${encodeURIComponent(row.id)}`)}
                >
                  <TableCell className="font-mono text-sm">{row.id}</TableCell>
                  <TableCell className="whitespace-nowrap text-fg-muted">
                    {row.date ? new Date(row.date).toLocaleDateString('pt-BR') : '—'}
                  </TableCell>
                  <TableCell>{row.customer_name || 'Cliente não identificado'}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBRL(row.grand_total)}
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                      statusBadgeClass(row.status),
                    )}>
                      {STATUS_LABELS[row.status || ''] || 'Status desconhecido'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-fg-muted">
                    {formatDelivery(row)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatQuotation(row)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Mobile Cards (hidden on md+) ── */}
      {!loading && !error && items.length > 0 && (
        <div className="md:hidden space-y-3">
          {items.map(row => (
            <div
              key={row.id}
              className="bg-surface rounded-lg border border-line shadow-sm p-4 space-y-3 cursor-pointer"
              onClick={() => navigate(`/sales-orders/${encodeURIComponent(row.id)}`)}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm font-semibold truncate">{row.id}</span>
                <span className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                  statusBadgeClass(row.status),
                )}>
                  {STATUS_LABELS[row.status || ''] || 'Status desconhecido'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg truncate">{row.customer_name || 'Cliente não identificado'}</span>
                <span className="text-fg-muted text-xs">
                  {row.date ? new Date(row.date).toLocaleDateString('pt-BR') : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold">{formatBRL(row.grand_total)}</span>
                <div className="text-xs text-fg-muted">
                  {formatDelivery(row)}
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span>Orçamento relacionado: {row.source_quotation ? (
                  <button
                    onClick={(e: MouseEvent<HTMLButtonElement>) => {
                      e.stopPropagation();
                      navigate(`/quotations/${encodeURIComponent(row.source_quotation || '')}`);
                    }}
                    className="text-primary hover:underline"
                  >
                    {row.source_quotation}
                  </button>
                ) : '—'}</span>
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
              onClick={() => setPage(p => Math.max(1, p - 1))}
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
              onClick={() => setPage(p => p + 1)}
            >
              Próximo ›
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusBadgeClass(status: string | undefined): string {
  const map: Record<string, string> = {
    'Draft': 'bg-surface-muted text-fg-muted',
    'To Deliver and Bill': 'bg-primary/10 text-primary',
    'To Bill': 'tone-info-soft',
    'To Deliver': 'tone-info-soft',
    'Completed': 'bg-success/10 text-success',
    'Cancelled': 'bg-surface-muted text-fg-muted/40 line-through',
    'Closed': 'bg-surface-muted text-fg-muted/50',
  };
  return map[status || ''] || 'bg-surface-muted text-fg-muted';
}
