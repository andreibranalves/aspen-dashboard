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
  CalendarClock,
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
  ClientResolutionView,
} from '@/features/quotations/automaticClientResolution';
import { Heading } from '@/components/ui/heading';
import ProductionTermsFields from '@/features/quotations/components/ProductionTermsFields';
import { DEFAULT_PRODUCTION_DAYS } from '@/lib/productionDeadline';
import { Text } from '@/components/ui/text';
import { MOBILE_MEDIA_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';

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
  /** Prazo padrão das Configurações, exibido enquanto o card não define outro. */
  defaultProductionDays?: number;
}

function clientResolutionAnnouncement(view: ClientResolutionView): string {
  switch (view.state) {
    case 'checking':
      return 'Verificando cliente…';
    case 'linked':
      return `Cliente já cadastrado: ${view.nome}`;
    case 'choice':
      return choiceHeading(view);
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

/** Heading of a choice, in the operator's words: what was found and why it
 * needs a decision. */
function choiceHeading(view: Extract<ClientResolutionView, { state: 'choice' }>): string {
  const count = view.candidates.length;
  switch (view.reason) {
    case 'identifier_in_use': {
      if (count === 1) {
        const [candidate] = view.candidates;
        const field = candidate.matchedBy.includes('email') ? 'e-mail' : 'telefone';
        return `Este ${field} já está no cadastro de ${candidate.nome}.`;
      }
      return 'O e-mail e o telefone já estão em outros cadastros.';
    }
    case 'identifier_conflict':
      return 'Cadastro encontrado, mas com dados diferentes.';
    case 'weak_matches_only':
      return count === 1 ? 'Cliente com nome parecido.' : `${count} clientes com nome parecido.`;
    case 'archived_match':
      return 'Só há cadastros arquivados com estes dados.';
    default:
      return `${count} cadastros com estes dados.`;
  }
}

function sameDigits(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = (left ?? '').replace(/\D/g, '');
  const b = (right ?? '').replace(/\D/g, '');
  return a.length > 0 && a === b;
}

function sameEmail(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = (left ?? '').trim().toLowerCase();
  return a.length > 0 && a === (right ?? '').trim().toLowerCase();
}

/** One contact of a candidate, marked against what the draft says: equal (✓),
 * different (≠) or unknown on one side (plain). */
function CandidateContact({
  value,
  draftValue,
  same,
}: {
  value: string | null;
  draftValue?: string;
  same: boolean;
}) {
  if (!value) return null;
  const differs = Boolean(draftValue?.trim()) && !same;
  return (
    <span className={cn('inline-flex items-center gap-1', differs && 'text-warning')}>
      {same && <Check size={12} className="text-success" aria-label="igual ao pedido" />}
      {differs && <span aria-label="diferente do pedido">≠</span>}
      {value}
    </span>
  );
}

const VISIBLE_CANDIDATES = 3;

interface ClientResolutionAreaProps {
  view: ClientResolutionView;
  draftIdx: number;
  disabled: boolean;
  /** Contacts extracted for the draft, to mark each candidate's equal and different fields. */
  identity: { email?: string; telefone?: string };
  onSelectClient?: (draftIdx: number, candidate: ClientResolutionCandidate) => void;
  onConfirmNewClient?: (draftIdx: number) => void;
  onRetryClientResolution?: (draftIdx: number) => void;
  onClearClientSelection?: (draftIdx: number) => void;
}

/** Identity decision of the card, one line when settled and a short choice when
 * not. Every action is a button, so the area works by keyboard, and the state
 * is announced without moving focus. */
function ClientResolutionArea({
  view,
  draftIdx,
  disabled,
  identity,
  onSelectClient,
  onConfirmNewClient,
  onRetryClientResolution,
  onClearClientSelection,
}: ClientResolutionAreaProps) {
  const [showAll, setShowAll] = useState(false);
  if (view.state === 'idle') return null;

  const selectable =
    view.state === 'choice' ? view.candidates.filter((candidate) => !candidate.arquivado) : [];
  const visible = showAll ? selectable : selectable.slice(0, VISIBLE_CANDIDATES);
  const hidden = selectable.length - visible.length;

  return (
    <div className="border-b border-border-subtle px-4 py-3 text-compact">
      <p className="sr-only" aria-live="polite">
        {clientResolutionAnnouncement(view)}
      </p>

      {view.state === 'checking' && (
        <p className="flex items-center gap-2 text-fg-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          Verificando cliente…
        </p>
      )}

      {view.state === 'linked' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-fg">
            <Check size={14} className="shrink-0 text-success" aria-hidden="true" />
            <span className="truncate">{view.nome}</span>
          </span>
          <span className="text-fg-muted">cliente cadastrado</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto"
            disabled={disabled || !onClearClientSelection}
            onClick={() => onClearClientSelection?.(draftIdx)}
          >
            Trocar
          </Button>
        </div>
      )}

      {view.state === 'choice' && (
        <div className="space-y-2">
          <p className="font-semibold text-fg">{choiceHeading(view)}</p>
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-control border border-border-subtle bg-surface">
            {visible.map((candidate) => (
              <li key={candidate.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-fg">
                    {candidate.nome}
                    {candidate.empresa && candidate.empresa !== candidate.nome && (
                      <span className="font-normal text-fg-muted"> · {candidate.empresa}</span>
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-fg-muted">
                    <CandidateContact
                      value={candidate.email}
                      draftValue={identity.email}
                      same={sameEmail(candidate.email, identity.email)}
                    />
                    <CandidateContact
                      value={candidate.telefone ? fmtPhone(candidate.telefone) || candidate.telefone : null}
                      draftValue={identity.telefone}
                      same={sameDigits(candidate.telefone, identity.telefone)}
                    />
                    {candidate.documento && <span>{candidate.documento}</span>}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={disabled || !onSelectClient}
                  onClick={() => onSelectClient?.(draftIdx, candidate)}
                  aria-label={`Usar o cadastro de ${candidate.nome}`}
                >
                  Usar
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            {hidden > 0 && (
              <Button type="button" variant="ghost" size="xs" onClick={() => setShowAll(true)}>
                Mostrar mais {hidden}
              </Button>
            )}
            {view.allowNewClient && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="ml-auto"
                disabled={disabled || !onConfirmNewClient}
                onClick={() => onConfirmNewClient?.(draftIdx)}
              >
                É outra pessoa: cadastrar novo
              </Button>
            )}
          </div>
        </div>
      )}

      {view.state === 'new_client' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 font-semibold text-fg">
            {view.confirmed && <Check size={14} className="text-success" aria-hidden="true" />}
            Novo cliente
          </span>
          <span className="text-fg-muted">será cadastrado ao salvar</span>
          {!view.confirmed && view.needsConfirmation && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="ml-auto"
              disabled={disabled || !onConfirmNewClient}
              onClick={() => onConfirmNewClient?.(draftIdx)}
            >
              Confirmar novo cliente
            </Button>
          )}
        </div>
      )}

      {view.state === 'archived' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 font-semibold text-warning">
            <AlertTriangle size={14} aria-hidden="true" />
            Cadastro arquivado
          </span>
          {view.nome && <span className="truncate text-fg-muted">{view.nome}</span>}
          <Button type="button" variant="outline" size="xs" className="ml-auto" asChild>
            <a href={view.clientId ? `#/leads/cliente/${encodeURIComponent(view.clientId)}` : '#/leads'}>
              Abrir cadastro
            </a>
          </Button>
        </div>
      )}

      {view.state === 'error' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 font-semibold text-destructive">
            <AlertTriangle size={14} aria-hidden="true" />
            Não foi possível verificar o cliente
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="ml-auto"
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
  defaultProductionDays = DEFAULT_PRODUCTION_DAYS,
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
  const [opportunityExpanded, setOpportunityExpanded] = useState(false);
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
  // No celular os itens viram lista empilhada; só uma versão fica montada.
  const compactItems = useMediaQuery(MOBILE_MEDIA_QUERY);
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
      if (!(e.target as Element).closest('[data-item-search-cell]')) {
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
  // Total sem o acréscimo: itens automáticos voltam ao preço de tabela.
  const baseTotal = draft.edited.items.reduce((sum, it) => {
    const rate = !it._rateManual && it._baseRate !== undefined ? it._baseRate : Number(it.rate) || 0;
    return sum + (Number(it.qty) || 0) * rate;
  }, 0);
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

  // Conteúdo de cada item, compartilhado pela tabela (desktop) e pela lista (celular).
  const itemRows = displayItems.map((item, ii) => {
    const hasCode = !!item.item_code;
    const results = itemResults[ii] || [];
    const searching = itemSearching[ii] || false;
    const showDropdown = activeSearchIdx === ii && results.length > 0;
    const searchValue =
      itemSearchTerms[ii] !== undefined ? itemSearchTerms[ii] : item.item_code || '';


    return {
      key: ii,
      item,
      hasCode,
      conflict: pricingConflictItems.includes(item.item_code),
      sku: (
        <>
                      {editing ? (
                        <div className="relative" data-item-search-cell>
                          <Input
                            size="xs"
                            className="pr-6"
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
                            <div className="absolute left-0 right-0 top-8 z-floating max-h-48 overflow-y-auto rounded-control border border-border-subtle bg-surface shadow-lg">
                              {results.map((p) => (
                                // eslint-disable-next-line no-restricted-syntax -- opção de autocomplete
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
                                    'w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 focus-inset',
                                    isUnpricedProduct(p)
                                      ? 'cursor-not-allowed opacity-50'
                                      : 'hover:bg-surface-hover'
                                  )}
                                  onMouseDown={(e) => e.preventDefault()}
                          onClick={() => void handleSelectProduct(ii, p)}
                                >
                                  <span className="font-mono text-3xs text-fg-muted shrink-0">
                                    {p.sku || p.item_code}
                                  </span>
                                  <span className="truncate">
                                    {String(p.nome || p.item_name || '—')}
                                  </span>
                                  {isUnpricedProduct(p) && (
                                    <span className="ml-auto shrink-0 text-3xs text-destructive">
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
        </>
      ),
      name: (
        <>
                      {editing ? (
                        <Input
                          aria-label={`Nome exibido no orçamento ${item.item_code || ii + 1}`}
                          size="xs"
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
        </>
      ),
      qty: (
        <>
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
                          size="xs"
                          hideSpinButtons
                          className="w-full text-center"
                        />
                      ) : hasCode ? (
                        Number(item.qty)
                      ) : (
                        '—'
                      )}
        </>
      ),
      price: (
        <>
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
                          size="xs"
                          hideSpinButtons
                          className="w-full text-center"
                        />
                      ) : item.rate ? (
                        formatBRL(item.rate)
                      ) : (
                        '—'
                      )}
        </>
      ),
      remove: (
        <>
                      <Button
                        type="button"
                        onClick={() => handleRemoveItem(ii)}
                        disabled={editingBlocked}
                        variant="ghost-muted-destructive"
                        size="icon"
                        aria-label={`Excluir ${item.item_name || item.item_code || `item ${ii + 1}`}`}
                        title="Excluir produto"
                      >
                        <X size={14} />
                      </Button>
        </>
      ),
    };
  });

  return (
    <div
      ref={cardRef}
      aria-busy={isProcessing || issueBlocked || parentEditingBlocked || pricingPending}
      className={cn(
        'rounded-control border border-border-subtle bg-surface',
        isProcessing && !immutableIssue && 'opacity-60'
      )}
    >
      {/* ── Header ── */}
      <div
        className={cn(
          'flex items-start justify-between gap-3 rounded-t-control bg-raised p-4',
          !isDone && 'border-b border-border-subtle'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-fg-muted">
              Pedido {displayIdx + 1} de {totalDrafts}
            </span>

            {draft.edited.prazo_pedido && (
              <span
                className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-badge bg-warning/10 px-2 py-0.5 text-2xs font-semibold text-warning"
                title={draft.edited.prazo_pedido}
              >
                <CalendarClock size={12} className="shrink-0" aria-hidden="true" />
                <span className="truncate">Prazo pedido: {draft.edited.prazo_pedido}</span>
              </span>
            )}
            {isDone && (
              <span className="inline-flex items-center gap-1 rounded-badge bg-primary/10 px-2 py-0.5 text-2xs font-semibold text-primary">
                <Check size={12} /> Emitido
              </span>
            )}
            {!isDone && hasSavedSnapshot && (
              <span className="inline-flex items-center gap-1 rounded-badge bg-surface px-2 py-0.5 text-2xs font-semibold text-fg-muted">
                <Check size={12} /> Rascunho salvo
              </span>
            )}
          </div>
          {editing && !isDone ? (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-3xs font-medium text-fg-muted">Nome</span>
                  <Input
                    aria-label="Nome"
                    value={draft.edited.nome || ''}
                    onChange={(e) => onUpdateField(draft.index, 'nome', e.target.value)}
                    disabled={editingBlocked}
                    placeholder="Nome"
                    size="xs"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-3xs font-medium text-fg-muted">Empresa</span>
                  <Input
                    aria-label="Empresa"
                    value={draft.edited.empresa || ''}
                    onChange={(e) => onUpdateField(draft.index, 'empresa', e.target.value)}
                    disabled={editingBlocked}
                    placeholder="Empresa"
                    size="xs"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[4fr_3fr_3fr]">
                <label className="flex flex-col gap-1">
                  <span className="text-3xs font-medium text-fg-muted">E-mail</span>
                  <Input
                    aria-label="E-mail"
                    value={draft.edited.email || ''}
                    onChange={(e) => onUpdateField(draft.index, 'email', e.target.value)}
                    disabled={editingBlocked}
                    placeholder="E-mail"
                    size="xs"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-3xs font-medium text-fg-muted">Telefone</span>
                  <Input
                    aria-label="Telefone"
                    value={draft.edited.telefone || ''}
                    onChange={(e) => onUpdateField(draft.index, 'telefone', e.target.value)}
                    disabled={editingBlocked}
                    placeholder="Telefone"
                    size="xs"
                  />
                </label>
                <label className="flex flex-col gap-1 [&>div]:flex [&>div]:w-full">
                  <span className="text-3xs font-medium text-fg-muted">Origem</span>
                  <Select
                    aria-label="Origem"
                    value={draft.edited.origem || ''}
                    onChange={(e) => onUpdateField(draft.index, 'origem', e.target.value)}
                    disabled={editingBlocked}
                    size="xs"
                    className="w-full"
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
              <Heading level="subsection" className="mt-1 flex min-w-0 items-center gap-2">
                <span className="truncate">{capitalize(displayName) || 'Cliente'}</span>
                {draft.edited.origem && (
                  <span className="shrink-0 rounded-badge bg-primary/10 px-1.5 py-0.5 text-2xs font-medium leading-3 text-primary">
                    {draft.edited.origem}
                  </span>
                )}
              </Heading>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-fg-muted">
                {draft.edited.empresa && <span>{draft.edited.empresa}</span>}
                {draft.edited.email && <span>{draft.edited.email}</span>}
                {draft.edited.telefone && <span>{fmtPhone(draft.edited.telefone) || draft.edited.telefone}</span>}
              </div>
            </>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-3xs font-medium text-fg-muted uppercase">Total</p>
          <p className="text-lg font-bold text-fg">{totalDisplay}</p>
          {isDone && snapshot && <p className="text-3xs text-fg-muted">Frete: {formatBRL(snapshot.frete)}</p>}
          {!isDone && draft.edited.acrescimo_percent > 0 && (
            <p className="text-3xs text-fg-muted">Base: {formatBRL(baseTotal)}</p>
          )}
        </div>
      </div>

      {!isDone && !hasSavedSnapshot && clientResolution && (
        <ClientResolutionArea
          view={clientResolution}
          draftIdx={draft.index}
          disabled={editingBlocked}
          identity={{ email: draft.edited.email, telefone: draft.edited.telefone }}
          onSelectClient={onSelectClient}
          onConfirmNewClient={onConfirmNewClient}
          onRetryClientResolution={onRetryClientResolution}
          onClearClientSelection={onClearClientSelection}
        />
      )}

      {/* ── Demand selector (automatic flow) ── */}
      {!isDone && opportunitySelector && (
        <div className="border-b border-border-subtle bg-raised/60 px-4 py-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left text-3xs font-medium text-fg-muted"
            aria-expanded={opportunityExpanded}
            aria-controls={`quotation-opportunity-${draft.index}`}
            onClick={() => setOpportunityExpanded((expanded) => !expanded)}
          >
            Oportunidade
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={cn('transition-transform', opportunityExpanded && 'rotate-180')}
            />
          </button>
          {opportunityExpanded && (
            <div id={`quotation-opportunity-${draft.index}`} className="mt-3">
              {opportunitySelector}
            </div>
          )}
        </div>
      )}

      {/* ── Template selector ── */}
      {!isDone && (
        <div className="border-b border-border-subtle bg-raised/60 px-4 py-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left text-3xs font-medium text-fg-muted"
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
                  <Button type="button" variant="outline" onClick={onRetryTemplates}>Tentar novamente</Button>
                </div>
              ) : (
                <Select
                  aria-label="Modelo de orçamento"
                  value={draft.edited.template_key || ''}
                  onChange={(event) => onUpdateField(draft.index, 'template_key', event.target.value)}
                  disabled={editingBlocked || templateLoading || templates.length === 0}
                  size="sm"
                  className="w-full"
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

      {!isDone && (
        <ProductionTermsFields
          className="border-b border-border-subtle px-4 py-3"
          size="sm"
          productionDays={draft.edited.prazo_producao_dias ?? defaultProductionDays}
          surchargePercent={draft.edited.acrescimo_percent}
          disabled={editingBlocked}
          onProductionDaysChange={(days) => onUpdateField(draft.index, 'prazo_producao_dias', days)}
          onSurchargePercentChange={(percent) => {
            if (editingBlocked) return;
            onUpdateField(draft.index, 'acrescimo_percent', percent);
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
        />
      )}

      {/* ── Items table ── */}
      {!isDone && compactItems && (
        <ul
          aria-label={`Itens do pedido ${displayIdx + 1}`}
          className="divide-y divide-border-subtle border-y border-border-subtle"
        >
          {itemRows.map((row) => (
            <li
              key={row.key}
              className={cn('flex flex-col gap-2 px-4 py-3', row.conflict && 'bg-warning/10')}
            >
              {editing ? (
                <>
                  <div className="flex items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      {row.sku}
                      {row.name}
                    </div>
                    {row.remove}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <Text variant="label" aria-hidden="true">Qtd.</Text>
                      {row.qty}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Text variant="label" aria-hidden="true">Preço</Text>
                      {row.price}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <Text variant="title">{row.item.item_name || row.item.item_code || '—'}</Text>
                    <Text variant="meta">
                      {row.hasCode ? `${Number(row.item.qty)} × ${row.item.rate ? formatBRL(row.item.rate) : '—'}` : 'Sem produto'}
                      {row.item.item_code && <span className="font-mono"> · {row.item.item_code}</span>}
                    </Text>
                  </div>
                  {row.remove}
                </div>
              )}
            </li>
          ))}
          {itemRows.length === 0 && (
            <li className="px-4 py-3 text-center text-sm text-fg-muted">Nenhum item adicionado</li>
          )}
        </ul>
      )}
      {!isDone && !compactItems && (
        <Table
          density="dense"
          edges="inset"
          className="w-full max-w-full table-fixed"
          aria-label={`Itens do pedido ${displayIdx + 1}`}
        >
            <colgroup>
              <col className="w-24" />
              <col />
              <col className="w-16" />
              <col className="w-20" />
              <col className="w-12" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">SKU</TableHead>
                <TableHead scope="col">Produto</TableHead>
                <TableHead scope="col" className="text-center">Qtd</TableHead>
                <TableHead scope="col" className="text-center">Preço</TableHead>
                <TableHead scope="col" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemRows.map((row) => (
                <TableRow key={row.key} tone={row.conflict ? 'warning' : 'default'}>
                  <TableCell>{row.sku}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-center">{row.qty}</TableCell>
                  <TableCell className="text-center">{row.price}</TableCell>
                  <TableCell>{row.remove}</TableCell>
                </TableRow>
              ))}
              {displayItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-12 text-center text-fg-muted">
                    Nenhum item adicionado
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
      )}

      {isDone && (
        <div className="border-t border-border-subtle bg-raised/60 px-4 pb-3">
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
      <div className="flex flex-wrap items-center gap-2 rounded-b-control border-t border-border-subtle bg-raised p-3">
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
            <Button variant="ghost" onClick={toggleEditing} disabled={editingBlocked}>
              <Pencil size={14} />
              {editing ? 'Concluir' : 'Editar'}
            </Button>
            {editing && (
              <Button
                variant="ghost"
                onClick={() => onAddItem(draft.index)}
                disabled={editingBlocked}
              >
                <Plus size={14} />
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
                className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-control bg-surface px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
              >
                <FileText size={14} /> Abrir PDF
              </a>
            ) : (
              <span aria-disabled="true" className="inline-flex h-8 items-center gap-2 rounded-control bg-surface px-3 text-xs font-medium text-fg opacity-40">
                <FileText size={14} /> Abrir PDF
              </span>
            )}
            {waSendEnabled ? (
              <Button
                disabled={whatsappSendBlocked}
                title={deliveryError || (delivery ? 'Este orçamento já possui uma entrega pelo WhatsApp.' : undefined)}
                onClick={() => onSendWhatsApp?.(draft.index)}
              >
                <Phone size={14} /> {deliveryError ? 'Falha no envio' : deliveryPending ? 'Enviando…' : delivery ? 'Enviado' : 'Enviar WhatsApp'}
              </Button>
            ) : null}
          </>
        ) : reviewOnly ? (
          <>
            <Button variant="outline" onClick={onDiscard} disabled={actionBlocked}>Descartar resultado</Button>
            <Button onClick={onApply} disabled={actionBlocked || !canApply}>Aplicar ao orçamento ativo</Button>
          </>
        ) : (
          <>
            {!editing && (
              <Button
                variant="ghost"
                onClick={() => onReviewQuote(draft.index)}
                disabled={actionBlocked || !canCreate}
                title="Abre uma pré-visualização temporária sem salvar ou emitir."
                aria-describedby={actionBlockMessage ? actionStatusId : undefined}
              >
                <Eye size={14} />
                Revisar
              </Button>
            )}
            {!editing && (
              <Button
                onClick={() => onCreateQuote(draft.index)}
                disabled={actionBlocked || !canCreate}
                aria-describedby={actionBlockMessage ? actionStatusId : undefined}
              >
                {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {isProcessing ? 'Emitindo…' : 'Emitir orçamento'}
              </Button>
            )}
            {isProcessing && draft.result?.error && savedDraft.issueRecoveryRequired && onClearIssueRecovery && (
              <Button
                variant="outline"
                onClick={() => onClearIssueRecovery(draft.index)}
              >
                Confirmar ausência e liberar nova tentativa
              </Button>
            )}
            {isProcessing && draft.result?.error && !savedDraft.issueRecoveryRequired && onRecoverIssue && (
              <Button
                variant="outline"
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
