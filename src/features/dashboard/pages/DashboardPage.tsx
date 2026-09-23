import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { apiGet, apiPut } from '@/lib/api/api';
import { formatBRL, formatDate, capitalize } from '@/lib/formatting/formatters';
import ErrorState from '@/components/shared/ErrorState';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import Skeleton from '@/components/shared/Skeleton';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { TabBar } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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
  projectDashboardView,
  type DashboardListView,
  type DashboardSummaryView,
  type DashboardViewData,
} from '@/features/dashboard/dashboardViewModel';
import { parseHashOption, useHashQueryState } from '@/hooks/useHashQueryState';
import { projectQuotationListRow, type ProjectedQuotationListRow } from '@/lib/localProjections';
import { quotationStatusBadgeKey, quotationStatusLabel } from '@/lib/statusLabels';
import { Heading } from '@/components/ui/heading';

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

type DashboardTab = 'overview' | 'products' | 'customers' | 'finance';

const TABS: Array<{ key: DashboardTab; label: string; title: string }> = [
  { key: 'overview', label: 'Visão geral', title: 'Resultados' },
  { key: 'products', label: 'Produtos', title: 'Produtos por receita' },
  { key: 'customers', label: 'Clientes', title: 'Clientes por receita' },
  { key: 'finance', label: 'Financeiro', title: 'Composição financeira' },
];

const parseDashboardPeriod = parseHashOption<string>(PERIODS.map((period) => period.key));
const parseDashboardTab = parseHashOption<DashboardTab>(TABS.map((tab) => tab.key));

interface DashboardPageProps {
  navigate: (path: string) => void;
}

type RecentQuotations =
  | { status: 'loading' | 'error'; items: [] }
  | { status: 'ready'; items: ProjectedQuotationListRow[] };

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

