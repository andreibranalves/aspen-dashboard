// src/components/SplitResultCard.tsx
// Compact result card for the split-panel auto page.

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Pencil,
  X,
  Plus,
  Loader2,
  AlertTriangle,
  Send,
  FileText,
  Check,
  Phone,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBRL, capitalize } from '@/lib/formatting/formatters';
import { DEFAULT_LEAD_SOURCE, LEAD_SOURCES } from '@/lib/clientMetadata';
import { isUnpricedProduct, searchProducts } from '@/lib/api/productCache';
import type { Product } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import WhatsAppSendPanel from '@/features/quotations/components/WhatsAppSendPanel';
import QuotationDeliveryStatus from '@/features/quotations/components/QuotationDeliveryStatus';
import type { Draft, DraftEdited, DraftItem, QuotationIssueProjection, StoredAutoQuoteDraft } from '@/types/domain';
import type { CommunicationFlow } from '@/lib/api/communicationApi';
import type { DeliveryResolution, DeliveryView } from '@/lib/api/quotationDeliveryApi';
import type { QuotationTemplateMetadata } from '@/lib/api/quotationTemplatesApi';

export interface SplitResultCardProps {
  draft: Draft;
  displayIdx: number;
  totalDrafts: number;
  isProcessing?: boolean;
  onUpdateField: (draftIdx: number, field: keyof DraftEdited, value: unknown) => void;
  onUpdateItem: (draftIdx: number, itemIdx: number, field: keyof DraftItem, value: unknown) => void;
  onRemoveItem: (draftIdx: number, itemIdx: number) => void;
  onAddItem: (draftIdx: number) => void;
  selectProduct: (draftIdx: number, itemIdx: number, product: Product) => void;
  onRefetchPricing: (draftIdx: number) => Promise<Draft | undefined>;
  onCreateQuote: (draftIdx: number) => void;
  onSaveDraft?: (draftIdx: number) => void;
  isSavingDraft?: boolean;
  onPreviewQuote: (draftIdx: number) => void;
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
  templates?: QuotationTemplateMetadata[];
  templateLoading?: boolean;
  templateError?: string | null;
  onRetryTemplates?: () => void;
  onSelectWhatsAppFlow?: (draftIdx: number, flowId: string) => void;
  onSendWhatsApp?: (draftIdx: number) => void;
  onResolveDelivery?: (decision: DeliveryResolution, note: string) => void | Promise<void>;
}

