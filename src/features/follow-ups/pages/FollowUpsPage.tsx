import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import EmptyState from '@/components/shared/EmptyState';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { apiGet } from '@/lib/api/api';
import {
  projectDashboardView,
  type DashboardListView,
  type DashboardQuotationView,
} from '@/features/dashboard/dashboardViewModel';
import {
  listFollowUps,
  type FollowUpListView,
  type FollowUpPage,
  type FollowUpView,
} from '@/lib/api/followUpApi';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import FollowUpReviewDrawer from '@/features/follow-ups/components/FollowUpReviewDrawer';
import {
  parseHashOption,
  parseHashPositiveInteger,
  useHashQueryState,
} from '@/hooks/useHashQueryState';
import { fmtPhone, formatBRL, formatDateTime } from '@/lib/formatting/formatters';
import { quotationStatusBadgeKey, quotationStatusLabel } from '@/lib/statusLabels';

const PAGE_SIZE = 25;
const TABS: Array<{ view: FollowUpListView; label: string }> = [
  { view: 'ready', label: 'Prontos' },
  { view: 'waiting', label: 'Aguardando 24h' },
  { view: 'sent', label: 'Enviados' },
  { view: 'dismissed', label: 'Dispensados' },
  { view: 'attention', label: 'Atenção' },
];
const FOLLOW_UP_VIEWS = TABS.map((tab) => tab.view);
const parseFollowUpView = parseHashOption<FollowUpListView>(FOLLOW_UP_VIEWS);
const MAX_PAGE = 1_000_000;

function parseFollowUpPage(raw: string | null, fallback: number): number {
  const value = parseHashPositiveInteger(raw, fallback);
  return value <= MAX_PAGE ? value : fallback;
}

const STATE_LABELS: Record<string, string> = {
  ready: 'Pronto',
  waiting: 'Aguardando 24h',
  awaiting_receipt: 'Atenção',
  held: 'Atenção',
  approved: 'Aprovado',
  processing: 'Processando',
  sent: 'Enviado',
  cancelled: 'Cancelado',
  dismissed: 'Dispensado',
  needs_review: 'Atenção',
  failed: 'Falhou',
};

function formatDate(value: string | null): string {
  if (!value) return 'Sem recibo';
  return Number.isNaN(new Date(value).getTime()) ? 'Data indisponível' : formatDateTime(value);
}

const EMPTY_DESCRIPTIONS: Record<FollowUpListView, string> = {
  ready: 'Nenhum follow-up pronto. Envios recentes ficam em Aguardando 24h.',
  waiting: 'Nenhum envio no prazo de 24h.',
  attention: 'Nada exige atenção. Cliente que já respondeu também aparece aqui.',
  sent: 'Nenhum item nesta lista.',
  dismissed: 'Nenhum item nesta lista.',
};

function toneForState(value: string): string {
  if (value === 'ready' || value === 'sent' || value === 'approved') return 'tone-success-soft';
  if (value === 'waiting' || value === 'processing') return 'tone-warning-soft';
  if (
    value === 'failed' ||
    value === 'needs_review' ||
    value === 'awaiting_receipt' ||
    value === 'held' ||
    value === 'cancelled'
  ) {
    return 'tone-destructive-soft';
  }
  return 'tone-neutral-muted';
}

interface FollowUpsPageProps {
  navigate: (hash: string) => void;
  embedded?: boolean;
  returnView?: FollowUpReturnView;
}

export type FollowUpReturnView = 'unanswered' | 'sent';

