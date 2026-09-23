import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { ShoppingCart, TrendingUp, DollarSign, Package, AlertTriangle, ChevronRight } from 'lucide-react';
import { apiGet } from '@/lib/api/api';
import { formatBRL, formatDate } from '@/lib/formatting/formatters';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import PageToolbar from '@/components/shared/PageToolbar';
import ListPagination from '@/components/shared/ListPagination';
import EntityIdentity from '@/components/shared/EntityIdentity';
import ExportCsvButton from '@/components/shared/ExportCsvButton';
import SkeletonTable from '@/components/shared/SkeletonTable';
import Skeleton from '@/components/shared/Skeleton';
import { projectSalesOrderListRow, type ProjectedSalesOrderListRow } from '@/lib/localProjections';
import { Button } from '@/components/ui/button';
import { SearchField } from '@/components/ui/search-field';
import { StatusBadge } from '@/components/ui/badge';
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
  summaryLabel: string;
}

const PERIODS: PeriodOption[] = [
  { value: 'today', label: 'Hoje', summaryLabel: 'Hoje' },
  { value: '7d', label: '7d', summaryLabel: 'Últimos 7 dias' },
  { value: '30d', label: '30d', summaryLabel: 'Últimos 30 dias' },
  { value: '90d', label: '90d', summaryLabel: 'Últimos 90 dias' },
  { value: 'month', label: 'Mês atual', summaryLabel: 'Mês atual' },
];

