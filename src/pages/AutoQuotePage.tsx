import { useState, useCallback, useEffect, type ClipboardEvent } from 'react';
import {
  Sparkles,
  FileText,
  AlertTriangle,
  RotateCcw,
  History,
  MessageCircle,
  RefreshCw,
  Image as ImageIcon,
  X,
} from 'lucide-react';
import { apiPost, apiGet, apiPatch } from '@/lib/api';
import { capitalize, formatBRL, formatDate } from '@/lib/formatters';
import { buildQuotationViewUrl } from '@/lib/printFormats';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import SplitResultCard from '@/components/SplitResultCard';
import { useImageInput } from '@/hooks/useImageInput';
import { useExtractionDrafts } from '@/hooks/useExtractionDrafts';
import type { Draft } from '@/types/domain';
import { fetchFlows, executeFlow, type CommunicationFlow } from '@/lib/communicationApi';

interface HistoryItem {
  id: string;
  cliente?: string;
  data?: string;
  valor?: string | number;
}

interface QuoteLead {
  id: string;
  nome?: string;
  email?: string;
  telefone?: string;
  pedidoTexto?: string;
  texto?: string;
  source?: string;
  status?: 'new' | 'converted' | 'discarded';
  quotationId?: string | null;
}

interface WaStatus {
  state?: 'sending' | 'sent' | 'error';
  message?: string;
}

