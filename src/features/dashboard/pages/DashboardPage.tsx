import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Clock,
  DollarSign,
  ExternalLink,
  Package,
  ShoppingCart,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { quotationStatusLabel, quotationStatusBadgeKey } from '@/lib/statusLabels';
import { apiGet } from '@/lib/api/api';
import { formatBRL, formatDate, capitalize } from '@/lib/formatting/formatters';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { FilterChip } from '@/components/ui/filter-chip';
import { StatCard } from '@/components/ui/stat-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  projectDashboardView,
  type DashboardViewData,
} from '@/features/dashboard/dashboardViewModel';
import { parseHashOption, useHashQueryState } from '@/hooks/useHashQueryState';

interface PeriodOption {
  key: string;
  label: string;
}

const PERIODS: PeriodOption[] = [
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
  { key: 'month', label: 'Este mês' },
  { key: 'last_month', label: 'Mês passado' },
];
const parseDashboardPeriod = parseHashOption<string>(PERIODS.map((period) => period.key));

interface DashboardPageProps {
  navigate: (path: string) => void;
}

interface SummaryCard {
  icon: LucideIcon;
  label: string;
  value: string;
  delta: number | null;
}

function Unavailable({ children = 'Dados não disponíveis no momento.' }: { children?: ReactNode }) {
  return <p className="py-6 text-sm text-fg-muted">{children}</p>;
}

function OmittedRowsNote({ omitted }: { omitted: number }) {
  if (!omitted) return null;
  return (
    <p className="mt-3 text-xs text-fg-muted">
      {omitted} {omitted === 1 ? 'registro não foi exibido' : 'registros não foram exibidos'} por
      falta de dados confirmados.
    </p>
  );
}

function formatDashboardDate(value: string): string {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return dateOnly ? `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}` : formatDate(value);
}

