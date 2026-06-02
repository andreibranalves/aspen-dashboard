import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, ShoppingCart, TrendingUp, DollarSign, Package } from 'lucide-react';
import { apiGet } from '@/lib/api.js';
import { formatBRL } from '@/lib/formatters.js';
import { cn } from '@/lib/utils.js';
import PageHeader from '@/components/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table.jsx';

const STATUS_LABELS = {
  'Draft': 'Rascunho',
  'On Hold': 'Em espera',
  'To Pay': 'A pagar',
  'To Deliver and Bill': 'A entregar e faturar',
  'To Bill': 'A faturar',
  'To Deliver': 'A entregar',
  'Completed': 'Concluído',
  'Cancelled': 'Cancelado',
  'Closed': 'Fechado',
};

const PERIODS = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'month', label: 'Mês' },
];

const STATUSES = ['', 'Draft', 'On Hold', 'To Deliver and Bill', 'To Bill', 'To Deliver', 'Completed', 'Cancelled', 'Closed'];
const STATUS_DISPLAY = ['Todos', 'Rascunho', 'Em espera', 'A entregar e faturar', 'A faturar', 'A entregar', 'Concluído', 'Cancelado', 'Fechado'];

export default function SalesOrdersPage({ navigate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [period, setPeriod] = useState('30d');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [summary, setSummary] = useState(null);
  const [totalPages, setTotalPages] = useState(1);
  const searchTimer = useRef(null);

  // ── Fetch summary on mount ──────────────────────────────────────────────────
  useEffect(() => {
    apiGet('/sales-dashboard?period=30d').then(d => {
      if (d?.success) setSummary(d);
    }).catch(() => {});
  }, []);

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
      const data = await apiGet(`/sales-orders?${params}`);
      setItems(data.items || []);
      setTotalPages(data.has_more ? page + 1 : page);
    } catch (err) {
      setError(err.message || 'Erro ao carregar pedidos.');
    } finally {
      setLoading(false);
    }
  }, [page, limit, period, status, search]);

  // ── Initial load + refetch when filters change ──────────────────────────────
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // ── Debounced search ────────────────────────────────────────────────────────
  const onSearchChange = useCallback((e) => {
    const val = e.target.value;
    setSearchDraft(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(val);
      setPage(1);
    }, 350);
  }, []);

  // ── Period change ───────────────────────────────────────────────────────────
  const onPeriodChange = useCallback((p) => {
    setPeriod(p);
    setPage(1);
  }, []);

  // ── Status change ───────────────────────────────────────────────────────────
  const onStatusChange = useCallback((e) => {
    setStatus(e.target.value);
    setPage(1);
  }, []);

  // ── Limit change ────────────────────────────────────────────────────────────
  const onLimitChange = useCallback((e) => {
    const newLimit = parseInt(e.target.value, 10);
    setLimit(newLimit);
    setPage(1);
  }, []);

  // ── Format delivery info ────────────────────────────────────────────────────
  const formatDelivery = (item) => {
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

  // ── Format source quotation ─────────────────────────────────────────────────
  const formatSource = (item) => {
    if (item.source_quotation) {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/quotations/${encodeURIComponent(item.source_quotation)}`);
          }}
          className="text-framer-accent-blue hover:underline text-sm"
        >
          {item.source_quotation}
        </button>
      );
    }
    return <span className="text-muted-foreground">—</span>;
  };

  // ── Summary card component ──────────────────────────────────────────────────
  const SummaryCard = ({ icon: Icon, label, value, subtitle, colorClass }) => {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-framer-hairline bg-card p-4 shadow-sm flex-1 min-w-[160px]">
        <div className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          colorClass || 'bg-framer-surface-2 text-framer-ink-muted',
        )}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold text-framer-ink truncate">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
    );
  };

  const summaryData = summary?.summary;

  return (
    <div className="space-y-4 pb-28">
      {/* PageHeader */}
      <PageHeader
        title="Pedidos"
      />

      {/* Summary cards */}
      {summaryData && (
        <div className="flex flex-wrap gap-3">
          <SummaryCard
            icon={DollarSign}
            label="Receita"
            value={formatBRL(summaryData.revenue || 0)}
            subtitle={summaryData.revenue_delta_pct !== undefined
              ? `${summaryData.revenue_delta_pct >= 0 ? '+' : ''}${summaryData.revenue_delta_pct}% vs período anterior`
              : undefined}
            colorClass="bg-framer-success/10 text-framer-success"
          />
          <SummaryCard
            icon={ShoppingCart}
            label="Pedidos"
            value={String(summaryData.orders || 0)}
            colorClass="bg-framer-accent-blue/10 text-framer-accent-blue"
          />
          <SummaryCard
            icon={TrendingUp}
            label="Ticket Médio"
            value={formatBRL(summaryData.average_ticket || 0)}
            colorClass="bg-amber-500/10 text-amber-600"
          />
          <SummaryCard
            icon={Package}
            label="Pedidos em Aberto"
            value={String(summaryData.open_orders || 0)}
            colorClass="bg-purple-500/10 text-purple-600"
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
                  ? 'bg-framer-accent-blue text-white'
                  : 'bg-framer-surface-2 text-framer-ink-muted hover:text-framer-ink hover:bg-framer-surface-1',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Status select */}
        <select
          value={status}
          onChange={onStatusChange}
          className="border border-framer-hairline rounded-[10px] px-3 py-2 text-sm bg-framer-surface-1 text-framer-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
          aria-label="Filtrar por status"
        >
          {STATUSES.map((s, i) => (
            <option key={s} value={s}>{STATUS_DISPLAY[i]}</option>
          ))}
        </select>

        {/* Search */}
        <div className="relative max-w-md flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por Nº ou Cliente…"
            value={searchDraft}
            onChange={onSearchChange}
            className="pl-9"
            aria-label="Buscar pedidos"
          />
        </div>

        {/* Limit selector */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="whitespace-nowrap">Itens/página</span>
          <select
            value={limit}
            onChange={onLimitChange}
            className="border border-framer-hairline rounded-[10px] px-3 py-2 text-sm bg-framer-surface-1 text-framer-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
          >
            {[10, 25, 50, 100].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="rounded-lg border border-framer-hairline bg-card shadow-sm">
          <div className="p-8 space-y-4">
            <div className="h-4 w-48 bg-framer-surface-2 rounded animate-pulse" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 bg-framer-surface-2 rounded animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <p className="text-lg">Erro ao carregar pedidos</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={fetchOrders}>
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && items.length === 0 && (
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <ShoppingCart size={36} className="text-muted-foreground/40" />
          <p>Nenhum pedido encontrado</p>
          <p className="text-sm">Tente ajustar os filtros ou criar um novo pedido.</p>
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
                  className="cursor-pointer bg-card"
                  onClick={() => navigate(`/sales-orders/${encodeURIComponent(row.id)}`)}
                >
                  <TableCell className="font-mono text-sm">{row.id}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {row.date ? new Date(row.date).toLocaleDateString('pt-BR') : '—'}
                  </TableCell>
                  <TableCell>{row.customer_name || row.customer || '—'}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBRL(row.grand_total)}
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                      statusBadgeClass(row.status),
                    )}>
                      {STATUS_LABELS[row.status] || row.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDelivery(row)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatSource(row)}
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
              className="bg-card rounded-lg border border-border shadow-sm p-4 space-y-3 cursor-pointer"
              onClick={() => navigate(`/sales-orders/${encodeURIComponent(row.id)}`)}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm font-semibold truncate">{row.id}</span>
                <span className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                  statusBadgeClass(row.status),
                )}>
                  {STATUS_LABELS[row.status] || row.status}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-framer-ink truncate">{row.customer_name || row.customer || '—'}</span>
                <span className="text-muted-foreground text-xs">
                  {row.date ? new Date(row.date).toLocaleDateString('pt-BR') : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold">{formatBRL(row.grand_total)}</span>
                <div className="text-xs text-muted-foreground">
                  {formatDelivery(row)}
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Origem: {row.source_quotation ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/quotations/${encodeURIComponent(row.source_quotation)}`);
                    }}
                    className="text-framer-accent-blue hover:underline"
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
            <span className="text-sm text-muted-foreground px-2">
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

function statusBadgeClass(status) {
  const map = {
    'Draft': 'bg-framer-surface-2 text-framer-ink-muted',
    'On Hold': 'bg-amber-500/10 text-amber-600',
    'To Pay': 'bg-orange-500/10 text-orange-600',
    'To Deliver and Bill': 'bg-framer-accent-blue/10 text-framer-accent-blue',
    'To Bill': 'bg-purple-500/10 text-purple-600',
    'To Deliver': 'bg-cyan-500/10 text-cyan-600',
    'Completed': 'bg-framer-success/10 text-framer-success',
    'Cancelled': 'bg-framer-surface-2 text-framer-ink-muted/40 line-through',
    'Closed': 'bg-framer-surface-2 text-framer-ink-muted/50',
  };
  return map[status] || 'bg-framer-surface-2 text-framer-ink-muted';
}
