import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import {
  AlertTriangle,
  Ban,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListChecks,
  MessageCircle,
  Search,
  RefreshCw,
  Star,
} from 'lucide-react';
import EmptyState from '@/components/shared/EmptyState';
import SkeletonTable from '@/components/shared/SkeletonTable';
import FollowUpReviewDrawer from '@/features/follow-ups/components/FollowUpReviewDrawer';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { fmtPhone, formatBRL, formatDate, formatDateTime } from '@/lib/formatting/formatters';
import {
  associateCommercialInbound,
  completeCommercialAction,
  continueCommercialFollowUp,
  createCommercialAction,
  getCommercialFollowUpSuggestion,
  getCommercialActionHistory,
  listCommercialQueue,
  recordManualContact,
  rescheduleCommercialAction,
  setCommercialUrgency,
  unblockCommercialContact,
  type CommercialQueueFilter,
  type CommercialQueueItem,
  type CommercialQueuePage,
  type CommercialQueueProposal,
  type CommercialActionHistoryEntry,
  type CommercialActionScheduleInput,
  type CommercialFollowUpBusinessDays,
  type CommercialFollowUpContinuityType,
  type CommercialFollowUpSuggestion,
  type CommercialManualContactResultCode,
  type CommercialManualContactType,
} from '@/lib/api/commercialQueueApi';
import { getFollowUp, type FollowUpView } from '@/lib/api/followUpApi';

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
const MANUAL_CONTACT_TYPES = [
  ['phone_call', 'Ligação telefônica'],
  ['external_conversation', 'Conversa externa'],
] as const satisfies ReadonlyArray<[CommercialManualContactType, string]>;
const MANUAL_CONTACT_RESULTS = [
  ['follow_up_agreed', 'Próximo passo combinado'],
  ['interested', 'Interessado'],
  ['not_interested', 'Sem interesse'],
  ['no_response', 'Sem resposta'],
  ['awaiting_information', 'Aguardando informação'],
  ['wrong_contact', 'Contato incorreto'],
  ['other', 'Outro resultado'],
] as const satisfies ReadonlyArray<[CommercialManualContactResultCode, string]>;

type ActionKind = (typeof ACTION_KINDS)[number][0];
type Dialog =
  | { type: 'create'; item: CommercialQueueItem }
  | { type: 'schedule'; item: CommercialQueueItem }
  | { type: 'complete'; item: CommercialQueueItem }
  | { type: 'manual-contact'; item: CommercialQueueItem; commandId: string }
  | { type: 'continue-follow-up'; item: CommercialQueueItem; commandId: string }
  | { type: 'associate-response'; item: CommercialQueueItem }
  | { type: 'unblock-contact'; item: CommercialQueueItem }
  | { type: 'history'; item: CommercialQueueItem };

interface ScheduleDraft {
  kind: ActionKind;
  dueDate: string;
  dueTime: string;
  reason: string;
}

type ManualContactContinuation = 'successor' | 'wait' | 'close' | '';

interface ManualContactDraft extends ScheduleDraft {
  contactType: CommercialManualContactType;
  occurredAt: string;
  note: string;
  resultCode: CommercialManualContactResultCode;
  countsAsFollowUp: boolean;
  continuation: ManualContactContinuation;
  closeReason: string;
}

interface ManualContactSuggestion {
  anchorDate: string;
  date: string;
  label: string;
  businessDays: CommercialFollowUpBusinessDays;
  occurredAt: string;
}

interface ManualContactSuggestionEligibility {
  label: string;
  businessDays: CommercialFollowUpBusinessDays;
}

interface AppliedManualContactSuggestion {
  occurredAt: string;
  before: Pick<ManualContactDraft, 'kind' | 'dueDate' | 'dueTime' | 'reason' | 'continuation'>;
  after: Pick<ManualContactDraft, 'kind' | 'dueDate' | 'dueTime' | 'reason' | 'continuation'>;
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

function localDateTimeInSaoPaulo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

function localDateTimeToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return '';
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59) {
    return '';
  }
  const candidate = new Date(`${value}:00-03:00`);
  return Number.isNaN(candidate.getTime()) ? '' : candidate.toISOString();
}

