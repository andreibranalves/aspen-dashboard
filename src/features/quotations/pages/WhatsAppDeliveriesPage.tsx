import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Search, Trash2 } from 'lucide-react';
import { DetailDrawer } from '@/features/customers/components/DetailDrawer';
import SendHistoryTab, { type SendEvent } from '@/features/communication/components/SendHistoryTab';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import SkeletonTable from '@/components/shared/SkeletonTable';
import QuotationDeliveryStatus from '@/features/quotations/components/QuotationDeliveryStatus';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { useToast } from '@/components/shared/toast';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  cancelPendingDeliveries,
  deliveryPollDelay,
  fetchDelivery,
  listDeliveries,
  projectDelivery,
  resolveDelivery,
  type DeliveryListFilters,
  type DeliveryPage,
  type DeliveryResolution,
  type DeliveryState,
  type DeliveryView,
} from '@/lib/api/quotationDeliveryApi';
import { fmtPhone, formatDateTime } from '@/lib/formatting/formatters';
import { cn } from '@/lib/utils';
import {
  parseHashOption,
  parseHashPositiveInteger,
  useHashQueryState,
} from '@/hooks/useHashQueryState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 25;

interface DeliveryFilters {
  requiresAction: boolean;
  includeActive: boolean;
  states: DeliveryState[];
  delayed: boolean;
  search: string;
  from: string;
  to: string;
}

const DEFAULT_FILTERS: DeliveryFilters = {
  requiresAction: true,
  includeActive: true,
  states: [],
  delayed: false,
  search: '',
  from: '',
  to: '',
};

const STATE_FILTERS: Array<{ key: DeliveryState; label: string }> = [
  { key: 'retry_scheduled', label: 'Reagendado' },
  { key: 'delivered', label: 'Entregues' },
  { key: 'failed', label: 'Falhos' },
];

const STEP_STATE_LABELS: Record<DeliveryView['steps'][number]['state'], string> = {
  queued: 'Na fila',
  sending: 'Enviando',
  server_ack: 'Aceito pelo provedor',
  reconciling: 'Confirmando entrega',
  retry_scheduled: 'Nova tentativa agendada',
  needs_review: 'Requer revisão',
  delivered: 'Entregue',
  read: 'Lido',
  failed: 'Falhou',
};

function stepStateTone(state: DeliveryView['steps'][number]['state']): string {
  if (state === 'delivered' || state === 'read') return 'tone-success-soft';
  if (state === 'failed' || state === 'needs_review') return 'tone-destructive-soft';
  if (state === 'retry_scheduled' || state === 'reconciling') return 'tone-warning-soft';
  return 'tone-neutral-muted';
}

