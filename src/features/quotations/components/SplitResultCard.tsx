// Revisão e envio do card de novo orçamento (modo Conversa).

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
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
import { capitalize, fmtPhone, formatBRL } from '@/lib/formatting/formatters';
import { isValidLeadSource, LEAD_SOURCES } from '@/lib/clientMetadata';
import { isUnpricedProduct, searchProducts } from '@/lib/api/productCache';
import type { Product } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
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
  onRecoverIssue?: (draftIdx: number) => void;
  onClearIssueRecovery?: (draftIdx: number) => void;
  onPricingPendingChange?: (draftIdx: number, pending: boolean) => void;
  isSavingDraft?: boolean;
  onReviewQuote: (draftIdx: number) => void;
  onBackToOrder: () => void;
  onEditManually: () => void;
  manualDisabled?: boolean;
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

function TotalBlock({ value, note }: { value: string; note?: string }) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5 text-right max-sm:items-start max-sm:text-left">
      <Text as="p" variant="label">Total</Text>
      <p className="text-title font-bold leading-none tabular-nums text-fg">{value}</p>
      {note && <Text as="p" variant="caption">{note}</Text>}
    </div>
  );
}

function StepFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="flex flex-wrap items-center gap-2 rounded-b-card border-t border-line bg-surface-subtle px-5 py-3 md:px-6">
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
  onRecoverIssue,
  onClearIssueRecovery,
  onPricingPendingChange,
  isSavingDraft = false,
  onReviewQuote,
  onBackToOrder,
  onEditManually,
  manualDisabled = false,
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
  const actionStatusId = `quotation-action-status-${draft.index}`;
  const immutableIssue = Boolean(issue);
  const issueViewUrl = issue?.pdfUrl || viewUrl;
  const displayName = capitalize((resultData?.cliente as string | undefined) || draft.edited.nome);
  const whatsappSendBlocked = deliveryPending || Boolean(delivery) || Boolean(deliveryError);
  const phone = draft.edited.telefone ? fmtPhone(draft.edited.telefone) || draft.edited.telefone : '';
  const contacts = [draft.edited.empresa, draft.edited.email, phone].filter(Boolean) as string[];

  // Conteúdo de cada item, compartilhado pela tabela (desktop) e pela lista (celular).
  const itemRows = items.map((item, ii) => {
    const results = itemResults[ii] || [];
    const searching = itemSearching[ii] || false;
    const showDropdown = activeSearchIdx === ii && results.length > 0;
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
            onFocus={() => setActiveSearchIdx(ii)}
            disabled={editingBlocked}
          />
          {searching && (
            <Loader2 size={12} className="absolute right-2 top-2.5 animate-spin text-fg-muted" />
          )}
          {showDropdown && (
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
          )}
        </div>
      ),
      name: (
        <Input
          aria-label={`Nome exibido no orçamento ${item.item_code || ii + 1}`}
          variant={variant}
          placeholder="Nome do produto"
          value={item.item_name || ''}
          onChange={(event) => onUpdateItem(draft.index, ii, 'item_name', event.target.value)}
          disabled={editingBlocked}
        />
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
    const itemCount = items.length;
    const unitCount = items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
    const productionDays = draft.edited.prazo_producao_dias ?? defaultProductionDays;
    const templateName = templates.find((template) => template.key === draft.edited.template_key)?.name || 'Modelo padrão';
    const businessNumber = issue?.businessNumber || (resultData?.businessNumber as string | undefined);
    const identity = [
      businessNumber && `Nº ${businessNumber}`,
      displayName,
      draft.edited.email,
      phone,
    ].filter(Boolean).join(' · ');
    return (
      <div ref={cardRef}>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-5 md:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-4 max-sm:basis-full">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-success/15 text-success">
              <Check size={24} aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <Heading level="card" as="h2">Orçamento emitido</Heading>
              <Text as="p" variant="meta">{identity}</Text>
            </div>
          </div>
          <TotalBlock value={totalDisplay} note={snapshot ? `Frete: ${formatBRL(snapshot.frete)}` : undefined} />
        </div>

        <dl className="grid grid-cols-2 gap-4 border-b border-line px-5 py-4 sm:grid-cols-4 md:px-6">
          <div className="flex min-w-0 flex-col gap-1">
            <Text as="dt" variant="label">Itens</Text>
            <Text as="dd" variant="value">
              {itemCount} {itemCount === 1 ? 'produto' : 'produtos'} · {unitCount} un.
            </Text>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Text as="dt" variant="label">Prazo</Text>
            <Text as="dd" variant="value">{productionDays} {productionDays === 1 ? 'dia útil' : 'dias úteis'}</Text>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Text as="dt" variant="label">Origem</Text>
            <Text as="dd" variant="value" truncate>{draft.edited.origem || '—'}</Text>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Text as="dt" variant="label">Modelo</Text>
            <Text as="dd" variant="value" truncate>{templateName}</Text>
          </div>
        </dl>

        <div className="flex flex-col gap-3 px-5 py-5 md:px-6">
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

  return (
    <div
      ref={cardRef}
      aria-busy={isProcessing || issueBlocked || parentEditingBlocked || pricingPending}
      className={cn(isProcessing && !immutableIssue && 'opacity-60')}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-5 md:px-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 max-sm:basis-full">
          {editingClient ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nome">
                <Input
                  value={draft.edited.nome || ''}
                  onChange={(e) => onUpdateField(draft.index, 'nome', e.target.value)}
                  disabled={editingBlocked}
                />
              </Field>
              <Field label="Empresa">
                <Input
                  value={draft.edited.empresa || ''}
                  onChange={(e) => onUpdateField(draft.index, 'empresa', e.target.value)}
                  disabled={editingBlocked}
                />
              </Field>
              <Field label="E-mail">
                <Input
                  type="email"
                  value={draft.edited.email || ''}
                  onChange={(e) => onUpdateField(draft.index, 'email', e.target.value)}
                  disabled={editingBlocked}
                />
              </Field>
              <Field label="Telefone">
                <Input
                  inputMode="tel"
                  value={draft.edited.telefone || ''}
                  onChange={(e) => onUpdateField(draft.index, 'telefone', e.target.value)}
                  disabled={editingBlocked}
                />
              </Field>
              <Field label="Origem">
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
              <div className="flex items-end">
                <Button type="button" variant="outline" onClick={() => setEditingClient(false)} disabled={editingBlocked}>
                  <Check size={14} /> Concluir
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Heading level="card" as="h2" className="min-w-0 truncate">
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
                {draft.edited.origem && <StatusBadge status={draft.edited.origem} tone="tone-primary-soft" />}
                {clientResolution && !hasSavedSnapshot && (
                  <ClientResolutionBadge
                    view={clientResolution}
                    draftIdx={draft.index}
                    disabled={editingBlocked}
                    onConfirmNewClient={onConfirmNewClient}
                    onRetryClientResolution={onRetryClientResolution}
                    onClearClientSelection={onClearClientSelection}
                  />
                )}
                {hasSavedSnapshot && <StatusBadge status="saved" label="Rascunho salvo" tone="tone-neutral-soft" />}
                {draft.edited.prazo_pedido && (
                  <StatusBadge status="deadline" label={`Prazo pedido: ${draft.edited.prazo_pedido}`} tone="tone-warning-soft" />
                )}
              </div>
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

      <div className="grid grid-cols-1 gap-3 border-b border-line px-5 py-4 sm:grid-cols-2 md:grid-cols-4 md:px-6">
        {opportunitySelector}
        <Field
          label="Modelo de orçamento"
          error={templateError}
          className={opportunitySelector ? undefined : 'md:col-span-2'}
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
          className="sm:col-span-2"
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

      {compactItems ? (
        <ul aria-label="Itens do pedido" className="divide-y divide-line border-b border-line">
          {itemRows.map((row) => (
            <li key={row.key} className="flex flex-col gap-2 px-5 py-3">
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {row.name}
                  {row.sku}
                </div>
                {row.remove}
              </div>
              <div className="grid grid-cols-2 gap-2">
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

      <div className="flex flex-col items-start gap-3 px-5 py-4 md:px-6">
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
        <Button type="button" variant="ghost" onClick={onBackToOrder} disabled={editingBlocked}>
          <ArrowLeft size={14} /> Voltar ao pedido
        </Button>
        <Button type="button" variant="ghost-muted" onClick={onEditManually} disabled={manualDisabled}>
          Editar no manual
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
            onClick={() => onReviewQuote(draft.index)}
            disabled={actionBlocked || !canCreate}
            title="Abre uma pré-visualização temporária sem salvar ou emitir."
            aria-describedby={actionBlockMessage ? actionStatusId : undefined}
          >
            <Eye size={14} /> Pré-visualizar
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
