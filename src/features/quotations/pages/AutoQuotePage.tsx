import { useState, useCallback, useEffect, useMemo, useRef, type ClipboardEvent, type ReactNode } from 'react';
import {
  Sparkles,
  FileText,
  AlertTriangle,
  RotateCcw,
  Image as ImageIcon,
  X,
  Settings,
} from 'lucide-react';
import { apiPost } from '@/lib/api/api';
import { listQuotationTemplates, type QuotationTemplateMetadata } from '@/lib/api/quotationTemplatesApi';
import OrderTemplateManager from '@/features/quotations/components/OrderTemplateManager';
import { listOrderTemplates, type OrderTemplate } from '@/lib/api/orderTemplatesApi';
import { capitalize } from '@/lib/formatting/formatters';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import SplitResultCard from '@/features/quotations/components/SplitResultCard';
import { useImageInput } from '@/hooks/useImageInput';
import { useExtractionDrafts } from '@/hooks/useExtractionDrafts';
import type { Draft, OrcamentoResponse, StoredAutoQuoteDraft } from '@/types/domain';
import { loadAutoQuoteDrafts, saveAutoQuoteDrafts } from '@/lib/storage/autoQuoteDraftStorage';
import {
  buildQuotePayload,
  getQuotationIssue,
  issuePersistedDraft,
  QuotationIssueApiError,
} from '@/lib/api/quotationIssueApi';
import { fetchFlows, type CommunicationFlow } from '@/lib/api/communicationApi';
import {
  deliveryIdentityKey,
  useQuotationDeliveries,
} from '@/hooks/useQuotationDeliveries';
import type { DeliveryView } from '@/lib/api/quotationDeliveryApi';
import { isSendableQuotationStatus, sendContextKey, type SendContext } from '@/lib/api/communicationSend';

function loadInitialAutoQuoteDrafts() {
  try {
    return typeof window === 'undefined' ? [] : loadAutoQuoteDrafts(window.sessionStorage);
  } catch {
    return [];
  }
}

