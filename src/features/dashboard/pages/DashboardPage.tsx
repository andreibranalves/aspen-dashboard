import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { apiGet, apiPut } from '@/lib/api/api';
import { formatBRL, formatDate, capitalize } from '@/lib/formatting/formatters';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import { Button } from '@/components/ui/button';
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
  return (
    <div className="min-w-0 rounded-lg border border-border-subtle bg-surface p-4">
      <p className="truncate text-xs font-medium text-fg-muted">{label}</p>
      <p className="mt-2 truncate text-2xl font-semibold leading-8 tabular-nums text-fg">{value}</p>
      <p className="mt-2 truncate text-xs text-fg-muted">{detail}</p>
    </div>
  );
}

function DashboardTabs({
  tab,
  onChange,
}: {
  tab: DashboardTab;
  onChange: (tab: DashboardTab) => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(TABS[next].key);
    document.getElementById(`results-tab-${TABS[next].key}`)?.focus();
  };

  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Seções de resultados">
      {TABS.map((option, index) => (
        <button
          key={option.key}
          id={`results-tab-${option.key}`}
          type="button"
          role="tab"
          aria-selected={tab === option.key}
          aria-controls={`results-panel-${option.key}`}
          tabIndex={tab === option.key ? 0 : -1}
          onClick={() => onChange(option.key)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          className={`inline-flex min-h-8 items-center rounded-sm border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page ${
            tab === option.key
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border-control bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
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
        className="relative flex h-56 items-end justify-around gap-2 border-b border-page/20 px-3 pb-5 pl-9 pt-7"
        style={{ minWidth: `${Math.max(180, series.items.length * 42 + 40)}px` }}
      >
        <span className="pointer-events-none absolute left-1 top-3 text-xs text-page/70">
          {formatCompactBRL(maxRevenue)}
        </span>
        <span className="pointer-events-none absolute bottom-5 left-1 text-xs text-page/70">
          R$ 0
        </span>
        {series.items.map((day) => {
          const height = Math.round((day.revenue / maxRevenue) * 100);
          return (
            <div
              key={day.date}
              className="flex min-w-6 max-w-16 flex-1 flex-col items-center justify-end gap-1"
            >
              <span className="text-xs tabular-nums text-page/75">
                {formatCompactBRL(day.revenue)}
              </span>
              <div className="flex h-36 w-full items-end">
                <div
                  className="w-full rounded-t-sm bg-page/55"
                  style={{ height: `${height}%` } as CSSProperties}
                  aria-hidden="true"
                />
              </div>
              <span className="whitespace-nowrap text-xs text-page/75">
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

function AcquisitionPanel({ data, onFinance }: { data: DashboardViewData; onFinance: () => void }) {
  const summary = data.summary;
  if (!summary) return <Unavailable>Dados de aquisição não disponíveis.</Unavailable>;
  const totalSpend = summary.ads_meta + (summary.ads_google_unavailable ? 0 : summary.ads_google);
  const metaShare = totalSpend > 0 ? (summary.ads_meta / totalSpend) * 100 : 0;

  return (
    <section
      className="flex min-h-[340px] flex-col rounded-lg border border-border-subtle bg-sage p-5 text-page [&_dd]:text-page [&_dt]:text-page/75 [&_h2]:text-page"
      aria-labelledby="acquisition-title"
    >
      <h2 id="acquisition-title" className="text-base font-semibold">
        Aquisição
      </h2>
      <div
        className="relative mx-auto mt-5 grid size-32 shrink-0 place-items-center rounded-full"
        style={totalSpend > 0 && !summary.ads_google_unavailable ? {
          background: `conic-gradient(rgb(var(--rust)) 0 ${metaShare}%, rgb(var(--page) / 0.55) ${metaShare}% 100%)`,
        } : { background: 'rgb(var(--page) / 0.18)' }}
        role="img"
        aria-label={summary.ads_google_unavailable ? 'Distribuição do gasto indisponível' : `Distribuição do gasto: Meta ${formatBRL(summary.ads_meta)}, Google Ads ${formatBRL(summary.ads_google)}`}
      >
        <div className="grid size-24 place-content-center rounded-full bg-sage text-center">
          <strong className="text-lg tabular-nums">{formatCompactBRL(totalSpend)}</strong>
          <span className="text-[11px]">gasto registrado</span>
        </div>
      </div>
      <dl className="mt-auto grid grid-cols-2 gap-3 pt-5">
        <div>
          <dt className="text-xs font-medium text-fg-muted">Gasto Meta</dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums text-fg">
            {formatBRL(summary.ads_meta)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-fg-muted">Google Ads</dt>
          <dd className="mt-1 text-sm font-semibold text-fg">
            {summary.ads_google_unavailable ? 'Indisponível' : formatBRL(summary.ads_google)}
          </dd>
        </div>
      </dl>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4 border-page/25 text-page hover:bg-page/10"
        onClick={onFinance}
      >
        Ver gasto mensal
      </Button>
    </section>
  );
}

function OverviewPanel({
  data,
  onFinance,
  onCustomers,
  recentQuotations,
  onNavigate,
}: {
  data: DashboardViewData;
  onFinance: () => void;
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
        <AcquisitionPanel data={data} onFinance={onFinance} />
        <section
          className="min-h-[340px] min-w-0 rounded-lg border border-border-subtle bg-orange p-5 text-page"
          aria-labelledby="revenue-chart-title"
        >
          <h2 id="revenue-chart-title" className="text-base font-semibold">
            Receita por dia · R$ mil
          </h2>
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
        <h2 id="recent-quotations-title" className="text-base font-semibold">
          Últimos orçamentos
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={() => onNavigate('/quotations')}>
          Ver todos
        </Button>
      </div>
      {data.status === 'loading' ? (
        <p className="py-6 text-sm text-fg-muted" role="status">
          Carregando orçamentos…
        </p>
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
                  <button
                    type="button"
                    className="font-semibold text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => onNavigate(`/quotations/${encodeURIComponent(quotation.id)}`)}
                  >
                    {quotation.businessNumber}
                  </button>
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
      className="min-h-[340px] rounded-lg border border-border-subtle bg-taupe p-5 text-page [&_p]:text-page/75"
      aria-labelledby="featured-customers-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="featured-customers-title" className="text-base font-semibold">
          Clientes em destaque
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-page/25 text-page hover:bg-page/10"
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

function ProductsPanel({ data }: { data: DashboardViewData }) {
  return (
    <section
      id="results-panel-products"
      role="tabpanel"
      aria-labelledby="results-tab-products"
      className="rounded-lg border border-line bg-surface p-5"
    >
      {data.topProducts === null ? (
        <Unavailable>Produtos por receita não estão disponíveis.</Unavailable>
      ) : data.topProducts.items.length === 0 ? (
        <>
          <Unavailable>
            {data.topProducts.omitted
              ? 'Nenhum produto com dados confirmados no período.'
              : 'Nenhum produto vendido no período.'}
          </Unavailable>
          <OmittedRowsNote omitted={data.topProducts.omitted} />
        </>
      ) : (
        <div className="mt-4">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Receita</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topProducts.items.map((product) => (
                <TableRow key={product.sku}>
                  <TableCell className="max-w-[320px] truncate font-medium">
                    {product.product}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{product.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{product.orders}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatBRL(product.revenue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <OmittedRowsNote omitted={data.topProducts.omitted} />
        </div>
      )}
    </section>
  );
}

function CustomersPanel({ data }: { data: DashboardViewData }) {
  return (
    <section
      id="results-panel-customers"
      role="tabpanel"
      aria-labelledby="results-tab-customers"
      className="rounded-lg border border-line bg-surface p-5"
    >
      {data.topCustomers === null ? (
        <Unavailable>Clientes por receita não estão disponíveis.</Unavailable>
      ) : data.topCustomers.items.length === 0 ? (
        <>
          <Unavailable>
            {data.topCustomers.omitted
              ? 'Nenhum cliente com dados confirmados no período.'
              : 'Nenhum cliente no período.'}
          </Unavailable>
          <OmittedRowsNote omitted={data.topCustomers.omitted} />
        </>
      ) : (
        <div className="mt-4">
          <Table className="min-w-[480px]">
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Receita</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topCustomers.items.map((customer) => (
                <TableRow key={customer.name}>
                  <TableCell className="max-w-[360px] truncate font-medium">
                    {capitalize(customer.name)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{customer.orders}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatBRL(customer.revenue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <OmittedRowsNote omitted={data.topCustomers.omitted} />
        </div>
      )}
    </section>
  );
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
        <h2 className="text-base font-semibold text-fg">Editar gasto Meta do mês</h2>
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
  return (
    <div
      id="results-panel-finance"
      role="tabpanel"
      aria-labelledby="results-tab-finance"
      className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(260px,1fr)]"
    >
      <section
        className="rounded-lg border border-line bg-surface p-5"
        aria-labelledby="finance-summary-title"
      >
        <h2 id="finance-summary-title" className="text-base font-semibold text-fg">
          Resultado do período
        </h2>
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
                    className={label === 'Lucro calculado' ? 'pt-6 font-semibold' : 'font-medium'}
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
      <section className="rounded-lg border border-line bg-surface p-5" aria-label="Gasto Meta">
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
      </section>
    </div>
  );
}

function LoadingResults() {
  return (
    <PageShell>
      <PageHeader title="Resultados" description="Carregando dados do período…" />
      <div className="flex gap-2" aria-hidden="true">
        {TABS.map((tab) => (
          <div key={tab.key} className="h-8 w-24 animate-pulse rounded-sm bg-surface-muted" />
        ))}
      </div>
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-busy="true"
        aria-label="Carregando resultados"
      >
        {TABS.map((tab) => (
          <div
            key={tab.key}
            className="h-28 animate-pulse rounded-lg border border-line bg-surface-muted"
          />
        ))}
      </div>
      <div
        className="h-80 animate-pulse rounded-lg border border-line bg-surface-muted"
        aria-hidden="true"
      />
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
      <PageHeader
        title={TABS.find((option) => option.key === tab)?.title ?? 'Resultados'}
        description="Dados indisponíveis"
        actions={
          <Select
            aria-label="Período dos resultados"
            value={period}
            onChange={(event) => onPeriodChange(event.target.value)}
          >
            {PERIODS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </Select>
        }
      />
      <DashboardTabs tab={tab} onChange={onTabChange} />
      {tab !== 'overview' ? (
        <section
          id={`results-panel-${tab}`}
          role="tabpanel"
          aria-label={`${TABS.find((option) => option.key === tab)?.label} indisponível`}
          className="rounded-lg border border-line bg-surface p-5"
        >
          <p className="mt-4 text-sm text-fg-muted">Não foi possível carregar os resultados.</p>
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
            Tentar novamente
          </Button>
        </section>
      ) : (
        <div
          id="results-panel-overview"
          role="tabpanel"
          aria-label="Resultados indisponíveis"
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {['Pedidos', 'Conversão', 'Receita', 'Ticket médio'].map((label) => (
              <MetricCard key={label} label={label} value="—" detail="Dados indisponíveis" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(260px,1fr)]">
            <section
              className="rounded-lg border border-line bg-surface p-5"
              aria-labelledby="unavailable-chart-title"
            >
              <h2 id="unavailable-chart-title" className="text-base font-semibold text-fg">
                Receita por dia · R$ mil
              </h2>
              <div className="mt-4 min-h-56 bg-surface-muted px-5 py-6">
                <p className="text-sm text-fg-muted">Não foi possível carregar os resultados.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={onRetry}
                >
                  Tentar novamente
                </Button>
              </div>
            </section>
            <section
              className="rounded-lg border border-line bg-surface p-5"
              aria-labelledby="unavailable-acquisition-title"
            >
              <h2 id="unavailable-acquisition-title" className="text-base font-semibold text-fg">
                Aquisição
              </h2>
              <p className="mt-4 text-2xl font-semibold text-fg">—</p>
              <p className="mt-6 text-sm text-fg-muted">Pendências indisponíveis</p>
            </section>
          </div>
        </div>
      )}
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

  const selectedTitle = TABS.find((option) => option.key === tab)?.title ?? 'Resultados';
  const periodLabel =
    data?.periodLabel ||
    PERIODS.find((option) => option.key === period)?.label ||
    'Período selecionado';

  if (loading) return <LoadingResults />;
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
        title={selectedTitle}
        description={periodLabel}
        actions={
          <div className="xl:absolute xl:right-workspace xl:top-[96px]">
            <Select
              aria-label="Período dos resultados"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            >
              {PERIODS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      <DashboardTabs tab={tab} onChange={setTab} />
      {tab === 'overview' ? (
        <OverviewPanel
          data={data}
          onFinance={() => setTab('finance')}
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