export default function AutoQuotePage() {
  // ── Helpers ──

  // ── Input state ──
  const [text, setText] = useState<string>('');
  const [extracting, setExtracting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [bottomTab, setBottomTab] = useState<'leads' | 'recentes'>('leads');
  const [quoteLeads, setQuoteLeads] = useState<QuoteLead[]>([]);
  const [quoteLeadsLoading, setQuoteLeadsLoading] = useState<boolean>(false);
  const [quoteLeadsError, setQuoteLeadsError] = useState<string | null>(null);
  const [selectedQuoteLeadId, setSelectedQuoteLeadId] = useState<string>('');

  // ── WhatsApp send state ──
  const [waStatusByDraft, setWaStatusByDraft] = useState<Record<number, WaStatus>>({});
  const [waFlows, setWaFlows] = useState<CommunicationFlow[]>([]);
  const [defaultWaFlowId, setDefaultWaFlowId] = useState<string>('');
  const [waFlowByDraft, setWaFlowByDraft] = useState<Record<number, string>>({});

  // ── Re-extract state (add items to existing draft) ──
  const [reExtractTextByDraft, setReExtractTextByDraft] = useState<Record<number, string>>({});
  const [reExtractLoadingByDraft, setReExtractLoadingByDraft] = useState<Record<number, boolean>>(
    {}
  );

  // ── Extracted hooks ──
  const {
    drafts,
    setDrafts,
    setProductSearch,
    fetchPricing,
    refetchDraftPricing,
    updateDraftItem,
    addDraftItem,
    removeDraftItem,
    updateDraftField,
    selectProduct,
    buildDraftsFromOrders,
  } = useExtractionDrafts();

  // ── Image input ──
  const { imageData, imagePreview, clearImage, handleImageFile } = useImageInput();

  // ── Load recent quotations ──
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiGet<{ data?: HistoryItem[] }>(
        '/quotations?limit=5&order_by=creation+desc'
      );
      if (res.data) setHistory(res.data.slice(0, 5));
    } catch {
      /* non-critical */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const loadQuoteLeads = useCallback(async () => {
    setQuoteLeadsLoading(true);
    setQuoteLeadsError(null);
    try {
      const res = await apiGet<{ data?: QuoteLead[] }>('/quote-leads?limit=5');
      setQuoteLeads(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setQuoteLeadsError((err as Error).message || 'Erro ao buscar leads de orçamento.');
    } finally {
      setQuoteLeadsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuoteLeads();
  }, [loadQuoteLeads]);

  const loadCommunicationFlows = useCallback(async () => {
    try {
      const data = await fetchFlows();
      const flows = Array.isArray(data.flows) ? data.flows : [];
      setWaFlows(flows);
      // Draft quotes should default to the "already talking" flow if it exists.
      const alreadyTalking = flows.find(
        (f) => f.context === 'already_talking' || /já estou/i.test(f.name || '')
      );
      setDefaultWaFlowId(alreadyTalking?.id || data.selectedFlowId || flows[0]?.id || '');
    } catch (err) {
      console.warn('[AutoQuotePage] failed to load communication flows:', (err as Error).message);
      setWaFlows([]);
      setDefaultWaFlowId('');
    }
  }, []);

  useEffect(() => {
    loadCommunicationFlows();
  }, [loadCommunicationFlows]);

  // ── Remove main padding so panels fill viewport edge-to-edge ──
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const orig = main.className;
    main.className = orig
      .replace(/\bp-4\b/g, '')
      .replace(/\bmd:p-6\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return () => {
      main.className = orig;
    };
  }, []);

  // ── Extract text → build drafts ──
  const handleExtract = useCallback(async () => {
    if (!text.trim() && !imageData) return;
    setExtracting(true);
    setError(null);
    try {
      const res = await apiPost<{
        orders?: Record<string, unknown>[];
      }>('/extract', {
        text: text || null,
        imageBase64: imageData?.base64 || null,
        imageMimeType: imageData?.mime || null,
      });
      const orders = res.orders;
      if (!orders || orders.length === 0) {
        setError('Nenhum pedido identificado no texto.');
        setExtracting(false);
        return;
      }
      let newDrafts = buildDraftsFromOrders(orders, '');
      const nonUrgent = newDrafts.filter((d) => !d.edited.urgente);
      if (nonUrgent.length > 0) newDrafts = await fetchPricing(nonUrgent, false);
      const urgent = newDrafts.filter((d) => d.edited.urgente);
      if (urgent.length > 0) await fetchPricing(urgent, true);
      setDrafts((prev) => {
        const startIndex = prev.length;
        const appendedDrafts = newDrafts.map((draft, offset) => ({
          ...draft,
          index: startIndex + offset,
        }));
        const next = [...prev, ...appendedDrafts];
        try {
          localStorage.setItem('aspen_drafts', JSON.stringify(next));
        } catch {}
        return next;
      });
      loadHistory();
    } catch (err) {
      setError((err as Error).message || 'Erro na extração.');
    } finally {
      setExtracting(false);
    }
  }, [text, imageData, fetchPricing, buildDraftsFromOrders, loadHistory]);

  // ── Create single quotation (draftIndex = draft.index, not array index) ──
  const createSingleQuote = useCallback(
    async (draftIndex: number) => {
      setDrafts((prev) => {
        const idx = prev.findIndex((d) => d.index === draftIndex);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], status: 'processing' };
        return next;
      });
      const draft = await new Promise<Draft | undefined>((resolve) => {
        setDrafts((prev) => {
          resolve(prev.find((d) => d.index === draftIndex));
          return prev;
        });
      });
      if (!draft) return;
      const payload = {
        extracted: {
          nome: draft.edited.nome,
          email: draft.edited.email || null,
          telefone: draft.edited.telefone || null,
          urgente: draft.edited.urgente,
          origem: draft.edited.origem || undefined,
          cnpj: draft.edited.cnpj || undefined,
          endereco: draft.edited.endereco || undefined,
          items: draft.edited.items
            .filter((it) => it.item_code && it.qty > 0)
            .map((it) => ({
              item_code: it.item_code,
              qty: it.qty,
              rate: it.rate,
              manual_rate: it._rateManual === true,
            })),
          prazo_producao: draft.edited.prazo_producao || undefined,
        },
      };
      try {
        const res = await apiPost<Record<string, unknown>>('/orcamento', payload);
        setDrafts((prev) => {
          const idx = prev.findIndex((d) => d.index === draftIndex);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], result: { success: true, data: res }, status: 'done' };
          return next;
        });
        loadHistory();
        if (selectedQuoteLeadId && res.quotation_id) {
          try {
            await apiPatch('/quote-leads', {
              id: selectedQuoteLeadId,
              status: 'converted',
              quotationId: String(res.quotation_id),
            });
          } catch (patchErr) {
            console.warn(
              '[AutoQuotePage] failed to mark quote lead converted:',
              (patchErr as Error).message
            );
          }
          setSelectedQuoteLeadId('');
          loadQuoteLeads();
        }
      } catch (err) {
        setDrafts((prev) => {
          const idx = prev.findIndex((d) => d.index === draftIndex);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            result: { success: false, error: (err as Error).message },
            status: 'error',
          };
          return next;
        });
      }
    },
    [loadHistory, loadQuoteLeads, selectedQuoteLeadId]
  );

  // ── Load history item: fetch detail and format as text ──
  const loadHistoryItem = useCallback(async (item: HistoryItem) => {
    setError(null);
    try {
      const res = await apiGet<{
        cliente?: string;
        email?: string;
        telefone?: string;
        items?: { item_code?: string; qty?: number }[];
      }>(`/quotations?id=${encodeURIComponent(item.id)}`);
      if (!res) return;
      const nome = res.cliente || item.cliente || 'Cliente';
      const email = res.email || '';
      const telefone = res.telefone || '';
      const itemsText = (res.items || []).map((it) => `${it.item_code} ${it.qty} un`).join(', ');
      const formatted = [
        `Nome: ${nome}`,
        email ? `E-mail: ${email}` : 'E-mail:',
        telefone ? `Telefone: ${telefone}` : 'Telefone:',
        itemsText ? `Pedido: ${itemsText}` : 'Pedido:',
      ].join('\n');
      setText(formatted);
      document.querySelector('.panel-left')?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setText(`${item.id} — ${item.cliente || 'Cliente'}`);
    }
  }, []);

  const useQuoteLead = useCallback((lead: QuoteLead) => {
    setSelectedQuoteLeadId(lead.id || '');
    setText(
      lead.texto ||
        [
          lead.nome ? `Nome: ${lead.nome}` : 'Nome:',
          lead.email ? `E-mail: ${lead.email}` : 'E-mail:',
          lead.telefone ? `Telefone: ${lead.telefone}` : 'Telefone:',
          lead.pedidoTexto ? `Pedido: ${lead.pedidoTexto}` : 'Pedido:',
        ].join('\n')
    );
    document.querySelector('.panel-left')?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // ── Reset ──
  const handleReset = useCallback(() => {
    setText('');
    clearImage();
    setDrafts([]);
    setError(null);
    setExtracting(false);
    setProductSearch({});
    setWaStatusByDraft({});
    setWaFlowByDraft({});
    setSelectedQuoteLeadId('');
    try {
      localStorage.removeItem('aspen_drafts');
    } catch {}
  }, [clearImage, setDrafts, setProductSearch]);

  const clearResults = useCallback(() => {
    setDrafts([]);
    setProductSearch({});
    setWaStatusByDraft({});
    setWaFlowByDraft({});
    setSelectedQuoteLeadId('');
    try {
      localStorage.removeItem('aspen_drafts');
    } catch {}
  }, [setDrafts, setProductSearch]);

  // ── WhatsApp handlers ──
  const handleSelectWhatsAppFlow = useCallback((draftIndex: number, flowId: string) => {
    setWaFlowByDraft((prev) => ({ ...prev, [draftIndex]: flowId }));
  }, []);

  const handleSendWhatsApp = useCallback(
    async (draftIndex: number) => {
      const draft = drafts.find((d) => d.index === draftIndex);
      if (!draft) {
        console.warn('[sendWhatsApp] draft not found for index:', draftIndex);
        setWaStatusByDraft((prev) => ({
          ...prev,
          [draftIndex]: { state: 'error', message: 'Pedido não encontrado.' },
        }));
        return;
      }
      if (!draft.result?.data?.quotation_id) {
        console.warn('[sendWhatsApp] missing quotation_id — draft not processed yet:', {
          draftIndex,
          hasResult: !!draft.result,
          hasData: !!draft.result?.data,
          status: draft.status,
        });
        setWaStatusByDraft((prev) => ({
          ...prev,
          [draftIndex]: { state: 'error', message: 'Crie o orçamento antes de enviar WhatsApp.' },
        }));
        return;
      }

      const resultData = draft.result.data;
      const quotationId = resultData.quotation_id as string;
      const telefone = draft.edited.telefone || (resultData.telefone as string) || '';
      const nome = (resultData.cliente as string) || draft.edited.nome || '';
      const flowId = waFlowByDraft[draftIndex] || defaultWaFlowId || waFlows[0]?.id || '';

      if (!flowId) {
        setWaStatusByDraft((prev) => ({
          ...prev,
          [draftIndex]: { state: 'error', message: 'Nenhum fluxo de WhatsApp disponível.' },
        }));
        return;
      }

      setWaStatusByDraft((prev) => ({ ...prev, [draftIndex]: { state: 'sending' } }));

      try {
        const res = await executeFlow({
          quotation_id: quotationId,
          flow_id: flowId,
          telefone,
          nome,
          deal_id: (resultData.deal_id as string | null) || null,
          items: (resultData.items as unknown[]) || draft.edited.items || [],
        });

        setWaStatusByDraft((prev) => ({
          ...prev,
          [draftIndex]: {
            state: 'sent',
            message: res.duplicate_warning
              ? res.duplicate_message || 'Fluxo enviado novamente.'
              : 'Orçamento enviado com sucesso!',
          },
        }));
      } catch (err) {
        console.error('[sendWhatsApp] failed:', (err as Error).message);
        setWaStatusByDraft((prev) => ({
          ...prev,
          [draftIndex]: {
            state: 'error',
            message: (err as Error).message || 'Erro ao enviar WhatsApp.',
          },
        }));
      }
    },
    [defaultWaFlowId, drafts, waFlowByDraft, waFlows]
  );

  // ── Re-extract handlers (add more items to an existing draft) ──
  const handleReExtractTextChange = useCallback((draftIndex: number, value: string) => {
    setReExtractTextByDraft((prev) => ({ ...prev, [draftIndex]: value }));
  }, []);

  const handleSubmitReExtract = useCallback(
    async (draftIndex: number) => {
      const text = reExtractTextByDraft[draftIndex]?.trim();
      if (!text) return;

      const draft = drafts.find((d) => d.index === draftIndex);
      if (!draft) return;

      setReExtractLoadingByDraft((prev) => ({ ...prev, [draftIndex]: true }));
      try {
        const existingItems = draft.edited.items
          .filter((it) => it.item_code && it.qty > 0)
          .map((it) => ({ item_code: it.item_code, qty: it.qty }));

        const res = await apiPost<{
          orders?: { items?: { item_code?: string; qty?: number }[] }[];
        }>('/extract', {
          text,
          existingItems,
        });

        const newItems = res.orders?.[0]?.items || [];
        if (!newItems.length) {
          setReExtractTextByDraft((prev) => ({ ...prev, [draftIndex]: '' }));
          return;
        }

        // Add each new item to the draft and re-price afterwards
        setDrafts((prev) => {
          const idx = prev.findIndex((d) => d.index === draftIndex);
          if (idx === -1) return prev;
          const next = [...prev];
          const currentItems = [...next[idx].edited.items];
          for (const it of newItems) {
            if (!it.item_code || (it.qty ?? 0) <= 0) continue;
            currentItems.push({
              item_code: it.item_code,
              qty: it.qty ?? 0,
              rate: null,
            });
          }
          next[idx] = {
            ...next[idx],
            edited: { ...next[idx].edited, items: currentItems },
          };
          try {
            localStorage.setItem('aspen_drafts', JSON.stringify(next));
          } catch {}
          return next;
        });

        // Re-fetch pricing for the updated draft
        await refetchDraftPricing(draftIndex);
        setReExtractTextByDraft((prev) => ({ ...prev, [draftIndex]: '' }));
      } catch (err) {
        setError((err as Error).message || 'Erro ao extrair itens adicionais.');
      } finally {
        setReExtractLoadingByDraft((prev) => ({ ...prev, [draftIndex]: false }));
      }
    },
    [drafts, reExtractTextByDraft, refetchDraftPricing]
  );

  const activeDrafts = drafts.filter((d) => !d.discarded);
  const visibleDrafts = [...activeDrafts].reverse();

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT PANEL (50%) ── */}
        <div className="panel-left flex flex-col w-full lg:w-1/2 min-w-0 border-r border-line bg-surface overflow-hidden">
          <div className="px-4 md:px-6 pt-4 md:pt-5 space-y-4">
            {/* Page title */}
            <h1 className="text-lg font-semibold text-fg">Pedido do cliente</h1>

            {/* Text input */}
            <div className="mt-2">
              <div className="relative">
                {imageData && (
                  <div className="absolute left-3 top-3 z-10">
                    <div className="group relative h-16 w-16 overflow-hidden rounded-xl border border-line bg-surface-muted shadow-sm">
                      {imagePreview ? (
                        <img
                          src={imagePreview}
                          alt="Prévia da imagem colada"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-primary">
                          <ImageIcon size={18} />
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={clearImage}
                        className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-md bg-black/65 text-white opacity-100 transition-colors hover:bg-black/80 sm:opacity-0 sm:group-hover:opacity-100"
                        aria-label="Remover imagem colada"
                        title="Remover imagem"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                )}

                <textarea
                  className={cn(
                    'w-full resize-none overflow-hidden rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-6 text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                    imageData ? 'min-h-[210px] pt-24' : 'min-h-[130px]'
                  )}
                  placeholder={
                    'Cole aqui a mensagem do cliente, formato natural é aceito. Inclua nome, telefone, e-mail, produto e quantidade.\n\nEx.: "João Lopes, 200 lenços de cetim de seda, joao@gmail.com, (11) 99999-9999."'
                  }
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={extracting}
                  onPaste={(e: ClipboardEvent<HTMLTextAreaElement>) => {
                    const items = e.clipboardData?.items;
                    if (items) {
                      for (const item of items) {
                        if (item.type.startsWith('image/')) {
                          e.preventDefault();
                          handleImageFile(item.getAsFile());
                          return;
                        }
                      }
                    }
                  }}
                />
              </div>
            </div>

            {/* Actions row */}
            <div className="flex items-center gap-2">
              <Button
                onClick={handleExtract}
                disabled={extracting || (!text.trim() && !imageData)}
                size="sm"
              >
                {extracting ? (
                  <>
                    <span className="spinner mr-2" />
                    Extraindo…
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    Extrair
                  </>
                )}
              </Button>

              {(text || imageData) && (
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <RotateCcw size={14} />
                  Limpar
                </Button>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-300">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Erro na extração</p>
                    <p className="text-xs mt-0.5">{error}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Bottom tabs: recent quotations + quote leads ── */}
          <div className="border-t border-line px-4 md:px-6 pt-4 pb-3 mt-auto flex flex-col h-[300px] lg:h-[340px]">
            <div className="mb-3 flex items-center justify-between gap-2 shrink-0">
              <div className="inline-flex rounded-lg bg-surface-muted p-0.5">
                <button
                  type="button"
                  onClick={() => setBottomTab('leads')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    bottomTab === 'leads'
                      ? 'bg-surface text-fg shadow-sm'
                      : 'text-fg-muted hover:text-fg'
                  )}
                >
                  <MessageCircle size={13} />
                  Leads
                </button>
                <button
                  type="button"
                  onClick={() => setBottomTab('recentes')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    bottomTab === 'recentes'
                      ? 'bg-surface text-fg shadow-sm'
                      : 'text-fg-muted hover:text-fg'
                  )}
                >
                  <History size={13} />
                  Recentes
                </button>
              </div>

              {bottomTab === 'leads' && (
                <button
                  type="button"
                  onClick={loadQuoteLeads}
                  disabled={quoteLeadsLoading}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-60"
                >
                  <RefreshCw size={12} className={quoteLeadsLoading ? 'animate-spin' : ''} />
                  Atualizar
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto -mx-4 px-4 md:-mx-6 md:px-6">
              {bottomTab === 'recentes' ? (
                historyLoading ? (
                  <div className="space-y-2 h-full">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-10 rounded-lg bg-surface-muted animate-pulse" />
                    ))}
                  </div>
                ) : history.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-xs text-fg-muted">Nenhum orçamento recente.</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {history.map((item, idx) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => loadHistoryItem(item)}
                        className={cn(
                          'w-full flex items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm hover:bg-surface-muted transition-colors',
                          idx === history.length - 1 && 'pb-1'
                        )}
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-fg truncate">
                            {item.cliente || 'Cliente'}
                          </p>
                          <p className="text-xs text-fg-muted truncate">{item.id}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-[11px] text-fg-muted whitespace-nowrap">
                            {formatDate(item.data)}
                          </span>
                          <span className="text-xs font-medium text-fg whitespace-nowrap">
                            {formatBRL(item.valor)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )
              ) : quoteLeadsLoading ? (
                <div className="space-y-1 h-full">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg px-3 py-1.5 animate-pulse"
                    >
                      <div className="space-y-1">
                        <div className="h-4 w-28 rounded bg-surface-muted" />
                        <div className="h-3 w-44 rounded bg-surface-muted" />
                      </div>
                      <div className="h-5 w-20 rounded-full bg-surface-muted" />
                    </div>
                  ))}
                </div>
              ) : quoteLeadsError ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-xs text-destructive">{quoteLeadsError}</p>
                </div>
              ) : quoteLeads.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-xs text-fg-muted">Nenhum lead de orçamento pendente.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {quoteLeads.map((lead) => {
                    const tagLabel =
                      lead.quotationId || (lead.status === 'new' ? 'Novo lead' : 'Lead');
                    const tagClass = lead.quotationId
                      ? 'bg-primary/10 text-primary'
                      : 'bg-emerald-500/10 text-success';
                    const displayName = lead.nome || 'Nome não identificado';
                    const displayEmail = lead.email || '';

                    return (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => useQuoteLead(lead)}
                        className="w-full flex items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm hover:bg-surface-muted transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-fg truncate">
                            {lead.telefone
                              ? `(${lead.telefone.slice(2, 4)}) ${lead.telefone.slice(4, 9)}-${lead.telefone.slice(9)}`
                              : 'Telefone não identificado'}
                          </p>
                          <p className="text-xs leading-tight text-fg-muted truncate">
                            {displayName}
                            {displayEmail ? <span className="text-fg-muted/60 mx-1">-</span> : null}
                            {displayEmail ? (
                              <span className="text-[11px] text-fg-muted/80">{displayEmail}</span>
                            ) : null}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 ml-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${tagClass}`}
                          >
                            {tagLabel}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL (50%) ── */}
        <div className="w-full lg:w-1/2 min-w-0 bg-page px-4 md:px-6 pt-4 md:pt-5 pb-0">
          {activeDrafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-muted mb-4">
                <FileText size={32} className="text-fg-muted" />
              </div>
              <h2 className="text-lg font-semibold text-fg">Nenhum pedido extraído</h2>
              <p className="mt-1 max-w-sm text-sm text-fg-muted">
                Cole o texto do pedido no painel esquerdo e clique em <strong>Extrair</strong> para
                gerar orçamentos.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-fg">
                  Resultados ({activeDrafts.length})
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearResults}
                  disabled={activeDrafts.length === 0}
                  className="text-fg-muted"
                >
                  <RotateCcw size={14} />
                  Limpar lista
                </Button>
              </div>

              {visibleDrafts.map((draft, displayIdx) => {
                const isError = draft.status === 'error';
                const isProcessing = draft.status === 'processing';
                const relativeViewUrl = draft.result?.data?.quotation_id
                  ? buildQuotationViewUrl(String(draft.result.data.quotation_id))
                  : '';

                if (isError) {
                  return (
                    <div
                      key={draft.index}
                      className="overflow-hidden rounded-[20px] border border-destructive/30 bg-surface shadow-sm"
                    >
                      <div className="flex items-start gap-3 p-5 text-sm text-destructive">
                        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="font-medium">
                            Falha ao criar orçamento para {capitalize(draft.edited.nome)}
                          </p>
                          <p>{draft.result?.error || 'Falha desconhecida'}</p>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <SplitResultCard
                    key={draft.index}
                    draft={draft}
                    displayIdx={displayIdx}
                    totalDrafts={activeDrafts.length}
                    isProcessing={isProcessing}
                    onUpdateField={updateDraftField}
                    onUpdateItem={updateDraftItem}
                    onRemoveItem={removeDraftItem}
                    onAddItem={addDraftItem}
                    selectProduct={selectProduct}
                    onRefetchPricing={refetchDraftPricing}
                    onCreateQuote={createSingleQuote}
                    viewUrl={relativeViewUrl}
                    waStatus={waStatusByDraft[draft.index]}
                    waFlows={waFlows}
                    waSelectedFlowId={waFlowByDraft[draft.index] || defaultWaFlowId}
                    onSelectWhatsAppFlow={handleSelectWhatsAppFlow}
                    onSendWhatsApp={handleSendWhatsApp}
                    reExtractText={reExtractTextByDraft[draft.index] || ''}
                    reExtractLoading={reExtractLoadingByDraft[draft.index] || false}
                    onReExtractTextChange={handleReExtractTextChange}
                    onSubmitReExtract={handleSubmitReExtract}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
