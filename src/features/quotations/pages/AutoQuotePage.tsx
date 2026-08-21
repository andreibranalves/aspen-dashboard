import { useState, useCallback, useEffect, useMemo, useRef, type ClipboardEvent } from 'react';
import {
  Sparkles,
  FileText,
  AlertTriangle,
  RotateCcw,
  History,
  Image as ImageIcon,
  X,
} from 'lucide-react';
import { apiPost, apiGet } from '@/lib/api/api';
import { listQuotationTemplates, type QuotationTemplateMetadata } from '@/lib/api/quotationTemplatesApi';
import OrderTemplateManager from '@/features/quotations/components/OrderTemplateManager';
import { listOrderTemplates, type OrderTemplate } from '@/lib/api/orderTemplatesApi';
import { capitalize, formatBRL, formatDate } from '@/lib/formatting/formatters';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import SplitResultCard from '@/features/quotations/components/SplitResultCard';
import { useImageInput } from '@/hooks/useImageInput';
import { useExtractionDrafts } from '@/hooks/useExtractionDrafts';
import type { Draft, OrcamentoResponse, StoredAutoQuoteDraft } from '@/types/domain';
import { loadAutoQuoteDrafts, saveAutoQuoteDrafts } from '@/lib/storage/autoQuoteDraftStorage';
import {
  buildQuotePayload,
  getQuotationIssue,
  issueQuotation,
  isPriceAuthoritativeConflict,
  QuotationIssueApiError,
} from '@/lib/api/quotationIssueApi';
import { fetchFlows, type CommunicationFlow } from '@/lib/api/communicationApi';
import {
  deliveryIdentityKey,
  useQuotationDeliveries,
} from '@/hooks/useQuotationDeliveries';
import type { DeliveryView } from '@/lib/api/quotationDeliveryApi';
import { isSendableQuotationStatus, sendContextKey, type SendContext } from '@/lib/api/communicationSend';

interface HistoryItem {
  id: string;
  cliente?: string;
  data?: string;
  valor?: string | number;
}

function moneyCents(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
}

function loadInitialAutoQuoteDrafts() {
  try {
    return typeof window === 'undefined' ? [] : loadAutoQuoteDrafts(window.localStorage);
  } catch {
    return [];
  }
}