function templateSlug(name: string): string {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function renderTemplateText(text: string, templates: OrderTemplate[]): ReactNode[] {
  const bySlug = new Map(templates.map((template) => [templateSlug(template.name), template]));
  const nodes: ReactNode[] = [];
  const mentionPattern = /(^|\s)(@[\p{L}\p{N}_-]+)/gu;
  let lastIndex = 0;
  let pillIndex = 0;

  for (const match of text.matchAll(mentionPattern)) {
    const token = match[2];
    const tokenStart = (match.index || 0) + match[1].length;
    const template = bySlug.get(templateSlug(token.slice(1)));
    if (!template) continue;
    if (tokenStart > lastIndex) nodes.push(text.slice(lastIndex, tokenStart));
    nodes.push(
      <span
        key={`${template.id}-${pillIndex++}`}
        title={`Template: ${template.name}`}
        className="whitespace-nowrap bg-surface font-semibold text-fg"
      >
        {token}
      </span>
    );
    lastIndex = tokenStart + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function inlineTemplateSelections(text: string, templates: OrderTemplate[]) {
  const bySlug = new Map(templates.map((template) => [templateSlug(template.name), template]));
  const selections: Array<{ id: string; quantity: number }> = [];
  const unknown: string[] = [];
  for (const match of text.matchAll(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*@([\p{L}\p{N}_-]+)(?!\.[\p{L}\p{N}_-]+)/gu)) {
    const template = bySlug.get(templateSlug(match[2]));
    if (!template) unknown.push(`@${match[2]}`);
    else selections.push({ id: template.id, quantity: Number(match[1].replace(',', '.')) });
  }
  return { selections, unknown };
}

export default function AutoQuotePage() {
  // ── Helpers ──

  // ── Input state ──
  const [text, setText] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionFrameRef = useRef<number | null>(null);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const [extracting, setExtracting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pricingConflictByDraft] = useState<Record<number, string[]>>({});
  const [savingDraftByIndex, setSavingDraftByIndex] = useState<Record<number, boolean>>({});
  const issueInFlight = useRef(new Set<number>());
  const extractionGenerationRef = useRef(0);

  // ── Quotation template ──
  const [templates, setTemplates] = useState<QuotationTemplateMetadata[]>([]);
  const [templateKey, setTemplateKey] = useState<string>('');
  const [templateLoading, setTemplateLoading] = useState<boolean>(true);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // ── Order template ──
  const [orderTemplates, setOrderTemplates] = useState<OrderTemplate[]>([]);
  const [orderTemplatesError, setOrderTemplatesError] = useState<string | null>(null);
  const [orderTemplateManagerOpen, setOrderTemplateManagerOpen] = useState(false);

  const loadOrderTemplates = useCallback(async () => {
    setOrderTemplatesError(null);
    try {
      const response = await listOrderTemplates();
      const available = Array.isArray(response.data)
        ? response.data.filter((template) => !template.archived)
        : [];
      setOrderTemplates(available);
    } catch {
      setOrderTemplates([]);
      setOrderTemplatesError('Não foi possível carregar os templates de pedido.');
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

  useEffect(() => {
    try {
      window.localStorage.removeItem('aspen_drafts');
    } catch {
      /* legacy local storage may be unavailable */
    }
  }, []);

  const skipDraftPersistence = useRef(false);
  const draftsHydrated = useRef(true);
  const activeDrafts = drafts.filter((draft) => !draft.discarded);
  const deliveryIdentities = useMemo(() => activeDrafts.flatMap((draft) => {
    const issue = (draft as StoredAutoQuoteDraft).issue;
    const resultData = draft.result?.data || (issue
      ? { businessNumber: issue.businessNumber, revisionId: issue.revisionId, status: issue.status }
      : undefined);
    const status = typeof resultData?.status === 'string' ? resultData.status : undefined;
    const revisionId = typeof resultData?.revisionId === 'string' ? resultData.revisionId : '';
    const flowId = waFlowByDraft[draft.index] || defaultWaFlowId || waFlows[0]?.id || '';
    return revisionId && flowId && isSendableQuotationStatus(status)
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
    saveAutoQuoteDrafts(window.sessionStorage, drafts);
  }, [drafts]);

  // ── Image input ──
  const { imageData, imagePreview, clearImage, handleImageFile } = useImageInput();

  // ── Prefill do cliente vindo do CRM (#/leads) — consome 'aspen_quote_prefill' uma única vez ──
  useEffect(() => {
    let raw: string | null;
    try {
      raw = window.sessionStorage.getItem('aspen_quote_prefill');
      if (raw !== null) window.sessionStorage.removeItem('aspen_quote_prefill');
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const prefill = JSON.parse(raw) as { nome?: unknown; email?: unknown; telefone?: unknown };
      const nome = typeof prefill.nome === 'string' ? prefill.nome.trim() : '';
      const email = typeof prefill.email === 'string' ? prefill.email.trim() : '';
      const telefone = typeof prefill.telefone === 'string' ? prefill.telefone.trim() : '';
      if (!nome && !email && !telefone) return;
      setText((current) => {
        if (current.trim() !== '') return current;
        return [
          `Nome: ${nome}`,
          `E-mail: ${email}`,
          `Telefone: ${telefone}`,
        ].join('\n');
      });
    } catch {
      /* prefill malformado — ignora */
    }
  }, []);

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
    } catch {
      console.warn('[AutoQuotePage] failed to load communication flows');
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

  const updateMention = useCallback((value: string, caret: number | null) => {
    if (caret === null) return setMention(null);
    const match = value.slice(0, caret).match(/(?:^|\s)@([\p{L}\p{N}_-]*)$/u);
    setMention(match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null);
  }, []);

  const mentionTemplates = useMemo(() => {
    if (!mention) return [];
    const query = templateSlug(mention.query);
    return orderTemplates.filter((template) => templateSlug(template.name).includes(query)).slice(0, 6);
  }, [mention, orderTemplates]);

  const cancelPendingSelection = useCallback(() => {
    if (selectionFrameRef.current === null) return;
    window.cancelAnimationFrame(selectionFrameRef.current);
    selectionFrameRef.current = null;
  }, []);

  const focusTextareaAt = useCallback((caret: number) => {
    cancelPendingSelection();
    selectionFrameRef.current = window.requestAnimationFrame(() => {
      selectionFrameRef.current = null;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }, [cancelPendingSelection]);

  useEffect(() => () => cancelPendingSelection(), [cancelPendingSelection]);

  const insertTemplateMention = useCallback((template: OrderTemplate) => {
    if (!mention) return;
    const afterMention = text.slice(mention.end);
    const inserted = `@${templateSlug(template.name)}`;
    const next = text.slice(0, mention.start) + inserted + afterMention;
    const caret = mention.start + inserted.length;
    setText(next);
    setMention(null);
    focusTextareaAt(caret);
  }, [focusTextareaAt, mention, text]);

  // ── Extract text → build drafts ──
  const handleExtract = useCallback(async () => {
    if (!text.trim() && !imageData) return;
    const inline = inlineTemplateSelections(text, orderTemplates);
    if (inline.unknown.length) {
      setError(`Template não encontrado: ${inline.unknown.join(', ')}.`);
      return;
    }
    const generation = ++extractionGenerationRef.current;
    setExtracting(true);
    setError(null);
    try {
      const res = await apiPost<{
        orders?: Record<string, unknown>[];
      }>('/extract', {
        text: text || null,
        imageBase64: imageData?.base64 || null,
        imageMimeType: imageData?.mime || null,
        ...(inline.selections.length ? { orderTemplateSelections: inline.selections } : {}),
      });
      if (generation !== extractionGenerationRef.current) return;
      const orders = res.orders;
      if (!orders || orders.length === 0) {
        setError('Nenhum pedido identificado no texto.');
        setExtracting(false);
        return;
      }
      const newDrafts = buildDraftsFromOrders(orders, '', templateKey);
      const nonUrgent = newDrafts.filter((d) => !d.edited.urgente);
      const urgent = newDrafts.filter((d) => d.edited.urgente);
      const pricedNonUrgent = nonUrgent.length > 0
        ? await fetchPricing(nonUrgent, false)
        : [];
      if (generation !== extractionGenerationRef.current) return;
      const pricedUrgent = urgent.length > 0
        ? await fetchPricing(urgent, true)
        : [];
      if (generation !== extractionGenerationRef.current) return;
      const pricedByIndex = new Map(
        [...pricedNonUrgent, ...pricedUrgent].map((draft) => [draft.index, draft])
      );
      const pricedDrafts = newDrafts.map((draft) => pricedByIndex.get(draft.index) || draft);
      setDrafts((prev) => {
        const startIndex = prev.length;
        const appendedDrafts = pricedDrafts.map((draft, offset) => ({
          ...draft,
          index: startIndex + offset,
        }));
        const next = [...prev, ...appendedDrafts];
        return next;
      });
    } catch {
      if (generation === extractionGenerationRef.current) {
        setError('Não foi possível extrair os pedidos. Tente novamente.');
      }
    } finally {
      if (generation === extractionGenerationRef.current) setExtracting(false);
    }
  }, [text, imageData, orderTemplates, templateKey, fetchPricing, buildDraftsFromOrders]);

  // ── Create single quotation (draftIndex = draft.index, not array index) ──
  const createSingleQuote = useCallback(
    async (draftIndex: number) => {
      const draft = drafts.find((candidate) => candidate.index === draftIndex) as StoredAutoQuoteDraft | undefined;
      if (!draft || issueInFlight.current.has(draftIndex)) return;
      issueInFlight.current.add(draftIndex);
      const key = draft.issueIdempotencyKey || globalThis.crypto.randomUUID();
      const requestDraft = { ...draft, issueIdempotencyKey: key };
      const nextDraft = { ...requestDraft, status: 'processing' as const, result: undefined };
      saveAutoQuoteDrafts(window.sessionStorage, drafts.map((candidate) => candidate.index === draftIndex ? nextDraft : candidate) as StoredAutoQuoteDraft[]);
      setDrafts((prev) => prev.map((candidate) => candidate.index === draftIndex
        ? ({ ...requestDraft, status: 'processing' as const, result: undefined } as StoredAutoQuoteDraft)
        : candidate));
      try {
        // Same transition as every other flow: create or reuse the persisted
        // draft, then issue it by reference so the server owns the content.
        let savedDraft = draft.saved;
        if (!savedDraft) {
          const created = await apiPost<OrcamentoResponse>('/orcamento', buildQuotePayload(requestDraft));
          const quotationId = String(created.quotation_uuid || created.quote_id || '');
          const revisionId = String(created.revision_id || created.quote_revision_id || '');
          const businessNumber = String(created.quotation_name || created.quotation_id || '');
          const concurrencyToken = String(created.concurrency_token || '');
          if (!quotationId || !revisionId || !businessNumber || !concurrencyToken) {
            throw new Error('Resposta inválida ao salvar o rascunho do orçamento.');
          }
          savedDraft = { quotationId, revisionId, businessNumber, concurrencyToken };
          setDrafts((prev) => prev.map((candidate) => candidate.index === draftIndex
            ? ({ ...candidate, saved: savedDraft } as StoredAutoQuoteDraft)
            : candidate));
        }
        if (!savedDraft.concurrencyToken) throw new Error('Recarregue a página antes de emitir este rascunho.');
        const issue = await issuePersistedDraft(savedDraft.revisionId, savedDraft.concurrencyToken, key);
        const data = {
          businessNumber: issue.businessNumber,
          quotationId: issue.quotationId,
          revisionId: issue.revisionId,
          revisionNumber: issue.revisionNumber,
          status: issue.status,
        };
        setDrafts((prev) => prev.map((candidate) => candidate.index === draftIndex
          ? ({ ...candidate, issue, result: { success: true, data }, status: 'done' } as StoredAutoQuoteDraft)
          : candidate));
      } catch (err) {
        const apiError = err instanceof QuotationIssueApiError ? err : null;
        const message = apiError?.status === 409
          ? 'O orçamento mudou ou já está em processamento. Tente novamente.'
          : 'Não foi possível emitir o orçamento. Tente novamente.';
        setDrafts((prev) => prev.map((candidate) => candidate.index === draftIndex
          ? ({ ...candidate, status: undefined, result: { success: false, error: message } } as StoredAutoQuoteDraft)
          : candidate));
        if (err instanceof QuotationIssueApiError && err.status === 409) {
          if (/processamento|retomada|instantes/i.test(err.message)) {
            const recovered = await getQuotationIssue(key);
            if (recovered.state === 'completed') {
              setDrafts((prev) => prev.map((candidate) => candidate.index === draftIndex
                ? ({ ...candidate, issue: recovered, result: { success: true, data: { businessNumber: recovered.businessNumber, quotationId: recovered.quotationId, revisionId: recovered.revisionId, revisionNumber: recovered.revisionNumber, status: recovered.status } }, status: 'done' } as StoredAutoQuoteDraft)
                : candidate));
            }
          }
        }
      } finally {
        issueInFlight.current.delete(draftIndex);
      }
    },
    [drafts]
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
      const concurrencyToken = String(result.concurrency_token || '');
      if (!quotationId || !revisionId || !businessNumber || !concurrencyToken) throw new Error('Resposta inválida ao salvar o rascunho.');
      setDrafts((current) => current.map((candidate) => candidate.index === draftIndex
        ? ({ ...candidate, saved: { quotationId, revisionId, businessNumber, concurrencyToken } } as StoredAutoQuoteDraft)
        : candidate));
    } catch {
      setDrafts((current) => current.map((candidate) => candidate.index === draftIndex
        ? ({ ...candidate, result: { success: false, error: 'Não foi possível salvar o rascunho. Tente novamente.' } } as StoredAutoQuoteDraft)
        : candidate));
    } finally {
      setSavingDraftByIndex((current) => {
        const next = { ...current };
        delete next[draftIndex];
        return next;
      });
    }
  }, [drafts, savingDraftByIndex]);

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
        const data = { businessNumber: state.businessNumber, quotationId: state.quotationId, revisionId: state.revisionId, revisionNumber: state.revisionNumber, status: state.status };
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

  // ── Destructive-action confirmations ──
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  const [confirmClearResults, setConfirmClearResults] = useState<boolean>(false);

  // ── Reset ──
  const handleReset = useCallback(() => {
    extractionGenerationRef.current += 1;
    setText('');
    clearImage();
    skipDraftPersistence.current = true;
    setDrafts([]);
    setError(null);
    setExtracting(false);
    setProductSearch({});
    setWaFlowByDraft({});
    try {
      window.sessionStorage.removeItem('aspen_drafts');
    } catch {
      console.warn('[AutoQuotePage] failed to clear drafts');
    }
  }, [clearImage, setDrafts, setProductSearch]);

  const clearResults = useCallback(() => {
    extractionGenerationRef.current += 1;
    skipDraftPersistence.current = true;
    setDrafts([]);
    setProductSearch({});
    setWaFlowByDraft({});
    try {
      window.sessionStorage.removeItem('aspen_drafts');
    } catch {
      console.warn('[AutoQuotePage] failed to clear drafts');
    }
  }, [setDrafts, setProductSearch]);

  // ── WhatsApp handlers ──
  const sendContextForDraft = useCallback((draft: Draft, flowId: string): SendContext | null => {
    const issue = (draft as StoredAutoQuoteDraft).issue;
    const resultData = draft.result?.data;
    // O transporte de entrega segue identificando o orçamento pelo número comercial;
    // contração dos nomes legados na resposta é escopo do ticket #126.
    const businessNumber = typeof resultData?.businessNumber === 'string' ? resultData.businessNumber : issue?.businessNumber;
    const revisionId = typeof resultData?.revisionId === 'string' ? resultData.revisionId : issue?.revisionId;
    if (!businessNumber || !revisionId || !flowId) return null;
    return { quotationId: businessNumber, revisionId, flowId };
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
      } catch {
        console.error('[sendWhatsApp] failed');
      } finally {
        activeSendKeys.current.delete(contextKey);
      }
    },
    [defaultWaFlowId, deliveryPendingForContext, drafts, enqueue, sendContextForDraft, waFlowByDraft, waFlows]
  );

  const visibleDrafts = [...activeDrafts].reverse();

  return (
    <div className="mx-auto w-full max-w-[1060px] flex h-full flex-col overflow-hidden animate-fade-in">
      <OrderTemplateManager
        open={orderTemplateManagerOpen}
        templates={orderTemplates}
        onClose={() => setOrderTemplateManagerOpen(false)}
        onChanged={loadOrderTemplates}
      />
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* ── LEFT PANEL (50%) ── */}
        <div className="panel-left flex h-1/2 min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto border-r border-line bg-surface lg:h-auto lg:overflow-hidden lg:w-1/2 lg:flex-none">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 md:px-6 md:pt-5 space-y-4">
            <div className="space-y-1">
              <h1 className="text-lg font-semibold tracking-tight text-fg">Pedido do cliente</h1>
              <p className="text-sm leading-5 text-fg-muted">
                Cole a conversa ou envie uma imagem. O conteúdo só vira orçamento depois da sua revisão.
              </p>
            </div>
            {templateError && (
              <div className="tone-warning-soft flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm">
                <span className="min-w-0">{templateError}</span>
                <Button type="button" variant="outline" size="sm" onClick={loadTemplates}>Tentar novamente</Button>
              </div>
            )}
            {orderTemplatesError && (
              <div className="tone-warning-soft flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs">
                <span className="min-w-0">{orderTemplatesError}</span>
                <Button type="button" variant="outline" size="sm" onClick={loadOrderTemplates}>
                  Tentar novamente
                </Button>
              </div>
            )}

            {/* Text input */}
            <div className="mt-2">
              <div className="relative">
                {imageData && (
                  <div className="absolute left-3 top-3 z-20">
                    <div className="group relative h-16 w-16 overflow-hidden rounded-lg border border-line bg-surface-muted shadow-sm">
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

                {text && (
                  <div
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute inset-px z-20 overflow-hidden whitespace-pre-wrap break-words px-4 py-3 text-sm leading-6 text-transparent',
                      imageData ? 'pt-24' : ''
                    )}
                  >
                    {renderTemplateText(text, orderTemplates)}
                  </div>
                )}

                <textarea
                  id="auto-quote-input"
                  ref={textareaRef}
                  className={cn(
                    'relative z-10 w-full resize-none overflow-hidden rounded-md border border-line bg-surface px-4 py-3 text-sm leading-6 text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page',
                    imageData ? 'min-h-[210px] pt-24' : 'min-h-[130px]'
                  )}
                  aria-label="Mensagem do cliente para extração"
                  placeholder="Cole aqui a mensagem do cliente, formato natural é aceito. Inclua nome, telefone, e-mail, produto e quantidade."
                  value={text}
                  onChange={(event) => {
                    cancelPendingSelection();
                    const value = event.target.value;
                    setText(value);
                    updateMention(value, event.target.selectionStart);
                  }}
                  onClick={(event) => {
                    cancelPendingSelection();
                    updateMention(event.currentTarget.value, event.currentTarget.selectionStart);
                  }}
                  onKeyUp={(event) => updateMention(event.currentTarget.value, event.currentTarget.selectionStart)}
                  aria-controls={mention ? 'order-template-mentions' : undefined}
                  aria-expanded={Boolean(mention && mentionTemplates.length)}
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
                {mention && (
                  <div
                    id="order-template-mentions"
                    className="absolute inset-x-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-lg"
                  >
                    {mentionTemplates.length ? mentionTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insertTemplateMention(template)}
                        className="flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm text-fg hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span>{template.name}</span>
                        <span className="text-xs text-fg-muted">@{templateSlug(template.name)}</span>
                      </button>
                    )) : (
                      <p className="px-3 py-2 text-sm text-fg-muted">Nenhum template encontrado.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Actions row */}
            <div className="flex items-center gap-2">
              <Button
                onClick={handleExtract}
                disabled={extracting || (!text.trim() && !imageData)}
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => (activeDrafts.length > 0 ? setConfirmReset(true) : handleReset())}
                >
                  <RotateCcw size={14} />
                  Limpar
                </Button>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="tone-destructive-soft rounded-lg p-3 text-sm" role="alert">
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
          <div className="flex shrink-0 justify-start border-t border-line px-4 py-3 md:px-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOrderTemplateManagerOpen(true)}
            >
              <Settings size={14} />
              Gerenciar templates
            </Button>
          </div>
        </div>

        {/* ── RIGHT PANEL (50%) ── */}
        <div className="h-1/2 min-h-0 w-full min-w-0 flex-1 overflow-y-auto bg-page px-4 pb-6 pt-4 md:px-6 md:pt-5 lg:h-auto lg:w-1/2 lg:flex-none">
          {activeDrafts.length === 0 ? (
            <div className="flex h-full flex-col">
              <div className="mb-3">
                <h2 className="text-lg font-semibold tracking-tight text-fg">Resultado</h2>
              </div>
              <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-line text-center">
                {/* The canonical large radius keeps this empty-state icon balanced. */}
                <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-surface-muted mb-4">
                  <FileText size={32} className="text-fg-muted" />
                </div>
                <h2 className="text-lg font-semibold text-fg">Nenhum pedido extraído</h2>
                <p className="mt-1 max-w-sm text-sm text-fg-muted">
                  Cole a mensagem do cliente no painel esquerdo e clique em <strong>Extrair</strong> para
                  gerar orçamentos.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold tracking-tight text-fg">
                    Resultados ({activeDrafts.length})
                  </h2>
                  <p className="text-sm text-fg-muted">
                    Confira os dados, itens e preços antes de criar o documento.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmClearResults(true)}
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
                      className="overflow-hidden rounded-lg border border-destructive/30 bg-surface shadow-sm"
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
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Descartar pedido e resultados?"
        message="O texto e a imagem atuais serão apagados e todos os rascunhos extraídos (incluindo orçamentos ainda não emitidos) serão removidos deste navegador."
        confirmLabel="Descartar tudo"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => {
          setConfirmReset(false);
          handleReset();
        }}
        onCancel={() => setConfirmReset(false)}
      />

      <ConfirmDialog
        open={confirmClearResults}
        title="Limpar a lista de resultados?"
        message="Todos os rascunhos extraídos serão removidos deste navegador, incluindo os que ainda não foram emitidos."
        confirmLabel="Limpar lista"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => {
          setConfirmClearResults(false);
          clearResults();
        }}
        onCancel={() => setConfirmClearResults(false)}
      />
    </div>
  );
}