export default function FollowUpsPage({
  navigate,
  embedded = false,
  returnView = 'sent',
}: FollowUpsPageProps) {
  const [view, setView] = useHashQueryState<FollowUpListView>('view', 'ready', parseFollowUpView);
  const [page, setPage] = useHashQueryState('page', 1, parseFollowUpPage);
  const [result, setResult] = useState<FollowUpPage | null>(null);
  const [selected, setSelected] = useState<FollowUpView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unanswered, setUnanswered] = useState<DashboardListView<DashboardQuotationView> | null>(
    null
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestGenerationRef = useRef(0);

  const load = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      if (returnView === 'unanswered') {
        const projected = projectDashboardView(
          await apiGet<unknown>('/sales-dashboard?period=month')
        );
        if (requestGeneration !== requestGenerationRef.current) return;
        if (!projected?.attention) throw new Error('Resposta inválida ao carregar retornos.');
        setUnanswered(projected.attention);
        setResult(null);
      } else {
        const nextResult = await listFollowUps({ view, page, pageSize: PAGE_SIZE });
        if (requestGeneration !== requestGenerationRef.current) return;
        setUnanswered(null);
        setResult(nextResult);
      }
    } catch (reason) {
      if (requestGeneration !== requestGenerationRef.current) return;
      setResult(null);
      setUnanswered(null);
      setError(
        reason instanceof Error && returnView === 'sent'
          ? reason.message
          : returnView === 'unanswered'
            ? 'Não foi possível carregar os retornos sem resposta.'
            : 'Não foi possível carregar os follow-ups.'
      );
    } finally {
      if (requestGeneration === requestGenerationRef.current) setLoading(false);
    }
  }, [page, returnView, view]);

  useEffect(() => {
    void load();
  }, [load]);

  function changeView(nextView: FollowUpListView) {
    setView(nextView);
    setPage(1);
    setSelected(null);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    changeView(TABS[nextIndex].view);
    tabRefs.current[nextIndex]?.focus();
  }

  function openQuotation(event: MouseEvent<HTMLAnchorElement>, quotationId: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(`/quotations/${encodeURIComponent(quotationId)}`);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const rows = result?.data || [];
  const unansweredRows = unanswered?.items || [];

  useEffect(() => {
    if (!loading && result && page > totalPages) setPage(1);
  }, [loading, page, result, setPage, totalPages]);

  return (
    <PageShell className={embedded ? 'space-y-4' : 'space-y-6'}>
      {!embedded && (
        <PageHeader
          title="Follow-ups"
          actions={
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw aria-hidden="true" className={loading ? 'animate-spin' : undefined} />
              Atualizar
            </Button>
          }
        />
      )}

      {(!embedded || returnView === 'sent') && (
        <div
          className="flex flex-wrap gap-1 border-b border-line"
          role="tablist"
          aria-label="Filtrar follow-ups"
        >
          {TABS.map((tab, index) => (
            <button
              key={tab.view}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`follow-ups-tab-${tab.view}`}
              aria-controls="follow-ups-panel"
              aria-selected={view === tab.view}
              tabIndex={view === tab.view ? 0 : -1}
              className={
                view === tab.view
                  ? 'border-b-2 border-primary px-3 py-2 text-sm font-semibold text-primary'
                  : 'border-b-2 border-transparent px-3 py-2 text-sm text-fg-muted hover:text-fg'
              }
              onClick={() => changeView(tab.view)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div
        id="follow-ups-panel"
        role="tabpanel"
        aria-labelledby={returnView === 'sent' ? `follow-ups-tab-${view}` : undefined}
        aria-label={returnView === 'unanswered' ? 'Retornos sem resposta' : undefined}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
            <span>{error}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => void load()}
            >
              Tentar novamente
            </Button>
          </div>
        )}

        {returnView === 'unanswered' ? (
          loading ? (
            <SkeletonTable rows={5} cols={5} />
          ) : unanswered === null ? null : unansweredRows.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="Nenhum retorno sem resposta"
              description="Não há orçamentos sem resposta no período selecionado."
            />
          ) : (
            <>
              <div className="hidden lg:block overflow-x-auto rounded-lg border border-line bg-surface">
                <Table className="min-w-[760px]">
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
                    {unansweredRows.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <a
                            href={`#/quotations/${encodeURIComponent(item.id)}`}
                            className="font-mono text-xs text-primary hover:underline"
                            aria-label={`Abrir orçamento ${item.id}`}
                            onClick={(event) => openQuotation(event, item.id)}
                          >
                            {item.id}
                          </a>
                        </TableCell>
                        <TableCell className="max-w-64 truncate">{item.customer}</TableCell>
                        <TableCell className="whitespace-nowrap text-fg-muted">
                          {item.age === 0
                            ? 'Hoje'
                            : `há ${item.age} ${item.age === 1 ? 'dia' : 'dias'}`}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                          {formatBRL(item.value)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={quotationStatusBadgeKey(item.status)}
                            label={quotationStatusLabel(item.status)}
                            className="tone-neutral-muted"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => navigate(`/quotations/${encodeURIComponent(item.id)}`)}
                          >
                            Abrir
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="grid gap-3 lg:hidden">
                {unansweredRows.map((item) => (
                  <article key={item.id} className="rounded-md border border-line bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <a
                          href={`#/quotations/${encodeURIComponent(item.id)}`}
                          className="font-mono text-xs text-primary hover:underline"
                          aria-label={`Abrir orçamento ${item.id}`}
                          onClick={(event) => openQuotation(event, item.id)}
                        >
                          {item.id}
                        </a>
                        <p className="mt-2 truncate font-medium">{item.customer}</p>
                        <p className="mt-1 text-xs text-fg-muted">
                          {item.age === 0
                            ? 'Hoje'
                            : `há ${item.age} ${item.age === 1 ? 'dia' : 'dias'}`}
                        </p>
                        <p className="mt-1 text-xs font-medium tabular-nums text-fg-muted">
                          {formatBRL(item.value)}
                        </p>
                      </div>
                      <StatusBadge
                        status={quotationStatusBadgeKey(item.status)}
                        label={quotationStatusLabel(item.status)}
                        className="tone-neutral-muted shrink-0"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-4 w-full"
                      onClick={() => navigate(`/quotations/${encodeURIComponent(item.id)}`)}
                    >
                      Abrir orçamento
                    </Button>
                  </article>
                ))}
              </div>
              {unanswered.omitted > 0 && (
                <p className="text-xs text-fg-muted">
                  {unanswered.omitted}{' '}
                  {unanswered.omitted === 1
                    ? 'registro não foi exibido por falta de dados confirmados.'
                    : 'registros não foram exibidos por falta de dados confirmados.'}
                </p>
              )}
            </>
          )
        ) : loading ? (
          <SkeletonTable rows={5} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="Nenhum follow-up"
            description={EMPTY_DESCRIPTIONS[view]}
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Orçamento</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Recibo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => (
                    <TableRow
                      key={`${item.quotationId}-${item.followUpId || item.eligibilityVersion}`}
                    >
                      <TableCell className="min-w-0 font-medium">
                        <a
                          href={`#/quotations/${encodeURIComponent(item.quotationId)}`}
                          className="block max-w-56 truncate text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          aria-label={`Abrir orçamento ${item.businessNumber}`}
                          title={item.businessNumber}
                          onClick={(event) => openQuotation(event, item.quotationId)}
                        >
                          {item.businessNumber}
                        </a>
                        <span className="mt-0.5 block whitespace-nowrap text-xs font-normal tabular-nums text-fg-muted">
                          {formatBRL(item.amount)}
                        </span>
                      </TableCell>
                      <TableCell className="min-w-0">
                        <span className="block max-w-72 truncate" title={item.clientName}>
                          {item.clientName}
                        </span>
                        <span className="mt-0.5 block whitespace-nowrap text-xs text-fg-muted">
                          {fmtPhone(item.canonicalPhone) || 'Telefone indisponível'}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        <span className="block">{formatDate(item.firstProviderReceiptAt)}</span>
                        {item.state === 'waiting' && item.dueAt && (
                          <span className="mt-0.5 block text-fg-muted">
                            vence em {formatDate(item.dueAt)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge
                            status={item.state}
                            label={STATE_LABELS[item.state] || item.state}
                            className={toneForState(item.state)}
                          />
                          <span className="text-xs text-fg-muted">{item.reasonLabel}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelected(item)}
                        >
                          Revisar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-3 lg:hidden">
              {rows.map((item) => (
                <article
                  key={`${item.quotationId}-${item.followUpId || item.eligibilityVersion}`}
                  className="min-w-0 rounded-md border border-line bg-surface p-4"
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg" title={item.clientName}>
                        {item.clientName}
                      </p>
                      <p className="mt-0.5 whitespace-nowrap text-xs text-fg-muted">
                        {fmtPhone(item.canonicalPhone) || 'Telefone indisponível'}
                      </p>
                    </div>
                    <StatusBadge
                      status={item.state}
                      label={STATE_LABELS[item.state] || item.state}
                      className={`${toneForState(item.state)} shrink-0`}
                    />
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <a
                        href={`#/quotations/${encodeURIComponent(item.quotationId)}`}
                        className="block truncate text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        aria-label={`Abrir orçamento ${item.businessNumber}`}
                        title={item.businessNumber}
                        onClick={(event) => openQuotation(event, item.quotationId)}
                      >
                        {item.businessNumber}
                      </a>
                      <span className="mt-0.5 block whitespace-nowrap text-xs tabular-nums text-fg-muted">
                        {formatBRL(item.amount)}
                      </span>
                      <span className="mt-1 block truncate text-xs text-fg-muted">
                        {item.reasonLabel}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setSelected(item)}
                    >
                      Revisar
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {returnView === 'sent' && !loading && result && result.total > result.pageSize && (
          <div className="flex items-center justify-between text-sm text-fg-muted">
            <span>
              Página {result.page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => current - 1)}
                disabled={page <= 1}
                aria-label="Página anterior"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => current + 1)}
                disabled={page >= totalPages}
                aria-label="Próxima página"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <FollowUpReviewDrawer
        followUp={selected}
        onClose={() => setSelected(null)}
        onChanged={() => void load()}
      />
    </PageShell>
  );
}
