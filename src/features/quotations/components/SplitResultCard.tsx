// src/components/SplitResultCard.tsx
// Compact result card for the split-panel auto page.

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import {
  Pencil,
  X,
  Plus,
  Loader2,
  AlertTriangle,
  Send,
  Check,
  Eye,
  FileText,
  Phone,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { capitalize, fmtPhone, formatBRL } from '@/lib/formatting/formatters';
import { isValidLeadSource, LEAD_SOURCES } from '@/lib/clientMetadata';
import { isUnpricedProduct, searchProducts } from '@/lib/api/productCache';
import type { Product } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import WhatsAppSendPanel from '@/features/quotations/components/WhatsAppSendPanel';
import QuotationDeliveryStatus from '@/features/quotations/components/QuotationDeliveryStatus';
import type {
  Draft,
  DraftEdited,
  DraftItem,
  QuotationIssueProjection,
  QuotationSavedSnapshot,
  StoredAutoQuoteDraft,
} from '@/types/domain';
import type { QuotationTemplateMetadata } from '@/lib/api/quotationTemplatesApi';
import type { CommunicationFlow } from '@/lib/api/communicationApi';
import type { DeliveryResolution, DeliveryView } from '@/lib/api/quotationDeliveryApi';
import type {
  ClientResolutionCandidate,
  ClientResolutionMatchedBy,
  ClientResolutionView,
} from '@/features/quotations/automaticClientResolution';

export interface SplitResultCardProps {
  draft: Draft;
  displayIdx: number;
  totalDrafts: number;
  isProcessing?: boolean;
  issueBlocked?: boolean;
  editingBlocked?: boolean;
  onUpdateField: (draftIdx: number, field: keyof DraftEdited, value: unknown) => void;
  onUpdateItem: (draftIdx: number, itemIdx: number, field: keyof DraftItem, value: unknown) => void;
  onRemoveItem: (draftIdx: number, itemIdx: number) => void;
  onAddItem: (draftIdx: number) => void;
  selectProduct: (draftIdx: number, itemIdx: number, product: Product) => Promise<void>;
  onRefetchPricing: (draftIdx: number) => Promise<Draft | undefined>;
  onCreateQuote: (draftIdx: number) => void;
  onRecoverIssue?: (draftIdx: number) => void;
  onClearIssueRecovery?: (draftIdx: number) => void;
  onPricingPendingChange?: (draftIdx: number, pending: boolean) => void;
  isSavingDraft?: boolean;
  onReviewQuote: (draftIdx: number) => void;
  reviewOnly?: boolean;
  onApply?: () => void;
  onDiscard?: () => void;
  issue?: QuotationIssueProjection;
  issueError?: string;
  pricingConflictItems?: string[];
  viewUrl?: string;
  delivery?: DeliveryView | null;
  deliveryPending?: boolean;
  deliveryError?: string;
  waSendEnabled?: boolean;
  waFlows?: CommunicationFlow[];
  waSelectedFlowId?: string;
  waFlowSelectionDisabled?: boolean;
  templates?: QuotationTemplateMetadata[];
  templateLoading?: boolean;
  templateError?: string | null;
  onRetryTemplates?: () => void;
  onSelectWhatsAppFlow?: (draftIdx: number, flowId: string) => void;
  onSendWhatsApp?: (draftIdx: number) => void;
  onResolveDelivery?: (decision: DeliveryResolution, note: string) => void | Promise<void>;
  /** Demand selector rendered for automatic results before saving/issuing. */
  opportunitySelector?: ReactNode;
  /** Portuguese, user-facing reason the automatic result cannot be issued yet. */
  opportunityBlockMessage?: string | null;
  /** Client identity resolution of this card, when the automatic flow provides one. */
  clientResolution?: ClientResolutionView;
  onSelectClient?: (draftIdx: number, candidate: ClientResolutionCandidate) => void;
  onConfirmNewClient?: (draftIdx: number) => void;
  onRetryClientResolution?: (draftIdx: number) => void;
  onClearClientSelection?: (draftIdx: number) => void;
  /** Portuguese, user-facing reason the client identity blocks persistence. */
  clientBlockMessage?: string | null;
}

const CLIENT_MATCH_FIELD_LABELS: Record<ClientResolutionMatchedBy, string> = {
  documento: 'documento',
  email: 'e-mail',
  telefone: 'telefone',
  nome: 'nome',
  empresa: 'empresa',
};

function matchedByLabel(fields: ClientResolutionMatchedBy[]): string {
  const labels = fields.map((field) => CLIENT_MATCH_FIELD_LABELS[field]);
  if (labels.length === 0) return 'sem campo informado';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
}

function clientResolutionAnnouncement(view: ClientResolutionView): string {
  switch (view.state) {
    case 'checking':
      return 'Verificando cliente…';
    case 'linked':
      return `Cliente já cadastrado: ${view.nome}`;
    case 'choice':
      return `${view.candidates.length} clientes encontrados. Escolha o cliente para continuar.`;
    case 'archived':
      return 'Cliente arquivado.';
    case 'new_client':
      return view.confirmed ? 'Novo cliente confirmado.' : 'Novo cliente.';
    case 'error':
      return 'Não foi possível verificar o cliente.';
    default:
      return '';
  }
}

interface ClientResolutionAreaProps {
  view: ClientResolutionView;
  draftIdx: number;
  disabled: boolean;
  onSelectClient?: (draftIdx: number, candidate: ClientResolutionCandidate) => void;
  onConfirmNewClient?: (draftIdx: number) => void;
  onRetryClientResolution?: (draftIdx: number) => void;
  onClearClientSelection?: (draftIdx: number) => void;
}

/** Compact identity state of the card, next to the identity fields it decides.
 * Every action is a button, so the whole area works by keyboard, and the state
 * is announced without moving focus. */
function ClientResolutionArea({
  view,
  draftIdx,
  disabled,
  onSelectClient,
  onConfirmNewClient,
  onRetryClientResolution,
  onClearClientSelection,
}: ClientResolutionAreaProps) {
  if (view.state === 'idle') return null;
  return (
    <div className="mt-2 rounded-md border border-border-subtle bg-raised px-3 py-2">
      <p className="sr-only" aria-live="polite">
        {clientResolutionAnnouncement(view)}
      </p>
      {view.state === 'checking' && (
        <p className="flex items-center gap-2 text-[11px] text-fg-muted">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          Verificando cliente…
        </p>
      )}
      {view.state === 'linked' && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className="inline-flex items-center gap-1 font-medium text-fg">
            <Check size={12} aria-hidden="true" />
            Cliente já cadastrado
          </span>
          <span className="truncate text-fg-muted">{view.nome}</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled || !onClearClientSelection}
            onClick={() => onClearClientSelection?.(draftIdx)}
          >
            Trocar
          </Button>
        </div>
      )}
      {view.state === 'choice' && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-fg-muted">Escolha o cliente</p>
          <ul className="space-y-1">
            {view.candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  disabled={candidate.arquivado || disabled || !onSelectClient}
                  onClick={() => onSelectClient?.(draftIdx, candidate)}
                  className="w-full rounded-md border border-border-subtle bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface"
                >
                  <span className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-fg">
                    <span className="truncate">{candidate.nome}</span>
                    {candidate.empresa && (
                      <span className="truncate text-[10px] font-normal text-fg-muted">
                        {candidate.empresa}
                      </span>
                    )}
                  </span>
                  {(candidate.documento || candidate.email || candidate.telefone) && (
                    <span className="block truncate text-[10px] text-fg-muted">
                      {[candidate.documento, candidate.email, candidate.telefone]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                  <span className="block text-[10px] text-fg-muted">
                    Corresponde por {matchedByLabel(candidate.matchedBy)}
                  </span>
                  {candidate.arquivado && (
                    <span className="block text-[10px] font-medium text-destructive">
                      Cliente arquivado — indisponível para seleção
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {view.allowNewClient && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={disabled || !onConfirmNewClient}
              onClick={() => onConfirmNewClient?.(draftIdx)}
            >
              É outro cliente: cadastrar novo
            </Button>
          )}
        </div>
      )}
      {view.state === 'new_client' && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 font-medium text-fg">
            {view.confirmed && <Check size={12} aria-hidden="true" />}
            Novo cliente
          </span>
          {!view.confirmed && view.needsConfirmation && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={disabled || !onConfirmNewClient}
              onClick={() => onConfirmNewClient?.(draftIdx)}
            >
              É outro cliente: cadastrar novo
            </Button>
          )}
        </div>
      )}
      {view.state === 'archived' && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 font-medium text-destructive">
            <AlertTriangle size={12} aria-hidden="true" />
            Cliente arquivado
          </span>
          {view.nome && <span className="truncate text-fg-muted">{view.nome}</span>}
          <Button type="button" variant="outline" size="xs" asChild>
            <a
              href={view.clientId ? `#/leads/cliente/${encodeURIComponent(view.clientId)}` : '#/leads'}
            >
              Abrir cadastro
            </a>
          </Button>
        </div>
      )}
      {view.state === 'error' && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 font-medium text-destructive">
            <AlertTriangle size={12} aria-hidden="true" />
            Não foi possível verificar o cliente
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled || !onRetryClientResolution}
            onClick={() => onRetryClientResolution?.(draftIdx)}
          >
            Tentar novamente
          </Button>
        </div>
      )}
    </div>
  );
}

