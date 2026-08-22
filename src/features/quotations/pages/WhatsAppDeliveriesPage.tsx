import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Search, Trash2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import SkeletonTable from '@/components/shared/SkeletonTable';
import QuotationDeliveryStatus from '@/features/quotations/components/QuotationDeliveryStatus';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { useToast } from '@/components/shared/toast';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  cancelPendingDeliveries,
  listDeliveries,
  projectDelivery,
  resolveDelivery,
  type DeliveryListFilters,
  type DeliveryPage,
  type DeliveryResolution,
  type DeliveryState,
  type DeliveryView,
} from '@/lib/api/quotationDeliveryApi';
import { fmtPhone } from '@/lib/formatting/formatters';
import { cn } from '@/lib/utils';
import {
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

function parseDeliveryFilters(raw: string | null, fallback: DeliveryFilters): DeliveryFilters {
  if (!raw) return fallback;
  try {
    const candidate = JSON.parse(raw) as Partial<DeliveryFilters>;
    const states = Array.isArray(candidate.states)
      ? candidate.states.filter((state) => STATE_FILTERS.some((filter) => filter.key === state))
      : fallback.states;
    return {
      requiresAction: typeof candidate.requiresAction === 'boolean' ? candidate.requiresAction : fallback.requiresAction,
      includeActive: typeof candidate.includeActive === 'boolean' ? candidate.includeActive : fallback.includeActive,
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

function serializeDeliveryFilters(value: DeliveryFilters, fallback: DeliveryFilters): string | null {
  return JSON.stringify(value) === JSON.stringify(fallback) ? null : JSON.stringify(value);
}

const ACTIVE_STATES: DeliveryState[] = [
  'queued',
  'processing',
  'provider_accepted',
  'reconciling',
  'retry_scheduled',
];

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function stateTone(state: DeliveryState): string {
  if (state === 'delivered') return 'tone-success-soft';
  if (state === 'failed' || state === 'needs_review') return 'tone-destructive-soft';
  if (state === 'retry_scheduled') return 'tone-warning-soft';
  return 'tone-primary-soft';
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
    'inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm transition-colors',
    active
      ? 'border-primary/30 bg-primary/10 text-primary'
      : 'border-line bg-surface text-fg-muted hover:bg-surface-muted hover:text-fg'
  );
}

interface DeliveryDetailsProps {
  delivery: DeliveryView;
  pending: boolean;
  onResolve: (decision: DeliveryResolution, note: string) => Promise<void>;
}

function DeliveryDetails({ delivery, pending, onResolve }: DeliveryDetailsProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <QuotationDeliveryStatus
        delivery={delivery}
        pending={pending}
        onResolve={onResolve}
        className="[&>div:first-child]:hidden"
      />
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Passos da entrega
        </h3>
        <ol className="mt-3 space-y-2" aria-label={`Passos da entrega ${delivery.businessNumber}`}>
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
                </div>
                <p className="mt-1 text-fg-muted">
                  Tentativas: {step.attemptCount} · Atualizado em {formatDateTime(step.updatedAt)}
                </p>
                {step.publicError && <p className="mt-1 text-destructive">{step.publicError}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function WhatsAppDeliveriesPage() {
  const [filters, setFilters] = useHashQueryState(
    'filters',
    DEFAULT_FILTERS,
    parseDeliveryFilters,
    serializeDeliveryFilters,
  );
  const [page, setPage] = useHashQueryState('page', 1, parseHashPositiveInteger);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [result, setResult] = useState<DeliveryPage | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

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
    setLoading(true);
    setError(null);
    listDeliveries(requestFilters)
      .then((nextResult) => {
        if (cancelled) return;
        setResult(nextResult);
        setExpandedId((current) => {
          if (current && nextResult.data.some((delivery) => delivery.id === current))
            return current;
          return (
            nextResult.data.find((delivery) => projectDelivery(delivery).requiresAction)?.id || null
          );
        });
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(
          nextError instanceof Error ? nextError.message : 'Não foi possível consultar as entregas.'
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadVersion, requestFilters]);

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
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : 'Não foi possível limpar a fila.';
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
      setExpandedId(null);
    } finally {
      setResolvingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil((result?.total || 0) / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-[1060px] space-y-4 pb-10 animate-fade-in">
      <PageHeader title="Envios WhatsApp" />

      <section
        className="space-y-4 rounded-xl border border-line bg-surface p-4 shadow-sm"
        aria-labelledby="delivery-filters-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="delivery-filters-title" className="text-sm font-semibold text-fg">
            Filtros
          </h2>
          <div className="flex flex-wrap items-center gap-2">
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setClearConfirmOpen(true)}
              disabled={loading || clearing}
              className="ml-1 border-l border-line pl-3 text-destructive hover:bg-destructive/10"
            >
              <Trash2 size={14} />
              {clearing ? 'Limpando…' : 'Limpar fila'}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className={filterInputClass(filters.requiresAction)}>
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={filters.requiresAction}
              onChange={(event) =>
                updateFilters((current) => ({ ...current, requiresAction: event.target.checked }))
              }
            />
            Requer ação
          </label>
          <label className={filterInputClass(filters.includeActive)}>
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={filters.includeActive}
              onChange={(event) =>
                updateFilters((current) => ({ ...current, includeActive: event.target.checked }))
              }
            />
            Em processamento
          </label>
          <label className={filterInputClass(filters.delayed)}>
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
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
                className="h-4 w-4 accent-primary"
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
                value={filters.from ? filters.from.split('-').reverse().join('/') : ''}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
                  const iso = digits.length >= 5
                    ? `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`
                    : '';
                  updateFilters((current) => ({ ...current, from: iso }));
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
                value={filters.to ? filters.to.split('-').reverse().join('/') : ''}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
                  const iso = digits.length >= 5
                    ? `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`
                    : '';
                  updateFilters((current) => ({ ...current, to: iso }));
                }}
              />
            </label>
          </fieldset>
        </div>
      </section>

      {result && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Resumo das entregas">
          {[
            ['Ativos', result.summary.active],
            ['Requer ação', result.summary.requiresAction],
            ['Reagendado', result.summary.retryScheduled],
            ['Atrasados', result.summary.delayed],
            ['Entregues nas últimas 24 horas', result.summary.deliveredLast24Hours],
          ].map(([label, value]) => (
            <article key={label} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
              <p className="text-xs font-medium text-fg-muted">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-fg">{value}</p>
            </article>
          ))}
        </section>
      )}

      {error && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
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

      {loading && !result ? (
        <SkeletonTable cols={8} rows={8} />
      ) : result && result.data.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-line bg-surface p-10 text-center text-sm text-fg-muted"
          role="status"
        >
          Nenhuma entrega encontrada para os filtros selecionados.
        </div>
      ) : result ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Orçamento</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Fluxo</TableHead>
                <TableHead>Passos entregues/total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Última atualização</TableHead>
                <TableHead>Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((delivery, index) => {
                const expanded = expandedId === delivery.id;
                const projection = projectDelivery(delivery);
                const detailId = `whatsapp-delivery-details-${index}`;
                const detailsActionLabel = `${expanded ? 'Ocultar detalhes de' : 'Detalhes de'} ${delivery.businessNumber}, linha ${index + 1}`;
                return (
                  <Fragment key={delivery.id}>
                    <TableRow>
                      <TableCell className="whitespace-nowrap font-medium text-fg">
                        {delivery.businessNumber}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">
                        {delivery.clientName}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {fmtPhone(delivery.phone) || 'Telefone não identificado'}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">
                        {delivery.flowName || 'Fluxo não identificado'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {delivery.progress.delivered} / {delivery.progress.total}
                      </TableCell>
                      <TableCell>
                        <span role="status" aria-live="polite">
                          <StatusBadge
                            status={delivery.state}
                            label={projection.label}
                            className={stateTone(delivery.state)}
                          />
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-fg-muted">
                        {formatDateTime(delivery.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={detailsActionLabel}
                          aria-controls={detailId}
                          aria-expanded={expanded}
                          onClick={() => setExpandedId(expanded ? null : delivery.id)}
                        >
                          {expanded ? 'Ocultar detalhes' : 'Detalhes'}
                        </Button>
                      </TableCell>
                    </TableRow>
                    <TableRow id={detailId} key={`${delivery.id}-details`} hidden={!expanded}>
                      <TableCell colSpan={8} className="bg-surface-muted/40">
                        {expanded && (
                          <DeliveryDetails
                            delivery={delivery}
                            pending={resolvingId === delivery.id}
                            onResolve={(decision, note) => resolve(delivery, decision, note)}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex flex-wrap items-center justify-between gap-3" aria-label="Paginação">
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
                Próxima
                <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        </>
      ) : null}

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
    </div>
  );
}
