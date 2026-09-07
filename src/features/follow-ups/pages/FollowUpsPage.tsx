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
}

export default function FollowUpsPage({ navigate }: FollowUpsPageProps) {
  const [view, setView] = useHashQueryState<FollowUpListView>('view', 'ready', parseFollowUpView);
  const [page, setPage] = useHashQueryState('page', 1, parseFollowUpPage);
  const [result, setResult] = useState<FollowUpPage | null>(null);
  const [selected, setSelected] = useState<FollowUpView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await listFollowUps({ view, page, pageSize: PAGE_SIZE }));
    } catch (reason) {
      setResult(null);
      setError(
        reason instanceof Error ? reason.message : 'Não foi possível carregar os follow-ups.'
      );
    } finally {
      setLoading(false);
    }
  }, [page, view]);

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

  useEffect(() => {
    if (!loading && result && page > totalPages) setPage(1);
  }, [loading, page, result, setPage, totalPages]);

  return (
    <PageShell className="space-y-6">
      <PageHeader
        title="Follow-ups"
        actions={
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw aria-hidden="true" className={loading ? 'animate-spin' : undefined} />
            Atualizar
          </Button>
        }
      />

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

      <div
        id="follow-ups-panel"
        role="tabpanel"
        aria-labelledby={`follow-ups-tab-${view}`}
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

        {loading ? (
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
                        <StatusBadge
                          status={item.state}
                          label={STATE_LABELS[item.state] || item.state}
                          className={toneForState(item.state)}
                        />
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

        {!loading && result && result.total > result.pageSize && (
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