function formatChartDate(value: string): string {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateOnly) return formatDate(value);
  const month = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
  ][Number(dateOnly[2]) - 1];
  return `${dateOnly[3]} ${month ?? dateOnly[2]}`;
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCompactBRL(value: number): string {
  if (Math.abs(value) < 1000) return formatBRL(value);
  return `R$\u00a0${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
}

function formatComparison(value: number | null, noOrders = false): string {
  if (noOrders || value === null) return 'Comparação indisponível';
  if (value === 0) return 'Sem variação';
  return `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}% vs. período anterior`;
}

function formatExpense(value: number): string {
  return value === 0 ? formatBRL(0) : `− ${formatBRL(value)}`;
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <StatCard label={label} value={value} metadata={detail} />;
}

function DashboardTabs({
  tab,
  onChange,
}: {
  tab: DashboardTab;
  onChange: (tab: DashboardTab) => void;
}) {
  return (
    <TabBar
      value={tab}
      onValueChange={onChange}
      label="Seções de resultados"
      idPrefix="results"
      items={TABS.map((option) => ({ value: option.key, label: option.label }))}
    />
  );
}

function RevenueChart({
  series,
}: {
  series: DashboardListView<{ date: string; revenue: number; orders: number }> | null;
}) {
  if (series === null) return <Unavailable>A série diária não está disponível.</Unavailable>;
  const maxRevenue = Math.max(...series.items.map((day) => day.revenue), 0);
  if (!series.items.length || maxRevenue <= 0)
    return (
      <>
        <Unavailable>
          {series.omitted
            ? 'Nenhum movimento com dados confirmados neste período.'
            : 'Nenhum movimento neste período.'}
        </Unavailable>
        <OmittedRowsNote omitted={series.omitted} />
      </>
    );

  return (
    <div className="overflow-x-auto" role="img" aria-label="Receita por dia">
      <div
        className="relative flex h-56 min-w-(--chart-min-w) items-end justify-around gap-2 border-b border-orange-ink/20 px-3 pb-5 pl-9 pt-7"
        style={{ '--chart-min-w': `${Math.max(180, series.items.length * 42 + 40)}px` } as CSSProperties}
      >
        <span className="pointer-events-none absolute left-1 top-3 text-xs text-orange-ink/70">
          {formatCompactBRL(maxRevenue)}
        </span>
        <span className="pointer-events-none absolute bottom-5 left-1 text-xs text-orange-ink/70">
          R$ 0
        </span>
        {series.items.map((day) => {
          const height = Math.round((day.revenue / maxRevenue) * 100);
          return (
            <div
              key={day.date}
              className="flex min-w-6 max-w-16 flex-1 flex-col items-center justify-end gap-1"
            >
              <span className="text-xs tabular-nums text-orange-ink/75">
                {formatCompactBRL(day.revenue)}
              </span>
              <div className="flex h-36 w-full items-end">
                <div
                  className="h-(--bar-h) w-full rounded-t-xs bg-bar-one"
                  style={{ '--bar-h': `${height}%` } as CSSProperties}
                  aria-hidden="true"
                />
              </div>
              <span className="whitespace-nowrap text-xs text-orange-ink/75">
                {formatChartDate(day.date)}
              </span>
            </div>
          );
        })}
      </div>
      <ul className="sr-only">
        {series.items.map((day) => (
          <li key={day.date}>
            {formatDashboardDate(day.date)}: {formatBRL(day.revenue)}, {day.orders}{' '}
            {day.orders === 1 ? 'pedido' : 'pedidos'}
          </li>
        ))}
      </ul>
      <OmittedRowsNote omitted={series.omitted} />
    </div>
  );
}

function SummaryMetrics({ summary }: { summary: DashboardSummaryView }) {
  const noOrders = summary.orders_count === 0;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
      <MetricCard
        label="Receita"
        value={formatCompactBRL(summary.total_revenue)}
        detail={formatComparison(summary.revenue_delta)}
      />
      <MetricCard
        label="Pedidos"
        value={String(summary.orders_count)}
        detail={formatComparison(summary.orders_delta)}
      />
      <MetricCard
        label="Conversão"
        value={noOrders ? '—' : formatRate(summary.conversion_rate)}
        detail={formatComparison(summary.conversion_delta, noOrders)}
      />
      <MetricCard
        label="Ticket médio"
        value={noOrders ? '—' : formatBRL(summary.avg_ticket)}
        detail={noOrders ? 'Sem pedidos no período' : `Receita / ${summary.orders_count} pedidos`}
      />
    </div>
  );
}

function OrderSourcesPanel({ data }: { data: DashboardViewData }) {
  const rows = data.ordersBySource?.items || [];
  const total = rows.reduce((sum, row) => sum + row.orders, 0);
  const colors = ['rgb(var(--chart-one))', 'rgb(var(--chart-two))', 'rgb(var(--chart-three))', 'rgb(var(--chart-four))'];
  const swatches = ['bg-chart-one', 'bg-chart-two', 'bg-chart-three', 'bg-chart-four'];
  const labels: Record<string, string> = { site_form: 'Site', whatsapp: 'WhatsApp', typebot: 'Typebot', sem_origem: 'Sem origem' };
  let start = 0;
  const stops = rows.map((row, index) => {
    const end = start + (total > 0 ? row.orders / total * 100 : 0);
    const stop = `${colors[index % colors.length]} ${start}% ${end}%`;
    start = end;
    return stop;
  });
  return (
    <section className="flex min-h-[340px] min-w-0 flex-col rounded-card bg-sage p-5 text-sage-ink" aria-label="Origem dos pedidos">
      <Heading as="h2" level="subsection">Origem dos pedidos</Heading>
      <div className={`mx-auto mt-4 grid size-40 shrink-0 place-items-center rounded-full ${total > 0 ? 'bg-(image:--pie)' : 'bg-light-sage'}`} style={total > 0 ? { '--pie': `conic-gradient(${stops.join(', ')})` } as CSSProperties : undefined} role="img" aria-label={rows.map((row) => `${labels[row.source] || row.source}: ${row.orders} pedidos`).join('; ') || 'Nenhum pedido no período'}>
        <span className="grid size-24 place-content-center rounded-full bg-sage text-center text-xs"><strong className="block text-xl tabular-nums">{total}</strong>pedido{total === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-3 pt-4">{rows.slice(0, 4).map((row, index) => <div key={row.source} className="flex items-start gap-2 text-2xs"><span className={`mt-1 size-2 shrink-0 rounded-full ${swatches[index % swatches.length]}`} /><span>{labels[row.source] || row.source}<strong className="block text-base tabular-nums">{total > 0 ? Math.round(row.orders / total * 100) : 0}%</strong></span></div>)}</div>
      {data.ordersBySource === null && <p className="mt-auto text-xs">Origem indisponível.</p>}
    </section>
  );
}

function OverviewPanel({
  data,
  onCustomers,
  recentQuotations,
  onNavigate,
}: {
  data: DashboardViewData;
  onCustomers: () => void;
  recentQuotations: RecentQuotations;
  onNavigate: (path: string) => void;
}) {
  const summary = data.summary;
  if (!summary) return null;
  return (
    <div
      id="results-panel-overview"
      role="tabpanel"
      aria-labelledby="results-tab-overview"
      className="space-y-4"
    >
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(190px,0.97fr)_repeat(3,minmax(0,1fr))]">
        <div className="xl:row-span-2">
          <SummaryMetrics summary={summary} />
        </div>
        <OrderSourcesPanel data={data} />
        <section
          className="min-h-[340px] min-w-0 rounded-card border border-border-subtle bg-orange p-5 text-orange-ink"
          aria-labelledby="revenue-chart-title"
        >
          <Heading level="section" id="revenue-chart-title">
            Receita por dia · R$ mil
          </Heading>
          <div className="mt-4">
            <RevenueChart series={data.salesByDay} />
          </div>
        </section>
        <FeaturedCustomersPanel data={data} onCustomers={onCustomers} />
        <div className="min-w-0 xl:col-span-3 xl:col-start-2">
          <RecentQuotationsPanel data={recentQuotations} onNavigate={onNavigate} />
        </div>
      </div>
    </div>
  );
}

function RecentQuotationsPanel({
  data,
  onNavigate,
}: {
  data: RecentQuotations;
  onNavigate: (path: string) => void;
}) {
  return (
    <section
      className="rounded-card border border-line bg-surface p-5"
      aria-labelledby="recent-quotations-title"
    >
      <div className="flex items-center justify-between gap-4">
        <Heading level="section" id="recent-quotations-title">
          Últimos orçamentos
        </Heading>
        <Button type="button" variant="outline" size="sm" onClick={() => onNavigate('/quotations')}>
          Ver todos
        </Button>
      </div>
      {data.status === 'loading' ? (
        <SkeletonTable cols={5} rows={5} />
      ) : data.status === 'error' ? (
        <p className="py-6 text-sm text-fg-muted">
          Não foi possível carregar os últimos orçamentos.
        </p>
      ) : data.items.length === 0 ? (
        <p className="py-6 text-sm text-fg-muted">Nenhum orçamento cadastrado.</p>
      ) : (
        <Table className="min-w-[620px]">
          <TableHeader>
            <TableRow>
              <TableHead>Orçamento</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((quotation) => (
              <TableRow key={quotation.id}>
                <TableCell>
                  <Button
                    type="button"
                    variant="link"
                    size="inline"
                    onClick={() => onNavigate(`/quotations/${encodeURIComponent(quotation.id)}`)}
                  >
                    {quotation.businessNumber}
                  </Button>
                </TableCell>
                <TableCell className="max-w-[260px] truncate">{quotation.cliente}</TableCell>
                <TableCell className="whitespace-nowrap text-fg-muted">
                  {formatDashboardDate(quotation.data)}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    status={quotationStatusBadgeKey(quotation.status)}
                    label={quotationStatusLabel(quotation.status)}
                  />
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatBRL(quotation.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function FeaturedCustomersPanel({
  data,
  onCustomers,
}: {
  data: DashboardViewData;
  onCustomers: () => void;
}) {
  const customers = data.topCustomers;
  return (
    <section
      className="min-h-[340px] rounded-card border border-border-subtle bg-taupe p-5 text-taupe-ink [&_p]:text-taupe-ink/75"
      aria-labelledby="featured-customers-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading level="section" id="featured-customers-title">
          Clientes em destaque
        </Heading>
        <Button
          type="button"
          variant="outline-ink"
          size="sm"
          onClick={onCustomers}
        >
          Ver clientes
        </Button>
      </div>
      {customers === null ? (
        <Unavailable>Clientes por receita não estão disponíveis.</Unavailable>
      ) : customers.items.length === 0 ? (
        <Unavailable>
          {customers.omitted
            ? 'Nenhum cliente com dados confirmados no período.'
            : 'Nenhum cliente no período.'}
        </Unavailable>
      ) : (
        <div className="mt-3 divide-y divide-page/10">
          {customers.items.slice(0, 5).map((customer, index) => (
            <div
              key={`${customer.name}-${index}`}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-full bg-page/10 text-xs font-semibold"
                aria-hidden="true"
              >
                {customer.name.trim().slice(0, 2).toLocaleUpperCase('pt-BR')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{capitalize(customer.name)}</p>
                <p className="text-xs opacity-75">
                  {customer.orders} {customer.orders === 1 ? 'pedido' : 'pedidos'}
                </p>
              </div>
              <strong className="shrink-0 text-sm tabular-nums">
                {formatBRL(customer.revenue)}
              </strong>
            </div>
          ))}
        </div>
      )}
      {customers ? <OmittedRowsNote omitted={customers.omitted} /> : null}
    </section>
  );
}

interface RankingRow { key: string; name: string; revenue: number; orders: number }

function RankingPanel({ kind, rows, omitted, summary }: {
  kind: 'products' | 'customers';
  rows: RankingRow[] | null;
  omitted: number;
  summary: DashboardSummaryView | null;
}) {
  const product = kind === 'products';
  const title = product ? 'produto' : 'cliente';
  const maxRevenue = Math.max(0, ...(rows || []).map((row) => row.revenue));
  const revenue = summary?.total_revenue || 0;
  const orders = summary?.orders_count || 0;
  return (
    <div id={`results-panel-${kind}`} role="tabpanel" aria-labelledby={`results-tab-${kind}`} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <MetricCard label="Receita total" value={formatBRL(revenue)} detail="Pedidos confirmados" />
        <MetricCard label={product ? 'Produtos no ranking' : 'Clientes no ranking'} value={rows ? String(rows.length) : '—'} detail="Com vendas no período" />
        <MetricCard label={product ? 'Produto líder' : 'Maior participação'} value={rows?.[0]?.name || '—'} detail={rows?.[0] ? `${formatBRL(rows[0].revenue)} em receita` : 'Sem dados no período'} />
        <MetricCard label="Pedidos" value={String(orders)} detail="No período selecionado" />
      </div>
      {rows === null ? <Unavailable>Receita por {title} não está disponível.</Unavailable> : rows.length === 0 ? <Unavailable>Nenhum {title} com venda no período.</Unavailable> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="min-w-0 rounded-card bg-surface p-5" aria-label={`Receita por ${title}`}>
            <Heading level="section">Receita por {title}</Heading>
            <p className="mt-1 text-xs text-fg-muted">Distribuição da receita dos pedidos</p>
            <div className="mt-8 space-y-6">
              {rows.slice(0, 6).map((row, index) => (
                <div key={row.key} className="grid grid-cols-[minmax(80px,110px)_minmax(0,1fr)_auto] items-center gap-3 text-2xs">
                  <span className="truncate text-fg-muted" title={row.name}>{row.name}</span>
                  <div className="h-5 overflow-hidden rounded-control bg-raised"><div className={`h-full w-(--bar-w) ${['bg-sage', 'bg-orange', 'bg-taupe'][index % 3]}`} style={{ '--bar-w': `${maxRevenue ? Math.max(2, (row.revenue / maxRevenue) * 100) : 0}%` } as CSSProperties} /></div>
                  <span className="tabular-nums text-fg-muted">{formatCompactBRL(row.revenue)}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="min-w-0 rounded-card bg-surface p-5" aria-label={`Participação por ${title}`}>
            <Heading level="section">{product ? 'Participação no catálogo' : 'Clientes por receita'}</Heading>
            <Table className="mt-6 min-w-[390px]">
              <TableHeader><TableRow><TableHead>{product ? 'Produto' : 'Cliente'}</TableHead><TableHead className="text-right">Receita</TableHead><TableHead className="text-right">Participação</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((row) => <TableRow key={row.key}><TableCell className="max-w-[230px] truncate font-medium">{row.name}</TableCell><TableCell className="text-right tabular-nums">{formatBRL(row.revenue)}</TableCell><TableCell className="text-right tabular-nums">{revenue > 0 ? `${(row.revenue / revenue * 100).toFixed(1).replace('.', ',')}%` : '—'}</TableCell></TableRow>)}</TableBody>
            </Table>
            <OmittedRowsNote omitted={omitted} />
          </section>
        </div>
      )}
    </div>
  );
}

function ProductsPanel({ data }: { data: DashboardViewData }) {
  return <RankingPanel kind="products" rows={data.topProducts?.items.map((item) => ({ key: item.sku, name: item.product, revenue: item.revenue, orders: item.orders })) ?? null} omitted={data.topProducts?.omitted ?? 0} summary={data.summary} />;
}

function CustomersPanel({ data }: { data: DashboardViewData }) {
  return <RankingPanel kind="customers" rows={data.topCustomers?.items.map((item) => ({ key: item.name, name: capitalize(item.name), revenue: item.revenue, orders: item.orders })) ?? null} omitted={data.topCustomers?.omitted ?? 0} summary={data.summary} />;
}

function MetaSpendForm({
  summary,
  period,
  draft,
  setDraft,
  saving,
  error,
  onSave,
  onCancel,
}: {
  summary: DashboardSummaryView;
  period: string;
  draft: string;
  setDraft: (value: string) => void;
  saving: boolean;
  error: string | null;
  onSave: (event: { preventDefault: () => void }) => void;
  onCancel: () => void;
}) {
  if (!summary.meta_editable)
    return (
      <p className="text-sm text-fg-muted">
        O gasto Meta só pode ser informado por mês calendário.
      </p>
    );
  const periodLabel =
    PERIODS.find((option) => option.key === period)?.label ?? 'período selecionado';
  return (
    <form className="space-y-4" onSubmit={onSave}>
      <div>
        <Heading level="section">Editar gasto Meta do mês</Heading>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-fg-muted">Mês de referência</dt>
            <dd className="mt-1 text-fg">{periodLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Valor informado</dt>
            <dd className="mt-1">
              <Input
                id="results-meta-spend"
                aria-label="Valor informado de gasto Meta"
                inputMode="decimal"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={saving}
                placeholder="0,00"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'results-meta-spend-error' : undefined}
              />
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-fg-muted">
          O valor será aplicado aos indicadores do mês de referência.
        </p>
      </div>
      {error ? (
        <p id="results-meta-spend-error" className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}

function FinancePanel({
  data,
  period,
  metaDraft,
  setMetaDraft,
  metaSaving,
  metaError,
  onSaveMeta,
  onCancelMeta,
}: {
  data: DashboardViewData;
  period: string;
  metaDraft: string;
  setMetaDraft: (value: string) => void;
  metaSaving: boolean;
  metaError: string | null;
  onSaveMeta: (event: { preventDefault: () => void }) => void;
  onCancelMeta: () => void;
}) {
  const summary = data.summary;
  if (!summary) return null;
  const rows = [
    ['Receita', formatBRL(summary.total_revenue), false],
    ['Custo dos produtos', formatExpense(summary.custo), true],
    ['Anúncios · Meta', formatExpense(summary.ads_meta), true],
    ['Impostos', formatExpense(summary.imposto), true],
    ['Lucro calculado', formatBRL(summary.lucro), false],
  ] as const;
  const segments = [
    { label: 'Custo dos produtos', value: summary.custo, color: 'bg-finance-one' },
    { label: 'Anúncios', value: summary.ads, color: 'bg-finance-two' },
    { label: 'Impostos', value: summary.imposto, color: 'bg-finance-three' },
    { label: 'Lucro calculado', value: Math.max(0, summary.lucro), color: 'bg-finance-four' },
  ];
  return (
    <div
      id="results-panel-finance"
      role="tabpanel"
      aria-labelledby="results-tab-finance"
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <MetricCard label="Receita" value={formatBRL(summary.total_revenue)} detail="Pedidos do período" />
        <MetricCard label="Custo dos produtos" value={formatBRL(summary.custo)} detail="Custos registrados" />
        <MetricCard label="Anúncios + impostos" value={formatBRL(summary.ads + summary.imposto)} detail="Gastos considerados" />
        <MetricCard label="Lucro calculado" value={formatBRL(summary.lucro)} detail="Receita menos custos e gastos" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
      <section className="min-w-0 rounded-card bg-surface p-5" aria-label="Composição financeira">
        <Heading level="section">Composição financeira</Heading>
        <p className="mt-1 text-xs text-fg-muted">Valores registrados no período</p>
        <div className="mt-8 flex h-12 w-full overflow-hidden rounded-control bg-raised" role="img" aria-label={segments.map((item) => `${item.label}: ${formatBRL(item.value)}`).join('; ')}>
          {segments.map((item) => <div key={item.label} className={`w-(--segment-w) ${item.color}`} style={{ '--segment-w': `${summary.total_revenue > 0 ? Math.max(0, item.value / summary.total_revenue * 100) : 0}%` } as CSSProperties} />)}
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">{segments.map((item) => <div key={item.label} className="flex items-start gap-2 text-xs"><span className={`mt-1 size-2 shrink-0 rounded-full ${item.color}`} /><div><span className="text-fg-muted">{item.label}</span><strong className="mt-1 block tabular-nums">{formatBRL(item.value)}</strong></div></div>)}</div>
      </section>
      <section className="min-w-0 rounded-card bg-surface p-5" aria-labelledby="finance-summary-title">
        <Heading level="section" id="finance-summary-title">Memória do cálculo</Heading>
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Componente</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(([label, value, expense]) => (
                <TableRow key={label}>
                  <TableCell
                    className={label === 'Lucro calculado' ? 'font-semibold' : 'font-medium'}
                  >
                    {label}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${expense ? 'text-fg-muted' : 'font-medium'}`}
                  >
                    {value}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {summary.ads_google_unavailable ? (
          <p className="mt-4 text-sm text-warning" role="status">
            Google Ads indisponível. O lucro foi calculado com esse gasto igual a zero.
          </p>
        ) : null}
      </section>
      </div>
      <details className="rounded-card bg-surface p-5" aria-label="Editar gasto Meta"><summary className="cursor-pointer text-xs font-semibold text-fg">Editar gasto Meta</summary><div className="mt-4">
        <MetaSpendForm
          summary={summary}
          period={period}
          draft={metaDraft}
          setDraft={setMetaDraft}
          saving={metaSaving}
          error={metaError}
          onSave={onSaveMeta}
          onCancel={onCancelMeta}
        />
      </div></details>
    </div>
  );
}