function manualContactDraft(item: CommercialQueueItem): ManualContactDraft {
  const schedule = scheduleDraft(item);
  return {
    ...schedule,
    contactType: 'phone_call',
    occurredAt: localDateTimeInSaoPaulo(),
    note: '',
    resultCode: 'follow_up_agreed',
    countsAsFollowUp: false,
    continuation: '',
    closeReason: '',
  };
}

function manualContactSuggestionEligibility(
  item: CommercialQueueItem,
  draft: ManualContactDraft
): ManualContactSuggestionEligibility | null {
  if (item.followUpStage !== 0 || draft.continuation) return null;
  if (draft.resultCode === 'awaiting_information') {
    return { businessDays: 2, label: 'Primeiro retorno' };
  }
  if (draft.resultCode === 'no_response' && draft.countsAsFollowUp) {
    return { businessDays: 3, label: 'Segundo retorno' };
  }
  return null;
}

function manualContactSuggestionForCurrentDraft(
  item: CommercialQueueItem,
  draft: ManualContactDraft,
  suggestion: ManualContactSuggestion | null
): ManualContactSuggestion | null {
  const eligibility = manualContactSuggestionEligibility(item, draft);
  if (
    !eligibility ||
    !suggestion ||
    suggestion.occurredAt !== draft.occurredAt ||
    suggestion.businessDays !== eligibility.businessDays
  ) {
    return null;
  }
  return suggestion;
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
    if (item.reasonCode === 'verify_conversation') {
      return 'Último contato: verificar conversa (telemetria insuficiente)';
    }
    if (item.reasonCode === 'associate_response') {
      return 'Último contato: associar resposta (mais de uma demanda)';
    }
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
  return 'Agendada';
}

function dueStatusTone(status: CommercialQueueItem['dueStatus']): string {
  if (status === 'overdue') return 'tone-destructive-soft';
  if (status === 'today') return 'tone-warning-soft';
  if (status === 'closed') return 'tone-neutral-muted';
  return 'tone-primary-soft';
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
  if (type === 'manual_contact') return 'Declaração manual';
  return 'Substituída';
}

function manualContactTypeLabel(value: CommercialActionHistoryEntry['contactType']): string {
  return MANUAL_CONTACT_TYPES.find(([type]) => type === value)?.[1] || 'Contato manual';
}

function manualContactResultLabel(value: CommercialActionHistoryEntry['resultCode']): string {
  return (
    MANUAL_CONTACT_RESULTS.find(([code]) => code === value)?.[1] || value || 'Resultado informado'
  );
}

