// Revisão e envio do card de novo orçamento (modo Conversa).

import { Fragment, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Eye,
  FileText,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Send,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { capitalize, fmtPhone, formatBRL, toApiDecimal } from '@/lib/formatting/formatters';
import { isValidLeadSource, LEAD_SOURCES } from '@/lib/clientMetadata';
import { isUnpricedProduct, searchProducts } from '@/lib/api/productCache';
import type { Product } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Heading } from '@/components/ui/heading';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Text } from '@/components/ui/text';
import InlineAlert from '@/components/shared/InlineAlert';
import WhatsAppSendPanel from '@/features/quotations/components/WhatsAppSendPanel';
import QuotationDeliveryStatus from '@/features/quotations/components/QuotationDeliveryStatus';
import ProductionTermsFields from '@/features/quotations/components/ProductionTermsFields';
import {
  ClientResolutionAnnouncement,
  ClientResolutionBadge,
  ClientResolutionChoice,
} from '@/features/quotations/components/ClientResolution';
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
import { DEFAULT_PRODUCTION_DAYS } from '@/lib/productionDeadline';
import { MOBILE_MEDIA_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';

export interface SplitResultCardProps {
  draft: Draft;
  /** Posição do pedido quando a conversa trouxe mais de um. */
  position?: { index: number; total: number };
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
  onReviewQuote: (draftIdx: number) => void;
  onRecoverIssue?: (draftIdx: number) => void;
  onClearIssueRecovery?: (draftIdx: number) => void;
  onPricingPendingChange?: (draftIdx: number, pending: boolean) => void;
  isSavingDraft?: boolean;
  onBackToOrder: () => void;
  onNewQuote: () => void;
  newQuoteDisabled?: boolean;
  /** Presente quando outro pedido da mesma conversa ainda não foi emitido. */
  onNextOrder?: () => void;
  issue?: QuotationIssueProjection;
  issueError?: string;
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

// compact: no celular o total fica no topo à direita, ao lado do cliente, com fonte menor.
function TotalBlock({ value, note, compact = false }: { value: string; note?: string; compact?: boolean }) {
  return (
    <div className={cn('flex shrink-0 flex-col items-end gap-1.5 text-right', !compact && 'max-sm:items-start max-sm:text-left')}>
      <Text as="p" variant="label">Total</Text>
      <p className={cn('font-bold leading-none tracking-tight tabular-nums text-fg', compact ? 'text-lead sm:text-stat' : 'text-stat')}>{value}</p>
      {note && <Text as="p" variant="caption">{note}</Text>}
    </div>
  );
}

function StepFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="flex flex-wrap items-center gap-2 px-5 pb-4 pt-5 md:px-6">
      {children}
    </footer>
  );
}

