import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import {
  AlertTriangle,
  Ban,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListChecks,
  MessageCircle,
  RefreshCw,
  Star,
} from 'lucide-react';
import EmptyState from '@/components/shared/EmptyState';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fmtPhone, formatBRL, formatDate, formatDateTime } from '@/lib/formatting/formatters';
import {
  completeCommercialAction,
  createCommercialAction,
  getCommercialActionHistory,
  listCommercialQueue,
  rescheduleCommercialAction,
  setCommercialUrgency,
  type CommercialQueueFilter,
  type CommercialQueueItem,
  type CommercialQueuePage,
  type CommercialQueueProposal,
  type CommercialActionHistoryEntry,
  type CommercialActionScheduleInput,
} from '@/lib/api/commercialQueueApi';

const PAGE_SIZE = 25;
const QUEUE_FILTERS: ReadonlyArray<[CommercialQueueFilter, string]> = [
  ['active', 'Todas'],
  ['overdue', 'Atrasadas'],
  ['today', 'Hoje'],
  ['scheduled', 'Agendadas'],
  ['closed', 'Encerradas'],
];
const ACTION_KINDS = [
  ['first_contact', 'Primeiro contato'],
  ['internal', 'Ação interna'],
  ['customer_contact', 'Contato com cliente'],
  ['agreed_commitment', 'Compromisso acordado'],
  ['review', 'Revisão'],
] as const;

type ActionKind = (typeof ACTION_KINDS)[number][0];
type Dialog =
  | { type: 'create'; item: CommercialQueueItem }
  | { type: 'schedule'; item: CommercialQueueItem }
  | { type: 'complete'; item: CommercialQueueItem }
  | { type: 'history'; item: CommercialQueueItem };

interface ScheduleDraft {
  kind: ActionKind;
  dueDate: string;
  dueTime: string;
  reason: string;
}

function scheduleDraft(item: CommercialQueueItem): ScheduleDraft {
  return {
    kind: ACTION_KINDS.some(([kind]) => kind === item.kind)
      ? (item.kind as ActionKind)
      : 'customer_contact',
    dueDate: item.dueDate || '',
    dueTime: item.dueTime || '',
    reason: '',
  };
}

interface CommercialQueuePanelProps {
  navigate: (hash: string) => void;
}

function contactLabel(item: CommercialQueueItem): string {
  return item.clientName || item.contactName;
}

function contactDetail(item: CommercialQueueItem): string | null {
  return fmtPhone(item.contactPhone) || item.contactEmail;
}

function contactContextLabel(item: CommercialQueueItem): string {
  if (item.contactContext.status === 'review') {
    return 'Último contato: revisão necessária (atribuição ambígua)';
  }
  if (item.contactContext.status === 'unavailable' || !item.contactContext.lastContactAt) {
    return 'Último contato: indisponível';
  }
  const direction =
    item.contactContext.lastContactDirection === 'inbound'
      ? 'cliente'
      : item.contactContext.lastContactDirection === 'outbound'
        ? 'comercial'
        : 'contato';
  return `Último contato (${direction}): ${formatDateTime(item.contactContext.lastContactAt)}`;
}

function proposalLabel(proposal: CommercialQueueProposal): string {
  const value = proposal.total === null ? 'Sem valor' : formatBRL(proposal.total);
  return `${proposal.businessNumber} · ${proposal.status} · ${value}`;
}

function dueStatusLabel(status: CommercialQueueItem['dueStatus']): string {
  if (status === 'overdue') return 'Atrasada';
  if (status === 'today') return 'Hoje';
  if (status === 'closed') return 'Encerrada';
  return 'Próxima';
}

function dueLabel(item: CommercialQueueItem): string {
  if (item.scheduleType === 'date_only' && item.dueDate) {
    return `${dueStatusLabel(item.dueStatus)} · ${formatDate(item.dueDate)}`;
  }
  if (item.dueStatus === 'closed') return `Encerrada · ${formatDateTime(item.dueAt)}`;
  const timestamp = formatDateTime(item.dueAt);
  return item.dueStatus === 'overdue' ? `Atrasada · ${timestamp}` : timestamp;
}