export default function SplitResultCard({
  draft,
  displayIdx,
  totalDrafts,
  isProcessing,
  onUpdateField,
  onUpdateItem,
  onRemoveItem,
  onAddItem,
  selectProduct,
  onRefetchPricing,
  onCreateQuote,
  onSaveDraft,
  isSavingDraft = false,
  onPreviewQuote,
  issue,
  issueError,
  pricingConflictItems = [],
  viewUrl,
  delivery = null,
  deliveryPending = false,
  deliveryError,
  waSendEnabled = true,
  waFlows = [],
  waSelectedFlowId = '',
  templates = [],
  templateLoading = false,
  templateError = null,
  onRetryTemplates,
  onSelectWhatsAppFlow,
  onSendWhatsApp,
  onResolveDelivery,
}: SplitResultCardProps) {
  const [editing, setEditing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

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
    [draft.index, onUpdateItem]
  );

  // Select product from dropdown
  const handleSelectProduct = useCallback(
    (ii: number, product: Product) => {
      if (!product?.sku) return;
      if (isUnpricedProduct(product)) return;
      selectProduct(draft.index, ii, product);
      setItemSearchTerms((prev) => ({
        ...prev,
        [ii]: product.sku,
      }));
      setItemResults((prev) => ({ ...prev, [ii]: [] }));
      setActiveSearchIdx(null);
    },
    [draft.index, selectProduct]
  );

  // Remove item with local state cleanup
  const handleRemoveItem = useCallback(
    (ii: number) => {
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
    [draft.index, onRemoveItem, activeSearchIdx]
  );

  const savedDraft = draft as StoredAutoQuoteDraft;
  const saved = savedDraft.saved;
  const isDone = Boolean(issue) || (draft.status === 'done' && draft.result?.success);
  const resultData = draft.result?.data;
  const items = isDone
    ? (resultData?.items as DraftItem[] | undefined) || draft.edited.items || []
    : draft.edited.items || [];
  const total = items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const totalUrgente = total;
  const validItems = items.filter((it) => it.item_code && it.qty > 0).length;
  const canCreate = validItems > 0 && Boolean(draft.edited.nome?.trim());
  const displayItems = editing ? items : items.filter((it) => it.item_code);
  const immutableIssue = Boolean(issue);
  const issueViewUrl = issue?.pdfUrl || viewUrl;
  const displayName = (resultData?.cliente as string | undefined) || draft.edited.nome;
  const deliveryBlocksSend = Boolean(delivery);
  const failedDelivery = delivery?.state === 'failed';

  function toggleEditing() {
    if (!editing) {
      if (immutableIssue) return;
      // Pre-fill search terms with existing item codes
      const terms: Record<number, string> = {};
      items.forEach((item, ii) => {
        if (item.item_code) terms[ii] = item.item_code;
      });
      setItemSearchTerms(terms);
      if (!draft.edited.origem) {
        onUpdateField(draft.index, 'origem', DEFAULT_LEAD_SOURCE);
      }
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
      aria-busy={isProcessing}
      className={cn(
        'rounded-lg border border-line bg-surface',
        isProcessing && !immutableIssue && 'opacity-60 pointer-events-none'
      )}
    >
      {/* ── Header ── */}
      <div
        className={cn(
          'flex items-start justify-between gap-3 p-4 bg-surface/50',
          !isDone && 'border-b border-line'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-fg-muted">
              Pedido {displayIdx + 1} de {totalDrafts}
            </span>

            {draft.edited.urgente && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
                <AlertTriangle size={10} /> Urgente
              </span>
            )}
            {isDone && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                <Check size={10} /> Emitido
              </span>
            )}
            {!isDone && saved && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                <Check size={10} /> Rascunho salvo
              </span>
            )}
          </div>
          {editing && !isDone ? (
            <div className="mt-2 space-y-2">
              <label className="block space-y-1">
                <span className="text-[10px] font-medium text-fg-muted">Nome</span>
                <Input
                  aria-label="Nome"
                  value={draft.edited.nome || ''}
                  onChange={(e) => onUpdateField(draft.index, 'nome', e.target.value)}
                  placeholder="Nome"
                  className="h-7 text-xs"
                />
              </label>
              <div className="grid grid-cols-[4fr_3fr_3fr] gap-2">
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium text-fg-muted">E-mail</span>
                  <Input
                    aria-label="E-mail"
                    value={draft.edited.email || ''}
                    onChange={(e) => onUpdateField(draft.index, 'email', e.target.value)}
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
                    placeholder="Telefone"
                    className="h-7 text-xs"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium text-fg-muted">Origem</span>
                  <select
                    aria-label="Origem"
                    value={draft.edited.origem || DEFAULT_LEAD_SOURCE}
                    onChange={(e) => onUpdateField(draft.index, 'origem', e.target.value)}
                    className="h-7 w-full rounded-sm border border-input bg-page px-2 text-xs text-fg shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                  >
                    {LEAD_SOURCES.map((source) => (
                      <option key={source.value} value={source.value}>
                        {source.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : (
            <>
              <h3 className="mt-1 text-sm font-semibold text-fg truncate">
                {capitalize(displayName) || 'Cliente'}
              </h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-fg-muted">
                {draft.edited.email && <span>{draft.edited.email}</span>}
                {draft.edited.telefone && <span>{draft.edited.telefone}</span>}
                {draft.edited.origem && (
                  <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px]">
                    {draft.edited.origem}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] font-medium text-fg-muted uppercase">Total</p>
          <p className="text-lg font-bold text-fg">{formatBRL(totalUrgente)}</p>
          {draft.edited.urgente && (
            <p className="text-[10px] text-fg-muted">Base: {formatBRL(total)}</p>
          )}
        </div>
      </div>

      {/* ── Stage 2: extracted values remain editable until creation. ── */}
      {!isDone && (
        <div className="border-b border-line bg-primary/5 px-4 py-3">
          <p className="text-xs leading-5 text-fg-muted">
            Confirme cliente, itens, quantidades e preços. Nada será criado enquanto você não gerar o orçamento.
          </p>
        </div>
      )}

      {/* ── Template selector ── */}
      {!isDone && (
        <div className="border-b border-line bg-surface/20 px-4 py-3">
          {templateError ? (
            <div className="flex items-center justify-between gap-2 text-xs text-destructive">
              <span>{templateError}</span>
              <Button type="button" variant="outline" size="sm" onClick={onRetryTemplates}>Tentar novamente</Button>
            </div>
          ) : (
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-fg-muted">Modelo HTML</span>
              <select
                aria-label="Modelo HTML"
                value={draft.edited.template_key || ''}
                onChange={(event) => onUpdateField(draft.index, 'template_key', event.target.value)}
                disabled={templateLoading || templates.length === 0}
                className="h-8 w-full rounded-sm border border-input bg-page px-2 text-xs text-fg shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              >
                {!draft.edited.template_key && <option value="">Padrão do servidor</option>}
                {templates.map((template) => (
                  <option key={template.key} value={template.key}>{template.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {/* ── Items table ── */}
      {!isDone && (
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[520px] table-fixed text-xs"
            aria-label={`Itens do pedido ${displayIdx + 1}`}
          >
            <colgroup>
              <col />
              <col className="w-24" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-8" />
            </colgroup>
            <thead>
              <tr className="border-b border-line text-fg-muted">
                <th scope="col" className="py-2 pl-4 pr-3 text-left font-medium">Produto</th>
                <th scope="col" className="px-3 py-2 text-center font-medium">Qtd</th>
                <th scope="col" className="px-3 py-2 text-center font-medium">Preço</th>
                <th scope="col" className="py-2 pl-3 pr-4 text-right font-medium">Subtotal</th>
                <th scope="col" className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item, ii) => {
                const hasCode = !!item.item_code;
                const results = itemResults[ii] || [];
                const searching = itemSearching[ii] || false;
                const showDropdown = activeSearchIdx === ii && results.length > 0;
                const searchValue =
                  itemSearchTerms[ii] !== undefined ? itemSearchTerms[ii] : item.item_code || '';

                return (
                  <tr
                    key={ii}
                    className={cn(
                      'border-b border-line last:border-b-0 hover:bg-surface/30',
                      pricingConflictItems.includes(item.item_code) && 'bg-amber-50 dark:bg-amber-500/10',
                    )}
                  >
                    <td className="py-2 pl-4 pr-3">
                      {editing ? (
                        <div className="relative item-search-cell">
                          <Input
                            className="h-7 text-xs pr-6"
                            placeholder="Buscar SKU ou nome…"
                            value={searchValue}
                            onChange={(e) => onItemSkuChange(ii, e.target.value)}
                            onFocus={() => setActiveSearchIdx(ii)}
                          />
                          {searching && (
                            <Loader2
                              size={12}
                              className="animate-spin absolute right-2 top-1.5 text-fg-muted"
                            />
                          )}
                          {showDropdown && (
                            <div className="absolute z-50 left-0 right-0 mt-1 bg-surface border border-line rounded-lg shadow-lg max-h-48 overflow-y-auto">
                              {results.map((p) => (
                                <button
                                  key={p.sku || p.item_code}
                                  type="button"
                                  disabled={isUnpricedProduct(p)}
                                  title={
                                    isUnpricedProduct(p)
                                      ? 'Preço indisponível para este produto.'
                                      : undefined
                                  }
                                  className={cn(
                                    'w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
                                    isUnpricedProduct(p)
                                      ? 'cursor-not-allowed opacity-50'
                                      : 'hover:bg-surface-muted'
                                  )}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => handleSelectProduct(ii, p)}
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
                          <label className="mt-1 block space-y-1">
                            <Input
                              aria-label={`Nome exibido no orçamento ${item.item_code || ii + 1}`}
                              className="h-7 text-xs"
                              value={item.item_name || ''}
                              onChange={(event) =>
                                onUpdateItem(draft.index, ii, 'item_name', event.target.value)
                              }
                            />
                          </label>
                        </div>
                      ) : (
                        <span
                          className="block truncate font-medium text-fg"
                          title={item.item_name || item.item_code || undefined}
                        >
                          {item.item_name || item.item_code || '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {editing ? (
                        <Input
                          type="number"
                          aria-label={`Quantidade do item ${item.item_code || ii + 1}`}
                          value={item.qty}
                          onChange={(e) => {
                            const val = Math.max(1, Number(e.target.value));
                            onUpdateItem(draft.index, ii, 'qty', val);
                            if (qtyPricingTimer.current) clearTimeout(qtyPricingTimer.current);
                            qtyPricingTimer.current = setTimeout(
                              () => onRefetchPricing(draft.index),
                              600
                            );
                          }}
                          className="mx-auto h-7 w-16 text-center text-xs"
                        />
                      ) : hasCode ? (
                        Number(item.qty)
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {editing ? (
                        <Input
                          type="number"
                          step="0.01"
                          aria-label={`Preço unitário do item ${item.item_code || ii + 1}`}
                          value={item.rate || ''}
                          onChange={(e) =>
                            onUpdateItem(draft.index, ii, 'rate', Number(e.target.value))
                          }
                          data-conflict-sku={item.item_code || undefined}
                          className="mx-auto h-7 w-20 text-center text-xs"
                        />
                      ) : item.rate ? (
                        formatBRL(item.rate)
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pl-3 pr-4 text-right font-medium">
                      {formatBRL((item.qty || 0) * (item.rate || 0))}
                    </td>
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(ii)}
                        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                        aria-label={`Excluir ${item.item_name || item.item_code || `item ${ii + 1}`}`}
                        title="Excluir produto"
                      >
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {displayItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-xs text-fg-muted">
                    Nenhum item adicionado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {isDone && (
        <div className="px-4 pb-2 border-t border-line bg-surface/20">
          {issue && (
            <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 pt-3 text-xs text-fg-muted">
              <strong className="text-fg">{issue.businessNumber}</strong>
              <span>Revisão {issue.revisionNumber}</span>
              <span>Validade: {issue.validUntil}</span>
            </div>
          )}
          <WhatsAppSendPanel
            selectedFlowId={waSelectedFlowId}
            flows={waFlows}
            delivery={delivery}
            pending={deliveryPending}
            onSelectFlow={(flowId) => onSelectWhatsAppFlow?.(draft.index, flowId)}
            onSend={() => onSendWhatsApp?.(draft.index)}
            hideButton
          />
          <QuotationDeliveryStatus
            delivery={delivery}
            pending={deliveryPending}
            onResolve={onResolveDelivery}
          />
          {deliveryError && (
            <p role="status" className="text-xs leading-5 text-warning">
              {deliveryError}
            </p>
          )}
        </div>
      )}

      {/* ── Stage 3 + actions ── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface/30 p-3">
        {!isDone && (
          <div className="w-full border-b border-line pb-3">
            <p className="text-xs leading-5 text-fg-muted">
              Um orçamento comercial com os dados revisados e o modelo selecionado.
            </p>
          </div>
        )}
        {!isDone && (
          <>
            <Button variant="ghost" size="sm" onClick={toggleEditing}>
              <Pencil size={13} />
              {editing ? 'Concluir' : 'Editar'}
            </Button>
            {editing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAddItem(draft.index)}
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
              className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-surface px-3 text-xs font-medium text-fg transition-all duration-200 hover:bg-surface-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
              >
                <FileText size={13} />
                Abrir PDF
              </a>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-surface px-3 text-xs font-medium text-fg opacity-40"
              >
                <FileText size={13} />
                Abrir PDF
              </span>
            )}
            {failedDelivery && issue?.businessNumber && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  window.location.hash = `/quotations/${encodeURIComponent(issue.businessNumber)}`;
                }}
              >
                Nova revisão
              </Button>
            )}
            {waSendEnabled ? (
              <Button
                size="sm"
                disabled={deliveryPending || deliveryBlocksSend}
                onClick={() => onSendWhatsApp?.(draft.index)}
              >
                <Phone size={13} />
                Enviar WhatsApp
              </Button>
            ) : (
              <span className="text-xs text-fg-muted">Emita o orçamento para enviar WhatsApp</span>
            )}
          </>
        ) : (
          <>
            {!editing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPreviewQuote(draft.index)}
                disabled={isProcessing || !canCreate}
                title="Pré-visualização temporária; não salva nem envia."
              >
                <Eye size={13} />
                Ver
              </Button>
            )}
            {onSaveDraft && !saved && !editing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSaveDraft(draft.index)}
                disabled={isProcessing || isSavingDraft || !canCreate}
              >
                {isSavingDraft ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {isSavingDraft ? 'Salvando…' : 'Salvar rascunho'}
              </Button>
            )}
            {!editing && (
              <Button
                size="sm"
                onClick={() => onCreateQuote(draft.index)}
                disabled={isProcessing || !canCreate}
              >
                <Send size={13} />
                Gerar orçamento
              </Button>
            )}
          </>
        )}
      </div>

      {issueError && !isDone && (
        <p role="alert" className="border-t border-line px-4 py-3 text-xs text-destructive">{issueError}</p>
      )}

    </div>
  );
}