const STATUSES = [
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

function formatSummaryDelta(value: number | null, amount: number): string | undefined {
  if (value === null) return undefined;
  if (value === 0 && amount === 0) return undefined;
  if (value === 0) return 'sem variação vs. período anterior';
  return `${value > 0 ? '+' : ''}${value}% vs. período anterior`;
}

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
    conversionRate < 0
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

function SalesOrderExportMenu({
  period,
  status,
  search,
}: {
  period: string;
  status: string;
  search: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    });
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        dismiss(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss(true);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [dismiss, open]);

  return (
    <div className="relative w-full sm:w-auto">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        aria-expanded={open}
        aria-controls="sales-order-export-menu"
        onClick={() => setOpen((current) => !current)}
      >
        Exportar <span aria-hidden="true">▾</span>
      </Button>
      <div
        ref={menuRef}
        id="sales-order-export-menu"
        hidden={!open}
        aria-label="Exportar dados"
        className={`absolute left-0 top-full z-20 mt-2 w-60 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-control border border-line bg-surface p-2 shadow-lg sm:left-auto sm:right-0 ${open ? 'flex' : 'hidden'}`}
      >
        <ExportCsvButton
          resource="sales-orders"
          filters={{ period, status, search }}
          className="w-full justify-start"
        >
          Exportar pedidos
        </ExportCsvButton>
        <ExportCsvButton
          resource="sales-order-items"
          filters={{ period, status, search }}
          className="w-full justify-start"
        >
          Exportar itens
        </ExportCsvButton>
      </div>
    </div>
  );
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
  const [hasMore, setHasMore] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGenerationRef = useRef(0);
  const summaryRequestGenerationRef = useRef(0);

  const fetchSummary = useCallback(async () => {
    const requestGeneration = ++summaryRequestGenerationRef.current;
    setSummary(null);
    setSummaryError(null);
    try {
      const response = await apiGet<unknown>(`/sales-dashboard?period=${encodeURIComponent(period)}`);
      if (requestGeneration !== summaryRequestGenerationRef.current) return;
      const projected = projectDashboardSummary(response);
      if (!projected) throw new Error('Resposta inválida ao carregar métricas de vendas.');
      setSummary(projected);
    } catch {
      if (requestGeneration !== summaryRequestGenerationRef.current) return;
      setSummaryError('Não foi possível carregar as métricas de vendas. Tente novamente.');
    }
  }, [period]);

  // ── Fetch summary when the period changes ──────────────────────────────────
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
      setHasMore(data.has_more);
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

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

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
    setSummary(null);
    setSummaryError(null);
    setPeriod(p);
    setPage(1);
  }, []);

  // ── Status change ───────────────────────────────────────────────────────────
  const onStatusChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setStatus(e.target.value);
    setPage(1);
  }, []);

  // ── Limit change ────────────────────────────────────────────────────────────
  const onLimitChange = useCallback((newLimit: number) => {
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
          className="text-link text-sm hover:underline"
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
    setSummary(null);
    setSummaryError(null);
    setPeriod('30d');
    setPage(1);
  }, []);
  const hasListFilters = Boolean(search || status || period !== '30d');
  const summaryData = summary;
  const summaryLoading = !summaryData && !summaryError;
  const summaryPeriodLabel = PERIODS.find((option) => option.value === period)?.summaryLabel ?? 'Últimos 30 dias';

  return (
    <PageShell>
      {/* PageHeader */}
      <PageHeader
        title="Pedidos"
        actions={<SalesOrderExportMenu period={period} status={status} search={search} />}
      />

      {(summaryData || summaryLoading) && (
        <section aria-label={`Resumo comercial: ${summaryPeriodLabel.toLowerCase()}`} aria-busy={summaryLoading} className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-fg-muted">
            {summaryPeriodLabel}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryLoading
              ? Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-[145px] rounded-card" />
                ))
              : summaryData && (
                  <>
                    <StatCard
                      icon={ShoppingCart}
                      label="Pedidos"
                      value={String(summaryData.orders_count)}
                      metadata={
                        summaryData.orders_count === 0 ? undefined : `${summaryData.orders_count} no período`
                      }
                      className="border-border-subtle bg-surface"
                    />
                    <StatCard
                      icon={DollarSign}
                      label="Receita"
                      value={summaryData.orders_count === 0 ? '—' : formatBRL(summaryData.total_revenue)}
                      metadata={formatSummaryDelta(summaryData.revenue_delta, summaryData.total_revenue)}
                      className="border-border-subtle bg-surface"
                    />
                    <StatCard
                      icon={Package}
                      label="Em aberto"
                      value={String(summaryData.open_orders)}
                      className="border-border-subtle bg-surface"
                    />
                    <StatCard
                      icon={TrendingUp}
                      label="Ticket médio"
                      value={summaryData.orders_count === 0 ? '—' : formatBRL(summaryData.avg_ticket)}
                      metadata={formatSummaryDelta(summaryData.avg_ticket_delta, summaryData.avg_ticket)}
                      className="border-border-subtle bg-surface"
                    />
                  </>
                )}
          </div>
        </section>
      )}
      {!summaryData && summaryError && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-destructive/30 bg-surface px-4 py-3"
          role="alert"
        >
          <p className="text-sm text-destructive">
            Não foi possível carregar o resumo comercial.
          </p>
          <Button variant="outline" size="sm" onClick={() => void fetchSummary()}>
            Tentar novamente
          </Button>
        </div>
      )}

      <section className="rounded-card bg-surface p-5" aria-label="Lista de pedidos">
      <PageToolbar className="mb-5">
        <SearchField
          placeholder="Buscar pedido ou cliente"
          value={searchDraft}
          onChange={onSearchChange}
          aria-label="Buscar pedidos"
        />

        {/* Status select */}
        <label className="flex w-full min-w-0 sm:w-auto">
          <Select
            aria-label="Filtrar por status"
            value={status}
            onChange={onStatusChange}
            title="Status do pedido"
            className="w-full sm:min-w-40"
          >
            {STATUSES.map((s, i) => (
              <option key={s} value={s}>
                {STATUS_DISPLAY[i]}
              </option>
            ))}
          </Select>
        </label>

        {/* Period select */}
        <label className="flex w-full min-w-0 sm:ml-auto sm:w-auto">
          <Select
            aria-label="Filtrar por período"
            value={period}
            onChange={(event) => onPeriodChange(event.target.value)}
            className="w-full sm:min-w-28"
          >
            {PERIODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      </PageToolbar>

      {/* Loading */}
      {loading && <SkeletonTable cols={5} rows={8} size="lg" />}

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
                <a href="#/novo-orcamento">Novo orçamento</a>
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
          <Table className="min-w-[730px]" containerClassName="rounded-none">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Pedido</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  aria-label={`Abrir pedido ${row.id}`}
                  onClick={() => navigate(`/sales-orders/${encodeURIComponent(row.id)}`)}
                >
                  <TableCell className="py-4 text-xs font-semibold">
                    <div>{row.id}</div>
                    <div className="mt-1 text-[11px] font-normal text-fg-muted">{row.source_quotation ? formatQuotation(row) : 'Sem orçamento de origem'}</div>
                  </TableCell>
                  <TableCell className="py-4">
                    <EntityIdentity name={row.customer_name || 'Cliente não identificado'} />
                  </TableCell>
                  <TableCell className="py-4 text-fg-muted">{row.date ? formatSalesOrderDate(row.date) : '—'}</TableCell>
                  <TableCell className="py-4">
                    <StatusBadge
                      status={row.status || ''}
                      label={STATUS_LABELS[row.status || ''] || 'Status desconhecido'}
                    />
                  </TableCell>
                  <TableCell className="py-4 text-right font-sans tabular-nums">
                    {formatBRL(row.grand_total)}
                  </TableCell>
                  <TableCell className="py-4 text-right text-fg-muted"><ChevronRight size={16} aria-hidden="true" /></TableCell>
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
              className="bg-surface rounded-card border border-line shadow-sm p-4 space-y-3 cursor-pointer"
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
                <span className="font-sans font-semibold tabular-nums">{formatBRL(row.grand_total)}</span>
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
                      className="text-link hover:underline"
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
        <ListPagination label="Paginação de pedidos" page={page} limit={limit} pageSizes={[10, 25, 50, 100]} hasNext={hasMore} onPageChange={setPage} onLimitChange={onLimitChange} />
      )}

      </section>

    </PageShell>
  );
}
