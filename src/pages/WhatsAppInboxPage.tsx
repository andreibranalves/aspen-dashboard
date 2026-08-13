import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  Search,
  User,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { WhatsAppAttachmentCard } from '@/components/ui/whatsapp-attachment-card';
import { Input } from '@/components/ui/input';
import { fmtPhone, formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import {
  createWhatsappPreQuote,
  extractWhatsappQuote,
  fetchWhatsappConversations,
  fetchWhatsappConversation,
  fetchWhatsappMessages,
  sendWhatsappMessage,
  syncMessagesForConversation,
  syncWhatsappConversations,
  updateWhatsappConversationStatus,
  type WhatsappConversation,
  type WhatsappConversationDetail,
  type WhatsappConversationStatus,
  type WhatsappExtractionResult,
  type WhatsappMessage,
} from '@/lib/whatsappInboxApi';

const STATUS_FILTERS: Array<{ value: WhatsappConversationStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'new', label: 'Novas' },
  { value: 'needs_quote', label: 'Pedido detectado' },
  { value: 'quote_lead_created', label: 'Pré-orçamento' },
  { value: 'waiting_customer', label: 'Aguardando cliente' },
  { value: 'closed', label: 'Encerradas' },
];

function statusLabel(status: WhatsappConversationStatus): string {
  if (status === 'needs_quote') return 'Pedido detectado';
  if (status === 'incomplete') return 'Incompleta';
  if (status === 'quote_lead_created') return 'Pré-orçamento';
  if (status === 'quotation_created') return 'Orçamento criado';
  if (status === 'waiting_customer') return 'Aguardando cliente';
  if (status === 'closed') return 'Encerrada';
  if (status === 'ignored') return 'Ignorada';
  return 'Nova';
}

function conversationTitle(
  conversation: Pick<WhatsappConversation, 'displayLabel' | 'displayName' | 'canonicalPhone'>
): string {
  const candidates = [conversation.displayLabel, conversation.displayName]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const canonicalDigits = String(conversation.canonicalPhone || '').replace(/\D/g, '');

  for (const candidate of candidates) {
    const candidateDigits = candidate.replace(/\D/g, '');
    if (canonicalDigits && candidateDigits === canonicalDigits) continue;
    return candidate;
  }

  return 'Contato sem nome';
}

interface WhatsAppInboxPageProps {
  navigate?: (path: string) => void;
}

