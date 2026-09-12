import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, ListChecks, RefreshCw } from 'lucide-react';
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
  type CommercialQueueItem,
  type CommercialQueuePage,
  type CommercialQueueProposal,
  type CommercialActionHistoryEntry,
  type CommercialActionScheduleInput,
} from '@/lib/api/commercialQueueApi';

const PAGE_SIZE = 25;
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

function proposalLabel(proposal: CommercialQueueProposal): string {
  const value = proposal.total === null ? 'Sem valor' : formatBRL(proposal.total);
  return `${proposal.businessNumber} · ${proposal.status} · ${value}`;
}

function dueStatusLabel(status: CommercialQueueItem['dueStatus']): string {
  if (status === 'overdue') return 'Atrasada';
  if (status === 'today') return 'Hoje';
  return 'Próxima';
}

function dueLabel(item: CommercialQueueItem): string {
  if (item.scheduleType === 'date_only' && item.dueDate) {
    return `${dueStatusLabel(item.dueStatus)} · ${formatDate(item.dueDate)}`;
  }
  const timestamp = formatDateTime(item.dueAt);
  return item.dueStatus === 'overdue' ? `Atrasada · ${timestamp}` : timestamp;
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
  const requestGenerationRef = useRef(0);

  const load = useCallback(async (requestedPage: number) => {
    const requestGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await listCommercialQueue({ page: requestedPage, pageSize: PAGE_SIZE });
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
    void load(page);
  }, [load, page]);

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
      await load(currentPage);
    } catch (reason) {
      setDialogError(
        reason instanceof Error ? reason.message : 'Não foi possível reagendar a ação.'
      );
    } finally {
      setSubmitting(false);
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
      await load(currentPage);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
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
          onClick={() => void load(page)}
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
            onClick={() => void load(page)}
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
                  <TableHead>Motivo</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <TableRow key={item.actionId}>
                    <TableCell>
                      {clientName(item)}
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
                      <StatusBadge status={item.reasonCode} label={item.reasonLabel} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-fg-muted">
                      {dueLabel(item)}
                    </TableCell>
                    <TableCell>{actionButtons(item)}</TableCell>
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
                    {contactDetail(item) && (
                      <p className="mt-1 text-xs text-fg-muted">{contactDetail(item)}</p>
                    )}
                  </div>
                  <StatusBadge status={item.reasonCode} label={item.reasonLabel} />
                </div>
                <p className="mt-3 text-sm text-fg-muted">
                  {item.demandSummary || 'Demanda não informada'}
                </p>
                {item.proposals.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-fg-muted">
                    {item.proposals.map((proposal) => (
                      <li key={proposal.quotationId}>{proposalLabel(proposal)}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-fg-muted">{dueLabel(item)}</p>
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