function DashboardPeriodAction({ period, onChange }: { period: string; onChange: (period: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-fg-muted">Período</span>
      <Select
        aria-label="Período dos resultados"
        value={period}
        onChange={(event) => onChange(event.target.value)}
      >
        {PERIODS.map((option) => (
          <option key={option.key} value={option.key}>{option.label}</option>
        ))}
      </Select>
    </div>
  );
}

function LoadingResults({
  period,
  tab,
  onPeriodChange,
  onTabChange,
}: {
  period: string;
  tab: DashboardTab;
  onPeriodChange: (period: string) => void;
  onTabChange: (tab: DashboardTab) => void;
}) {
  return (
    <PageShell>
      <PageHeader title="Resultados" actions={<DashboardPeriodAction period={period} onChange={onPeriodChange} />} />
      <DashboardTabs tab={tab} onChange={onTabChange} />
      {tab === 'overview' ? (
        <div id="results-panel-overview" role="tabpanel" aria-labelledby="results-tab-overview" aria-busy="true" className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(190px,0.97fr)_repeat(3,minmax(0,1fr))]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:row-span-2 xl:grid-cols-1">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[145px] rounded-card" />)}
          </div>
          <Skeleton className="h-[340px] rounded-card" />
          <Skeleton className="h-[340px] rounded-card" />
          <Skeleton className="h-[340px] rounded-card" />
          <Skeleton className="h-[340px] rounded-card xl:col-span-3 xl:col-start-2" />
        </div>
      ) : (
        <div id={`results-panel-${tab}`} role="tabpanel" aria-labelledby={`results-tab-${tab}`} aria-busy="true" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[145px] rounded-card" />)}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-[360px] rounded-card" />
            <Skeleton className="h-[360px] rounded-card" />
          </div>
        </div>
      )}
    </PageShell>
  );
}