export default function SplitResultCard({
  draft,
  position,
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
  onReviewQuote,
  onRecoverIssue,
  onClearIssueRecovery,
  onPricingPendingChange,
  isSavingDraft = false,
  onBackToOrder,
  onNewQuote,
  newQuoteDisabled = false,
  onNextOrder,
  issue,
  issueError,
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
  const cardRef = useRef<HTMLDivElement>(null);
  const editingBlocked = Boolean(isProcessing || isSavingDraft || parentEditingBlocked);
  const isDone = Boolean(issue) || (draft.status === 'done' && draft.result?.success);
  // Sem nome ou origem válida o cadastro abre em edição: é o que falta para emitir.
  const [editingClient, setEditingClient] = useState(
    () => !draft.edited.nome?.trim() || !isValidLeadSource(draft.edited.origem)
  );
  // Itens chegam só para leitura; abrem em edição quando algum ainda não tem produto ou preço.
  const [editingItems, setEditingItems] = useState(
    () => (draft.edited.items || []).some((item) => !item.item_code || !(Number(item.rate) > 0))
  );

  useEffect(() => {
    if (isDone || draft.edited.template_key || !templates.some((template) => template.key === 'simples')) {
      return;
    }
    onUpdateField(draft.index, 'template_key', 'simples');
  }, [draft.edited.template_key, draft.index, isDone, onUpdateField, templates]);

  // ── Per-item product search (local state, like QuotationDetailPage) ──
  const [itemSearchTerms, setItemSearchTerms] = useState<Record<number, string>>({});
  const [itemResults, setItemResults] = useState<Record<number, Product[]>>({});
  const [itemSearching, setItemSearching] = useState<Record<number, boolean>>({});
  const [activeSearchIdx, setActiveSearchIdx] = useState<number | null>(null);
  // Campo do item que abriu a busca: a lista de produtos aparece embaixo dele.
  const [activeSearchField, setActiveSearchField] = useState<'sku' | 'name'>('sku');
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const qtyPricingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusNewItem = useRef(false);
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
  const schedulePricing = useCallback(() => {
    const pricingGeneration = beginPricing();
    qtyPricingTimer.current = setTimeout(async () => {
      qtyPricingTimer.current = null;
      try {
        await onRefetchPricing(draft.index);
      } finally {
        settlePricing(pricingGeneration);
      }
    }, 600);
  }, [beginPricing, draft.index, onRefetchPricing, settlePricing]);
  const actionBlocked = Boolean(editingBlocked || issueBlocked || pricingPending);

  useEffect(() => {
    onPricingPendingChange?.(draft.index, pricingPending);
    return () => onPricingPendingChange?.(draft.index, false);
  }, [draft.index, onPricingPendingChange, pricingPending]);

  useEffect(() => {
    if (!editingBlocked) return;
    setEditingClient(false);
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
  const runProductSearch = useCallback(
    (ii: number, value: string) => {
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
    []
  );

  const onItemSkuChange = useCallback(
    (ii: number, value: string) => {
      if (editingBlocked) return;
      setItemSearchTerms((prev) => ({ ...prev, [ii]: value }));
      onUpdateItem(draft.index, ii, 'item_code', value);
      runProductSearch(ii, value);
    },
    [draft.index, editingBlocked, onUpdateItem, runProductSearch]
  );

  // O nome também busca produto por SKU ou nome, sem apagar o SKU já escolhido.
  const onItemNameChange = useCallback(
    (ii: number, value: string) => {
      if (editingBlocked) return;
      onUpdateItem(draft.index, ii, 'item_name', value);
      runProductSearch(ii, value);
    },
    [draft.index, editingBlocked, onUpdateItem, runProductSearch]
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
      setItemSearchTerms({});
      setItemResults({});
      setItemSearching({});
      setActiveSearchIdx(null);
    },
    [draft.index, editingBlocked, onRemoveItem]
  );

  const handleAddItem = useCallback(() => {
    if (editingBlocked) return;
    focusNewItem.current = true;
    setEditingItems(true);
    onAddItem(draft.index);
  }, [draft.index, editingBlocked, onAddItem]);

  const savedDraft = draft as StoredAutoQuoteDraft;
  const saved = savedDraft.saved;
  const hasSavedSnapshot = Boolean(saved?.snapshot);
  const resultData = draft.result?.data;
  const snapshot = saved?.snapshot || (resultData?.snapshot as QuotationSavedSnapshot | undefined);
  const items = isDone
    ? snapshot?.items || []
    : draft.edited.items || [];

  useEffect(() => {
    if (!focusNewItem.current) return;
    focusNewItem.current = false;
    const inputs = cardRef.current?.querySelectorAll<HTMLInputElement>('[data-item-sku]');
    inputs?.[inputs.length - 1]?.focus();
  }, [items.length]);

  const calculatedTotal = items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const freight = Number(draft.edited.frete) || 0;
  const total = isDone ? snapshot?.total : calculatedTotal + freight;
  // Total sem o acréscimo: itens automáticos voltam ao preço de tabela.
  const baseTotal = draft.edited.items.reduce((sum, it) => {
    const rate = !it._rateManual && it._baseRate !== undefined ? it._baseRate : Number(it.rate) || 0;
    return sum + (Number(it.qty) || 0) * rate;
  }, freight);
  const totalDisplay = total === undefined ? '—' : formatBRL(total);
  const templateName = templates.find((template) => template.key === draft.edited.template_key)?.name || 'Modelo padrão';
  const conditionsSummary = [
    templateName,
    `${draft.edited.prazo_producao_dias ?? defaultProductionDays} dias`,
    draft.edited.frete ? `Frete ${formatBRL(freight)}` : 'Frete padrão',
    draft.edited.acrescimo_percent > 0 && `+${draft.edited.acrescimo_percent}%`,
  ].filter(Boolean).join(' · ');
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
  const actionStatusId = `quotation-action-status-${draft.index}`;
  const immutableIssue = Boolean(issue);
  const issueViewUrl = issue?.pdfUrl || viewUrl;
  const displayName = capitalize((resultData?.cliente as string | undefined) || draft.edited.nome);
  const whatsappSendBlocked = deliveryPending || Boolean(delivery) || Boolean(deliveryError);
  const phone = draft.edited.telefone ? fmtPhone(draft.edited.telefone) || draft.edited.telefone : '';
  const contacts = [draft.edited.empresa, draft.edited.email, phone].filter(Boolean) as string[];

  // Conteúdo de cada item, compartilhado pela tabela (desktop) e pela lista (celular).
  const itemRows = items.map((item, ii) => {
    if (!editingItems) {
      const cell = 'flex h-8 min-w-0 items-center px-3 text-sm text-fg';
      return {
        key: ii,
        sku: <span className={cn(cell, 'truncate')}>{item.item_code || '—'}</span>,
        name: <span className={cn(cell, 'truncate')}>{item.item_name || '—'}</span>,
        qty: <span className={cn(cell, 'justify-end tabular-nums')}>{item.qty}</span>,
        price: <span className={cn(cell, 'justify-end tabular-nums')}>{item.rate ? formatBRL(Number(item.rate)) : '—'}</span>,
        remove: null,
      };
    }
    const results = itemResults[ii] || [];
    const searching = itemSearching[ii] || false;
    const showDropdown = activeSearchIdx === ii && results.length > 0;
    const dropdown = showDropdown && (
    <div className="absolute left-0 top-9 z-floating max-h-48 w-80 max-w-screen overflow-y-auto rounded-control border border-line bg-surface shadow-lg">
      {results.map((p) => (
        // eslint-disable-next-line no-restricted-syntax -- opção de autocomplete
        <button
          key={p.sku || p.item_code}
          type="button"
          disabled={editingBlocked || isUnpricedProduct(p)}
          title={isUnpricedProduct(p) ? 'Preço indisponível para este produto.' : undefined}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors focus-inset',
            isUnpricedProduct(p) ? 'cursor-not-allowed opacity-50' : 'hover:bg-surface-hover'
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void handleSelectProduct(ii, p)}
        >
          <span className="shrink-0 font-mono text-3xs text-fg-muted">{p.sku || p.item_code}</span>
          <span className="truncate">{String(p.nome || p.item_name || '—')}</span>
          {isUnpricedProduct(p) && (
            <span className="ml-auto shrink-0 text-3xs text-destructive">Preço indisponível</span>
          )}
        </button>
      ))}
    </div>
    );
    const searchValue =
      itemSearchTerms[ii] !== undefined ? itemSearchTerms[ii] : item.item_code || '';
    // Na tabela a célula parece texto até receber hover ou foco; na lista do celular fica com moldura.
    const variant = compactItems ? 'default' : 'ghost';

    return {
      key: ii,
      sku: (
        <div className="relative" data-item-search-cell>
          <Input
            aria-label={`Produto do item ${ii + 1}`}
            data-item-sku
            variant={variant}
            className="pr-6"
            placeholder="Buscar SKU ou nome…"
            value={searchValue}
            onChange={(e) => onItemSkuChange(ii, e.target.value)}
            onFocus={() => {
              setActiveSearchIdx(ii);
              setActiveSearchField('sku');
            }}
            disabled={editingBlocked}
          />
          {searching && activeSearchField === 'sku' && (
            <Loader2 size={12} className="absolute right-2 top-2.5 animate-spin text-fg-muted" />
          )}
          {activeSearchField === 'sku' && dropdown}
        </div>
      ),
      name: (
        <div className="relative" data-item-search-cell>
          <Input
            aria-label={`Nome exibido no orçamento ${item.item_code || ii + 1}`}
            variant={variant}
            placeholder="Nome do produto"
            value={item.item_name || ''}
            onChange={(event) => onItemNameChange(ii, event.target.value)}
            onFocus={() => {
              setActiveSearchIdx(ii);
              setActiveSearchField('name');
            }}
            disabled={editingBlocked}
          />
          {searching && activeSearchField === 'name' && (
            <Loader2 size={12} className="absolute right-2 top-2.5 animate-spin text-fg-muted" />
          )}
          {activeSearchField === 'name' && dropdown}
        </div>
      ),
      qty: (
        <Input
          type="number"
          aria-label={`Quantidade do item ${item.item_code || ii + 1}`}
          value={item.qty}
          onChange={(e) => {
            if (editingBlocked) return;
            onUpdateItem(draft.index, ii, 'qty', Math.max(1, Number(e.target.value)));
            schedulePricing();
          }}
          disabled={editingBlocked}
          hideSpinButtons
          variant={variant}
          className="text-right"
        />
      ),
      price: (
        <MoneyInput
          aria-label={`Preço unitário do item ${item.item_code || ii + 1}`}
          value={item.rate || null}
          onValueChange={(value) => onUpdateItem(draft.index, ii, 'rate', value ?? 0)}
          disabled={editingBlocked}
          placeholder="—"
          variant={variant}
          className="text-right"
        />
      ),
      remove: (
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
      ),
    };
  });

  if (isDone) {
    const businessNumber = issue?.businessNumber || (resultData?.businessNumber as string | undefined);
    const identity = [
      businessNumber && `Nº ${businessNumber}`,
      displayName,
      draft.edited.email,
      phone,
    ].filter(Boolean).join(' · ');
    return (
      <div ref={cardRef}>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-3.5 md:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-4 max-sm:basis-full">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-success/15 text-success">
              <Check size={24} aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <Heading level="subject">Orçamento emitido</Heading>
              <Text as="p" variant="meta">{identity}</Text>
            </div>
          </div>
          <TotalBlock value={totalDisplay} note={snapshot ? `Frete: ${formatBRL(snapshot.frete)}` : undefined} />
        </div>

        <div className="flex flex-col gap-3 px-5 py-3.5 md:px-6">
          <WhatsAppSendPanel
            flows={waFlows}
            selectedFlowId={waSelectedFlowId}
            onSelectFlow={(flowId) => onSelectWhatsAppFlow?.(draft.index, flowId)}
            disabled={waFlowSelectionDisabled}
          />
          <QuotationDeliveryStatus
            delivery={delivery}
            pending={deliveryPending}
            hideStatusLabel
            hideUpdatedAt
            onResolve={onResolveDelivery}
          />
        </div>

        <StepFooter>
          {onNextOrder && (
            <Button type="button" variant="ghost" onClick={onNextOrder}>
              Próximo pedido <ArrowRight size={14} />
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onNewQuote} disabled={newQuoteDisabled}>
            <Plus size={14} /> Novo orçamento
          </Button>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {issueViewUrl ? (
              <Button variant="outline" asChild>
                <a href={issueViewUrl} target="_blank" rel="noopener noreferrer">
                  <FileText size={14} /> Abrir PDF
                </a>
              </Button>
            ) : (
              <Button type="button" variant="outline" disabled>
                <FileText size={14} /> Abrir PDF
              </Button>
            )}
            {waSendEnabled && (
              <Button
                type="button"
                disabled={whatsappSendBlocked}
                title={deliveryError || (delivery ? 'Este orçamento já possui uma entrega pelo WhatsApp.' : undefined)}
                onClick={() => onSendWhatsApp?.(draft.index)}
              >
                <MessageCircle size={14} /> {deliveryError ? 'Falha no envio' : deliveryPending ? 'Enviando…' : delivery ? 'Enviado' : 'Enviar WhatsApp'}
              </Button>
            )}
          </div>
        </StepFooter>
      </div>
    );
  }

  const metaItems = [
    draft.edited.origem,
    clientResolution && !hasSavedSnapshot && clientResolution.state !== 'idle' && clientResolution.state !== 'choice' && (
      <ClientResolutionBadge
        view={clientResolution}
        draftIdx={draft.index}
        disabled={editingBlocked}
        onConfirmNewClient={onConfirmNewClient}
        onRetryClientResolution={onRetryClientResolution}
        onClearClientSelection={onClearClientSelection}
      />
    ),
    hasSavedSnapshot && 'Rascunho salvo',
    draft.edited.prazo_pedido && <span className="text-warning">Prazo pedido: {draft.edited.prazo_pedido}</span>,
  ].filter(Boolean);

  return (
    <div
      ref={cardRef}
      aria-busy={isProcessing || issueBlocked || parentEditingBlocked || pricingPending}
      className={cn(isProcessing && !immutableIssue && 'opacity-60')}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-3.5 md:px-6">
        <div className={cn('flex min-w-0 flex-1 flex-col gap-1.5', editingClient && 'max-sm:basis-full')}>
          {editingClient ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
              <Field label="Nome" className="sm:col-span-3">
                <Input
                  value={draft.edited.nome || ''}
                  onChange={(e) => onUpdateField(draft.index, 'nome', e.target.value)}
                  disabled={editingBlocked}
                />
              </Field>
              <Field label="Empresa" className="sm:col-span-3">
                <Input
                  value={draft.edited.empresa || ''}
                  onChange={(e) => onUpdateField(draft.index, 'empresa', e.target.value)}
                  disabled={editingBlocked}
                />
              </Field>
              <Field label="E-mail" className="sm:col-span-2">
                <Input
                  type="email"
                  value={draft.edited.email || ''}
                  onChange={(e) => onUpdateField(draft.index, 'email', e.target.value)}
                  disabled={editingBlocked}
                />
              </Field>
              <Field label="Telefone" className="sm:col-span-2">
                <Input
                  inputMode="tel"
                  value={draft.edited.telefone || ''}
                  onChange={(e) => onUpdateField(draft.index, 'telefone', e.target.value)}
                  disabled={editingBlocked}
                />
              </Field>
              <Field label="Origem" className="sm:col-span-2">
                <Select
                  value={draft.edited.origem || ''}
                  onChange={(e) => onUpdateField(draft.index, 'origem', e.target.value)}
                  disabled={editingBlocked}
                  containerClassName="w-full"
                  className="w-full"
                >
                  <option value="">Selecione a origem…</option>
                  {LEAD_SOURCES.map((source) => (
                    <option key={source.value} value={source.value}>
                      {source.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex sm:col-span-6">
                <Button type="button" variant="outline" onClick={() => setEditingClient(false)} disabled={editingBlocked}>
                  <Check size={14} /> Concluir
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-1">
                <Heading level="subject" className="min-w-0 truncate">
                  {displayName || 'Cliente'}
                </Heading>
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="icon"
                  aria-label="Editar cliente"
                  onClick={() => setEditingClient(true)}
                  disabled={editingBlocked}
                >
                  <Pencil size={14} />
                </Button>
              </div>
              {clientResolution && !hasSavedSnapshot && <ClientResolutionAnnouncement view={clientResolution} />}
              {metaItems.length > 0 && (
                <Text as="div" variant="meta" className="flex flex-wrap items-center">
                  {metaItems.map((item, index) => (
                    <Fragment key={index}>
                      {index > 0 && <span aria-hidden="true" className="mx-2">·</span>}
                      {item}
                    </Fragment>
                  ))}
                </Text>
              )}
              {contacts.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {contacts.map((contact) => <Text key={contact} variant="meta">{contact}</Text>)}
                </div>
              )}
              {position && position.total > 1 && (
                <Text as="p" variant="caption">Pedido {position.index + 1} de {position.total}</Text>
              )}
            </>
          )}
        </div>
        <TotalBlock
          value={totalDisplay}
          compact={!editingClient}
          note={draft.edited.acrescimo_percent > 0 ? `Base: ${formatBRL(baseTotal)}` : undefined}
        />
      </div>

      {clientResolution && !hasSavedSnapshot && (
        <ClientResolutionChoice
          view={clientResolution}
          draftIdx={draft.index}
          disabled={editingBlocked}
          identity={{ email: draft.edited.email, telefone: draft.edited.telefone }}
          onSelectClient={onSelectClient}
          onConfirmNewClient={onConfirmNewClient}
        />
      )}

      {opportunitySelector && (
        <div className="grid grid-cols-1 gap-3 px-5 py-3.5 sm:grid-cols-2 md:px-6">{opportunitySelector}</div>
      )}

      {/* Condições ficam recolhidas; o resumo mostra os valores sem abrir. */}
      <details className="group px-5 py-3.5 md:px-6" open={Boolean(templateError)}>
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-control focus-inset [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} className="shrink-0 text-fg-muted transition-transform group-open:rotate-90" aria-hidden="true" />
          <span className="text-sm font-medium text-fg">Condições</span>
          <span className="min-w-0 truncate">
            <Text as="span" variant="meta">{conditionsSummary}</Text>
          </span>
        </summary>
      <div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-2 md:grid-cols-4">
        <Field
          label="Modelo de orçamento"
          error={templateError}
        >
          {templateError ? (
            <Button type="button" variant="outline" onClick={onRetryTemplates}>Tentar novamente</Button>
          ) : (
            <Select
              value={draft.edited.template_key || ''}
              onChange={(event) => onUpdateField(draft.index, 'template_key', event.target.value)}
              disabled={editingBlocked || templateLoading || templates.length === 0}
              className="w-full"
              containerClassName="w-full"
            >
              {!draft.edited.template_key && <option value="">Modelo padrão</option>}
              {templates.map((template) => (
                <option key={template.key} value={template.key}>{template.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <ProductionTermsFields
          className="sm:col-span-2 md:col-span-3"
          freight={
            <Field label="Frete (R$)">
              <MoneyInput
                value={draft.edited.frete ? freight : null}
                onValueChange={(value) => onUpdateField(draft.index, 'frete', value === null ? '' : toApiDecimal(value))}
                disabled={editingBlocked}
                placeholder="Padrão"
              />
            </Field>
          }
          productionDays={draft.edited.prazo_producao_dias ?? defaultProductionDays}
          surchargePercent={draft.edited.acrescimo_percent}
          disabled={editingBlocked}
          onProductionDaysChange={(days) => onUpdateField(draft.index, 'prazo_producao_dias', days)}
          onSurchargePercentChange={(percent) => {
            if (editingBlocked) return;
            onUpdateField(draft.index, 'acrescimo_percent', percent);
            schedulePricing();
          }}
        />
      </div>
      </details>

      {compactItems && !editingItems ? (
        // Leitura no celular: uma linha por item com o subtotal; "Editar" abre os campos.
        <ul aria-label="Itens do pedido" className="divide-y divide-line">
          {items.map((item, ii) => {
            const qty = Number(item.qty) || 0;
            const rate = Number(item.rate) || 0;
            return (
              <li key={ii} className="flex min-h-14 items-center gap-3 px-5 py-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Text as="p" variant="meta">{item.item_code || '—'}</Text>
                  <p className="line-clamp-2 text-sm font-semibold text-fg">
                    {item.item_name || item.item_code || 'Item sem produto'}
                  </p>
                  <Text as="p" variant="meta">
                    <span className="tabular-nums">{qty} {qty === 1 ? 'peça' : 'peças'} - {rate ? `${formatBRL(rate)} a un.` : '—'}</span>
                  </Text>
                </div>
                <span className="whitespace-nowrap text-lead font-bold tabular-nums text-fg">
                  {rate ? formatBRL(qty * rate) : '—'}
                </span>
              </li>
            );
          })}
          {items.length === 0 && (
            <li className="px-5 py-4 text-center text-sm text-fg-muted">Nenhum item adicionado</li>
          )}
        </ul>
      ) : compactItems ? (
        <ul aria-label="Itens do pedido" className="divide-y divide-line">
          {itemRows.map((row) => (
            <li key={row.key} className="flex flex-col gap-2 px-5 py-3">
              <div className="flex items-end gap-2">
                <Field label="Produto" className="flex-1">{row.name}</Field>
                {row.remove}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Field label="SKU" className="col-span-2">{row.sku}</Field>
                <Field label="Qtd">{row.qty}</Field>
                <Field label="Preço">{row.price}</Field>
              </div>
            </li>
          ))}
          {itemRows.length === 0 && (
            <li className="px-5 py-4 text-center text-sm text-fg-muted">Nenhum item adicionado</li>
          )}
        </ul>
      ) : (
        <div className="px-3 md:px-4">
          <Table
            density="dense"
            className="table-fixed text-sm"
            containerClassName="overflow-visible"
            aria-label="Itens do pedido"
          >
            <colgroup>
              <col className="w-36" />
              <col />
              <col className="w-20" />
              <col className="w-36" />
              <col className="w-10" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">SKU</TableHead>
                <TableHead scope="col">Produto</TableHead>
                <TableHead scope="col" className="text-right">Qtd</TableHead>
                <TableHead scope="col" className="text-right">Preço</TableHead>
                <TableHead scope="col"><span className="sr-only">Excluir</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemRows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>{row.sku}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.qty}</TableCell>
                  <TableCell>{row.price}</TableCell>
                  <TableCell>{row.remove}</TableCell>
                </TableRow>
              ))}
              {itemRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-12 text-center text-fg-muted">
                    Nenhum item adicionado
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-col items-start gap-3 px-5 py-3.5 text-sm md:px-6">
        <Button type="button" variant="link" size="inline" onClick={handleAddItem} disabled={editingBlocked}>
          <Plus size={14} /> Adicionar item
        </Button>
        {actionBlockMessage && (
          <div id={actionStatusId} className="flex items-center gap-1.5">
            <AlertTriangle size={14} className="shrink-0 text-warning" aria-hidden="true" />
            <Text variant="meta">{actionBlockMessage}</Text>
          </div>
        )}
        {issueError && <InlineAlert className="w-full">{issueError}</InlineAlert>}
      </div>

      <StepFooter>
        <Button type="button" variant="ghost-muted" onClick={onBackToOrder} disabled={editingBlocked}>
          Voltar
        </Button>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {isProcessing && draft.result?.error && savedDraft.issueRecoveryRequired && onClearIssueRecovery && (
            <Button type="button" variant="outline" onClick={() => onClearIssueRecovery(draft.index)}>
              Confirmar ausência e liberar nova tentativa
            </Button>
          )}
          {isProcessing && draft.result?.error && !savedDraft.issueRecoveryRequired && onRecoverIssue && (
            <Button type="button" variant="outline" onClick={() => onRecoverIssue(draft.index)}>
              Consultar novamente
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditingItems((current) => !current)}
            disabled={editingBlocked}
            aria-pressed={editingItems}
            size={compactItems ? 'icon' : undefined}
            aria-label={compactItems ? (editingItems ? 'Concluir edição' : 'Editar') : undefined}
            title={compactItems ? (editingItems ? 'Concluir edição' : 'Editar') : undefined}
          >
            {editingItems ? <Check size={14} /> : <Pencil size={14} />}
            {!compactItems && (editingItems ? 'Concluir edição' : 'Editar')}
          </Button>
          {/* No celular a pré-visualização vira só ícone para caber no rodapé. */}
          <Button
            type="button"
            variant="outline"
            size={compactItems ? 'icon' : undefined}
            onClick={() => onReviewQuote(draft.index)}
            disabled={actionBlocked || !canCreate}
            title="Abre uma pré-visualização temporária sem salvar ou emitir."
            aria-label={compactItems ? 'Pré-visualizar' : undefined}
            aria-describedby={actionBlockMessage ? actionStatusId : undefined}
          >
            <Eye size={14} />
            {!compactItems && 'Pré-visualizar'}
          </Button>
          <Button
            type="button"
            onClick={() => onCreateQuote(draft.index)}
            disabled={actionBlocked || !canCreate}
            aria-describedby={actionBlockMessage ? actionStatusId : undefined}
          >
            {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {isProcessing ? 'Emitindo…' : 'Emitir orçamento'}
          </Button>
        </div>
      </StepFooter>
    </div>
  );
}