export default function SplitResultCard({
  draft,
  displayIdx,
  totalDrafts,
  isProcessing,
  issueBlocked = false,
  editingBlocked: parentEditingBlocked = false,
  onUpdateField,
  onUpdateItem,
  onRemoveItem,
  onAddItem,
  selectProduct,
  onRefetchPricing,
  onCreateQuote,
  onRecoverIssue,
  onClearIssueRecovery,
  onPricingPendingChange,
  isSavingDraft = false,
  onReviewQuote,
  reviewOnly = false,
  onApply,
  onDiscard,
  issue,
  issueError,
  pricingConflictItems = [],
  viewUrl,
  delivery = null,
  deliveryPending = false,
  deliveryError,
  waSendEnabled = false,
  waFlows = [],
  waSelectedFlowId = '',
  waFlowSelectionDisabled = false,
  templates = [],
  templateLoading = false,
  templateError = null,
  onRetryTemplates,
  onSelectWhatsAppFlow,
  onSendWhatsApp,
  onResolveDelivery,
  opportunitySelector,
  opportunityBlockMessage = null,
  clientResolution,
  onSelectClient,
  onConfirmNewClient,
  onRetryClientResolution,
  onClearClientSelection,
  clientBlockMessage = null,
}: SplitResultCardProps) {
  const [editing, setEditing] = useState(reviewOnly);
  const [templateExpanded, setTemplateExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const editingBlocked = Boolean(isProcessing || isSavingDraft || parentEditingBlocked);
  const isDone = Boolean(issue) || (draft.status === 'done' && draft.result?.success);

  useEffect(() => {
    if (isDone || draft.edited.template_key || !templates.some((template) => template.key === 'simples')) {
      return;
    }
    onUpdateField(draft.index, 'template_key', 'simples');
  }, [draft.edited.template_key, draft.index, isDone, onUpdateField, templates]);

  useEffect(() => {
    if (!pricingConflictItems.length) return;
    setEditing(true);
    const sku = pricingConflictItems[0];
    const focus = () => {
      const input = Array.from(cardRef.current?.querySelectorAll<HTMLInputElement>('[data-conflict-sku]') || [])
        .find((candidate) => candidate.dataset.conflictSku === sku);
      input?.focus();
    };
    const frame = window.requestAnimationFrame(focus);
    return () => window.cancelAnimationFrame(frame);
  }, [pricingConflictItems]);
  // ── Per-item product search (local state, like QuotationDetailPage) ──
  const [itemSearchTerms, setItemSearchTerms] = useState<Record<number, string>>({});
  const [itemResults, setItemResults] = useState<Record<number, Product[]>>({});
  const [itemSearching, setItemSearching] = useState<Record<number, boolean>>({});
  const [activeSearchIdx, setActiveSearchIdx] = useState<number | null>(null);
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const qtyPricingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pricingGenerationRef = useRef(0);
  const [pricingPending, setPricingPending] = useState(false);
  const beginPricing = useCallback(() => {
    if (qtyPricingTimer.current) clearTimeout(qtyPricingTimer.current);
    qtyPricingTimer.current = null;
    const generation = ++pricingGenerationRef.current;
    setPricingPending(true);
    return generation;
  }, []);
  const settlePricing = useCallback((generation: number) => {
    if (pricingGenerationRef.current === generation) setPricingPending(false);
  }, []);
  const actionBlocked = Boolean(editingBlocked || issueBlocked || pricingPending);

  useEffect(() => {
    onPricingPendingChange?.(draft.index, pricingPending);
    return () => onPricingPendingChange?.(draft.index, false);
  }, [draft.index, onPricingPendingChange, pricingPending]);

  useEffect(() => {
    if (!editingBlocked) return;
    setEditing(false);
    Object.values(searchTimers.current).forEach((timer) => clearTimeout(timer));
    searchTimers.current = {};
    setItemSearchTerms({});
    setItemResults({});
    setItemSearching({});
    setActiveSearchIdx(null);
    if (!isProcessing && !isSavingDraft) return;
    pricingGenerationRef.current += 1;
    setPricingPending(false);
    if (qtyPricingTimer.current) {
      clearTimeout(qtyPricingTimer.current);
      qtyPricingTimer.current = null;
    }
  }, [editingBlocked, isProcessing, isSavingDraft]);

  useEffect(() => () => {
    if (qtyPricingTimer.current) clearTimeout(qtyPricingTimer.current);
  }, []);

  // Click outside closes the active dropdown
  useEffect(() => {
    if (activeSearchIdx === null) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.item-search-cell')) {
        setActiveSearchIdx(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeSearchIdx]);

  // Debounced product search per item index
  const onItemSkuChange = useCallback(
    (ii: number, value: string) => {
      if (editingBlocked) return;
      setItemSearchTerms((prev) => ({ ...prev, [ii]: value }));
      onUpdateItem(draft.index, ii, 'item_code', value);
      if (searchTimers.current[ii]) clearTimeout(searchTimers.current[ii]);
      if (value && value.length >= 2) {
        setItemSearching((prev) => ({ ...prev, [ii]: true }));
        searchTimers.current[ii] = setTimeout(async () => {
          try {
            const data = await searchProducts(value, 6);
            setItemResults((prev) => ({ ...prev, [ii]: data }));
          } catch {
            setItemResults((prev) => ({ ...prev, [ii]: [] }));
          } finally {
            setItemSearching((prev) => ({ ...prev, [ii]: false }));
          }
        }, 300);
      } else {
        setItemResults((prev) => ({ ...prev, [ii]: [] }));
        setItemSearching((prev) => ({ ...prev, [ii]: false }));
      }
    },
    [draft.index, editingBlocked, onUpdateItem]
  );

  // Select product from dropdown
  const handleSelectProduct = useCallback(
    async (ii: number, product: Product) => {
      if (editingBlocked) return;
      if (!product?.sku) return;
      if (isUnpricedProduct(product)) return;
      const pricingGeneration = beginPricing();
      try {
        await selectProduct(draft.index, ii, product);
      } finally {
        settlePricing(pricingGeneration);
      }
      setItemSearchTerms((prev) => ({
        ...prev,
        [ii]: product.sku,
      }));
      setItemResults((prev) => ({ ...prev, [ii]: [] }));
      setActiveSearchIdx(null);
    },
    [beginPricing, draft.index, editingBlocked, selectProduct, settlePricing]
  );

  // Remove item with local state cleanup
  const handleRemoveItem = useCallback(
    (ii: number) => {
      if (editingBlocked) return;
      onRemoveItem(draft.index, ii);
      setItemSearchTerms((prev) => {
        const n = { ...prev };
        delete n[ii];
        return n;
      });
      setItemResults((prev) => {
        const n = { ...prev };
        delete n[ii];
        return n;
      });
      setItemSearching((prev) => {
        const n = { ...prev };
        delete n[ii];
        return n;
      });
      if (activeSearchIdx === ii) setActiveSearchIdx(null);
    },
    [activeSearchIdx, draft.index, editingBlocked, onRemoveItem]
  );

  const savedDraft = draft as StoredAutoQuoteDraft;
  const saved = savedDraft.saved;
  const hasSavedSnapshot = Boolean(saved?.snapshot);
  const resultData = draft.result?.data;
  const snapshot = saved?.snapshot || (resultData?.snapshot as QuotationSavedSnapshot | undefined);
  const items = isDone
    ? snapshot?.items || []
    : draft.edited.items || [];
  const calculatedTotal = items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const total = isDone ? snapshot?.total : calculatedTotal;
  const totalDisplay = total === undefined ? '—' : formatBRL(total);
  const validItems = items.filter((it) => it.item_code && it.qty > 0).length;
  const hasClient = Boolean(draft.edited.nome?.trim());
  const actionBlockMessage = !hasClient && validItems === 0
    ? 'Informe o cliente e adicione ao menos um item para continuar.'
    : !hasClient
      ? 'Informe o cliente para continuar.'
      : validItems === 0
        ? 'Adicione ao menos um item para continuar.'
        : !draft.edited.origem
          ? 'Selecione a origem para continuar.'
          : !isValidLeadSource(draft.edited.origem)
            ? 'Selecione uma origem válida para continuar.'
            : clientBlockMessage
              ? clientBlockMessage
              : opportunityBlockMessage
                ? opportunityBlockMessage
                : null;
  const canCreate = actionBlockMessage === null;
  const canApply = canCreate && items.every((item) => Number.isFinite(Number(item.rate)) && Number(item.rate) > 0);
  const actionStatusId = `quotation-action-status-${draft.index}`;
  const displayItems = editing ? items : items.filter((it) => it.item_code);
  const immutableIssue = Boolean(issue);
  const issueViewUrl = issue?.pdfUrl || viewUrl;
  const displayName = (resultData?.cliente as string | undefined) || draft.edited.nome;
  const whatsappSendBlocked = deliveryPending || Boolean(delivery) || Boolean(deliveryError);

  function toggleEditing() {
    if (editingBlocked || immutableIssue) return;
    if (!editing) {
      // Pre-fill search terms with existing item codes
      const terms: Record<number, string> = {};
      items.forEach((item, ii) => {
        if (item.item_code) terms[ii] = item.item_code;
      });
      setItemSearchTerms(terms);
    } else {
      // Clear local search state on exit
      setItemSearchTerms({});
      setItemResults({});
      setItemSearching({});
      setActiveSearchIdx(null);
    }
    setEditing((prev) => !prev);
  }

  return (
    <div
      ref={cardRef}
      aria-busy={isProcessing || issueBlocked || parentEditingBlocked || pricingPending}
      className={cn(
        'rounded-lg border border-border-subtle bg-surface',
        isProcessing && !immutableIssue && 'opacity-60'
      )}
    >
      {/* ── Header ── */}
      <div
        className={cn(
          'flex items-start justify-between gap-3 rounded-t-lg bg-raised p-4',
          !isDone && 'border-b border-border-subtle'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-fg-muted">
              Pedido {displayIdx + 1} de {totalDrafts}
            </span>

            {draft.edited.urgente && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                <AlertTriangle size={10} /> Urgente
              </span>
            )}
            {isDone && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                <Check size={10} /> Emitido
              </span>
            )}
            {!isDone && hasSavedSnapshot && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                <Check size={10} /> Rascunho salvo
              </span>
            )}
          </div>
          {editing && !isDone ? (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium text-fg-muted">Nome</span>
                  <Input
                    aria-label="Nome"
                    value={draft.edited.nome || ''}
                    onChange={(e) => onUpdateField(draft.index, 'nome', e.target.value)}
                    disabled={editingBlocked}
                    placeholder="Nome"
                    className="h-7 text-xs"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium text-fg-muted">Empresa</span>
                  <Input
                    aria-label="Empresa"
                    value={draft.edited.empresa || ''}
                    onChange={(e) => onUpdateField(draft.index, 'empresa', e.target.value)}
                    disabled={editingBlocked}
                    placeholder="Empresa"
                    className="h-7 text-xs"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[4fr_3fr_3fr]">
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium text-fg-muted">E-mail</span>
                  <Input
                    aria-label="E-mail"
                    value={draft.edited.email || ''}
                    onChange={(e) => onUpdateField(draft.index, 'email', e.target.value)}
                    disabled={editingBlocked}
                    placeholder="E-mail"
                    className="h-7 text-xs"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium text-fg-muted">Telefone</span>
                  <Input
                    aria-label="Telefone"
                    value={draft.edited.telefone || ''}
                    onChange={(e) => onUpdateField(draft.index, 'telefone', e.target.value)}
                    disabled={editingBlocked}
                    placeholder="Telefone"
                    className="h-7 text-xs"
                  />
                </label>
                <label className="block space-y-1 [&>div]:flex [&>div]:w-full">
                  <span className="text-[10px] font-medium text-fg-muted">Origem</span>
                  <Select
                    aria-label="Origem"
                    value={draft.edited.origem || ''}
                    onChange={(e) => onUpdateField(draft.index, 'origem', e.target.value)}
                    disabled={editingBlocked}
                    className="h-7 w-full rounded-control border border-border-control bg-raised px-2 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-sage focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                  >
                    <option value="">Selecione a origem…</option>
                    {LEAD_SOURCES.map((source) => (
                      <option key={source.value} value={source.value}>
                        {source.label}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            </div>
          ) : (
            <>
              <h3 className="mt-1 flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
                <span className="truncate">{capitalize(displayName) || 'Cliente'}</span>
                {draft.edited.origem && (
                  <span className="shrink-0 rounded-full bg-taupe/15 px-1.5 py-0.5 text-[10px] font-medium leading-3 text-primary">
                    {draft.edited.origem}
                  </span>
                )}
              </h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-fg-muted">
                {draft.edited.empresa && <span>{draft.edited.empresa}</span>}
                {draft.edited.email && <span>{draft.edited.email}</span>}
                {draft.edited.telefone && <span>{fmtPhone(draft.edited.telefone) || draft.edited.telefone}</span>}
              </div>
            </>
          )}
          {!isDone && !hasSavedSnapshot && clientResolution && (
            <ClientResolutionArea
              view={clientResolution}
              draftIdx={draft.index}
              disabled={editingBlocked}
              onSelectClient={onSelectClient}
              onConfirmNewClient={onConfirmNewClient}
              onRetryClientResolution={onRetryClientResolution}
              onClearClientSelection={onClearClientSelection}
            />
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] font-medium text-fg-muted uppercase">Total</p>
          <p className="text-lg font-bold text-fg">{totalDisplay}</p>
          {isDone && snapshot && <p className="text-[10px] text-fg-muted">Frete: {formatBRL(snapshot.frete)}</p>}
          {draft.edited.urgente && (
            <p className="text-[10px] text-fg-muted">Base: {totalDisplay}</p>
          )}
        </div>
      </div>

      {/* ── Demand selector (automatic flow) ── */}
      {!isDone && opportunitySelector && (
        <div className="border-b border-border-subtle bg-raised/60 px-4 py-3">
          {opportunitySelector}
        </div>
      )}

      {/* ── Template selector ── */}
      {!isDone && (
        <div className="border-b border-border-subtle bg-raised/60 px-4 py-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left text-[10px] font-medium text-fg-muted"
            aria-expanded={templateExpanded}
            aria-controls={`quotation-template-${draft.index}`}
            onClick={() => setTemplateExpanded((expanded) => !expanded)}
          >
            Modelo de orçamento
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={cn('transition-transform', templateExpanded && 'rotate-180')}
            />
          </button>
          {templateExpanded && (
            <div id={`quotation-template-${draft.index}`} className="mt-3">
              {templateError ? (
                <div className="flex items-center justify-between gap-2 text-xs text-destructive">
                  <span>{templateError}</span>
                  <Button type="button" variant="outline" size="sm" onClick={onRetryTemplates}>Tentar novamente</Button>
                </div>
              ) : (
                <Select
                  aria-label="Modelo de orçamento"
                  value={draft.edited.template_key || ''}
                  onChange={(event) => onUpdateField(draft.index, 'template_key', event.target.value)}
                  disabled={editingBlocked || templateLoading || templates.length === 0}
                  className="h-8 w-full rounded-control border border-border-control bg-raised px-2 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-sage focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                  containerClassName="w-full"
                >
                  {!draft.edited.template_key && <option value="">Modelo padrão</option>}
                  {templates.map((template) => (
                    <option key={template.key} value={template.key}>{template.name}</option>
                  ))}
                </Select>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Items table ── */}
      {!isDone && (
        <Table
          containerClassName="border-0 rounded-none"
          className="w-full max-w-full table-fixed text-xs"
          aria-label={`Itens do pedido ${displayIdx + 1}`}
        >
            <colgroup>
              <col className="w-24" />
              <col />
              <col className="w-16" />
              <col className="w-20" />
              <col className="w-10" />
            </colgroup>
            <TableHeader>
              <TableRow className="text-fg-muted">
                <TableHead scope="col" className="py-2 pl-4 pr-2 text-left font-medium">SKU</TableHead>
                <TableHead scope="col" className="px-2 py-2 text-left font-medium">Produto</TableHead>
                <TableHead scope="col" className="px-2 py-2 text-center font-medium">Qtd</TableHead>
                <TableHead scope="col" className="px-2 py-2 text-center font-medium">Preço</TableHead>
                <TableHead scope="col" className="px-1 py-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayItems.map((item, ii) => {
                const hasCode = !!item.item_code;
                const results = itemResults[ii] || [];
                const searching = itemSearching[ii] || false;
                const showDropdown = activeSearchIdx === ii && results.length > 0;
                const searchValue =
                  itemSearchTerms[ii] !== undefined ? itemSearchTerms[ii] : item.item_code || '';

                return (
                  <TableRow
                    key={ii}
                    className={cn(
                      'border-b border-line last:border-b-0 hover:bg-surface-hover',
                      pricingConflictItems.includes(item.item_code) && 'bg-warning/10',
                    )}
                  >
                    <TableCell className="py-2 pl-4 pr-2">
                      {editing ? (
                        <div className="relative item-search-cell">
                          <Input
                            className="h-7 text-xs pr-6"
                            placeholder="Buscar SKU ou nome…"
                            value={searchValue}
                            onChange={(e) => onItemSkuChange(ii, e.target.value)}
                            onFocus={() => setActiveSearchIdx(ii)}
                            disabled={editingBlocked}
                          />
                          {searching && (
                            <Loader2
                              size={12}
                              className="animate-spin absolute right-2 top-1.5 text-fg-muted"
                            />
                          )}
                          {showDropdown && (
                            <div className="absolute left-0 right-0 top-8 z-50 max-h-48 overflow-y-auto rounded-md border border-border-subtle bg-surface shadow-lg">
                              {results.map((p) => (
                                <button
                                  key={p.sku || p.item_code}
                                  type="button"
                                  disabled={editingBlocked || isUnpricedProduct(p)}
                                  title={
                                    isUnpricedProduct(p)
                                      ? 'Preço indisponível para este produto.'
                                      : undefined
                                  }
                                  className={cn(
                                    'w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
                                    isUnpricedProduct(p)
                                      ? 'cursor-not-allowed opacity-50'
                                      : 'hover:bg-surface-hover'
                                  )}
                                  onMouseDown={(e) => e.preventDefault()}
                          onClick={() => void handleSelectProduct(ii, p)}
                                >
                                  <span className="font-mono text-[10px] text-fg-muted shrink-0">
                                    {p.sku || p.item_code}
                                  </span>
                                  <span className="truncate">
                                    {String(p.nome || p.item_name || '—')}
                                  </span>
                                  {isUnpricedProduct(p) && (
                                    <span className="ml-auto shrink-0 text-[10px] text-destructive">
                                      Preço indisponível
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="block truncate font-medium text-fg" title={item.item_code || undefined}>
                          {item.item_code || '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      {editing ? (
                        <Input
                          aria-label={`Nome exibido no orçamento ${item.item_code || ii + 1}`}
                          className="h-7 text-xs"
                          value={item.item_name || ''}
                          onChange={(event) =>
                            onUpdateItem(draft.index, ii, 'item_name', event.target.value)
                          }
                          disabled={editingBlocked}
                        />
                      ) : (
                        <span
                          className="block truncate font-medium text-fg"
                          title={item.item_name || item.item_code || undefined}
                        >
                          {item.item_name || item.item_code || '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-center">
                      {editing ? (
                        <Input
                          type="number"
                          aria-label={`Quantidade do item ${item.item_code || ii + 1}`}
                          value={item.qty}
                          onChange={(e) => {
                            if (editingBlocked) return;
                            const val = Math.max(1, Number(e.target.value));
                            onUpdateItem(draft.index, ii, 'qty', val);
                            const pricingGeneration = beginPricing();
                            qtyPricingTimer.current = setTimeout(async () => {
                              qtyPricingTimer.current = null;
                              try {
                                await onRefetchPricing(draft.index);
                              } finally {
                                settlePricing(pricingGeneration);
                              }
                            }, 600);
                          }}
                          disabled={editingBlocked}
                          className="h-7 w-full appearance-textfield text-center text-xs [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
                        />
                      ) : hasCode ? (
                        Number(item.qty)
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-center">
                      {editing ? (
                        <Input
                          type="number"
                          step="0.01"
                          aria-label={`Preço unitário do item ${item.item_code || ii + 1}`}
                          value={item.rate || ''}
                          onChange={(e) =>
                            onUpdateItem(draft.index, ii, 'rate', Number(e.target.value))
                          }
                          disabled={editingBlocked}
                          data-conflict-sku={item.item_code || undefined}
                          className="h-7 w-full appearance-textfield text-center text-xs [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
                        />
                      ) : item.rate ? (
                        formatBRL(item.rate)
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="px-1 py-2">
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(ii)}
                        disabled={editingBlocked}
                        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                        aria-label={`Excluir ${item.item_name || item.item_code || `item ${ii + 1}`}`}
                        title="Excluir produto"
                      >
                        <X size={13} />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {displayItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-4 text-center text-xs text-fg-muted">
                    Nenhum item adicionado
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
      )}

      {isDone && (
        <div className="rounded-b-lg border-t border-border-subtle bg-raised/60 px-4 pb-3">
          <WhatsAppSendPanel
            selectedFlowId={waSelectedFlowId}
            flows={waFlows}
            delivery={delivery}
            pending={deliveryPending}
            onSelectFlow={(flowId) => onSelectWhatsAppFlow?.(draft.index, flowId)}
            onSend={() => onSendWhatsApp?.(draft.index)}
            hideButton
            selectionDisabled={waFlowSelectionDisabled}
          />
          <QuotationDeliveryStatus
            delivery={delivery}
            pending={deliveryPending}
            hideStatusLabel
            hideUpdatedAt
            onResolve={onResolveDelivery}
          />
        </div>
      )}

      {/* ── Stage 3 + actions ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-b-lg border-t border-border-subtle bg-raised p-3">
        {!isDone && actionBlockMessage && (
          <p
            id={actionStatusId}
            className="w-full border-b border-border-subtle pb-3 text-xs leading-5 text-fg-muted"
          >
            {actionBlockMessage}
          </p>
        )}
        {!isDone && !reviewOnly && (
          <>
            <Button variant="ghost" size="sm" onClick={toggleEditing} disabled={editingBlocked}>
              <Pencil size={13} />
              {editing ? 'Concluir' : 'Editar'}
            </Button>
            {editing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAddItem(draft.index)}
                disabled={editingBlocked}
              >
                <Plus size={13} />
                Item
              </Button>
            )}
          </>
        )}

        <div className="flex-1" />

        {isDone ? (
          <>
            {issueViewUrl ? (
              <a
                href={issueViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-surface px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              >
                <FileText size={13} /> Abrir PDF
              </a>
            ) : (
              <span aria-disabled="true" className="inline-flex h-8 items-center gap-2 rounded-sm bg-surface px-3 text-xs font-medium text-fg opacity-40">
                <FileText size={13} /> Abrir PDF
              </span>
            )}
            {waSendEnabled ? (
              <Button
                size="sm"
                disabled={whatsappSendBlocked}
                title={deliveryError || (delivery ? 'Este orçamento já possui uma entrega pelo WhatsApp.' : undefined)}
                onClick={() => onSendWhatsApp?.(draft.index)}
              >
                <Phone size={13} /> {deliveryError ? 'Falha no envio' : deliveryPending ? 'Enviando…' : delivery ? 'Enviado' : 'Enviar WhatsApp'}
              </Button>
            ) : null}
          </>
        ) : reviewOnly ? (
          <>
            <Button variant="outline" size="sm" onClick={onDiscard} disabled={actionBlocked}>Descartar resultado</Button>
            <Button size="sm" onClick={onApply} disabled={actionBlocked || !canApply}>Aplicar ao orçamento ativo</Button>
          </>
        ) : (
          <>
            {!editing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onReviewQuote(draft.index)}
                disabled={actionBlocked || !canCreate}
                title="Abre uma pré-visualização temporária sem salvar ou emitir."
                aria-describedby={actionBlockMessage ? actionStatusId : undefined}
              >
                <Eye size={13} />
                Revisar
              </Button>
            )}
            {!editing && (
              <Button
                size="sm"
                onClick={() => onCreateQuote(draft.index)}
                disabled={actionBlocked || !canCreate}
                aria-describedby={actionBlockMessage ? actionStatusId : undefined}
              >
                {isProcessing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {isProcessing ? 'Emitindo…' : 'Emitir orçamento'}
              </Button>
            )}
            {isProcessing && draft.result?.error && savedDraft.issueRecoveryRequired && onClearIssueRecovery && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onClearIssueRecovery(draft.index)}
              >
                Confirmar ausência e liberar nova tentativa
              </Button>
            )}
            {isProcessing && draft.result?.error && !savedDraft.issueRecoveryRequired && onRecoverIssue && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRecoverIssue(draft.index)}
              >
                Consultar novamente
              </Button>
            )}
          </>
        )}
      </div>

      {issueError && !isDone && (
        <p role="alert" className="border-t border-border-subtle px-4 py-3 text-xs text-destructive">
          {issueError}
        </p>
      )}

    </div>
  );
}
