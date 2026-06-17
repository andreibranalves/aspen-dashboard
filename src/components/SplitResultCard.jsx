// src/components/SplitResultCard.jsx
// Compact result card for the split-panel auto page.
// Leaner version of DraftReviewCard — no full customer form, no summary sidebar.

import { useState, useRef, useCallback, useEffect } from 'react';
import { Pencil, X, Plus, Loader2, AlertTriangle, Send, FileText, Check } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { formatBRL, capitalize } from '@/lib/formatters.js';
import { DEFAULT_LEAD_SOURCE, LEAD_SOURCES } from '@/lib/clientMetadata.js';
import { searchProducts } from '@/lib/productCache.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import WhatsAppSendPanel from '@/components/WhatsAppSendPanel.jsx';

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
  viewUrl,
  waStatus,
  waFlows = [],
  waSelectedFlowId = '',
  onSelectWhatsAppFlow,
  onSendWhatsApp,
}) {
  const [editing, setEditing] = useState(false);

  // ── Per-item product search (local state, like QuotationDetailPage) ──
  const [itemSearchTerms, setItemSearchTerms] = useState({}); // { ii: term }
  const [itemResults, setItemResults] = useState({}); // { ii: [...] }
  const [itemSearching, setItemSearching] = useState({}); // { ii: bool }
  const [activeSearchIdx, setActiveSearchIdx] = useState(null); // ii or null
  const searchTimers = useRef({}); // { ii: timeoutId }
  const qtyPricingTimer = useRef(null); // debounced pricing refetch

  // Click outside closes the active dropdown
  useEffect(() => {
    if (activeSearchIdx === null) return;
    const handler = (e) => {
      if (!e.target.closest('.item-search-cell')) {
        setActiveSearchIdx(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeSearchIdx]);

  // Debounced product search per item index
  const onItemSkuChange = useCallback(
    (ii, value) => {
      setItemSearchTerms((prev) => ({ ...prev, [ii]: value }));
      onUpdateItem(draft.index, ii, 'item_code', value);
      clearTimeout(searchTimers.current[ii]);
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
    (ii, product) => {
      if (!product?.sku) return;
      selectProduct(draft.index, ii, product);
      setItemSearchTerms((prev) => ({
        ...prev,
        [ii]: product.nome || product.item_name || product.sku,
      }));
      setItemResults((prev) => ({ ...prev, [ii]: [] }));
      setActiveSearchIdx(null);
    },
    [draft.index, selectProduct]
  );

  // Remove item with local state cleanup
  const handleRemoveItem = useCallback(
    (ii) => {
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

  const isDone = draft.status === 'done' && draft.result?.success;
  const resultData = draft.result?.data;
  const items = isDone ? resultData?.items || draft.edited.items || [] : draft.edited.items || [];
  const total = items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const totalUrgente = draft.edited.urgente ? total * 1.3 : total;
  const validItems = items.filter((it) => it.item_code && it.qty > 0).length;
  const displayItems = editing ? items : items.filter((it) => it.item_code);
  const displayName = resultData?.cliente || draft.edited.nome;

  function toggleEditing() {
    if (!editing) {
      // Pre-fill search terms with existing item names
      const terms = {};
      items.forEach((item, ii) => {
        if (item.item_code) terms[ii] = item.item_name || item.item_code;
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
      className={cn(
        'rounded-xl border border-line bg-surface',
        isProcessing && 'opacity-60 pointer-events-none'
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
          <div className="flex items-center gap-2">
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
                <Check size={10} /> Orçamento criado
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
                    placeholder="Email"
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
                    className="h-7 w-full rounded-md border border-input bg-page px-2 text-xs text-fg shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
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

      {/* ── Items table ── */}
      {!isDone && (
        <div className="overflow-visible">
          <table className="w-full table-fixed text-xs">
            <colgroup>
              <col />
              <col className="w-24" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-8" />
            </colgroup>
            <thead>
              <tr className="border-b border-line text-fg-muted">
                <th className="py-2 pl-4 pr-3 text-left font-medium">Produto</th>
                <th className="px-3 py-2 text-center font-medium">Qtd</th>
                <th className="px-3 py-2 text-center font-medium">Preço</th>
                <th className="py-2 pl-3 pr-4 text-right font-medium">Subtotal</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item, ii) => {
                const hasCode = !!item.item_code;
                const results = itemResults[ii] || [];
                const searching = itemSearching[ii] || false;
                const showDropdown = activeSearchIdx === ii && results.length > 0;
                const searchValue =
                  itemSearchTerms[ii] !== undefined
                    ? itemSearchTerms[ii]
                    : item.item_name || item.item_code || '';

                return (
                  <tr
                    key={ii}
                    className="border-b border-line last:border-b-0 hover:bg-surface/30"
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
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-surface-muted transition-colors flex items-center gap-2"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    handleSelectProduct(ii, p);
                                  }}
                                >
                                  <span className="font-mono text-[10px] text-fg-muted shrink-0">
                                    {p.sku || p.item_code}
                                  </span>
                                  <span className="truncate">{p.nome || p.item_name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="block truncate font-medium text-fg">
                          {item.item_name || item.item_code || '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {editing ? (
                        <Input
                          type="number"
                          value={item.qty}
                          onChange={(e) => {
                            const val = Math.max(1, Number(e.target.value));
                            onUpdateItem(draft.index, ii, 'qty', val);
                            clearTimeout(qtyPricingTimer.current);
                            qtyPricingTimer.current = setTimeout(
                              () => onRefetchPricing(draft.index),
                              600
                            );
                          }}
                          className="mx-auto h-7 w-16 text-center text-xs"
                        />
                      ) : hasCode ? (
                        item.qty
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {editing ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={item.rate || ''}
                          onChange={(e) =>
                            onUpdateItem(draft.index, ii, 'rate', Number(e.target.value))
                          }
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
                        className="p-0.5 rounded text-fg-muted hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Remover produto"
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
        <div className="px-4 pb-4 border-t border-line bg-surface/20">
          <WhatsAppSendPanel
            selectedFlowId={waSelectedFlowId}
            flows={waFlows}
            status={waStatus}
            onSelectFlow={(flowId) => onSelectWhatsAppFlow?.(draft.index, flowId)}
            onSend={() => onSendWhatsApp?.(draft.index)}
          />
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex items-center gap-2 p-3 border-t border-line bg-surface/30">
        {!isDone && (
          <>
            <Button variant="ghost" size="sm" onClick={toggleEditing}>
              <Pencil size={13} />
              {editing ? 'Concluir' : 'Editar'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onAddItem(draft.index);
                if (!editing) toggleEditing();
              }}
            >
              <Plus size={13} />
              Item
            </Button>
          </>
        )}

        <div className="flex-1" />

        {isDone ? (
          <>
            <a
              href={viewUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className={!viewUrl ? 'pointer-events-none' : undefined}
            >
              <Button size="sm" variant="secondary" disabled={!viewUrl}>
                <FileText size={13} />
                Abrir orçamento
              </Button>
            </a>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => onCreateQuote(draft.index)}
            disabled={isProcessing || validItems === 0 || !draft.edited.nome?.trim()}
          >
            <Send size={13} />
            Criar orçamento
          </Button>
        )}
      </div>
    </div>
  );
}