export default function AutoQuotePage() {
  // ── Helpers ──

  // ── Input state ──
  const [text, setText] = useState<string>('');
  const [extracting, setExtracting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pricingConflictByDraft, setPricingConflictByDraft] = useState<Record<number, string[]>>({});
  const [savingDraftByIndex, setSavingDraftByIndex] = useState<Record<number, boolean>>({});
  const issueInFlight = useRef(new Set<number>());
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  // ── Quotation template ──
  const [templates, setTemplates] = useState<QuotationTemplateMetadata[]>([]);
  const [templateKey, setTemplateKey] = useState<string>('');
  const [templateLoading, setTemplateLoading] = useState<boolean>(true);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // ── Order template ──
  const [orderTemplates, setOrderTemplates] = useState<OrderTemplate[]>([]);
  const [orderTemplateId, setOrderTemplateId] = useState<string>('');
  const [orderTemplatesLoading, setOrderTemplatesLoading] = useState<boolean>(true);
  const [orderTemplatesError, setOrderTemplatesError] = useState<string | null>(null);
  const [orderTemplateManagerOpen, setOrderTemplateManagerOpen] = useState(false);

  const loadOrderTemplates = useCallback(async () => {
    setOrderTemplatesLoading(true);
    setOrderTemplatesError(null);
    try {
      const response = await listOrderTemplates();
      const available = Array.isArray(response.data)
        ? response.data.filter((template) => !template.archived)
        : [];
      setOrderTemplates(available);
      setOrderTemplateId((current) =>
        available.some((template) => template.id === current) ? current : ''
      );
    } catch {
      setOrderTemplates([]);
      setOrderTemplateId('');
      setOrderTemplatesError('Não foi possível carregar os templates de pedido.');
    } finally {
      setOrderTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrderTemplates();
  }, [loadOrderTemplates]);

  const loadTemplates = useCallback(async () => {
    setTemplateLoading(true);
    setTemplateError(null);
    try {
      const response = await listQuotationTemplates(true);
      const available = response.templates || response.data || [];
      setTemplates(available);
      setTemplateKey(response.default_key || available.find((template) => template.is_default)?.key || '');
    } catch {
      setTemplateError('Não foi possível carregar os modelos HTML.');
    } finally {
      setTemplateLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // ── WhatsApp send state ──
  const [waFlows, setWaFlows] = useState<CommunicationFlow[]>([]);
  const [defaultWaFlowId, setDefaultWaFlowId] = useState<string>('');
  const [waFlowByDraft, setWaFlowByDraft] = useState<Record<number, string>>({});
  const activeSendKeys = useRef(new Set<string>());
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
  } = useExtractionDrafts(loadInitialAutoQuoteDrafts());
  const skipDraftPersistence = useRef(false);
  const draftsHydrated = useRef(true);
  const activeDrafts = drafts.filter((draft) => !draft.discarded);
  const deliveryIdentities = useMemo(() => activeDrafts.flatMap((draft) => {
    const issue = (draft as StoredAutoQuoteDraft).issue;
    const resultData = draft.result?.data || (issue ? {
      quotation_id: issue.businessNumber,
      revision_id: issue.revisionId,
      status_canonical: 'emitido',
    } : undefined);
    const status = resultData?.status_canonical || resultData?.status;
    const quotationId = typeof resultData?.quotation_id === 'string' ? resultData.quotation_id : '';
    const revisionId = typeof resultData?.revision_id === 'string'
      ? resultData.revision_id
      : typeof resultData?.quote_revision_id === 'string'
        ? resultData.quote_revision_id
        : '';
    const flowId = waFlowByDraft[draft.index] || defaultWaFlowId || waFlows[0]?.id || '';
    return quotationId && revisionId && flowId && isSendableQuotationStatus(status)
      ? [{ revisionId, flowId }]
      : [];
  }), [activeDrafts, defaultWaFlowId, waFlowByDraft, waFlows]);
  const {
    deliveriesByKey,
    pendingKeys,
    errorByKey,
    enqueue,
    resolve,
  } = useQuotationDeliveries(deliveryIdentities);

  useEffect(() => {
    if (!draftsHydrated.current) {
      draftsHydrated.current = true;
      return;
    }
    if (skipDraftPersistence.current) {
      skipDraftPersistence.current = false;
      return;
    }
    saveAutoQuoteDrafts(window.localStorage, drafts);
  }, [drafts]);

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
        ...(orderTemplateId ? { orderTemplateId } : {}),
      });
      const orders = res.orders;
      if (!orders || orders.length === 0) {
        setError('Nenhum pedido identificado no texto.');
        setExtracting(false);
        return;
      }
      let newDrafts = buildDraftsFromOrders(orders, '', templateKey);
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
        return next;
      });
      loadHistory();
    } catch (err) {
      setError((err as Error).message || 'Erro na extração.');
    } finally {
      setExtracting(false);
    }
  }, [text, imageData, orderTemplateId, templateKey, fetchPricing, buildDraftsFromOrders, loadHistory]);

  // ── Create single quotation (draftIndex = draft.index, not array index) ──
  const createSingleQuote = useCallback(
    async (draftIndex: number) => {
      const draft = drafts.find((candidate) => candidate.index === draftIndex) as StoredAutoQuoteDraft | undefined;
      if (!draft || issueInFlight.current.has(draftIndex)) return;
      issueInFlight.current.add(draftIndex);
      const key = draft.issueIdempotencyKey || globalThis.crypto.randomUUID();
      const requestDraft = { ...draft, issueIdempotencyKey: key };
      const nextDraft = { ...requestDraft, status: 'processing' as const, result: undefined };
      saveAutoQuoteDrafts(window.localStorage, drafts.map((candidate) => candidate.index === draftIndex ? nextDraft : candidate) as StoredAutoQuoteDraft[]);
      setDrafts((prev) => prev.map((candidate) => candidate.index === draftIndex
        ? ({ ...requestDraft, status: 'processing' as const, result: undefined } as StoredAutoQuoteDraft)
        : candidate));
      try {
        const issue = await issueQuotation(buildQuotePayload(requestDraft), key, {
          sourceQuotationId: draft.sourceQuotationId || draft.saved?.quotationId,
          sourceRevisionId: draft.sourceRevisionId || draft.saved?.revisionId,
        });
        const data = {
          quotation_id: issue.businessNumber,
          quotation_uuid: issue.quotationId,
          revision_id: issue.revisionId,
          revision_number: issue.revisionNumber,
          status: 'emitido',
          status_canonical: 'emitido',
        };
        setDrafts((prev) => prev.map((candidate) => candidate.index === draftIndex
          ? ({ ...candidate, issue, result: { success: true, data }, status: 'done' } as StoredAutoQuoteDraft)
          : candidate));
        loadHistory();
      } catch (err) {
        const apiError = err instanceof QuotationIssueApiError ? err : null;
        const priceConflict = Boolean(apiError && isPriceAuthoritativeConflict(apiError));
        const message = apiError?.status === 409
          ? priceConflict
            ? `${apiError.message} Atualize os preços e tente novamente.`
            : apiError.message
          : err instanceof Error ? err.message : 'Não foi possível emitir o orçamento. Tente novamente.';
        setDrafts((prev) => prev.map((candidate) => candidate.index === draftIndex
          ? ({ ...candidate, status: undefined, result: { success: false, error: message } } as StoredAutoQuoteDraft)
          : candidate));
        if (err instanceof QuotationIssueApiError && err.status === 409) {
          if (/processamento|retomada|instantes/i.test(err.message)) {
            const recovered = await getQuotationIssue(key);
            if (recovered.state === 'completed') {
              setDrafts((prev) => prev.map((candidate) => candidate.index === draftIndex
                ? ({ ...candidate, issue: recovered, result: { success: true, data: { quotation_id: recovered.businessNumber, quotation_uuid: recovered.quotationId, revision_id: recovered.revisionId, revision_number: recovered.revisionNumber, status: 'emitido', status_canonical: 'emitido' } }, status: 'done' } as StoredAutoQuoteDraft)
                : candidate));
            }
          } else if (isPriceAuthoritativeConflict(err)) {
            const before = new Map(draft.edited.items.map((item) => [item.item_code, moneyCents(item.rate)]));
            const data = err.data && typeof err.data === 'object' ? err.data as Record<string, unknown> : {};
            const authoritative = data.authoritative && typeof data.authoritative === 'object'
              ? data.authoritative as Record<string, unknown> : data;
            const corrected = Array.isArray(authoritative.items) ? authoritative.items : [];
            let changedItems: string[] = [];
            if (corrected.length) {
              const corrections = new Map(corrected.map((value) => {
                const correction = value as Record<string, unknown>;
                return [String(correction.item_code || correction.sku || ''), correction] as const;
              }));
              const changed = corrected.map((value) => {
                const correction = value as Record<string, unknown>;
                const sku = String(correction.item_code || correction.sku || '');
                const rate = correction.rate ?? correction.authoritative_rate;
                const beforeRate = before.get(sku);
                return sku && moneyCents(rate) !== null && moneyCents(rate) !== beforeRate ? sku : '';
              }).filter(Boolean);
              changedItems = changed;
              setDrafts((prev) => prev.map((candidate) => candidate.index === draftIndex
                ? ({ ...candidate, edited: { ...candidate.edited, items: candidate.edited.items.map((item) => {
                  const correction = corrections.get(item.item_code);
                  const rate = correction?.rate ?? correction?.authoritative_rate;
                  return correction && moneyCents(rate) !== null && moneyCents(rate) !== moneyCents(item.rate)
                    ? { ...item, rate: Number(rate) } : item;
                }) }, issueIdempotencyKey: undefined } as StoredAutoQuoteDraft)
                : candidate));
            } else {
              const refreshed = await refetchDraftPricing(draftIndex);
              changedItems = (refreshed?.edited.items || []).filter((item) =>
                item.item_code && before.get(item.item_code) !== moneyCents(item.rate)
              ).map((item) => item.item_code);
            }
            setPricingConflictByDraft((prev) => ({ ...prev, [draftIndex]: changedItems }));
            setDrafts((prev) => prev.map((candidate) => candidate.index === draftIndex
              ? ({ ...candidate, issueIdempotencyKey: undefined } as StoredAutoQuoteDraft)
              : candidate));
          }
        }
      } finally {
        issueInFlight.current.delete(draftIndex);
      }
    },
    [drafts, loadHistory, refetchDraftPricing]
  );

  const saveSingleDraft = useCallback(async (draftIndex: number) => {
    const draft = drafts.find((candidate) => candidate.index === draftIndex) as StoredAutoQuoteDraft | undefined;
    if (!draft || draft.saved || savingDraftByIndex[draftIndex]) return;
    setSavingDraftByIndex((current) => ({ ...current, [draftIndex]: true }));
    try {
      const result = await apiPost<OrcamentoResponse>('/orcamento', buildQuotePayload(draft));
      const quotationId = String(result.quote_id || result.quotation_uuid || '');
      const revisionId = String(result.revision_id || result.quote_revision_id || '');
      const businessNumber = String(result.quotation_name || result.quotation_id || '');
      if (!quotationId || !revisionId || !businessNumber) throw new Error('Resposta inválida ao salvar o rascunho.');
      setDrafts((current) => current.map((candidate) => candidate.index === draftIndex
        ? ({ ...candidate, saved: { quotationId, revisionId, businessNumber } } as StoredAutoQuoteDraft)
        : candidate));
      loadHistory();
    } catch (error) {
      setDrafts((current) => current.map((candidate) => candidate.index === draftIndex
        ? ({ ...candidate, result: { success: false, error: error instanceof Error ? error.message : 'Não foi possível salvar o rascunho.' } } as StoredAutoQuoteDraft)
        : candidate));
    } finally {
      setSavingDraftByIndex((current) => {
        const next = { ...current };
        delete next[draftIndex];
        return next;
      });
    }
  }, [drafts, loadHistory, savingDraftByIndex]);

  const recoveredDrafts = useRef(new Set<number>());
  const recoveryTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const recoveryAttempts = useRef(new Map<number, number>());
  useEffect(() => () => {
    for (const timer of recoveryTimers.current.values()) clearTimeout(timer);
    recoveryTimers.current.clear();
  }, []);
  const recoverQuotationIssue = useCallback(async (draft: StoredAutoQuoteDraft) => {
    if (
      !draft.issueIdempotencyKey ||
      draft.issue ||
      draft.status === 'processing' ||
      recoveredDrafts.current.has(draft.index) ||
      recoveryTimers.current.has(draft.index)
    ) return;
    try {
      const state = await getQuotationIssue(draft.issueIdempotencyKey);
      if (state.state === 'processing') {
        const attempt = (recoveryAttempts.current.get(draft.index) || 0) + 1;
        recoveryAttempts.current.set(draft.index, attempt);
        if (attempt > 3) {
          recoveredDrafts.current.add(draft.index);
          setDrafts((prev) => prev.map((candidate) => candidate.index === draft.index
            ? ({ ...candidate, status: undefined, result: { success: false, error: 'A emissão continua em processamento. Tente novamente quando estiver pronta.' } } as StoredAutoQuoteDraft)
            : candidate));
          return;
        }
        const delay = Math.min(10_000, Math.max(500, state.retryAfterMs || 500));
        setDrafts((prev) => prev.map((candidate) => candidate.index === draft.index
          ? ({ ...candidate, status: 'processing' } as StoredAutoQuoteDraft) : candidate));
        const timer = setTimeout(() => {
          recoveryTimers.current.delete(draft.index);
          recoverQuotationIssue(draft);
        }, delay);
        recoveryTimers.current.set(draft.index, timer);
        return;
      }
      recoveredDrafts.current.add(draft.index);
      const timer = recoveryTimers.current.get(draft.index);
      if (timer) clearTimeout(timer);
      recoveryTimers.current.delete(draft.index);
      if (state.state === 'completed') {
        const data = { quotation_id: state.businessNumber, quotation_uuid: state.quotationId, revision_id: state.revisionId, revision_number: state.revisionNumber, status: 'emitido', status_canonical: 'emitido' };
        setDrafts((prev) => prev.map((candidate) => candidate.index === draft.index
          ? ({ ...candidate, issue: state, result: { success: true, data }, status: 'done' } as StoredAutoQuoteDraft)
          : candidate));
      } else {
        setDrafts((prev) => prev.map((candidate) => candidate.index === draft.index
          ? ({ ...candidate, result: { success: false, error: state.error }, status: undefined } as StoredAutoQuoteDraft)
          : candidate));
      }
    } catch {
      recoveredDrafts.current.add(draft.index);
      const timer = recoveryTimers.current.get(draft.index);
      if (timer) clearTimeout(timer);
      recoveryTimers.current.delete(draft.index);
      setDrafts((prev) => prev.map((candidate) => candidate.index === draft.index
        ? ({ ...candidate, status: undefined, result: { success: false, error: 'Não foi possível consultar a emissão. Tente novamente.' } } as StoredAutoQuoteDraft)
        : candidate));
    }
  }, []);

  useEffect(() => {
    for (const draft of drafts as StoredAutoQuoteDraft[]) recoverQuotationIssue(draft);
  }, [drafts, recoverQuotationIssue]);

  const createNewRevision = useCallback((draftIndex: number) => {
    setDrafts((prev) => {
      const source = prev.find((candidate) => candidate.index === draftIndex) as StoredAutoQuoteDraft | undefined;
      if (!source?.issue) return prev;
      const nextIndex = Math.max(-1, ...prev.map((candidate) => candidate.index)) + 1;
      const next = [...prev, {
        ...source,
        index: nextIndex,
        issue: undefined,
        issueIdempotencyKey: undefined,
        sourceQuotationId: source.issue.quotationId,
        sourceRevisionId: source.issue.revisionId,
        status: undefined,
        result: undefined,
      } as StoredAutoQuoteDraft];
      return next;
    });
  }, []);

  const previewSingleQuote = useCallback(
    (draftIndex: number) => {
      const draft = drafts.find((candidate) => candidate.index === draftIndex);
      if (!draft) return;
      const form = document.createElement('form');
      const payload = document.createElement('input');
      form.method = 'POST';
      form.action = '/api/quotation-preview?format=html';
      form.target = '_blank';
      form.style.display = 'none';
      payload.type = 'hidden';
      payload.name = 'payload';
      payload.value = JSON.stringify(buildQuotePayload(draft));
      form.append(payload);
      document.body.append(form);
      form.submit();
      form.remove();
    },
    [drafts]
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
    } catch (loadError) {
      console.warn('[AutoQuotePage] failed to load history item:', (loadError as Error).message);
      setText(`${item.id} — ${item.cliente || 'Cliente'}`);
    }
  }, []);

  // ── Reset ──
  const handleReset = useCallback(() => {
    setText('');
    clearImage();
    skipDraftPersistence.current = true;
    setDrafts([]);
    setError(null);
    setExtracting(false);
    setProductSearch({});
    setWaFlowByDraft({});
    setOrderTemplateId('');
    try {
      localStorage.removeItem('aspen_drafts');
    } catch (storageError) {
      console.warn('[AutoQuotePage] failed to clear drafts:', (storageError as Error).message);
    }
  }, [clearImage, setDrafts, setProductSearch]);

  const clearResults = useCallback(() => {
    skipDraftPersistence.current = true;
    setDrafts([]);
    setProductSearch({});
    setWaFlowByDraft({});
    try {
      localStorage.removeItem('aspen_drafts');
    } catch (storageError) {
      console.warn('[AutoQuotePage] failed to clear drafts:', (storageError as Error).message);
    }
  }, [setDrafts, setProductSearch]);

  // ── WhatsApp handlers ──
  const sendContextForDraft = useCallback((draft: Draft, flowId: string): SendContext | null => {
    const issue = (draft as StoredAutoQuoteDraft).issue;
    const resultData = draft.result?.data || (issue ? {
      quotation_id: issue.businessNumber,
      revision_id: issue.revisionId,
    } : undefined);
    const quotationId = typeof resultData?.quotation_id === 'string' ? resultData.quotation_id : '';
    const revisionId = typeof resultData?.revision_id === 'string'
      ? resultData.revision_id
      : typeof resultData?.quote_revision_id === 'string'
        ? resultData.quote_revision_id
        : '';
    if (!quotationId || !revisionId || !flowId) return null;
    return { quotationId, revisionId, flowId };
  }, []);

  const deliveryForContext = useCallback((context: SendContext | null): DeliveryView | null => {
    if (!context) return null;
    return deliveriesByKey[deliveryIdentityKey(context)] || null;
  }, [deliveriesByKey]);

  const deliveryErrorForContext = useCallback((context: SendContext | null): string | undefined => {
    if (!context) return undefined;
    return errorByKey[deliveryIdentityKey(context)];
  }, [errorByKey]);

  const deliveryPendingForContext = useCallback((context: SendContext | null): boolean => {
    if (!context) return false;
    return pendingKeys.includes(deliveryIdentityKey(context));
  }, [pendingKeys]);

  const resolveDeliveryForContext = useCallback(
    (delivery: DeliveryView | null, decision: 'confirmed_received' | 'confirmed_not_received', note: string) => {
      if (!delivery) return Promise.resolve();
      return resolve(delivery.id, decision, note);
    },
    [resolve]
  );

  const handleSelectWhatsAppFlow = useCallback((draftIndex: number, flowId: string) => {
    setWaFlowByDraft((prev) => ({ ...prev, [draftIndex]: flowId }));
  }, []);

  const handleSendWhatsApp = useCallback(
    async (draftIndex: number) => {
      const draft = drafts.find((d) => d.index === draftIndex);
      if (!draft) {
        console.warn('[sendWhatsApp] draft not found for index:', draftIndex);
        setError('Pedido não encontrado.');
        return;
      }
      const issue = (draft as StoredAutoQuoteDraft).issue;
      const resultData = draft.result?.data || (issue ? {
        quotation_id: issue.businessNumber,
        revision_id: issue.revisionId,
      } : undefined);
      const quotationId = typeof resultData?.quotation_id === 'string' ? resultData.quotation_id : '';
      if (!quotationId) {
        console.warn('[sendWhatsApp] missing quotation_id — draft not processed yet:', {
          draftIndex,
          hasResult: !!draft.result,
          hasData: !!draft.result?.data,
          status: draft.status,
        });
        setError('Crie o orçamento antes de enviar WhatsApp.');
        return;
      }

      const flowId = waFlowByDraft[draftIndex] || defaultWaFlowId || waFlows[0]?.id || '';
      const context = sendContextForDraft(draft, flowId);
      if (!context) {
        setError(flowId
          ? 'Não foi possível identificar a revisão imutável do orçamento.'
          : 'Nenhum fluxo de WhatsApp disponível.');
        return;
      }
      if (deliveryPendingForContext(context)) {
        setError('Aguarde a consulta do status de entrega antes de enviar.');
        return;
      }
      const contextKey = sendContextKey(context);
      if (activeSendKeys.current.has(contextKey)) return;
      activeSendKeys.current.add(contextKey);

      try {
        await enqueue({
          quotationId: context.quotationId,
          revisionId: context.revisionId,
          flowId: context.flowId,
        });
      } catch (err) {
        console.error('[sendWhatsApp] failed:', err instanceof Error ? err.message : err);
      } finally {
        activeSendKeys.current.delete(contextKey);
      }
    },
    [defaultWaFlowId, deliveryPendingForContext, drafts, enqueue, sendContextForDraft, waFlowByDraft, waFlows]
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

  const visibleDrafts = [...activeDrafts].reverse();

  return (
    <div className="flex h-full flex-col overflow-hidden animate-fade-in">
      <OrderTemplateManager
        open={orderTemplateManagerOpen}
        templates={orderTemplates}
        onClose={() => setOrderTemplateManagerOpen(false)}
        onChanged={loadOrderTemplates}
      />
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* ── LEFT PANEL (50%) ── */}
        <div className="panel-left flex h-1/2 min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto border-r border-line bg-surface lg:h-auto lg:overflow-hidden lg:w-1/2 lg:flex-none">
          <div className="px-4 md:px-6 pt-4 md:pt-5 space-y-4">
            {/* Page title */}
            <h1 className="text-lg font-semibold text-fg">Pedido do cliente</h1>
            {templateError && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300">
                <span className="min-w-0">{templateError}</span>
                <Button type="button" variant="outline" size="sm" onClick={loadTemplates}>Tentar novamente</Button>
              </div>
            )}
            {orderTemplatesError && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300">
                <span className="min-w-0">{orderTemplatesError}</span>
                <Button type="button" variant="outline" size="sm" onClick={loadOrderTemplates}>
                  Tentar novamente
                </Button>
              </div>
            )}

            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-xs font-medium text-fg-muted">
                Template de pedido
                <select
                  aria-label="Template de pedido"
                  value={orderTemplateId}
                  onChange={(event) => setOrderTemplateId(event.target.value)}
                  disabled={extracting || orderTemplatesLoading}
                  className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
                >
                  <option value="">Nenhum</option>
                  {orderTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-end sm:self-auto"
                onClick={() => setOrderTemplateManagerOpen(true)}
              >
                Gerenciar
              </Button>
            </div>

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

          {/* ── Bottom panel: recent quotations ── */}
          <div className="border-t border-line px-4 md:px-6 pt-4 pb-3 mt-auto flex flex-col h-[300px] lg:h-[340px]">
            <div className="mb-3 flex items-center gap-1.5 shrink-0 text-xs font-medium text-fg-muted">
              <History size={13} />
              Recentes
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto -mx-4 px-4 md:-mx-6 md:px-6">
              {historyLoading ? (
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
                        <p className="font-medium text-fg truncate">{item.cliente || 'Cliente'}</p>
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
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL (50%) ── */}
        <div className="h-1/2 min-h-0 w-full min-w-0 flex-1 overflow-y-auto bg-page px-4 pb-6 pt-4 md:px-6 md:pt-5 lg:h-auto lg:w-1/2 lg:flex-none">
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
                const issueProjection = (draft as StoredAutoQuoteDraft).issue;
                const resultData = draft.result?.data || (issueProjection ? {
                  quotation_id: issueProjection.businessNumber,
                  quotation_uuid: issueProjection.quotationId,
                  revision_id: issueProjection.revisionId,
                  revision_number: issueProjection.revisionNumber,
                  status: 'emitido',
                  status_canonical: 'emitido',
                } : undefined);
                const quotationId = resultData?.quotation_id ? String(resultData.quotation_id) : '';
                const relativeViewUrl = quotationId
                  ? `/#/quotations/${encodeURIComponent(quotationId)}`
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

                const selectedFlowId = waFlowByDraft[draft.index] || defaultWaFlowId || waFlows[0]?.id || '';
                const revisionId = (resultData?.revision_id as string | null) || (resultData?.quote_revision_id as string | null) || '';
                const quotationSendable = isSendableQuotationStatus(resultData?.status_canonical || resultData?.status);
                const sendContext = quotationSendable && quotationId && revisionId && selectedFlowId
                  ? { quotationId, revisionId, flowId: selectedFlowId }
                  : null;
                const delivery = deliveryForContext(sendContext);
                const deliveryPending = deliveryPendingForContext(sendContext);
                const deliveryError = deliveryErrorForContext(sendContext);

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
                    onSaveDraft={saveSingleDraft}
                    isSavingDraft={Boolean(savingDraftByIndex[draft.index])}
                    onPreviewQuote={previewSingleQuote}
                    onNewRevision={createNewRevision}
                    issue={issueProjection}
                    issueError={draft.result?.error}
                    pricingConflictItems={pricingConflictByDraft[draft.index] || []}
                    viewUrl={(draft as StoredAutoQuoteDraft).issue?.pdfUrl || relativeViewUrl}
                    delivery={quotationSendable ? delivery : null}
                    deliveryPending={quotationSendable && deliveryPending}
                    deliveryError={quotationSendable ? deliveryError : undefined}
                    waSendEnabled={quotationSendable}
                    waFlows={waFlows}
                    waSelectedFlowId={selectedFlowId}
                    onSelectWhatsAppFlow={handleSelectWhatsAppFlow}
                    onSendWhatsApp={handleSendWhatsApp}
                    onResolveDelivery={async (decision, note) => {
                      await resolveDeliveryForContext(delivery, decision, note);
                    }}
                    templates={templates}
                    templateLoading={templateLoading}
                    templateError={templateError}
                    onRetryTemplates={loadTemplates}
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
