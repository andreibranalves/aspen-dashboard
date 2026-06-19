import { useState, useEffect, useCallback } from 'react';
import { BarChart3, TrendingUp, DollarSign, Package, Clock, ShoppingCart, Users, FileText, ExternalLink } from 'lucide-react';
import { apiGet } from '@/lib/api.js';
import { formatBRL, capitalize } from '@/lib/formatters.js';
import { cn } from '@/lib/utils.js';
import PageHeader from '@/components/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';

const PERIODS = [
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
  { key: 'month', label: 'Este mês' },
  { key: 'last_month', label: 'Mês passado' },
];

export default function DashboardPage({ navigate }) {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet(`/sales-dashboard?period=${period}`);
      setData(result);
    } catch (err) {
      setError(err.message || 'Erro ao carregar dashboard.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const deltaClass = (value) => {
    if (!value && value !== 0) return '';
    const num = Number(value);
    if (Number.isNaN(num)) return '';
    return num >= 0 ? 'text-success' : 'text-destructive';
  };

  const formatDelta = (value) => {
    if (!value && value !== 0) return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    const sign = num >= 0 ? '+' : '';
    return `${sign}${num.toFixed(1)}%`;
  };

  // ── Loading / Error states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in max-w-[1060px] mx-auto">
        <PageHeader
          title="Dashboard"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-surface rounded-lg border border-line shadow-sm p-5 space-y-3">
              <div className="h-4 w-24 bg-surface-muted rounded animate-pulse" />
              <div className="h-8 w-32 bg-surface-muted rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="bg-surface rounded-lg border border-line shadow-sm p-5 space-y-3">
          <div className="h-4 w-40 bg-surface-muted rounded animate-pulse" />
          <div className="h-6 w-full bg-surface-muted rounded animate-pulse" />
          <div className="h-6 w-full bg-surface-muted rounded animate-pulse" />
          <div className="h-6 w-full bg-surface-muted rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 animate-fade-in max-w-[1060px] mx-auto">
        <PageHeader
          title="Dashboard"
        />
        <div className="bg-surface rounded-lg border border-line shadow-sm p-5">
          <div className="flex items-center gap-3 text-destructive">
            <BarChart3 className="h-5 w-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Summary cards config ─────────────────────────────────────────────────────

  const summaryCards = [
    {
      icon: DollarSign,
      label: 'Total vendido',
      value: data?.summary?.total_revenue != null ? formatBRL(data.summary.total_revenue) : '—',
      delta: data?.summary?.revenue_delta,
    },
    {
      icon: ShoppingCart,
      label: 'Pedidos',
      value: data?.summary?.orders_count != null ? String(data.summary.orders_count) : '—',
      delta: data?.summary?.orders_delta,
    },
    {
      icon: TrendingUp,
      label: 'Ticket médio',
      value: data?.summary?.avg_ticket != null ? formatBRL(data.summary.avg_ticket) : '—',
      delta: data?.summary?.avg_ticket_delta,
    },
    {
      icon: Clock,
      label: 'Pedidos em aberto',
      value: data?.summary?.open_orders != null ? String(data.summary.open_orders) : '—',
      delta: null,
    },
    {
      icon: BarChart3,
      label: 'Conversão',
      value: data?.summary?.conversion_rate != null ? `${data.summary.conversion_rate}%` : '—',
      delta: data?.summary?.conversion_delta,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-[1060px] mx-auto">
      {/* ── Header ─────────────────────────────────────────────── */}
      <PageHeader
        title="Dashboard"
      />

      {/* ── Period filter chips ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              'px-3 py-1 text-xs rounded-full border transition-colors',
              period === p.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-transparent text-fg border-line hover:bg-primary/5'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Summary cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {summaryCards.map((card, idx) => (
          <div
            key={idx}
            className="bg-surface rounded-lg border border-line shadow-sm p-5 flex flex-col gap-2"
          >
            <div className="flex items-center gap-2 text-fg-muted">
              <card.icon className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-xs font-medium uppercase tracking-wider">
                {card.label}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-fg">
                {card.value}
              </span>
              {card.delta != null && (
                <span className={cn('text-xs font-medium', deltaClass(card.delta))}>
                  {formatDelta(card.delta)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Top Products + Top Clients (side by side on lg) ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── "O que vendeu" — Top Products ──────────────────────── */}
        <div className="bg-surface rounded-lg border border-line shadow-sm p-5">
          <h2 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            O que vendeu
          </h2>
          {data?.top_products?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">SKU</th>
                    <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Produto</th>
                    <th className="text-right py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Qtd</th>
                    <th className="text-right py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Receita</th>
                    <th className="text-right py-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Pedidos</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_products.map((p, i) => (
                    <tr key={p.sku || i} className="border-b border-line/50 last:border-0">
                      <td className="py-2 pr-2 text-fg-muted font-mono text-xs">{p.sku}</td>
                      <td className="py-2 pr-2 text-fg font-medium truncate max-w-[180px]">
                        {p.product || p.name}
                      </td>
                      <td className="py-2 pr-2 text-right text-fg">{p.quantity ?? p.qty}</td>
                      <td className="py-2 pr-2 text-right text-fg font-medium">
                        {formatBRL(p.revenue ?? p.total)}
                      </td>
                      <td className="py-2 text-right text-fg">{p.orders ?? p.order_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">Nenhum produto vendido no período.</p>
          )}
        </div>

        {/* ── "Top clientes" — Top Customers ─────────────────────── */}
        <div className="bg-surface rounded-lg border border-line shadow-sm p-5">
          <h2 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Top clientes
          </h2>
          {data?.top_customers?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Cliente</th>
                    <th className="text-right py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Receita</th>
                    <th className="text-right py-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Pedidos</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_customers.map((c, i) => (
                    <tr key={c.name || i} className="border-b border-line/50 last:border-0">
                      <td className="py-2 pr-2 text-fg font-medium truncate max-w-[240px]">
                        {capitalize(c.name || c.customer)}
                      </td>
                      <td className="py-2 pr-2 text-right text-fg font-medium">
                        {formatBRL(c.revenue ?? c.total)}
                      </td>
                      <td className="py-2 text-right text-fg">{c.orders ?? c.order_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">Nenhum cliente no período.</p>
          )}
        </div>
      </div>

      {/* ── "Vendas por dia" — Sales by Day ──────────────────────── */}
      <div className="bg-surface rounded-lg border border-line shadow-sm p-5">
        <h2 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Vendas por dia
        </h2>
        {data?.sales_by_day?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Data</th>
                  <th className="text-right py-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Receita</th>
                </tr>
              </thead>
              <tbody>
                {data.sales_by_day.map((d, i) => (
                  <tr key={d.date || i} className="border-b border-line/50 last:border-0">
                    <td className="py-2 pr-2 text-fg">{d.date}</td>
                    <td className="py-2 text-right text-fg font-medium">
                      {formatBRL(d.revenue ?? d.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">Nenhuma venda no período.</p>
        )}
      </div>

      {/* ── "Orçamentos para follow-up" — Stale Quotations ───────── */}
      <div className="bg-surface rounded-lg border border-line shadow-sm p-5">
        <h2 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          Orçamentos para follow-up
        </h2>
        {data?.stale_quotations?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Orçamento</th>
                  <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Cliente</th>
                  <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Idade</th>
                  <th className="text-right py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Valor</th>
                  <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Status</th>
                  <th className="text-right py-2 font-medium text-fg-muted text-xs uppercase tracking-wider">Ação</th>
                </tr>
              </thead>
              <tbody>
                {data.stale_quotations.map((q, i) => (
                  <tr key={q.id || i} className="border-b border-line/50 last:border-0">
                    <td className="py-2 pr-2">
                      <button
                        onClick={() => navigate(`/quotations/${encodeURIComponent(q.id)}`)}
                        className="text-primary hover:underline font-mono text-xs flex items-center gap-1"
                      >
                        {q.id}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </button>
                    </td>
                    <td className="py-2 pr-2 text-fg truncate max-w-[180px]">
                      {capitalize(q.customer || q.client)}
                    </td>
                    <td className="py-2 pr-2 text-fg-muted">há {q.age || q.days_old} dias</td>
                    <td className="py-2 pr-2 text-right text-fg font-medium">
                      {formatBRL(q.value ?? q.total)}
                    </td>
                    <td className="py-2 pr-2">
                      <span className="inline-block px-2 py-0.5 text-xs rounded-pill bg-primary/10 text-primary font-medium">
                        {q.status}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/quotations/${encodeURIComponent(q.id)}`)}
                      >
                        Abrir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">Nenhum orçamento parado no período.</p>
        )}
      </div>
    </div>
  );
}