function UnavailableResults({
  period,
  tab,
  onTabChange,
  onPeriodChange,
  onRetry,
}: {
  period: string;
  tab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  onPeriodChange: (period: string) => void;
  onRetry: () => void;
}) {
  return (
    <PageShell>
      <PageHeader title="Resultados" actions={<DashboardPeriodAction period={period} onChange={onPeriodChange} />} />
      <DashboardTabs tab={tab} onChange={onTabChange} />
      <div id={`results-panel-${tab}`} role="tabpanel" aria-labelledby={`results-tab-${tab}`}>
        <ErrorState title="Não foi possível carregar os resultados" onRetry={onRetry} />
      </div>
    </PageShell>
  );
}

export default function DashboardPage({ navigate }: DashboardPageProps) {
  const [period, setPeriod] = useHashQueryState('period', 'month', parseDashboardPeriod);
  const [tab, setTab] = useHashQueryState<DashboardTab>('tab', 'overview', parseDashboardTab);
  const [data, setData] = useState<DashboardViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [metaDraft, setMetaDraft] = useState('');
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [recentQuotations, setRecentQuotations] = useState<RecentQuotations>({
    status: 'loading',
    items: [],
  });
  const requestGenerationRef = useRef(0);

  const fetchDashboard = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setError(false);
    setData(null);
    try {
      const result = await apiGet<unknown>(`/sales-dashboard?period=${period}`);
      if (requestGeneration !== requestGenerationRef.current) return;
      const projected = projectDashboardView(result);
      if (!projected || !projected.summary) throw new Error('invalid');
      setData(projected);
    } catch {
      if (requestGeneration !== requestGenerationRef.current) return;
      setError(true);
    } finally {
      if (requestGeneration === requestGenerationRef.current) setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    if (tab !== 'overview') return;
    let active = true;
    setRecentQuotations({ status: 'loading', items: [] });
    void apiGet<{ data?: unknown }>('/quotations?page=1&limit=5')
      .then((response) => {
        if (!active) return;
        if (!Array.isArray(response.data)) throw new Error('invalid');
        const items = response.data.map(projectQuotationListRow);
        if (items.some((item) => item === null)) throw new Error('invalid');
        setRecentQuotations({ status: 'ready', items: items as ProjectedQuotationListRow[] });
      })
      .catch(() => {
        if (active) setRecentQuotations({ status: 'error', items: [] });
      });
    return () => {
      active = false;
    };
  }, [tab]);

  useEffect(() => {
    if (!data?.summary?.meta_editable) {
      setMetaDraft('');
      setMetaError(null);
      return;
    }
    setMetaDraft(String(data.summary.ads_meta));
    setMetaError(null);
  }, [data]);

  const saveMeta = useCallback(
    async (event: { preventDefault: () => void }) => {
      event.preventDefault();
      setMetaSaving(true);
      setMetaError(null);
      try {
        const result = await apiPut<unknown>(
          `/sales-dashboard?period=${encodeURIComponent(period)}`,
          { period, meta_spend: metaDraft }
        );
        const projected = projectDashboardView(result);
        if (!projected?.summary) throw new Error('invalid');
        setData(projected);
      } catch (saveError) {
        setMetaError(
          saveError instanceof Error && saveError.message !== 'invalid'
            ? saveError.message
            : 'Não foi possível salvar o gasto da Meta.'
        );
      } finally {
        setMetaSaving(false);
      }
    },
    [metaDraft, period]
  );

  if (loading) return <LoadingResults period={period} tab={tab} onPeriodChange={setPeriod} onTabChange={setTab} />;
  if (error || !data)
    return (
      <UnavailableResults
        period={period}
        tab={tab}
        onTabChange={setTab}
        onPeriodChange={setPeriod}
        onRetry={() => void fetchDashboard()}
      />
    );

  return (
    <PageShell>
      <PageHeader
        title="Resultados"
        actions={<DashboardPeriodAction period={period} onChange={setPeriod} />}
      />
      <DashboardTabs tab={tab} onChange={setTab} />
      {tab === 'overview' ? (
        <OverviewPanel
          data={data}
          onCustomers={() => setTab('customers')}
          recentQuotations={recentQuotations}
          onNavigate={navigate}
        />
      ) : tab === 'products' ? (
        <ProductsPanel data={data} />
      ) : tab === 'customers' ? (
        <CustomersPanel data={data} />
      ) : (
        <FinancePanel
          data={data}
          period={period}
          metaDraft={metaDraft}
          setMetaDraft={setMetaDraft}
          metaSaving={metaSaving}
          metaError={metaError}
          onSaveMeta={saveMeta}
          onCancelMeta={() => {
            setMetaDraft(String(data.summary?.ads_meta ?? 0));
            setMetaError(null);
          }}
        />
      )}
    </PageShell>
  );
}
