import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import { ArrowDown, ArrowLeft, MessagesSquare, PanelRight } from 'lucide-react';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { DetailDrawer } from '@/components/shared/DetailDrawer';
import EmptyState from '@/components/shared/EmptyState';
import EntityIdentity from '@/components/shared/EntityIdentity';
import ErrorState from '@/components/shared/ErrorState';
import InlineAlert from '@/components/shared/InlineAlert';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import PageToolbar from '@/components/shared/PageToolbar';
import { Button } from '@/components/ui/button';
import { SearchField } from '@/components/ui/search-field';
import { Select } from '@/components/ui/select';
import { fmtPhone } from '@/lib/formatting/formatters';
import { cn } from '@/lib/utils';
import {
  fetchConversations,
  fetchMessagesAfter,
  fetchMessagesBefore,
  markConversationRead,
  runMessageAction,
  updateConversationStatus,
  type AttendanceConversation,
  type AttendanceMessage,
  type AttendanceStatus,
  type AttendanceStatusFilter,
} from '@/lib/api/attendanceApi';
import type { ApiError } from '@/lib/api/api';
import { fetchAttendanceContext, type ContextDelivery } from '@/lib/api/attendanceContextApi';
import { enqueueDelivery } from '@/lib/api/quotationDeliveryApi';
import { prepareAtendimentoQuoteDraft } from '@/lib/api/atendimentoQuoteDraftApi';
import ContextPanel from '@/features/attendance/components/ContextPanel';
import ConversationList, { conversationName } from '@/features/attendance/components/ConversationList';
import MessageComposer from '@/features/attendance/components/MessageComposer';
import MessageTimeline, { type MessageActionName } from '@/features/attendance/components/MessageTimeline';
import { STATUS_FILTERS, STATUS_LABELS } from '@/features/attendance/attendanceLabels';
import { useVisiblePolling } from '@/features/attendance/useVisiblePolling';

const CONVERSATION_POLL_MS = 5_000;
const LIST_POLL_MS = 10_000;
const NEAR_BOTTOM_PX = 80;
const MAX_INCREMENTAL_PAGES = 5;
const WIDE_MEDIA_QUERY = '(min-width: 1280px)';

interface Thread {
  conversationId: string;
  conversation: AttendanceConversation | null;
  messages: AttendanceMessage[];
  olderCursor: string | null;
  hasOlder: boolean;
  revision: number;
  loading: boolean;
  error: string | null;
}

function selectedFromHash(): string | null {
  const query = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(query).get('conversationId');
}

// The context panel is a column on wide screens and a drawer otherwise; only
// one of them is mounted, so the context is read once.
function useWideLayout(): boolean {
  const [wide, setWide] = useState(() => Boolean(window.matchMedia?.(WIDE_MEDIA_QUERY).matches));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia(WIDE_MEDIA_QUERY);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return wide;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function byTimeline(a: AttendanceMessage, b: AttendanceMessage): number {
  return a.timestamp === b.timestamp ? a.id.localeCompare(b.id) : a.timestamp.localeCompare(b.timestamp);
}

function byActivity(a: AttendanceConversation, b: AttendanceConversation): number {
  const at = (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '');
  return at !== 0 ? at : b.id.localeCompare(a.id);
}

function mergeMessages(current: AttendanceMessage[], incoming: AttendanceMessage[]): AttendanceMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    // An echo merged into an operator reply is removed, not shown twice.
    if (message.supersededBy) {
      byId.delete(message.id);
      continue;
    }
    const known = byId.get(message.id);
    if (!known || known.revision <= message.revision) byId.set(message.id, message);
  }
  return [...byId.values()].sort(byTimeline);
}

function emptyThread(conversationId: string): Thread {
  return {
    conversationId,
    conversation: null,
    messages: [],
    olderCursor: null,
    hasOlder: false,
    revision: 0,
    loading: true,
    error: null,
  };
}

interface AttendancePageProps {
  navigate: (hash: string) => void;
}