export default function WhatsAppInboxPage({ navigate }: WhatsAppInboxPageProps) {
  const [status, setStatus] = useState<WhatsappConversationStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<WhatsappConversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<WhatsappMessage[]>([]);
  const [extraction, setExtraction] = useState<WhatsappExtractionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crmDetail, setCrmDetail] = useState<WhatsappConversationDetail | null>(null);

  const quotationAttachments = useMemo(() => {
    return messages
      .flatMap((m) => m.attachments || [])
      .filter((a) => a.documentRole === 'quotation_pdf');
  }, [messages]);

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) || conversations[0] || null,
    [conversations, selectedId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWhatsappConversations({ status, q: query, limit: 50 });
      setConversations(data);
      setSelectedId((current) =>
        current && data.some((item) => item.id === current) ? current : data[0]?.id || ''
      );
    } catch (err) {
      setError((err as Error).message || 'Erro ao carregar conversas do WhatsApp.');
    } finally {
      setLoading(false);
    }
  }, [query, status]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected?.id) {
      setMessages([]);
      setExtraction(null);
      return;
    }

    let cancelled = false;
    setMessagesLoading(true);
    setExtraction(null);
    setCrmDetail(null);
    fetchWhatsappMessages(selected.id)
      .then((data) => {
        if (cancelled) return;
        setMessages(data);
        return syncMessagesForConversation(selected.id)
          .then((synced) => {
            if (!cancelled) setMessages(synced);
          })
          .catch(() => {
            // Keep stored messages visible if live sync fails.
          });
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || 'Erro ao carregar mensagens.');
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    // Fetch CRM match (non-critical)
    fetchWhatsappConversation(selected.id)
      .then((detail) => {
        if (!cancelled) setCrmDetail(detail);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  const sync = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await syncWhatsappConversations();
      await load();
    } catch (err) {
      setError((err as Error).message || 'Erro ao sincronizar WhatsApp.');
    } finally {
      setSaving(false);
    }
  }, [load]);

  const loadMessages = useCallback(async () => {
    if (!selected) return;
    setMessagesLoading(true);
    setError(null);
    try {
      const data = await syncMessagesForConversation(selected.id);
      setMessages(data);
    } catch (err) {
      setError((err as Error).message || 'Erro ao carregar mensagens.');
    } finally {
      setMessagesLoading(false);
    }
  }, [selected]);

  const extract = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const data = await extractWhatsappQuote(selected.id);
      setExtraction(data);
    } catch (err) {
      setError((err as Error).message || 'Erro ao extrair orçamento da conversa.');
    } finally {
      setSaving(false);
    }
  }, [selected]);

  const sendMessage = useCallback(async () => {
    if (!selected || !draft.trim() || sending) return;
    const text = draft.trim();
    setDraft('');
    setSending(true);
    setError(null);
    // Optimistic append for snappy UI
    const optimistic: WhatsappMessage = {
      id: `temp-${Date.now()}`,
      conversationId: selected.id,
      direction: 'outbound',
      type: 'text',
      body: text,
      mediaUrl: '',
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const stored = await sendWhatsappMessage(selected.id, text);
      setMessages(stored);
    } catch (err) {
      // Roll back optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setError((err as Error).message || 'Erro ao enviar mensagem.');
    } finally {
      setSending(false);
    }
  }, [draft, selected, sending]);

  const createPreQuote = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await createWhatsappPreQuote(selected.id, extraction?.extractedPayload);
      const updated = await updateWhatsappConversationStatus(selected.id, 'quote_lead_created');
      setConversations((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      navigate?.('/pre-orcamentos');
    } catch (err) {
      setError((err as Error).message || 'Erro ao criar pré-orçamento.');
    } finally {
      setSaving(false);
    }
  }, [extraction?.extractedPayload, navigate, selected]);

  return (
    <div className="mx-auto max-w-[1320px] space-y-5 pb-10 animate-fade-in">
      <PageHeader title="WhatsApp" />

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setStatus(item.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                status === item.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface-muted text-fg-muted hover:text-fg'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:w-80">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar nome, telefone ou mensagem…"
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={loading || saving}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Atualizar
            </Button>
            <Button onClick={sync} disabled={saving}>
              <RefreshCw size={14} className={saving ? 'animate-spin' : ''} />
              Sincronizar
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold text-fg">
            Conversas
          </div>
          {loading ? (
            <div className="space-y-2 p-3">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-20 animate-pulse rounded-lg bg-surface-muted" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center text-sm text-fg-muted">
              Nenhuma conversa encontrada.
            </div>
          ) : (
            <div className="max-h-[680px] overflow-y-auto p-2 flex flex-col gap-2">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={cn(
                    'w-full rounded-lg p-3 text-left transition-colors hover:bg-surface-muted',
                    selected?.id === conversation.id && 'bg-primary/5 ring-1 ring-primary/20'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">
                        {conversationTitle(conversation)}
                      </p>
                      <p className="truncate text-xs text-fg-muted">
                        {fmtPhone(conversation.canonicalPhone) || 'Telefone não identificado'}
                      </p>
                    </div>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-fg-muted">
                      {statusLabel(conversation.status)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-fg-muted">
                    {conversation.lastMessagePreview || 'Sem prévia de mensagem'}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-h-[560px] rounded-xl border border-line bg-surface shadow-sm">
          {!selected ? (
            <div className="flex min-h-[560px] flex-col items-center justify-center text-fg-muted">
              <MessageCircle size={36} className="mb-3 opacity-50" />
              Selecione uma conversa.
            </div>
          ) : (
            <>
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-fg">{conversationTitle(selected)}</h2>
                <p className="text-xs text-fg-muted">
                  {fmtPhone(selected.canonicalPhone) || 'Telefone não identificado'}
                </p>
              </div>
              <div className="max-h-[560px] space-y-3 overflow-y-auto p-4">
                {messagesLoading ? (
                  <div className="text-sm text-fg-muted">Carregando mensagens…</div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-8 text-sm text-fg-muted">
                    <p>Sem mensagens sincronizadas.</p>
                    <Button variant="outline" size="sm" onClick={loadMessages} disabled={saving}>
                      <RefreshCw size={14} className={saving ? 'animate-spin' : ''} />
                      Carregar mensagens
                    </Button>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        'max-w-[80%] rounded-md px-3 py-2 text-sm',
                        message.direction === 'outbound'
                          ? 'ml-auto bg-primary text-primary-foreground'
                          : 'bg-surface-muted text-fg'
                      )}
                    >
                      {message.body && <p className="mb-2 whitespace-pre-wrap">{message.body}</p>}
                      {message.attachments && message.attachments.length > 0 ? (
                        <div className="space-y-2">
                          {message.attachments.map((attachment) => (
                            <WhatsAppAttachmentCard key={attachment.id} attachment={attachment} />
                          ))}
                        </div>
                      ) : !message.body ? (
                        <p>[{message.type}]</p>
                      ) : null}
                      <p className="mt-1 text-[10px] opacity-70">{formatDate(message.timestamp)}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center gap-2 border-t border-line p-3">
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Digite uma mensagem…"
                  disabled={sending}
                />
                <Button onClick={sendMessage} disabled={sending || !draft.trim()}>
                  Enviar
                </Button>
              </div>
            </>
          )}
        </section>

        <aside className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-fg">Painel comercial</h2>
          {selected ? (
            <div className="mt-4 space-y-4 text-sm">
              <div className="rounded-lg bg-surface-muted p-3 text-fg-muted">
                <p>Telefone: {fmtPhone(selected.canonicalPhone) || 'Não identificado'}</p>
                <p>Status: {statusLabel(selected.status)}</p>
                <p>Atualizado: {formatDate(selected.updatedAt)}</p>
                <p>Orçamento: {selected.linkedQuotationId || 'Nenhum vínculo'}</p>
              </div>

              <Button
                className="w-full"
                onClick={extract}
                disabled={saving || messages.length === 0}
              >
                <Bot size={14} />
                Extrair orçamento
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={createPreQuote}
                disabled={
                  saving ||
                  !selected.canonicalPhone ||
                  selected.identityStatus === 'unresolved' ||
                  selected.identityStatus === 'conflict'
                }
              >
                Criar pré-orçamento
              </Button>

              {quotationAttachments.length > 0 && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase text-primary">
                    Orçamentos enviados
                  </p>
                  {quotationAttachments.map((a) => (
                    <div key={a.id} className="text-xs text-fg">
                      <p>ID: {a.quotationId || '—'}</p>
                      <p>Lead: {a.leadId || '—'}</p>
                      <p>Cliente: {a.customerId || '—'}</p>
                    </div>
                  ))}
                </div>
              )}

              {crmDetail?.crmMatch && (
                <div className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <User size={14} className="text-fg-muted" />
                    <p className="text-xs font-semibold uppercase text-fg-muted">
                      Cadastro encontrado
                    </p>
                  </div>
                  <div className="space-y-1 text-xs text-fg">
                    <p className="font-medium">{crmDetail.crmMatch.nome || '—'}</p>
                    <p>{crmDetail.crmMatch.tipo === 'lead' ? 'Lead' : 'Cliente'}</p>
                    {crmDetail.crmMatch.telefone && (
                      <p className="text-fg-muted">{fmtPhone(crmDetail.crmMatch.telefone)}</p>
                    )}
                    {crmDetail.crmMatch.email && (
                      <p className="text-fg-muted">{crmDetail.crmMatch.email}</p>
                    )}
                    <span className="inline-block rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-fg-muted">
                      {crmDetail.crmMatch.matchSource === 'phone'
                        ? 'Telefone'
                        : crmDetail.crmMatch.matchSource === 'email'
                          ? 'Email'
                          : 'Nome'}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={() =>
                      navigate?.(
                        `/leads/${crmDetail.crmMatch!.tipo}/${encodeURIComponent(crmDetail.crmMatch!.id)}`
                      )
                    }
                  >
                    <ExternalLink size={14} />
                    Abrir lead
                  </Button>
                </div>
              )}

              {extraction && (
                <div className="rounded-lg border border-line p-3">
                  <p className="mb-2 text-xs font-semibold uppercase text-fg-muted">Extração</p>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs text-fg-muted">
                    {JSON.stringify(extraction.extractedPayload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-fg-muted">Selecione uma conversa.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