function isClosed(item: CommercialQueueItem): boolean {
  return item.dueStatus === 'closed' || item.terminalStatus !== null;
}

function terminalContext(item: CommercialQueueItem) {
  if (!isClosed(item)) return null;
  return (
    <div className="space-y-1 text-xs text-fg-muted">
      <p>Status final: {item.terminalStatus || item.opportunityStatus || 'Encerrada'}</p>
      {item.terminalReason && <p>Motivo do encerramento: {item.terminalReason}</p>}
      {item.terminalAt && <p>Encerrado em: {formatDateTime(item.terminalAt)}</p>}
    </div>
  );
}

function historyLabel(type: CommercialActionHistoryEntry['type']): string {
  if (type === 'created') return 'Criada';
  if (type === 'rescheduled') return 'Reagendada';
  if (type === 'completed') return 'Concluída';
  return 'Substituída';
}

export default function CommercialQueuePanel({ navigate }: CommercialQueuePanelProps) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CommercialQueuePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [completionMode, setCompletionMode] = useState<'successor' | 'close'>('successor');
  const [history, setHistory] = useState<CommercialActionHistoryEntry[]>([]);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [urgencySubmitting, setUrgencySubmitting] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<CommercialQueueFilter>('active');
  const requestGenerationRef = useRef(0);

  const load = useCallback(async (requestedPage: number, requestedFilter: CommercialQueueFilter) => {
    const requestGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await listCommercialQueue({
        page: requestedPage,
        pageSize: PAGE_SIZE,
        filter: requestedFilter,
      });
      if (requestGeneration !== requestGenerationRef.current) return;
      setResult(next);
      // The server clamps a page that no longer exists to the last valid one.
      // Adopt it so navigation continues from real remaining work instead of
      // an empty page the operator can no longer leave.
      if (next.page !== requestedPage) setPage(next.page);
    } catch (reason) {
      if (requestGeneration !== requestGenerationRef.current) return;
      setResult(null);
      setError(
        reason instanceof Error ? reason.message : 'Não foi possível carregar a fila comercial.'
      );
    } finally {
      if (requestGeneration === requestGenerationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page, filter);
  }, [filter, load, page]);

  const rows = result?.data || [];
  const total = result?.total ?? 0;
  // The rendered page is always the one the server actually served.
  const currentPage = result?.page ?? page;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showPagination = !loading && !error && total > PAGE_SIZE;

  function openClient(event: MouseEvent<HTMLAnchorElement>, clientId: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(`/leads/cliente/${encodeURIComponent(clientId)}`);
  }

  function clientName(item: CommercialQueueItem) {
    if (!item.clientId) return <span className="font-medium">{contactLabel(item)}</span>;
    return (
      <a
        href={`#/leads/cliente/${encodeURIComponent(item.clientId)}`}
        className="font-medium text-primary hover:underline"
        onClick={(event) => openClient(event, item.clientId!)}
      >
        {contactLabel(item)}
      </a>
    );
  }

  function openSchedule(item: CommercialQueueItem) {
    setDialog({ type: 'schedule', item });
    setDraft(scheduleDraft(item));
    setDialogError(null);
  }

  function openCreate(item: CommercialQueueItem) {
    setDialog({ type: 'create', item });
    setDraft(scheduleDraft(item));
    setDialogError(null);
  }

  function openComplete(item: CommercialQueueItem) {
    setDialog({ type: 'complete', item });
    setDraft(scheduleDraft(item));
    setCompletionMode('successor');
    setDialogError(null);
  }

  async function openHistory(item: CommercialQueueItem) {
    setDialog({ type: 'history', item });
    setHistory([]);
    setDialogError(null);
    try {
      setHistory(await getCommercialActionHistory(item.opportunityId));
    } catch (reason) {
      setDialogError(
        reason instanceof Error ? reason.message : 'Não foi possível carregar o histórico.'
      );
    }
  }

  function closeDialog(force = false) {
    if (submitting && !force) return;
    setDialog(null);
    setDraft(null);
    setDialogError(null);
  }

  function updateDraft(field: keyof ScheduleDraft, value: string) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  async function submitSchedule() {
    if (!dialog || (dialog.type !== 'schedule' && dialog.type !== 'create') || !draft) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      if (dialog.type === 'create') {
        await createCommercialAction({
          opportunityId: dialog.item.opportunityId,
          replaceActionId: dialog.item.actionId,
          expectedVersion: dialog.item.version,
          ...draft,
          dueTime: draft.dueTime || null,
        });
      } else {
        await rescheduleCommercialAction({
          actionId: dialog.item.actionId,
          expectedVersion: dialog.item.version,
          ...draft,
          dueTime: draft.dueTime || null,
        });
      }
      closeDialog(true);
      await load(currentPage, filter);
    } catch (reason) {
      setDialogError(
        reason instanceof Error ? reason.message : 'Não foi possível reagendar a ação.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleUrgency(item: CommercialQueueItem) {
    if (isClosed(item) || item.state !== 'active' || urgencySubmitting.has(item.opportunityId)) return;
    setUrgencySubmitting((current) => new Set(current).add(item.opportunityId));
    try {
      await setCommercialUrgency({
        opportunityId: item.opportunityId,
        actionId: item.actionId,
        expectedVersion: item.version,
        isUrgent: !item.isUrgent,
      });
      await load(currentPage, filter);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Não foi possível atualizar a urgência.'
      );
    } finally {
      setUrgencySubmitting((current) => {
        const next = new Set(current);
        next.delete(item.opportunityId);
        return next;
      });
    }
  }

  async function submitComplete() {
    if (!dialog || dialog.type !== 'complete' || !draft) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      const base = {
        actionId: dialog.item.actionId,
        expectedVersion: dialog.item.version,
      };
      if (completionMode === 'successor') {
        await completeCommercialAction({
          ...base,
          outcome: {
            successor: {
              ...draft,
              dueTime: draft.dueTime || null,
            } as CommercialActionScheduleInput,
          },
        });
      } else {
        await completeCommercialAction({
          ...base,
          outcome: { closeReason: draft.reason },
        });
      }
      closeDialog(true);
          await load(currentPage, filter);
    } catch (reason) {
      setDialogError(
        reason instanceof Error ? reason.message : 'Não foi possível concluir a ação.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  function kindOptions() {
    return ACTION_KINDS.map(([value, label]) => (
      <option key={value} value={value}>
        {label}
      </option>
    ));
  }

  function scheduleFields() {
    if (!draft) return null;
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Tipo de ação
          <select
            aria-label="Tipo de ação"
            className="h-9 rounded-sm border border-input bg-background px-3"
            value={draft.kind}
            onChange={(event) => updateDraft('kind', event.target.value)}
          >
            {kindOptions()}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Data local
          <input
            aria-label="Data local"
            required
            type="date"
            className="h-9 rounded-md border border-input bg-background px-3"
            value={draft.dueDate}
            onChange={(event) => updateDraft('dueDate', event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Horário local <span className="text-fg-muted">(opcional)</span>
          <input
            aria-label="Horário local"
            type="time"
            className="h-9 rounded-md border border-input bg-background px-3"
            value={draft.dueTime}
            onChange={(event) => updateDraft('dueTime', event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">
          Motivo
          <textarea
            aria-label="Motivo"
            required
            className="min-h-20 rounded-md border border-input bg-background px-3 py-2"
            value={draft.reason}
            onChange={(event) => updateDraft('reason', event.target.value)}
          />
        </label>
      </div>
    );
  }

  function actionButtons(item: CommercialQueueItem) {
    if (isClosed(item)) {
      return (
        <div className="space-y-2">
          {terminalContext(item)}
          <Button type="button" variant="ghost" size="sm" onClick={() => void openHistory(item)}>
            Histórico
          </Button>
        </div>
      );
    }
    if (item.state !== 'active') {
      return (
        <span className="text-xs text-fg-muted">
          Resultado: {item.reason || item.reasonLabel}
        </span>
      );
    }
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => openCreate(item)}>
          Nova ação
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openSchedule(item)}>
          Reagendar
        </Button>
        <Button type="button" size="sm" onClick={() => openComplete(item)}>
          Concluir
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => void openHistory(item)}>
          Histórico
        </Button>
      </div>
    );
  }

  function whatsappLink(item: CommercialQueueItem) {
    if (!item.whatsappHref) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
          <Ban size={13} aria-hidden="true" /> WhatsApp indisponível
        </span>
      );
    }
    return (
      <a
        href={item.whatsappHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        aria-label={`Abrir WhatsApp de ${contactLabel(item)}`}
      >
        <MessageCircle size={13} aria-hidden="true" /> WhatsApp
        <ExternalLink size={11} aria-hidden="true" />
      </a>
    );
  }

  function contextDetails(item: CommercialQueueItem) {
    return (
      <div className="space-y-1 text-xs text-fg-muted">
        <p>Motivo: {item.reason || item.reasonLabel}</p>
        <p>Prazo: {dueLabel(item)}</p>
        <p>{contactContextLabel(item)}</p>
        {item.contactContext.blockers.length > 0 ? (
          <p className="inline-flex items-center gap-1 text-destructive">
            <Ban size={13} aria-hidden="true" />
            Bloqueio: {item.contactContext.blockers.map((blocker) => blocker.label).join(', ')}
          </p>
        ) : (
          <p>Bloqueios: nenhum conhecido</p>
        )}
      </div>
    );
  }

  function urgencyButton(item: CommercialQueueItem) {
    if (isClosed(item) || item.state !== 'active') return null;
    const submittingUrgency = urgencySubmitting.has(item.opportunityId);
    return (
      <Button
        type="button"
        variant={item.isUrgent ? 'default' : 'outline'}
        size="sm"
        aria-label={item.isUrgent ? 'Remover urgência' : 'Marcar como urgente'}
        aria-pressed={item.isUrgent}
        disabled={submittingUrgency}
        onClick={() => void toggleUrgency(item)}
      >
        <Star aria-hidden="true" className={item.isUrgent ? 'fill-current' : undefined} />
        {item.isUrgent ? 'Urgente' : 'Marcar urgente'}
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div
          className="mr-auto flex flex-wrap gap-1 rounded-sm border border-line bg-surface p-1"
          role="tablist"
          aria-label="Cortes da fila comercial"
        >
          {QUEUE_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={
                filter === value
                  ? 'rounded-sm bg-surface-muted px-3 py-1.5 text-sm font-medium text-fg'
                  : 'rounded-sm px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg'
              }
              onClick={() => {
                if (value === filter) return;
                setPage(1);
                setFilter(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {showPagination && (
          <nav
            aria-label="Paginação da fila"
            className="mr-auto flex items-center gap-2 text-sm text-fg-muted"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={loading || currentPage <= 1}
            >
              <ChevronLeft aria-hidden="true" />
              Anterior
            </Button>
            <span aria-live="polite">
              Página {Math.min(currentPage, lastPage)} de {lastPage}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
              disabled={loading || currentPage >= lastPage}
            >
              Próxima
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load(page, filter)}
          disabled={loading}
        >
          <RefreshCw aria-hidden="true" className={loading ? 'animate-spin' : undefined} />
          Atualizar
        </Button>
      </div>

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
          onClick={() => void load(page, filter)}
          >
            Tentar novamente
          </Button>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={5} cols={4} />
      ) : error ? null : rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nenhuma próxima ação"
          description="Leads novos entram aqui com o primeiro atendimento pendente."
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface lg:block">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Contato</TableHead>
                  <TableHead>Demanda</TableHead>
                  <TableHead>Propostas</TableHead>
                  <TableHead>Contexto</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <TableRow key={item.actionId}>
                    <TableCell>
                      {clientName(item)}
                      {item.clientName && item.contactName !== item.clientName && (
                        <p className="text-xs text-fg-muted">Contato: {item.contactName}</p>
                      )}
                      {contactDetail(item) && (
                        <p className="text-xs text-fg-muted">{contactDetail(item)}</p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-96 truncate text-fg-muted">
                      {item.demandSummary || 'Demanda não informada'}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {item.proposals.length === 0 ? (
                        <span className="text-xs">Sem propostas</span>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {item.proposals.map((proposal) => (
                            <li key={proposal.quotationId} className="whitespace-nowrap">
                              {proposalLabel(proposal)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell>
                      {contextDetails(item)}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        {item.isUrgent && <StatusBadge status="urgent" label="Urgente" />}
                        {urgencyButton(item)}
                        {whatsappLink(item)}
                        {actionButtons(item)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-3 lg:hidden">
            {rows.map((item) => (
              <article key={item.actionId} className="rounded-md border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate">{clientName(item)}</p>
                    {item.clientName && item.contactName !== item.clientName && (
                      <p className="mt-1 truncate text-xs text-fg-muted">
                        Contato: {item.contactName}
                      </p>
                    )}
                    {contactDetail(item) && (
                      <p className="mt-1 text-xs text-fg-muted">{contactDetail(item)}</p>
                    )}
                  </div>
                  {item.isUrgent && <StatusBadge status="urgent" label="Urgente" />}
                </div>
                <p className="mt-3 text-sm text-fg-muted">
                  {item.demandSummary || 'Demanda não informada'}
                </p>
                <p className="mt-1 text-xs text-fg-muted">Oportunidade: {item.opportunityId}</p>
                {item.proposals.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-fg-muted">
                    {item.proposals.map((proposal) => (
                      <li key={proposal.quotationId}>{proposalLabel(proposal)}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-3">{contextDetails(item)}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {urgencyButton(item)}
                  {whatsappLink(item)}
                </div>
                <div className="mt-3">{actionButtons(item)}</div>
              </article>
            ))}
          </div>
        </>
      )}

      {dialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="commercial-action-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2 id="commercial-action-dialog-title" className="text-lg font-semibold">
                {dialog.type === 'create'
                  ? 'Criar nova ação'
                  : dialog.type === 'schedule'
                    ? 'Reagendar próxima ação'
                    : dialog.type === 'complete'
                      ? 'Concluir próxima ação'
                      : 'Histórico da próxima ação'}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => closeDialog()}
                disabled={submitting}
              >
                Fechar
              </Button>
            </div>

            {dialog.type === 'history' ? (
              <div className="mt-4 space-y-3">
                {dialogError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {dialogError}
                  </p>
                ) : history.length === 0 ? (
                  <p className="text-sm text-fg-muted">Nenhum evento registrado.</p>
                ) : (
                  <ol className="space-y-3">
                    {history.map((entry) => (
                      <li key={entry.eventId} className="rounded-md border border-line p-3 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="font-medium">{historyLabel(entry.type)}</span>
                          <time dateTime={entry.timestamp}>{formatDateTime(entry.timestamp)}</time>
                        </div>
                        <p className="mt-1 text-fg-muted">
                          {entry.reason} · {entry.actor} · {entry.origin}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : (
              <form
                className="mt-4 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void (dialog.type === 'schedule' || dialog.type === 'create'
                    ? submitSchedule()
                    : submitComplete());
                }}
              >
                {dialog.type === 'complete' && (
                  <label className="grid gap-1 text-sm">
                    Resultado
                    <select
                      aria-label="Resultado"
                      className="h-9 rounded-sm border border-input bg-background px-3"
                      value={completionMode}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                        setCompletionMode(event.target.value as 'successor' | 'close')
                      }
                    >
                      <option value="successor">Criar próxima ação</option>
                      <option value="close">Fechar oportunidade</option>
                    </select>
                  </label>
                )}
                {dialog.type === 'complete' && completionMode === 'close' ? (
                  <label className="grid gap-1 text-sm">
                    Motivo do fechamento
                    <textarea
                      aria-label="Motivo do fechamento"
                      required
                      className="min-h-20 rounded-md border border-input bg-background px-3 py-2"
                      value={draft?.reason || ''}
                      onChange={(event) => updateDraft('reason', event.target.value)}
                    />
                  </label>
                ) : (
                  scheduleFields()
                )}
                {dialogError && (
                  <p role="alert" className="text-sm text-destructive">
                    {dialogError}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => closeDialog()}
                    disabled={submitting}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting
                      ? 'Salvando…'
                      : dialog.type === 'create'
                        ? 'Criar ação'
                        : dialog.type === 'schedule'
                          ? 'Reagendar'
                          : completionMode === 'successor'
                            ? 'Concluir e criar próxima'
                            : 'Concluir e fechar'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