// Converte dígitos ddmmaaaa em ISO; só aceita data completa e válida.
function brDateDigitsToIso(digits: string): string {
  if (digits.length !== 8) return '';
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return '';
  return `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
}

function formatBrDateDraft(digits: string): string {
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
}

function parseDeliveryFilters(raw: string | null, fallback: DeliveryFilters): DeliveryFilters {
  if (!raw) return fallback;
  try {
    const candidate = JSON.parse(raw) as Partial<DeliveryFilters>;
    const states = Array.isArray(candidate.states)
      ? candidate.states.filter((state) => STATE_FILTERS.some((filter) => filter.key === state))
      : fallback.states;
    return {
      requiresAction:
        typeof candidate.requiresAction === 'boolean'
          ? candidate.requiresAction
          : fallback.requiresAction,
      includeActive:
        typeof candidate.includeActive === 'boolean'
          ? candidate.includeActive
          : fallback.includeActive,
      states,
      delayed: typeof candidate.delayed === 'boolean' ? candidate.delayed : fallback.delayed,
      search: typeof candidate.search === 'string' ? candidate.search : fallback.search,
      from: typeof candidate.from === 'string' ? candidate.from : fallback.from,
      to: typeof candidate.to === 'string' ? candidate.to : fallback.to,
    };
  } catch {
    return fallback;
  }
}

function serializeDeliveryFilters(
  value: DeliveryFilters,
  fallback: DeliveryFilters
): string | null {
  return JSON.stringify(value) === JSON.stringify(fallback) ? null : JSON.stringify(value);
}

const ACTIVE_STATES: DeliveryState[] = [
  'queued',
  'processing',
  'provider_accepted',
  'reconciling',
  'retry_scheduled',
];

function stateTone(state: DeliveryState): string {
  if (state === 'delivered') return 'tone-success-soft';
  if (state === 'failed' || state === 'needs_review') return 'tone-destructive-soft';
  if (state === 'retry_scheduled') return 'tone-warning-soft';
  return 'tone-primary-soft';
}

function formatDeliveryProgress(delivery: DeliveryView): string {
  const { delivered, total } = delivery.progress;
  if (total === 0) return 'Sem etapas';
  return `${delivered} de ${total} ${total === 1 ? 'etapa' : 'etapas'}`;
}

function completionSourceLabel(delivery: DeliveryView): string {
  if (delivery.completionSource === 'provider_receipt') return 'Recibo do provedor';
  if (delivery.completionSource === 'operator') return 'Confirmação do operador';
  if (delivery.completionSource === 'legacy_provider_ack') return 'Aceite legado do provedor';
  return '—';
}

function inclusiveUtcEndOfDay(value: string): string {
  const endOfDay = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(endOfDay.getTime()) ? value : endOfDay.toISOString();
}

function updateSummary(
  summary: DeliveryPage['summary'],
  before: DeliveryView,
  after: DeliveryView
) {
  const beforeProjection = projectDelivery(before);
  const afterProjection = projectDelivery(after);
  const wasActive = ACTIVE_STATES.includes(before.state);
  const isActive = ACTIVE_STATES.includes(after.state);
  return {
    active: summary.active + Number(isActive) - Number(wasActive),
    requiresAction:
      summary.requiresAction +
      Number(after.state === 'needs_review') -
      Number(before.state === 'needs_review'),
    retryScheduled:
      summary.retryScheduled +
      Number(after.state === 'retry_scheduled') -
      Number(before.state === 'retry_scheduled'),
    delayed:
      summary.delayed +
      Number(afterProjection.requiresAction && after.state === 'provider_accepted') -
      Number(beforeProjection.requiresAction && before.state === 'provider_accepted'),
    deliveredLast24Hours:
      summary.deliveredLast24Hours +
      Number(after.state === 'delivered') -
      Number(before.state === 'delivered'),
  };
}

function filterInputClass(active: boolean): string {
  return cn(
    'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
    active
      ? 'bg-primary text-on-solid [&_input]:accent-white'
      : 'bg-surface-muted text-fg-muted hover:text-fg'
  );
}

interface DeliveryDetailsProps {
  delivery: DeliveryView;
  pending: boolean;
  readOnly?: boolean;
  onResolve: (decision: DeliveryResolution, note: string) => Promise<void>;
}

const DELIVERY_TABS = ['pending', 'history'] as const;
type DeliveryTab = (typeof DELIVERY_TABS)[number];
const parseDeliveryTab = parseHashOption<DeliveryTab>(DELIVERY_TABS);
type HistoryStatus = 'all' | 'sent' | 'pending' | 'failed';

function historyStatusLabel(status: SendEvent['status']): string {
  return { sent: 'Entregue', pending: 'Pendente', failed: 'Falhou', skipped: 'Ignorado' }[status];
}

function DeliveryDetails({ delivery, pending, readOnly = false, onResolve }: DeliveryDetailsProps) {
  return (
    <div className="min-w-0 space-y-5">
      <dl className="grid gap-3 text-xs sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-fg-muted">Telefone</dt>
          <dd className="mt-1 truncate font-medium text-fg" title={fmtPhone(delivery.phone) || '—'}>
            {fmtPhone(delivery.phone) || '—'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-fg-muted">Fluxo</dt>
          <dd className="mt-1 truncate font-medium text-fg" title={delivery.flowName || '—'}>
            {delivery.flowName || '—'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-fg-muted">Recibo</dt>
          <dd className="mt-1 font-medium text-fg">{completionSourceLabel(delivery)}</dd>
        </div>
      </dl>
      <div className="grid min-w-0 gap-5">
        {readOnly ? (
          <div className="rounded-lg border border-line bg-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Estado atual
            </p>
            <StatusBadge
              status={delivery.state}
              label={projectDelivery(delivery).label}
              className={stateTone(delivery.state)}
            />
            <p className="mt-2 text-xs text-fg-muted">
              Fonte de conclusão: {completionSourceLabel(delivery)}
            </p>
          </div>
        ) : (
          <QuotationDeliveryStatus
            delivery={delivery}
            pending={pending}
            onResolve={onResolve}
            className="[&>div:first-child]:hidden"
          />
        )}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Passos da entrega
          </h3>
          <ol
            className="mt-3 space-y-2"
            aria-label={`Passos da entrega ${delivery.businessNumber}`}
          >
            {delivery.steps.length === 0 && (
              <li className="rounded-lg border border-dashed border-line bg-surface p-3 text-xs text-fg-muted">
                Nenhuma etapa configurada para esta entrega.
              </li>
            )}
            {delivery.steps.map((step, index) => (
              <li
                key={step.id}
                className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3 text-xs"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted font-semibold text-fg-muted">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">
                      {step.type === 'quotation_pdf'
                        ? 'PDF do orçamento'
                        : step.type === 'quotation_webp'
                          ? 'Imagem WebP do orçamento'
                          : step.type === 'media'
                            ? 'Mídia'
                            : 'Mensagem'}
                    </span>
                    <StatusBadge
                      status={step.state}
                      label={STEP_STATE_LABELS[step.state]}
                      className={stepStateTone(step.state)}
                    />
                  </div>
                  <p className="mt-1 text-fg-muted">
                    Tentativas: {step.attemptCount} · Atualizado em{' '}
                    {formatDateTime(step.updatedAt) || '—'}
                  </p>
                  {(step.acceptedAt || step.deliveredAt || step.readAt) && (
                    <p className="mt-1 text-fg-muted">
                      {step.acceptedAt && `Aceite ${formatDateTime(step.acceptedAt)}`}
                      {step.deliveredAt && ` · Entrega ${formatDateTime(step.deliveredAt)}`}
                      {step.readAt && ` · Leitura ${formatDateTime(step.readAt)}`}
                    </p>
                  )}
                  {step.publicError && <p className="mt-1 text-destructive">{step.publicError}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

export default function WhatsAppDeliveriesPage() {
  const [activeTab, setActiveTab] = useHashQueryState<DeliveryTab>(
    'tab',
    'pending',
    parseDeliveryTab
  );
  const [filters, setFilters] = useHashQueryState(
    'filters',
    DEFAULT_FILTERS,
    parseDeliveryFilters,
    serializeDeliveryFilters
  );
  const [page, setPage] = useHashQueryState('page', 1, parseHashPositiveInteger);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [result, setResult] = useState<DeliveryPage | null>(null);
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryView | null>(null);
  const [selectedHistoryEvent, setSelectedHistoryEvent] = useState<SendEvent | null>(null);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);
  const [historyDetailError, setHistoryDetailError] = useState('');
  const historyDetailRequestRef = useRef(0);
  // Every selected-delivery detail request (poll or history fetch) carries an
  // identity checked before any state write. Resolution, drawer close, selection
  // change and a newer detail fetch all bump it, so a stale success or rejection
  // can never reopen the drawer or restore obsolete controls.
  const detailRequestRef = useRef(0);
  const invalidateDetailRequests = () => {
    detailRequestRef.current += 1;
  };
  const selectDelivery = (next: DeliveryView | null) => {
    invalidateDetailRequests();
    setSelectedDelivery(next);
  };
  // A silent poll must never overwrite a newer authoritative write (filters,
  // manual reload, resolution). Foreground writers bump this epoch.
  const resultEpochRef = useRef(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Texto em edição nos campos de data; o filtro só recebe data completa e válida.
  const [dateDraft, setDateDraft] = useState({ from: '', to: '' });

  useEffect(() => {
    setDateDraft({
      from: filters.from ? filters.from.split('-').reverse().join('/') : '',
      to: filters.to ? filters.to.split('-').reverse().join('/') : '',
    });
  }, [filters.from, filters.to]);

  const requestFilters = useMemo<DeliveryListFilters>(
    () => ({
      ...(filters.states.length > 0 ? { states: filters.states } : {}),
      ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: inclusiveUtcEndOfDay(filters.to) } : {}),
      requiresAction: filters.requiresAction,
      includeActive: filters.includeActive,
      ...(filters.delayed ? { delayed: true } : {}),
      page,
      pageSize: PAGE_SIZE,
    }),
    [filters, page]
  );

  useEffect(() => {
    let cancelled = false;
    const generation = (resultEpochRef.current += 1);
    setLoading(true);
    setError(null);
    if (activeTab === 'history') {
      setLoading(false);
      return undefined;
    }
    listDeliveries(requestFilters)
      .then((nextResult) => {
        if (cancelled || generation !== resultEpochRef.current) return;
        setResult(nextResult);
      })
      .catch(() => {
        if (cancelled || generation !== resultEpochRef.current) return;
        setError('Não foi possível consultar as entregas. Tente novamente.');
      })
      .finally(() => {
        // A resolution or a newer foreground load owns the epoch now: this
        // stale completion must not overwrite result, error or loading.
        if (!cancelled && generation === resultEpochRef.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, reloadVersion, requestFilters]);

  // The outbox keeps moving after the first load (worker, receipts, manual
  // resolution). Reuse the same poll cadence as the per-delivery hook instead of
  // requiring a browser reload to see progress.
  const refreshListSilently = useCallback(async () => {
    const epoch = resultEpochRef.current;
    try {
      const next = await listDeliveries(requestFilters);
      if (epoch !== resultEpochRef.current) return;
      setResult(next);
    } catch {
      // A polling failure must not replace a readable screen with an error banner.
    }
  }, [requestFilters]);

  useEffect(() => {
    if (activeTab === 'history' || !result) return undefined;
    const delays = result.data
      .map((delivery) => deliveryPollDelay(delivery.state))
      .filter((delay): delay is number => delay !== null);
    if (delays.length === 0) return undefined;
    const timer = setTimeout(() => void refreshListSilently(), Math.min(...delays));
    return () => clearTimeout(timer);
  }, [activeTab, result, refreshListSilently]);

  useEffect(() => {
    if (!selectedDelivery) return undefined;
    const delay = deliveryPollDelay(selectedDelivery.state);
    if (delay === null) return undefined;
    const id = selectedDelivery.id;
    const generation = ++detailRequestRef.current;
    const timer = setTimeout(() => {
      void fetchDelivery({ id })
        .then((next) => {
          // A stale success released after resolution/close must not touch
          // state: the generation is checked before every write.
          if (generation !== detailRequestRef.current || !next) return;
          setSelectedDelivery(next);
        })
        .catch(() => {
          // A stale rejection must not surface an error; keep the last
          // readable detail and let the next poll recover.
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      // A selection change, close or newer request invalidates the in-flight one.
      if (generation === detailRequestRef.current) detailRequestRef.current += 1;
    };
  }, [selectedDelivery]);

  const updateFilters = (update: (current: DeliveryFilters) => DeliveryFilters) => {
    setPage(1);
    setFilters(update);
  };

  const clearPending = async () => {
    setClearing(true);
    setError(null);
    try {
      const cancelled = await cancelPendingDeliveries();
      toast(
        cancelled === 0
          ? 'Nenhuma tentativa pendente para cancelar.'
          : `${cancelled} ${cancelled === 1 ? 'tentativa pendente cancelada.' : 'tentativas pendentes canceladas.'}`,
        cancelled === 0 ? 'info' : 'success'
      );
      setReloadVersion((value) => value + 1);
    } catch {
      const message = 'Não foi possível limpar a fila. Tente novamente.';
      toast(message, 'error');
    } finally {
      setClearing(false);
    }
  };

  const toggleState = (state: DeliveryState) => {
    updateFilters((current) => {
      const states = current.states.includes(state)
        ? current.states.filter((value) => value !== state)
        : [...current.states, state];
      const terminalFilter = states.some((value) => value === 'delivered' || value === 'failed');
      const restoreDefaultUnion =
        states.length === 0 && current.states.length > 0 && terminalFilter === false;
      return {
        ...current,
        states,
        ...(terminalFilter
          ? { requiresAction: false, includeActive: false }
          : restoreDefaultUnion
            ? { requiresAction: true, includeActive: true }
            : {}),
      };
    });
  };

  const resolve = async (delivery: DeliveryView, decision: DeliveryResolution, note: string) => {
    setResolvingId(delivery.id);
    try {
      const resolved = await resolveDelivery(delivery.id, decision, note);
      // Resolution is authoritative: invalidate every in-flight detail request
      // before closing so a stale GET cannot reopen the drawer with old state.
      invalidateDetailRequests();
      resultEpochRef.current += 1;
      // Resolution supersedes any held foreground list load: finalize its
      // loading state so the ignored stale completion cannot leave it stuck.
      setLoading(false);
      setResult((current) => {
        if (!current) return current;
        const before = current.data.find((item) => item.id === delivery.id);
        if (!before) return current;
        return {
          ...current,
          data: current.data.map((item) => (item.id === delivery.id ? resolved : item)),
          summary: updateSummary(current.summary, before, resolved),
        };
      });
      setSelectedDelivery(null);
    } finally {
      setResolvingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil((result?.total || 0) / PAGE_SIZE));

  const openHistoryDetails = async (event: SendEvent) => {
    const requestId = ++historyDetailRequestRef.current;
    invalidateDetailRequests();
    setSelectedHistoryEvent(event);
    setSelectedDelivery(null);
    setHistoryDetailError('');
    setHistoryDetailLoading(true);
    try {
      const delivery = await fetchDelivery({ id: event.id });
      if (requestId !== historyDetailRequestRef.current) return;
      setSelectedDelivery(delivery);
    } catch {
      if (requestId !== historyDetailRequestRef.current) return;
      setHistoryDetailError('Não foi possível consultar o detalhe atual deste envio.');
    } finally {
      if (requestId === historyDetailRequestRef.current) setHistoryDetailLoading(false);
    }
  };

  const closeDetails = () => {
    historyDetailRequestRef.current += 1;
    invalidateDetailRequests();
    setSelectedDelivery(null);
    setSelectedHistoryEvent(null);
    setHistoryDetailError('');
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % DELIVERY_TABS.length;
    if (event.key === 'ArrowLeft')
      nextIndex = (index - 1 + DELIVERY_TABS.length) % DELIVERY_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = DELIVERY_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveTab(DELIVERY_TABS[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <PageShell className="space-y-4 pb-10">
      <PageHeader
        title="Envios"
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReloadVersion((value) => value + 1)}
              disabled={loading || clearing}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              Atualizar
            </Button>
            {activeTab === 'pending' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setClearConfirmOpen(true)}
                disabled={loading || clearing}
                className="text-destructive hover:bg-destructive/10"
              >
                <Trash2 size={14} />
                {clearing ? 'Limpando…' : 'Limpar fila'}
              </Button>
            )}
          </>
        }
      />

      <div role="tablist" aria-label="Seções de envios" className="border-b border-line">
        <div className="flex gap-1">
          {(
            [
              ['pending', 'Pendências'],
              ['history', 'Histórico'],
            ] as const
          ).map(([tab, label], index) => (
            <button
              key={tab}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`delivery-tab-${tab}`}
              aria-selected={activeTab === tab}
              aria-controls="delivery-panel"
              tabIndex={activeTab === tab ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={cn(
                'min-h-10 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-fg-muted hover:text-fg'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div id="delivery-panel" role="tabpanel" aria-labelledby={`delivery-tab-${activeTab}`}>
        {activeTab === 'history' && (
          <section className="space-y-3" aria-label="Filtros do histórico">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['all', 'Todos'],
                  ['sent', 'Entregues'],
                  ['pending', 'Pendentes'],
                  ['failed', 'Falhas'],
                ] as const
              ).map(([status, label]) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setHistoryStatus(status)}
                  className={filterInputClass(historyStatus === status)}
                  aria-pressed={historyStatus === status}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label
                className="relative block text-xs font-medium text-fg-muted"
                htmlFor="history-search"
              >
                <span className="mb-1.5 block">Busca</span>
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-[2.15rem] text-fg-muted"
                />
                <Input
                  id="history-search"
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Buscar envio, fluxo, orçamento ou telefone"
                  className="pl-9"
                />
              </label>
              <fieldset className="grid grid-cols-2 gap-3">
                <legend className="sr-only">Período do histórico</legend>
                <label className="block text-xs font-medium text-fg-muted" htmlFor="history-from">
                  <span className="mb-1.5 block">Data inicial</span>
                  <Input
                    id="history-from"
                    type="date"
                    value={historyFrom}
                    onChange={(event) => setHistoryFrom(event.target.value)}
                  />
                </label>
                <label className="block text-xs font-medium text-fg-muted" htmlFor="history-to">
                  <span className="mb-1.5 block">Data final</span>
                  <Input
                    id="history-to"
                    type="date"
                    value={historyTo}
                    onChange={(event) => setHistoryTo(event.target.value)}
                  />
                </label>
              </fieldset>
            </div>
            <p className="text-xs text-fg-muted">
              Busca e período consideram os 200 envios mais recentes.
            </p>
          </section>
        )}

        {activeTab === 'pending' && (
          <section className="space-y-4" aria-label="Filtros de entregas">
            <div className="flex flex-wrap gap-2">
              <label className={filterInputClass(filters.requiresAction)}>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={filters.requiresAction}
                  onChange={(event) =>
                    updateFilters((current) => ({
                      ...current,
                      requiresAction: event.target.checked,
                    }))
                  }
                />
                Requer ação
              </label>
              <label className={filterInputClass(filters.includeActive)}>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={filters.includeActive}
                  onChange={(event) =>
                    updateFilters((current) => ({
                      ...current,
                      includeActive: event.target.checked,
                    }))
                  }
                />
                Em processamento
              </label>
              <label className={filterInputClass(filters.delayed)}>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={filters.delayed}
                  onChange={(event) =>
                    updateFilters((current) => ({ ...current, delayed: event.target.checked }))
                  }
                />
                Atrasados
              </label>
              {STATE_FILTERS.map(({ key, label }) => (
                <label key={key} className={filterInputClass(filters.states.includes(key))}>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={filters.states.includes(key)}
                    onChange={() => toggleState(key)}
                  />
                  {label}
                </label>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label
                className="relative block text-xs font-medium text-fg-muted"
                htmlFor="delivery-search"
              >
                <span className="mb-1.5 block">Busca</span>
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-[2.15rem] text-fg-muted"
                />
                <Input
                  id="delivery-search"
                  aria-label="Busca"
                  value={filters.search}
                  onChange={(event) =>
                    updateFilters((current) => ({ ...current, search: event.target.value }))
                  }
                  placeholder="Buscar orçamento, cliente, telefone ou fluxo"
                  className="pl-9"
                />
              </label>
              <fieldset className="grid grid-cols-2 gap-3">
                <legend className="sr-only">Período</legend>
                <label className="block text-xs font-medium text-fg-muted" htmlFor="delivery-from">
                  <span className="mb-1.5 block">Data inicial</span>
                  <Input
                    id="delivery-from"
                    aria-label="Data inicial (dd/mm/aaaa)"
                    type="text"
                    inputMode="numeric"
                    placeholder="dd/mm/aaaa"
                    maxLength={10}
                    className="[color-scheme:light] dark:[color-scheme:dark]"
                    value={dateDraft.from}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
                      setDateDraft((current) => ({ ...current, from: formatBrDateDraft(digits) }));
                      const iso = brDateDigitsToIso(digits);
                      // filtro só muda com data válida ou campo limpo; edição parcial mantém o anterior
                      if (iso || digits.length === 0) {
                        updateFilters((current) => ({ ...current, from: iso }));
                      }
                    }}
                  />
                </label>
                <label className="block text-xs font-medium text-fg-muted" htmlFor="delivery-to">
                  <span className="mb-1.5 block">Data final</span>
                  <Input
                    id="delivery-to"
                    aria-label="Data final (dd/mm/aaaa)"
                    type="text"
                    inputMode="numeric"
                    placeholder="dd/mm/aaaa"
                    maxLength={10}
                    className="[color-scheme:light] dark:[color-scheme:dark]"
                    value={dateDraft.to}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
                      setDateDraft((current) => ({ ...current, to: formatBrDateDraft(digits) }));
                      const iso = brDateDigitsToIso(digits);
                      if (iso || digits.length === 0) {
                        updateFilters((current) => ({ ...current, to: iso }));
                      }
                    }}
                  />
                </label>
              </fieldset>
            </div>
          </section>
        )}

        {activeTab === 'pending' && error && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} />
              {error}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReloadVersion((value) => value + 1)}
              disabled={loading}
            >
              Tentar novamente
            </Button>
          </div>
        )}

        {activeTab === 'history' ? (
          <SendHistoryTab
            embedded
            refreshKey={reloadVersion}
            filters={{
              status: historyStatus,
              search: historySearch,
              from: historyFrom,
              to: historyTo,
            }}
            onOpenQuotation={(quotationId) => {
              window.location.hash = `/quotations/${encodeURIComponent(quotationId)}`;
            }}
            onOpenDelivery={(event) => void openHistoryDetails(event)}
          />
        ) : loading && !result ? (
          <div role="status" aria-live="polite" aria-label="Carregando entregas">
            <span className="sr-only">Carregando entregas…</span>
            <SkeletonTable cols={8} rows={8} />
          </div>
        ) : result && result.data.length === 0 ? (
          <div
            className="rounded-lg border border-dashed border-line bg-surface p-10 text-center text-sm text-fg-muted"
            role="status"
          >
            Nenhuma entrega encontrada para os filtros selecionados.
          </div>
        ) : result ? (
          <>
            <Table
              aria-label="Tabela de entregas WhatsApp"
              aria-busy={loading}
              className="table-fixed min-w-[860px]"
            >
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="w-[22%]">
                    Envio
                  </TableHead>
                  <TableHead scope="col" className="w-[18%]">
                    Cliente
                  </TableHead>
                  <TableHead scope="col" className="w-[14%]">
                    Documento
                  </TableHead>
                  <TableHead scope="col" className="w-[16%]">
                    Estado
                  </TableHead>
                  <TableHead scope="col" className="w-[12%]">
                    Etapas
                  </TableHead>
                  <TableHead scope="col" className="w-[12%] whitespace-nowrap">
                    Atualização
                  </TableHead>
                  <TableHead scope="col" className="w-[10%]">
                    Ação
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.map((delivery, index) => {
                  const projection = projectDelivery(delivery);
                  return (
                    <TableRow key={delivery.id}>
                      <TableCell className="min-w-0">
                        <span className="block truncate font-medium text-fg" title={delivery.id}>
                          {delivery.id}
                        </span>
                      </TableCell>
                      <TableCell className="min-w-0">
                        <span
                          className="block truncate text-sm text-fg"
                          title={delivery.clientName}
                        >
                          {delivery.clientName || 'Cliente não identificado'}
                        </span>
                        <span
                          className="mt-1 block truncate text-xs text-fg-muted"
                          title={fmtPhone(delivery.phone)}
                        >
                          {fmtPhone(delivery.phone) || 'Telefone não informado'}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-fg-muted">
                        {delivery.businessNumber}
                      </TableCell>
                      <TableCell className="min-w-0">
                        <span
                          className="block min-w-0"
                          role="status"
                          aria-live="polite"
                          aria-label={`Estado: ${projection.label}. Progresso: ${formatDeliveryProgress(delivery)}`}
                        >
                          <StatusBadge
                            status={delivery.state}
                            label={projection.label}
                            className={stateTone(delivery.state)}
                          />
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-fg-muted">
                        {formatDeliveryProgress(delivery)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-fg-muted">
                        {formatDateTime(delivery.updatedAt) || '—'}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Abrir detalhes de ${delivery.businessNumber}, linha ${index + 1}`}
                          onClick={() => selectDelivery(delivery)}
                        >
                          Detalhes
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div
              className="flex flex-wrap items-center justify-between gap-3"
              aria-label="Paginação"
            >
              <p className="text-sm text-fg-muted">
                {result.total === 0
                  ? 'Nenhum resultado'
                  : `${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, result.total)} de ${result.total}`}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-fg-muted">
                  Página {page} de {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Página anterior"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={page <= 1 || loading}
                >
                  <ChevronLeft size={15} />
                  Anterior
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Próxima página"
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  disabled={page >= totalPages || loading}
                >
                  Próximo
                  <ChevronRight size={15} />
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={clearConfirmOpen}
        title="Limpar fila de envios"
        message="Cancelar somente as entregas ainda não enviadas? Mensagens já aceitas não serão alteradas."
        confirmLabel="Limpar fila"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => {
          setClearConfirmOpen(false);
          void clearPending();
        }}
        onCancel={() => setClearConfirmOpen(false)}
      />
      <DetailDrawer
        open={selectedDelivery !== null || selectedHistoryEvent !== null}
        onClose={closeDetails}
        title={selectedDelivery?.id || selectedHistoryEvent?.id || 'Detalhes do envio'}
        description={
          selectedDelivery
            ? `${selectedDelivery.businessNumber} · ${selectedDelivery.clientName || 'Cliente não identificado'}`
            : selectedHistoryEvent
              ? `${selectedHistoryEvent.flow_name || 'Fluxo sem nome'} · registro do histórico`
              : undefined
        }
        actions={
          selectedDelivery?.businessNumber ? (
            <a
              href={`#/quotations/${encodeURIComponent(selectedDelivery.businessNumber)}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Abrir orçamento
            </a>
          ) : undefined
        }
      >
        {selectedHistoryEvent ? (
          <div className="space-y-5 text-sm">
            <div className="rounded-lg border border-line bg-surface-muted/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Registro de origem
              </p>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-fg-muted">Estado registrado</dt>
                  <dd className="mt-1 font-medium text-fg">
                    {historyStatusLabel(selectedHistoryEvent.status)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">Telefone</dt>
                  <dd className="mt-1 font-medium text-fg">
                    {fmtPhone(selectedHistoryEvent.phone) || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">Etapas</dt>
                  <dd className="mt-1 font-medium text-fg">
                    {selectedHistoryEvent.steps_sent ?? '—'} /{' '}
                    {selectedHistoryEvent.steps_planned ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">Atualizado</dt>
                  <dd className="mt-1 font-medium text-fg">
                    {formatDateTime(
                      selectedHistoryEvent.sent_at || selectedHistoryEvent.created_at
                    ) || '—'}
                  </dd>
                </div>
              </dl>
            </div>
            {historyDetailLoading && (
              <p role="status" className="text-fg-muted">
                Consultando etapas e recibos…
              </p>
            )}
            {historyDetailError && (
              <p role="alert" className="text-destructive">
                {historyDetailError}
              </p>
            )}
            {selectedDelivery && (
              <DeliveryDetails
                delivery={selectedDelivery}
                pending={false}
                readOnly
                onResolve={async () => undefined}
              />
            )}
            {!historyDetailLoading && !historyDetailError && !selectedDelivery && (
              <p className="text-fg-muted">
                O registro histórico não possui um detalhe operacional disponível.
              </p>
            )}
          </div>
        ) : selectedDelivery ? (
          <DeliveryDetails
            delivery={selectedDelivery}
            pending={resolvingId === selectedDelivery.id}
            onResolve={(decision, note) => resolve(selectedDelivery, decision, note)}
          />
        ) : null}
      </DetailDrawer>
    </PageShell>
  );
}