export default function DashboardPage({ navigate }: DashboardPageProps) {
  const [period, setPeriod] = useHashQueryState('period', '30d', parseDashboardPeriod);
  const [data, setData] = useState<DashboardViewData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await apiGet<unknown>(`/sales-dashboard?period=${period}`);
      const projected = projectDashboardView(result);
      if (!projected) throw new Error('Resposta inválida ao carregar o dashboard.');
      setData(projected);
    } catch {
      setError('Não foi possível carregar o dashboard. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const deltaClass = (value: number): string => {
    if (value === 0) return 'text-fg-muted';
    return value > 0 ? 'text-success' : 'text-destructive';
  };

  const formatDelta = (value: number | null): string | null => {
    if (value === null) return null;
    if (value === 0) return 'sem variação';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1).replace('.', ',')}%`;
  };

  if (loading) {
    return (
      <PageShell>
        <PageHeader title="Dashboard" description="Visão geral do desempenho comercial." />
        <div className="flex flex-wrap gap-2" aria-hidden="true">
          {PERIODS.map((option) => (
            <div key={option.key} className="h-8 w-20 animate-pulse rounded-sm bg-surface-muted" />
          ))}
        </div>
        <div
          className="rounded-lg border border-line bg-surface p-5"
          aria-busy="true"
          aria-label="Carregando dashboard"
        >
          <div className="h-4 w-48 animate-pulse rounded-sm bg-surface-muted" />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="space-y-3 rounded-lg border border-line p-4">
                <div className="h-4 w-24 animate-pulse rounded-sm bg-surface-muted" />
                <div className="h-8 w-32 animate-pulse rounded-sm bg-surface-muted" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-5" aria-hidden="true">
          <div className="h-4 w-52 animate-pulse rounded-sm bg-surface-muted" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-10 animate-pulse rounded-sm bg-surface-muted" />
            ))}
          </div>
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <PageHeader title="Dashboard" description="Visão geral do desempenho comercial." />
        <div
          className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-surface px-4 py-16 text-center text-fg-muted"
          role="alert"
        >
          <AlertTriangle size={32} className="text-destructive/60" aria-hidden="true" />
          <p className="text-sm text-destructive">Erro ao carregar dashboard</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => void fetchDashboard()}>
            Tentar novamente
          </Button>
        </div>
      </PageShell>
    );
  }

  if (!data) return null;

  const summary = data.summary;
  const summaryCards: SummaryCard[] = summary
    ? [
        {
          icon: DollarSign,
          label: 'Total vendido',
          value: formatBRL(summary.total_revenue),
          delta: summary.revenue_delta,
        },
        {
          icon: ShoppingCart,
          label: 'Pedidos',
          value: String(summary.orders_count),
          delta: summary.orders_delta,
        },
        {
          icon: TrendingUp,
          label: 'Ticket médio',
          value: formatBRL(summary.avg_ticket),
          delta: summary.avg_ticket_delta,
        },
        {
          icon: Clock,
          label: 'Em aberto',
          value: String(summary.open_orders),
          delta: null,
        },
        {
          icon: BarChart3,
          label: 'Conversão',
          value: `${Number((summary.conversion_rate * 100).toFixed(2))}%`,
          delta: summary.conversion_delta,
        },
      ]
    : [];
  const selectedPeriodLabel =
    PERIODS.find((option) => option.key === period)?.label ?? 'período selecionado';
  const attention = data.attention;

  return (
    <PageShell>
      <PageHeader title="Dashboard" description="Visão geral do desempenho comercial." />

      <div className="flex flex-wrap items-center gap-2" aria-label="Período do dashboard">
        {PERIODS.map((option) => (
          <FilterChip
            key={option.key}
            selected={period === option.key}
            onClick={() => setPeriod(option.key)}
          >
            {option.label}
          </FilterChip>
        ))}
      </div>

      <section
        className="rounded-lg border border-line bg-surface p-5"
        aria-labelledby="dashboard-attention-title"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
              Trabalho que requer atenção
            </p>
            <h2 id="dashboard-attention-title" className="mt-1 text-base font-semibold text-fg">
              Orçamentos para follow-up
            </h2>
          </div>
          {attention && (
            <span className="text-xs text-fg-muted">
              {attention.items.length} {attention.items.length === 1 ? 'pendência' : 'pendências'}
            </span>
          )}
        </div>
        {!attention ? (
          <Unavailable>Esta fila não está disponível para o período selecionado.</Unavailable>
        ) : attention.items.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 py-6 text-sm text-fg-muted">
            <span>Nenhum orçamento parado no momento.</span>
            <Button variant="outline" size="sm" onClick={() => navigate('/quotations')}>
              Ver orçamentos
            </Button>
          </div>
        ) : (
          <div className="mt-4">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Orçamento</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Idade</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attention.items.map((quotation) => (
                  <TableRow key={quotation.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => navigate(`/quotations/${encodeURIComponent(quotation.id)}`)}
                        className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                      >
                        {quotation.id}
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      </button>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate">
                      {capitalize(quotation.customer)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-fg-muted">
                      há {quotation.age} {quotation.age === 1 ? 'dia' : 'dias'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatBRL(quotation.value)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={quotationStatusBadgeKey(quotation.status)}
                        label={quotationStatusLabel(quotation.status)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/quotations/${encodeURIComponent(quotation.id)}`)}
                      >
                        Abrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <OmittedRowsNote omitted={attention.omitted} />
          </div>
        )}
      </section>

      <section aria-labelledby="dashboard-summary-title">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
              Situação comercial
            </p>
            <h2 id="dashboard-summary-title" className="mt-1 text-base font-semibold text-fg">
              Resumo de {selectedPeriodLabel.toLowerCase()}
            </h2>
          </div>
        </div>
        {summary ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {summaryCards.map((card) => {
              const formattedDelta = formatDelta(card.delta);
              return (
                <StatCard
                  key={card.label}
                  icon={card.icon}
                  label={card.label}
                  value={card.value}
                  metadata={
                    formattedDelta ? (
                      <span
                        className={cn(
                          'whitespace-nowrap text-xs font-medium',
                          deltaClass(card.delta as number)
                        )}
                      >
                        {formattedDelta}
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface px-5 py-6">
            <Unavailable>As métricas do resumo não estão disponíveis no momento.</Unavailable>
            <Button variant="outline" size="sm" onClick={() => void fetchDashboard()}>
              Tentar novamente
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="dashboard-analytics-title">
        <div className="mb-3">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
            Analytics confirmados
          </p>
          <h2 id="dashboard-analytics-title" className="mt-1 text-base font-semibold text-fg">
            Desempenho comercial
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
              <Package className="h-4 w-4 text-primary" aria-hidden="true" />O que vendeu
            </h3>
            {data.topProducts === null ? (
              <Unavailable>Produtos mais vendidos não estão disponíveis.</Unavailable>
            ) : data.topProducts.items.length === 0 ? (
              <Unavailable>Nenhum produto vendido no período.</Unavailable>
            ) : (
              <>
                <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Receita</TableHead>
                      <TableHead className="text-right">Pedidos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topProducts.items.map((product) => (
                      <TableRow key={product.sku}>
                        <TableCell className="font-mono text-xs text-fg-muted">
                          {product.sku}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate font-medium">
                          {product.product}
                        </TableCell>
                        <TableCell className="text-right">{product.quantity}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatBRL(product.revenue)}
                        </TableCell>
                        <TableCell className="text-right">{product.orders}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <OmittedRowsNote omitted={data.topProducts.omitted} />
              </>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
              <Users className="h-4 w-4 text-primary" aria-hidden="true" />
              Top clientes
            </h3>
            {data.topCustomers === null ? (
              <Unavailable>Clientes com maior receita não estão disponíveis.</Unavailable>
            ) : data.topCustomers.items.length === 0 ? (
              <Unavailable>Nenhum cliente no período.</Unavailable>
            ) : (
              <>
                <Table className="min-w-[440px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="text-right">Receita</TableHead>
                      <TableHead className="text-right">Pedidos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topCustomers.items.map((customer) => (
                      <TableRow key={customer.name}>
                        <TableCell className="max-w-[240px] truncate font-medium">
                          {capitalize(customer.name)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatBRL(customer.revenue)}
                        </TableCell>
                        <TableCell className="text-right">{customer.orders}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <OmittedRowsNote omitted={data.topCustomers.omitted} />
              </>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-line bg-surface p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
            Vendas por dia
          </h3>
          {data.salesByDay === null ? (
            <Unavailable>A série diária não está disponível.</Unavailable>
          ) : data.salesByDay.items.length === 0 ? (
            <Unavailable>Nenhuma venda no período.</Unavailable>
          ) : (
            <>
              <Table className="min-w-[420px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                    <TableHead className="text-right">Pedidos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.salesByDay.items.map((day) => (
                    <TableRow key={day.date}>
                      <TableCell>{formatDashboardDate(day.date)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatBRL(day.revenue)}
                      </TableCell>
                      <TableCell className="text-right">{day.orders}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <OmittedRowsNote omitted={data.salesByDay.omitted} />
            </>
          )}
        </div>
      </section>
    </PageShell>
  );
}