export default function CommercialQueuePanel({ navigate }: CommercialQueuePanelProps) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CommercialQueuePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft | ManualContactDraft | null>(null);
  const [completionMode, setCompletionMode] = useState<'successor' | 'close'>('successor');
  const [continuityType, setContinuityType] =
    useState<CommercialFollowUpContinuityType>('new_cycle');
  const [history, setHistory] = useState<CommercialActionHistoryEntry[]>([]);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [urgencySubmitting, setUrgencySubmitting] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<CommercialQueueFilter>('active');
  const [search, setSearch] = useState('');
  const [manualSuggestion, setManualSuggestion] = useState<ManualContactSuggestion | null>(null);
  const [followUpReview, setFollowUpReview] = useState<FollowUpView | null>(null);
  const [followUpReviewLoading, setFollowUpReviewLoading] = useState(false);
  const [associationTarget, setAssociationTarget] = useState('');
  const [unblockReason, setUnblockReason] = useState('');
  const requestGenerationRef = useRef(0);
  const manualSuggestionRequestRef = useRef(0);
  const manualSuggestionAbortRef = useRef<AbortController | null>(null);
  const appliedManualSuggestionRef = useRef<AppliedManualContactSuggestion | null>(null);

  const manualContactItem = dialog?.type === 'manual-contact' ? dialog.item : null;
  const manualContactDraftState = draft && 'contactType' in draft ? draft : null;
  const manualContactActionId = manualContactItem?.actionId ?? null;
  const manualContactFollowUpStage = manualContactItem?.followUpStage ?? null;
  const manualContactOccurredAt = manualContactDraftState?.occurredAt ?? null;
  const manualContactResultCode = manualContactDraftState?.resultCode ?? null;
  const manualContactCountsAsFollowUp = manualContactDraftState?.countsAsFollowUp ?? null;
  const manualContactContinuation = manualContactDraftState?.continuation ?? null;

  useEffect(() => {
    const requestId = ++manualSuggestionRequestRef.current;
    manualSuggestionAbortRef.current?.abort();
    manualSuggestionAbortRef.current = null;
    setManualSuggestion(null);

    if (!manualContactItem || !manualContactDraftState || manualContactDraftState.continuation)
      return;
    const eligibility = manualContactSuggestionEligibility(
      manualContactItem,
      manualContactDraftState
    );
    const occurredAt = localDateTimeToIso(manualContactDraftState.occurredAt);
    if (!eligibility || !occurredAt) return;

    const controller = new AbortController();
    manualSuggestionAbortRef.current = controller;
    void getCommercialFollowUpSuggestion({
      occurredAt,
      businessDays: eligibility.businessDays,
      signal: controller.signal,
    })
      .then((result: CommercialFollowUpSuggestion) => {
        if (controller.signal.aborted || requestId !== manualSuggestionRequestRef.current) return;
        setManualSuggestion({
          anchorDate: result.anchorDate,
          date: result.suggestedDate,
          label: eligibility.label,
          businessDays: result.businessDays,
          occurredAt: manualContactDraftState.occurredAt,
        });
      })
      .catch(() => {
        // Suggestions are optional; an unavailable read must not block a manual declaration.
      });

    return () => controller.abort();
  }, [
    manualContactActionId,
    manualContactFollowUpStage,
    manualContactOccurredAt,
    manualContactResultCode,
    manualContactCountsAsFollowUp,
    manualContactContinuation,
  ]);

  const load = useCallback(
    async (requestedPage: number, requestedFilter: CommercialQueueFilter) => {
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
    },
    []
  );

  useEffect(() => {
    void load(page, filter);
  }, [filter, load, page]);

  const rows = result?.data || [];
  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
  const visibleRows = normalizedSearch
    ? rows.filter((item) =>
        [contactLabel(item), item.reasonLabel, item.reason, item.demandSummary, item.kindLabel]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase('pt-BR').includes(normalizedSearch))
      )
    : rows;
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

  function openManualContact(item: CommercialQueueItem) {
    appliedManualSuggestionRef.current = null;
    setDialog({ type: 'manual-contact', item, commandId: globalThis.crypto.randomUUID() });
    setDraft(manualContactDraft(item));
    setDialogError(null);
  }

  function openContinueFollowUp(item: CommercialQueueItem) {
    setDialog({
      type: 'continue-follow-up',
      item,
      commandId: globalThis.crypto.randomUUID(),
    });
    setContinuityType('new_cycle');
    setDraft(scheduleDraft(item));
    setDialogError(null);
  }

  function openAssociateResponse(item: CommercialQueueItem) {
    setDialog({ type: 'associate-response', item });
    setAssociationTarget(item.associationCandidates[0]?.opportunityId || item.opportunityId);
    setDraft(null);
    setDialogError(null);
  }

  function openUnblockContact(item: CommercialQueueItem) {
    setDialog({ type: 'unblock-contact', item });
    setUnblockReason('');
    setDraft(null);
    setDialogError(null);
  }

  async function openFollowUpReview(item: CommercialQueueItem) {
    if (item.reasonCode !== 'proposal_delivery_confirmed' || !item.sourceQuotationId) return;
    setFollowUpReview(null);
    setFollowUpReviewLoading(true);
    try {
      setFollowUpReview(await getFollowUp({
        quotationId: item.sourceQuotationId,
        expectedOpportunityId: item.opportunityId,
        expectedActionId: item.actionId,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o follow-up.');
    } finally {
      setFollowUpReviewLoading(false);
    }
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
    appliedManualSuggestionRef.current = null;
    setDialog(null);
    setDraft(null);
    setDialogError(null);
  }

  function updateDraft(field: keyof ScheduleDraft, value: string) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateManualDraft<K extends keyof ManualContactDraft>(
    field: K,
    value: ManualContactDraft[K]
  ) {
    if (field === 'occurredAt') {
      const applied = appliedManualSuggestionRef.current;
      appliedManualSuggestionRef.current = null;
      if (applied) {
        setDraft((current) => {
          if (
            !current ||
            !('contactType' in current) ||
            current.occurredAt !== applied.occurredAt
          ) {
            return current ? { ...current, [field]: value } : current;
          }
          const next: ManualContactDraft = { ...current, occurredAt: value as string };
          if (current.kind === applied.after.kind) next.kind = applied.before.kind;
          if (current.dueDate === applied.after.dueDate) next.dueDate = applied.before.dueDate;
          if (current.dueTime === applied.after.dueTime) next.dueTime = applied.before.dueTime;
          if (current.reason === applied.after.reason) next.reason = applied.before.reason;
          if (current.continuation === applied.after.continuation) {
            next.continuation = applied.before.continuation;
          }
          return next;
        });
        return;
      }
    }
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function useManualContactSuggestion() {
    if (!dialog || dialog.type !== 'manual-contact' || !draft || !('contactType' in draft)) return;
    const suggestion = manualContactSuggestionForCurrentDraft(dialog.item, draft, manualSuggestion);
    if (!suggestion) return;
    const before = {
      kind: draft.kind,
      dueDate: draft.dueDate,
      dueTime: draft.dueTime,
      reason: draft.reason,
      continuation: draft.continuation,
    };
    const after = {
      kind: 'customer_contact' as const,
      dueDate: suggestion.date,
      dueTime: '',
      reason: 'Acompanhar retorno pré-orçamento',
      continuation: 'wait' as const,
    };
    appliedManualSuggestionRef.current = {
      occurredAt: draft.occurredAt,
      before,
      after,
    };
    setDraft((current) => {
      if (
        !current ||
        !('contactType' in current) ||
        current.continuation ||
        current.occurredAt !== suggestion.occurredAt
      ) {
        return current;
      }
      return {
        ...current,
        ...after,
      };
    });
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
    if (isClosed(item) || item.state !== 'active' || urgencySubmitting.has(item.opportunityId))
      return;
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
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a urgência.');
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

  async function submitContinueFollowUp() {
    if (!dialog || dialog.type !== 'continue-follow-up' || !draft) return;
    if (!draft.dueDate || !draft.reason.trim()) {
      setDialogError('Informe a data e o motivo da continuidade.');
      return;
    }
    setSubmitting(true);
    setDialogError(null);
    try {
      await continueCommercialFollowUp({
        commandId: dialog.commandId,
        opportunityId: dialog.item.opportunityId,
        actionId: dialog.item.actionId,
        expectedVersion: dialog.item.version,
        type: continuityType,
        schedule: {
          kind: draft.kind,
          dueDate: draft.dueDate,
          dueTime: draft.dueTime || null,
          reason: draft.reason,
        },
      });
      closeDialog(true);
      await load(currentPage, filter);
    } catch (reason) {
      setDialogError(
        reason instanceof Error ? reason.message : 'Não foi possível registrar a continuidade.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAssociateResponse() {
    if (!dialog || dialog.type !== 'associate-response' || !associationTarget) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      await associateCommercialInbound({
        alertActionId: dialog.item.actionId,
        expectedVersion: dialog.item.version,
        opportunityId: associationTarget,
      });
      closeDialog(true);
      await load(currentPage, filter);
    } catch (reason) {
      setDialogError(
        reason instanceof Error ? reason.message : 'Não foi possível associar a resposta.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitUnblockContact() {
    if (!dialog || dialog.type !== 'unblock-contact') return;
    const target = dialog.item.blockedContactPhone || dialog.item.contactPhone;
    if (!target) return;
    if (!unblockReason.trim()) {
      setDialogError('Informe o motivo do desbloqueio.');
      return;
    }
    setSubmitting(true);
    setDialogError(null);
    try {
      await unblockCommercialContact({
        canonicalPhone: target,
        reason: unblockReason.trim(),
      });
      closeDialog(true);
      await load(currentPage, filter);
    } catch (reason) {
      setDialogError(
        reason instanceof Error ? reason.message : 'Não foi possível desbloquear o contato.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitManualContact() {
    if (!dialog || dialog.type !== 'manual-contact' || !draft || !('contactType' in draft)) return;
    if (!draft.continuation) {
      setDialogError('Escolha a continuidade do contato.');
      return;
    }
    const occurredAt = localDateTimeToIso(draft.occurredAt);
    if (!occurredAt) {
      setDialogError('Informe uma data e hora válidas para o contato.');
      return;
    }
    if (draft.continuation === 'close' && !draft.closeReason.trim()) {
      setDialogError('Informe o motivo do fechamento.');
      return;
    }
    if (draft.continuation !== 'close' && (!draft.dueDate || !draft.reason.trim())) {
      setDialogError('Informe a data e o motivo da continuidade.');
      return;
    }

    setSubmitting(true);
    setDialogError(null);
    try {
      const continuation =
        draft.continuation === 'close'
          ? { type: 'close' as const, closeReason: draft.closeReason }
          : {
              type: draft.continuation,
              schedule: {
                kind: draft.kind,
                dueDate: draft.dueDate,
                dueTime: draft.dueTime || null,
                reason: draft.reason,
              } as CommercialActionScheduleInput,
            };
      await recordManualContact({
        commandId: dialog.commandId,
        opportunityId: dialog.item.opportunityId,
        actionId: dialog.item.actionId,
        expectedVersion: dialog.item.version,
        contactType: draft.contactType,
        occurredAt,
        note: draft.note.trim() || null,
        resultCode: draft.resultCode,
        countsAsFollowUp: draft.countsAsFollowUp,
        continuation,
      });
      closeDialog(true);
      await load(currentPage, filter);
    } catch (reason) {
      setDialogError(
        reason instanceof Error ? reason.message : 'Não foi possível registrar o contato.'
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

  function manualContactFields() {
    if (!draft || !('contactType' in draft)) return null;
    const suggestion =
      dialog?.type === 'manual-contact'
        ? manualContactSuggestionForCurrentDraft(dialog.item, draft, manualSuggestion)
        : null;
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Tipo de contato
          <select
            aria-label="Tipo de contato"
            required
            className="h-9 rounded-sm border border-input bg-background px-3"
            value={draft.contactType}
            onChange={(event) =>
              updateManualDraft('contactType', event.target.value as CommercialManualContactType)
            }
          >
            {MANUAL_CONTACT_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Data e hora do contato
          <input
            aria-label="Data e hora do contato"
            required
            type="datetime-local"
            className="h-9 rounded-md border border-input bg-background px-3"
            value={draft.occurredAt}
            onChange={(event) => updateManualDraft('occurredAt', event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Resultado
          <select
            aria-label="Resultado do contato"
            required
            className="h-9 rounded-sm border border-input bg-background px-3"
            value={draft.resultCode}
            onChange={(event) =>
              updateManualDraft(
                'resultCode',
                event.target.value as CommercialManualContactResultCode
              )
            }
          >
            {MANUAL_CONTACT_RESULTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            aria-label="Follow-up comercial concluído"
            type="checkbox"
            checked={draft.countsAsFollowUp}
            onChange={(event) => updateManualDraft('countsAsFollowUp', event.target.checked)}
          />
          Follow-up comercial concluído
        </label>
        {suggestion && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-muted px-3 py-2 text-sm sm:col-span-2">
            <span>
              {suggestion.label} sugerido: {formatDate(suggestion.date)}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={useManualContactSuggestion}>
              Usar sugestão
            </Button>
          </div>
        )}
        <label className="grid gap-1 text-sm sm:col-span-2">
          Observação <span className="text-fg-muted">(opcional)</span>
          <textarea
            aria-label="Observação do contato"
            className="min-h-20 rounded-md border border-input bg-background px-3 py-2"
            value={draft.note}
            onChange={(event) => updateManualDraft('note', event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">
          Continuidade
          <select
            aria-label="Continuidade"
            required
            className="h-9 rounded-sm border border-input bg-background px-3"
            value={draft.continuation}
            onChange={(event) =>
              updateManualDraft('continuation', event.target.value as ManualContactContinuation)
            }
          >
            <option value="">Selecione uma continuidade</option>
            <option value="successor">Criar próxima ação</option>
            <option value="wait">Aguardar até uma data</option>
            <option value="close">Fechar oportunidade</option>
          </select>
        </label>
        {draft.continuation === 'close' ? (
          <label className="grid gap-1 text-sm sm:col-span-2">
            Motivo do fechamento
            <textarea
              aria-label="Motivo do fechamento"
              required
              className="min-h-20 rounded-md border border-input bg-background px-3 py-2"
              value={draft.closeReason}
              onChange={(event) => updateManualDraft('closeReason', event.target.value)}
            />
          </label>
        ) : draft.continuation ? (
          <>
            <label className="grid gap-1 text-sm">
              Tipo da próxima ação
              <select
                aria-label="Tipo da próxima ação"
                required
                className="h-9 rounded-sm border border-input bg-background px-3"
                value={draft.kind}
                onChange={(event) => updateManualDraft('kind', event.target.value as ActionKind)}
              >
                {kindOptions()}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              {draft.continuation === 'wait' ? 'Data para aguardar' : 'Data da próxima ação'}
              <input
                aria-label={
                  draft.continuation === 'wait' ? 'Data para aguardar' : 'Data da próxima ação'
                }
                required
                type="date"
                className="h-9 rounded-md border border-input bg-background px-3"
                value={draft.dueDate}
                onChange={(event) => updateManualDraft('dueDate', event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Horário <span className="text-fg-muted">(opcional)</span>
              <input
                aria-label="Horário da continuidade"
                type="time"
                className="h-9 rounded-md border border-input bg-background px-3"
                value={draft.dueTime}
                onChange={(event) => updateManualDraft('dueTime', event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              Motivo da continuidade
              <textarea
                aria-label="Motivo da continuidade"
                required
                className="min-h-20 rounded-md border border-input bg-background px-3 py-2"
                value={draft.reason}
                onChange={(event) => updateManualDraft('reason', event.target.value)}
              />
            </label>
          </>
        ) : null}
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
    if (item.reasonCode === 'associate_response') {
      return (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => openAssociateResponse(item)}>
            Associar resposta
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void openHistory(item)}>
            Histórico
          </Button>
          {item.contactContext.blockers.some((blocker) => blocker.code === 'do_not_contact') &&
            (item.blockedContactPhone || item.contactPhone) && (
              <Button type="button" variant="outline" size="sm" onClick={() => openUnblockContact(item)}>
                Desbloquear contato
              </Button>
            )}
        </div>
      );
    }
    if (
      item.state === 'suspended' &&
      item.contactContext.blockers.some((blocker) => blocker.code === 'do_not_contact')
    ) {
      return (
        <div className="flex flex-wrap gap-2">
          {(item.blockedContactPhone || item.contactPhone) && (
            <Button type="button" variant="outline" size="sm" onClick={() => openUnblockContact(item)}>
              Desbloquear contato
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => void openHistory(item)}>
            Histórico
          </Button>
        </div>
      );
    }
    if (item.state !== 'active') {
      return (
        <span className="text-xs text-fg-muted">Resultado: {item.reason || item.reasonLabel}</span>
      );
    }
    if (item.reasonCode === 'follow_up_decide_continuity') {
      return (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => openContinueFollowUp(item)}>
            Decidir continuidade
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void openHistory(item)}>
            Histórico
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap gap-2">
        {item.reasonCode === 'proposal_delivery_confirmed' && item.sourceQuotationId && (
          <Button
            type="button"
            variant="success"
            size="sm"
            disabled={followUpReviewLoading}
            onClick={() => void openFollowUpReview(item)}
          >
            {followUpReviewLoading ? 'Carregando…' : 'Revisar retorno'}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => openCreate(item)}>
          Nova ação
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openSchedule(item)}>
          Reagendar
        </Button>
        <Button type="button" size="sm" onClick={() => openComplete(item)}>
          Concluir
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openManualContact(item)}>
          Registrar contato
        </Button>
        {item.contactContext.blockers.some((blocker) => blocker.code === 'do_not_contact') &&
          (item.blockedContactPhone || item.contactPhone) && (
            <Button type="button" variant="outline" size="sm" onClick={() => openUnblockContact(item)}>
              Desbloquear contato
            </Button>
          )}
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
      <div className="space-y-1 rounded-xl border border-line bg-surface-subtle p-3 text-xs text-fg-muted">
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
    <div className="space-y-5">
      {!loading && !error && (
        <section aria-label="Resumo da fila nesta página" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {([
            ['Atrasadas', 'overdue'],
            ['Hoje', 'today'],
            ['Agendadas', 'upcoming'],
            ['Encerradas', 'closed'],
          ] as const).map(([label, status]) => (
            <article key={status} className="rounded-card border border-line bg-surface p-4">
              <p className="text-sm text-fg-muted">{label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {rows.filter((item) => item.dueStatus === status).length}
              </p>
              <p className="mt-1 text-xs text-fg-muted">Nesta página</p>
            </article>
          ))}
        </section>
      )}

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
          <input
            type="search"
            aria-label="Buscar nesta página da fila"
            placeholder="Buscar cliente ou ação"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 w-full rounded-control border border-input bg-background pl-9 pr-3 text-sm"
          />
        </label>
        <div
          className="flex flex-wrap gap-1 rounded-control bg-surface-subtle p-1"
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
                  ? 'rounded-control bg-primary/15 px-3 py-1.5 text-sm font-medium text-primary'
                  : 'rounded-control px-3 py-1.5 text-sm text-fg-muted hover:bg-surface hover:text-fg'
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

      {showPagination && (
        <nav aria-label="Paginação da fila" className="flex items-center justify-end gap-2 text-sm text-fg-muted">
          <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={loading || currentPage <= 1}>
            <ChevronLeft aria-hidden="true" /> Anterior
          </Button>
          <span aria-live="polite">Página {Math.min(currentPage, lastPage)} de {lastPage}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.min(lastPage, current + 1))} disabled={loading || currentPage >= lastPage}>
            Próxima <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => void load(page, filter)}>Tentar novamente</Button>
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
      ) : visibleRows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nenhuma ação nesta visualização"
          description="Altere a busca ou o status."
        />
      ) : (
        <div role="table" aria-label="Agenda comercial" className="space-y-3">
          {visibleRows.map((item) => (
            <article key={item.actionId} role="row" className="grid gap-4 rounded-card border border-line bg-surface p-4 xl:grid-cols-[110px_minmax(180px,1.2fr)_minmax(160px,1fr)_minmax(180px,1.2fr)_minmax(150px,1fr)] xl:items-center xl:p-5">
              <div role="cell" className="flex items-center gap-2 xl:block">
                <time dateTime={item.dueAt} className="font-semibold tabular-nums">{formatDate(item.dueDate || item.dueAt)}</time>
                <span className="text-sm text-fg-muted">{item.scheduleType === 'date_only' ? 'Dia inteiro' : item.dueTime || formatDateTime(item.dueAt).split(', ')[1] || '—'}</span>
              </div>
              <div role="cell" className="min-w-0">
                <p className="font-medium">{item.reason || item.reasonLabel}</p>
                <p className="mt-1 text-sm text-fg-muted">{item.kindLabel}</p>
              </div>
              <div role="cell" className="min-w-0">
                <div className="truncate">{clientName(item)}</div>
                {contactDetail(item) && <p className="mt-1 truncate text-xs text-fg-muted">{contactDetail(item)}</p>}
              </div>
              <div role="cell" className="space-y-2">
                <StatusBadge status={item.dueStatus} label={dueStatusLabel(item.dueStatus)} className={dueStatusTone(item.dueStatus)} />
                {item.isUrgent && <StatusBadge status="urgent" label="Urgente" />}
                <p className="text-xs text-fg-muted">{item.demandSummary || 'Demanda não informada'}</p>
                {item.proposals.length > 0 && <ul className="space-y-1 text-xs text-fg-muted">{item.proposals.map((proposal) => <li key={proposal.quotationId}>{proposalLabel(proposal)}</li>)}</ul>}
                <div className="text-xs text-fg-muted">{contextDetails(item)}</div>
              </div>
              <div role="cell" className="flex flex-wrap items-center gap-2 xl:justify-end">
                {urgencyButton(item)}
                {whatsappLink(item)}
                {actionButtons(item)}
              </div>
            </article>
          ))}
        </div>
      )}

      {dialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="commercial-action-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-card border border-line bg-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2 id="commercial-action-dialog-title" className="text-lg font-semibold">
                {dialog.type === 'create'
                  ? 'Criar nova ação'
                  : dialog.type === 'schedule'
                    ? 'Reagendar próxima ação'
                    : dialog.type === 'complete'
                        ? 'Concluir próxima ação'
                        : dialog.type === 'manual-contact'
                          ? 'Registrar contato'
                        : dialog.type === 'continue-follow-up'
                            ? 'Decidir continuidade'
                          : dialog.type === 'associate-response'
                            ? 'Associar resposta'
                          : dialog.type === 'unblock-contact'
                            ? 'Desbloquear contato'
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
                      <li key={entry.eventId} className="rounded-xl border border-line bg-surface-subtle p-4 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="font-medium">{historyLabel(entry.type)}</span>
                          <time dateTime={entry.timestamp}>{formatDateTime(entry.timestamp)}</time>
                        </div>
                        {entry.type === 'manual_contact' ? (
                          <>
                            <p className="mt-1 text-fg-muted">
                              {manualContactTypeLabel(entry.contactType)} ·{' '}
                              {manualContactResultLabel(entry.resultCode)} · {entry.actor}
                            </p>
                            <p className="mt-1 text-fg-muted">
                              {entry.countsAsFollowUp
                                ? 'Contou como follow-up comercial concluído'
                                : 'Não contou como follow-up comercial'}{' '}
                              · Continuidade:{' '}
                              {entry.continuationType === 'close'
                                ? 'fechamento'
                                : entry.continuationType === 'wait'
                                  ? 'aguardar'
                                  : 'próxima ação'}
                            </p>
                            {entry.note && <p className="mt-1 whitespace-pre-wrap">{entry.note}</p>}
                          </>
                        ) : (
                          <p className="mt-1 text-fg-muted">
                            {entry.reason} · {entry.actor} · {entry.origin}
                          </p>
                        )}
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
                    : dialog.type === 'manual-contact'
                      ? submitManualContact()
                      : dialog.type === 'continue-follow-up'
                        ? submitContinueFollowUp()
                        : dialog.type === 'associate-response'
                          ? submitAssociateResponse()
                        : dialog.type === 'unblock-contact'
                          ? submitUnblockContact()
                        : submitComplete());
                }}
              >
                {dialog.type === 'associate-response' && (
                  <label className="grid gap-1 text-sm">
                    Oportunidade da resposta
                    <select
                      aria-label="Oportunidade da resposta"
                      required
                      className="h-9 rounded-sm border border-input bg-background px-3"
                      value={associationTarget}
                      onChange={(event) => setAssociationTarget(event.target.value)}
                    >
                      {dialog.item.associationCandidates.map((candidate) => (
                        <option key={candidate.opportunityId} value={candidate.opportunityId}>
                          {candidate.demandSummary || candidate.opportunityId}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {dialog.type === 'unblock-contact' && (
                  <label className="grid gap-1 text-sm">
                    Motivo do desbloqueio
                    <textarea
                      aria-label="Motivo do desbloqueio"
                      required
                      maxLength={500}
                      className="min-h-20 rounded-md border border-input bg-background px-3 py-2"
                      value={unblockReason}
                      onChange={(event) => setUnblockReason(event.target.value)}
                    />
                  </label>
                )}
                {dialog.type === 'manual-contact' && manualContactFields()}
                {dialog.type === 'continue-follow-up' && (
                  <>
                    <label className="grid gap-1 text-sm">
                      Decisão de continuidade
                      <select
                        aria-label="Decisão de continuidade"
                        className="h-9 rounded-sm border border-input bg-background px-3"
                        value={continuityType}
                        onChange={(event) =>
                          setContinuityType(event.target.value as CommercialFollowUpContinuityType)
                        }
                      >
                        <option value="new_cycle">Iniciar novo ciclo</option>
                        <option value="manual_date">Confirmar uma data</option>
                      </select>
                    </label>
                    {scheduleFields()}
                  </>
                )}
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
                {dialog.type === 'manual-contact' || dialog.type === 'continue-follow-up' || dialog.type === 'associate-response' || dialog.type === 'unblock-contact' ? null : dialog.type === 'complete' &&
                  completionMode === 'close' ? (
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
                          : dialog.type === 'manual-contact'
                            ? 'Registrar contato'
                            : dialog.type === 'continue-follow-up'
                              ? 'Confirmar continuidade'
                            : dialog.type === 'associate-response'
                              ? 'Associar resposta'
                            : dialog.type === 'unblock-contact'
                              ? 'Desbloquear contato'
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

      <FollowUpReviewDrawer
        followUp={followUpReview}
        onClose={() => setFollowUpReview(null)}
        onChanged={() => {
          setFollowUpReview(null);
          void load(currentPage, filter);
        }}
      />
    </div>
  );
}