export default function AttendancePage({ navigate }: AttendancePageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(selectedFromHash);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [statusFilter, setStatusFilter] = useState<AttendanceStatusFilter>('active');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [conversations, setConversations] = useState<AttendanceConversation[]>([]);
  const [listCursor, setListCursor] = useState<string | null>(null);
  const [listHasMore, setListHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [listLoadingMore, setListLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const listRequest = useRef(0);

  const [thread, setThread] = useState<Thread | null>(null);
  const threadRef = useRef<Thread | null>(null);
  threadRef.current = thread;
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; token: number } | null>(null);
  const [confirmResend, setConfirmResend] = useState<string | null>(null);
  const [hasUnseenBelow, setHasUnseenBelow] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const scrollAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const stickToBottomRef = useRef(false);
  const readRequestRef = useRef(0);
  const wide = useWideLayout();
  const [contextOpen, setContextOpen] = useState(false);
  const [deliveryView, setDeliveryView] = useState<{ conversationId: string; items: ContextDelivery[] } | null>(null);
  const [deliveryPending, setDeliveryPending] = useState<string | null>(null);
  const [selectedForQuote, setSelectedForQuote] = useState<string[]>([]);
  const [preparingQuote, setPreparingQuote] = useState(false);

  const loadDeliveries = useCallback(async () => {
    const conversationId = selectedIdRef.current;
    if (!conversationId) return;
    try {
      const context = await fetchAttendanceContext(conversationId);
      if (selectedIdRef.current !== conversationId) return;
      setDeliveryView({ conversationId, items: context.match === 'matched' ? context.deliveries || [] : [] });
    } catch {
      // The context panel displays its own error; messages remain usable.
    }
  }, []);

  useEffect(() => {
    setDeliveryView(null);
    if (selectedId) void loadDeliveries();
  }, [selectedId, loadDeliveries]);
  useVisiblePolling(loadDeliveries, LIST_POLL_MS, Boolean(selectedId));

  const sendDelivery = async (delivery: ContextDelivery) => {
    const conversationId = selectedIdRef.current;
    if (!conversationId || !delivery.canSend) return;
    setDeliveryPending(delivery.id);
    setStatusNotice(null);
    try {
      const current = await fetchAttendanceContext(conversationId);
      const approved = current.match === 'matched' && current.deliveries?.some(
        (item) => item.id === delivery.id && item.revisionId === delivery.revisionId && item.canSend,
      );
      if (!approved) {
        if (selectedIdRef.current === conversationId) setStatusNotice('A entrega mudou. Atualize o contexto antes de enviar.');
        return;
      }
      if (selectedIdRef.current !== conversationId) return;
      await enqueueDelivery({ quotationId: delivery.quotationId, revisionId: delivery.revisionId, flowId: delivery.flowId });
      if (selectedIdRef.current === conversationId) await loadDeliveries();
    } catch (error) {
      if (selectedIdRef.current === conversationId) setStatusNotice(errorMessage(error, 'Não foi possível enviar o orçamento.'));
    } finally {
      setDeliveryPending(null);
    }
  };

  useEffect(() => {
    const onHash = () => setSelectedId(selectedFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // ── Conversation list ──────────────────────────────────────────────
  const loadFirstPage = useCallback(
    async (mode: 'replace' | 'refresh') => {
      const request = ++listRequest.current;
      if (mode === 'replace') setListLoading(true);
      try {
        const page = await fetchConversations({ status: statusFilter, q: debouncedSearch });
        if (request !== listRequest.current) return;
        setListError(null);
        setConversations((current) => {
          if (mode === 'replace') return page.items;
          // Keep every loaded conversation: one pushed out of the first page by
          // newer activity must stay visible, since the "load more" cursor
          // already points past it.
          const fresh = new Set(page.items.map((item) => item.id));
          return [...page.items, ...current.filter((item) => !fresh.has(item.id))].sort(byActivity);
        });
        if (mode === 'replace') {
          setListCursor(page.nextCursor);
          setListHasMore(page.hasMore);
        }
      } catch (error) {
        if (request !== listRequest.current) return;
        setListError(errorMessage(error, 'Não foi possível carregar as conversas.'));
        if (mode === 'refresh') throw error;
      } finally {
        if (request === listRequest.current) setListLoading(false);
      }
    },
    [statusFilter, debouncedSearch]
  );

  useEffect(() => {
    void loadFirstPage('replace');
  }, [loadFirstPage]);

  useVisiblePolling(() => loadFirstPage('refresh'), LIST_POLL_MS, true);

  const loadMoreConversations = async () => {
    if (!listCursor) return;
    const request = listRequest.current;
    setListLoadingMore(true);
    try {
      const page = await fetchConversations({ status: statusFilter, q: debouncedSearch, cursor: listCursor });
      if (request !== listRequest.current) return;
      setConversations((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setListCursor(page.nextCursor);
      setListHasMore(page.hasMore);
    } catch (error) {
      setListError(errorMessage(error, 'Não foi possível carregar mais conversas.'));
    } finally {
      setListLoadingMore(false);
    }
  };

  const patchListItem = useCallback((conversation: AttendanceConversation) => {
    setConversations((current) => current.map((item) => (item.id === conversation.id ? conversation : item)));
  }, []);

  // ── Selected conversation ──────────────────────────────────────────
  const loadThread = useCallback(async (conversationId: string) => {
    setThread(emptyThread(conversationId));
    setSelectedForQuote([]);
    setPrefill(null);
    setHasUnseenBelow(false);
    setStatusNotice(null);
    nearBottomRef.current = true;
    stickToBottomRef.current = true;
    try {
      const page = await fetchMessagesBefore(conversationId);
      // A response for a conversation the operator already left is dropped.
      if (threadRef.current?.conversationId !== conversationId) return;
      setThread({
        conversationId,
        conversation: page.conversation,
        messages: mergeMessages([], page.items),
        olderCursor: page.nextCursor ?? null,
        hasOlder: page.hasMore,
        revision: page.revision,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (threadRef.current?.conversationId !== conversationId) return;
      setThread({
        ...emptyThread(conversationId),
        loading: false,
        error:
          (error as ApiError)?.status === 404
            ? 'Conversa não encontrada.'
            : errorMessage(error, 'Não foi possível carregar as mensagens.'),
      });
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadThread(selectedId);
    else setThread(null);
  }, [selectedId, loadThread]);

  const pollThread = useCallback(async () => {
    const current = threadRef.current;
    if (!current || current.loading || current.error) return;
    const { conversationId } = current;
    let revision = current.revision;
    let conversation = current.conversation;
    const incoming: AttendanceMessage[] = [];
    for (let page = 0; page < MAX_INCREMENTAL_PAGES; page += 1) {
      const result = await fetchMessagesAfter(conversationId, revision);
      if (threadRef.current?.conversationId !== conversationId) return;
      incoming.push(...result.items);
      conversation = result.conversation;
      revision = result.revision;
      if (!result.hasMore) break;
    }
    if (threadRef.current?.conversationId !== conversationId) return;
    const newestKnown = current.messages.at(-1)?.timestamp || '';
    const arrivedBelow = incoming.some((message) => message.timestamp >= newestKnown);
    if (arrivedBelow) {
      if (nearBottomRef.current) stickToBottomRef.current = true;
      else setHasUnseenBelow(true);
    }
    setThread((previous) =>
      previous && previous.conversationId === conversationId
        ? { ...previous, conversation, revision, messages: mergeMessages(previous.messages, incoming) }
        : previous
    );
    if (conversation) patchListItem(conversation);
  }, [patchListItem]);

  useVisiblePolling(pollThread, CONVERSATION_POLL_MS, Boolean(selectedId));

  const loadOlder = async () => {
    const current = threadRef.current;
    if (!current?.olderCursor) return;
    const { conversationId } = current;
    const element = timelineRef.current;
    setLoadingOlder(true);
    try {
      const page = await fetchMessagesBefore(conversationId, current.olderCursor);
      if (threadRef.current?.conversationId !== conversationId) return;
      if (element) scrollAnchorRef.current = { height: element.scrollHeight, top: element.scrollTop };
      setThread((previous) =>
        previous && previous.conversationId === conversationId
          ? {
              ...previous,
              messages: mergeMessages(previous.messages, page.items),
              olderCursor: page.nextCursor ?? null,
              hasOlder: page.hasMore,
            }
          : previous
      );
    } catch (error) {
      setStatusNotice(errorMessage(error, 'Não foi possível carregar as mensagens anteriores.'));
    } finally {
      setLoadingOlder(false);
    }
  };

  // Keep the reading position: older pages grow upwards, new messages only
  // scroll into view when the operator is already at the end.
  useLayoutEffect(() => {
    const element = timelineRef.current;
    if (!element) return;
    if (scrollAnchorRef.current) {
      const { height, top } = scrollAnchorRef.current;
      element.scrollTop = element.scrollHeight - height + top;
      scrollAnchorRef.current = null;
    } else if (stickToBottomRef.current) {
      element.scrollTop = element.scrollHeight;
      stickToBottomRef.current = false;
    }
  }, [thread?.messages]);

  // Mark as read only what was actually rendered while the end is in view.
  const markRead = useCallback(async () => {
    const current = threadRef.current;
    if (!current?.conversation || !nearBottomRef.current || document.visibilityState !== 'visible') return;
    const shown = current.messages.reduce((max, message) => Math.max(max, message.createdRevision), 0);
    if (shown <= current.conversation.readRevision || current.conversation.unreadCount === 0) return;
    const request = ++readRequestRef.current;
    try {
      const updated = await markConversationRead(current.conversationId, shown);
      if (request !== readRequestRef.current || threadRef.current?.conversationId !== updated.id) return;
      setThread((previous) =>
        previous && previous.conversationId === updated.id ? { ...previous, conversation: updated } : previous
      );
      patchListItem(updated);
    } catch {
      // The next render or poll retries; reading is never assumed.
    }
  }, [patchListItem]);

  useEffect(() => {
    void markRead();
  }, [thread?.messages, thread?.conversation?.unreadCount, markRead]);

  const onTimelineScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    nearBottomRef.current = nearBottom;
    if (nearBottom && hasUnseenBelow) {
      setHasUnseenBelow(false);
      void markRead();
    }
  };

  const scrollToEnd = () => {
    const element = timelineRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    nearBottomRef.current = true;
    setHasUnseenBelow(false);
    void markRead();
  };

  const changeStatus = async (status: AttendanceStatus) => {
    const current = threadRef.current;
    if (!current?.conversation || current.conversation.status === status) return;
    setStatusNotice(null);
    try {
      const updated = await updateConversationStatus(current.conversationId, status, current.conversation.revision);
      setThread((previous) =>
        previous && previous.conversationId === updated.id
          ? { ...previous, conversation: updated, revision: Math.max(previous.revision, updated.revision) }
          : previous
      );
      patchListItem(updated);
    } catch (error) {
      const apiError = error as ApiError;
      setStatusNotice(errorMessage(error, 'Não foi possível alterar a situação.'));
      if (apiError?.status === 409) void pollThread();
    }
  };

  const copyForResend = (messageId: string) => {
    const source = threadRef.current?.messages.find((message) => message.id === messageId);
    if (source?.body) setPrefill({ text: source.body, token: Date.now() });
  };

  const runAction = async (messageId: string, action: MessageActionName) => {
    if (action === 'resend') {
      copyForResend(messageId);
      return;
    }
    if (action === 'resend_uncertain') {
      setConfirmResend(messageId);
      return;
    }
    const target = threadRef.current?.messages.find((message) => message.id === messageId);
    if (!target) return;
    setActionPending(messageId);
    setStatusNotice(null);
    try {
      await runMessageAction(messageId, action, target.revision);
    } catch (error) {
      setStatusNotice(errorMessage(error, 'Não foi possível atualizar o envio.'));
    } finally {
      setActionPending(null);
      void pollThread();
    }
  };

  const onSent = useCallback(() => {
    stickToBottomRef.current = true;
    void pollThread();
  }, [pollThread]);

  const useAiSuggestion = useCallback((conversationId: string, suggestion: string) => {
    if (selectedIdRef.current !== conversationId) return;
    setPrefill({ text: suggestion, token: Date.now() });
  }, []);

  const prepareQuote = async () => {
    const conversationId = selectedIdRef.current;
    if (!conversationId || selectedForQuote.length === 0 || preparingQuote) return;
    const ids = [...selectedForQuote].sort();
    const key = `aspen-attendance-quote-pending:${conversationId}`;
    const selectionKey = ids.join(',');
    let demandId: string = globalThis.crypto.randomUUID();
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(key) || 'null') as { selectionKey?: string; demandId?: string } | null;
      if (saved?.selectionKey === selectionKey && saved.demandId) demandId = saved.demandId;
      window.sessionStorage.setItem(key, JSON.stringify({ selectionKey, demandId }));
    } catch { /* A live request still uses one stable ID. */ }
    setPreparingQuote(true);
    setStatusNotice(null);
    try {
      const draft = await prepareAtendimentoQuoteDraft({ conversationId, demandId, messageIds: ids });
      if (selectedIdRef.current !== conversationId) return;
      try { window.sessionStorage.removeItem(key); } catch { /* unavailable */ }
      navigate(draft.destination.split('#')[1] || '/novo-orcamento');
    } catch (error) {
      if (selectedIdRef.current === conversationId) setStatusNotice(errorMessage(error, 'Não foi possível preparar o orçamento.'));
    } finally {
      setPreparingQuote(false);
    }
  };

  const selectConversation = (id: string) => navigate(`/atendimento?conversationId=${encodeURIComponent(id)}`);
  const filtered = statusFilter !== 'active' || Boolean(debouncedSearch);
  const conversation = thread?.conversation || null;

  return (
    <PageShell>
      <PageHeader title="Atendimento" />
      <div className="grid min-h-[480px] grid-cols-[minmax(0,1fr)] overflow-hidden rounded-card border border-border-subtle bg-surface lg:h-[calc(100dvh-12rem)] lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(260px,320px)]">
        <section
          aria-label="Lista de conversas"
          className={cn('flex min-h-0 flex-col border-border-subtle lg:border-r', selectedId && 'max-lg:hidden')}
        >
          <PageToolbar className="flex-col items-stretch gap-2 border-b border-border-subtle p-3">
            <SearchField
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome ou telefone"
              aria-label="Buscar conversas"
            />
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as AttendanceStatusFilter)}
              aria-label="Filtrar por situação"
              containerClassName="w-full"
              className="w-full"
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </PageToolbar>
          {listError && conversations.length > 0 && (
            <InlineAlert tone="warning" className="m-2">
              {listError}
            </InlineAlert>
          )}
          <ConversationList
            items={conversations}
            selectedId={selectedId}
            loading={listLoading}
            error={listError}
            filtered={filtered}
            hasMore={listHasMore}
            loadingMore={listLoadingMore}
            onSelect={selectConversation}
            onRetry={() => void loadFirstPage('replace')}
            onLoadMore={() => void loadMoreConversations()}
          />
        </section>

        <section
          aria-label="Conversa"
          className={cn('relative flex min-h-0 flex-col', !selectedId && 'max-lg:hidden')}
        >
          {!thread ? (
            <EmptyState icon={MessagesSquare} title="Selecione uma conversa" className="h-full rounded-none" />
          ) : thread.error ? (
            <ErrorState
              title="Não foi possível abrir a conversa"
              description={thread.error}
              onRetry={() => void loadThread(thread.conversationId)}
              className="h-full rounded-none"
            />
          ) : thread.loading || !conversation ? (
            <p className="px-4 py-6 text-sm text-fg-muted" role="status">
              Carregando mensagens…
            </p>
          ) : (
            <>
              <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  onClick={() => navigate('/atendimento')}
                  aria-label="Voltar para a lista"
                >
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <EntityIdentity
                  name={conversationName(conversation)}
                  secondary={conversation.phone ? fmtPhone(conversation.phone) : 'Telefone não identificado'}
                  className="min-w-0 flex-1"
                />
                <Select
                  value={conversation.status}
                  onChange={(event) => void changeStatus(event.target.value as AttendanceStatus)}
                  aria-label="Situação do atendimento"
                  className="h-9 w-36 sm:w-auto"
                >
                  {(Object.keys(STATUS_LABELS) as AttendanceStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
                {!wide && (
                  <Button variant="ghost" size="icon" onClick={() => setContextOpen(true)} aria-label="Contexto comercial">
                    <PanelRight aria-hidden="true" />
                  </Button>
                )}
              </header>
              {conversation.identityStatus === 'conflict' && (
                <InlineAlert tone="warning" className="m-2" title="Telefone em conflito">
                  Evidências recentes do WhatsApp indicam números diferentes para esta conversa.
                </InlineAlert>
              )}
              {statusNotice && (
                <InlineAlert tone="warning" className="m-2">
                  {statusNotice}
                </InlineAlert>
              )}
              {selectedForQuote.length > 0 && (
                <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2 text-xs">
                  <span>{selectedForQuote.length} mensagens selecionadas</span>
                  <Button size="sm" disabled={preparingQuote} onClick={() => void prepareQuote()}>
                    {preparingQuote ? 'Preparando…' : 'Preparar orçamento'}
                  </Button>
                </div>
              )}
              {thread.messages.length === 0 && (deliveryView?.conversationId !== conversation.id || deliveryView.items.length === 0) ? (
                <EmptyState icon={MessagesSquare} title="Sem mensagens registradas" className="flex-1 rounded-none" />
              ) : (
                <MessageTimeline
                  ref={timelineRef}
                  messages={thread.messages}
                  selectedMessageIds={selectedForQuote}
                  onToggleMessage={(messageId) => setSelectedForQuote((current) => current.includes(messageId) ? current.filter((id) => id !== messageId) : [...current, messageId])}
                  deliveries={deliveryView?.conversationId === conversation.id ? deliveryView.items : []}
                  deliveryPending={deliveryPending}
                  onSendDelivery={(delivery) => void sendDelivery(delivery)}
                  actionPending={actionPending}
                  onAction={(messageId, action) => void runAction(messageId, action)}
                  hasOlder={thread.hasOlder}
                  loadingOlder={loadingOlder}
                  onLoadOlder={() => void loadOlder()}
                  onScroll={onTimelineScroll}
                />
              )}
              {hasUnseenBelow && (
                <Button
                  size="sm"
                  className="absolute bottom-28 left-1/2 -translate-x-1/2 shadow-md"
                  onClick={scrollToEnd}
                >
                  <ArrowDown aria-hidden="true" /> Novas mensagens
                </Button>
              )}
              <MessageComposer key={conversation.id} conversation={conversation} onSent={onSent} prefill={prefill} />
              <ConfirmDialog
                open={Boolean(confirmResend)}
                title="Enviar de novo?"
                message="O envio anterior pode ter chegado ao cliente. Enviar de novo pode duplicar a mensagem."
                confirmLabel="Copiar para a resposta"
                onConfirm={() => {
                  if (confirmResend) copyForResend(confirmResend);
                  setConfirmResend(null);
                }}
                onCancel={() => setConfirmResend(null)}
              />
              {!wide && (
                <DetailDrawer open={contextOpen} onClose={() => setContextOpen(false)} title="Contexto comercial">
                  <ContextPanel
                    key={conversation.id}
                    conversationId={conversation.id}
                    identityVersion={conversation.identityVersion}
                    onUseSuggestion={(text) => useAiSuggestion(conversation.id, text)}
                  />
                </DetailDrawer>
              )}
            </>
          )}
        </section>
        {wide && (
          <aside aria-label="Contexto comercial" className="flex min-h-0 flex-col border-l border-border-subtle">
            {conversation && !thread?.error ? (
              <ContextPanel
                key={conversation.id}
                conversationId={conversation.id}
                identityVersion={conversation.identityVersion}
                onUseSuggestion={(text) => useAiSuggestion(conversation.id, text)}
              />
            ) : null}
          </aside>
        )}
      </div>
    </PageShell>
  );
}
