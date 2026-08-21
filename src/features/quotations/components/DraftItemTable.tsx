// src/components/DraftItemTable.tsx
// Items table with SKU autocomplete, qty/rate inputs, drag reorder, and add/remove.
// Extracted from AutoQuotePage.jsx.

import { GripVertical, X, Plus, Package, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { formatBRL } from '@/lib/formatting/formatters';
import { isUnpricedProduct } from '@/lib/api/productCache';
import type { Dispatch, SetStateAction } from 'react';
import type { Product, Draft, DraftItem, ProductSearchEntry } from '@/types/domain';

export interface DraftItemTableProps {
  items?: DraftItem[];
  validItems?: number;
  isApproved?: boolean;
  draftIdx: number;
  updateDraftItem: (draftIdx: number, itemIdx: number, field: keyof DraftItem, value: unknown) => void;
  onProductSearchChange: (draftIdx: number, val: string) => void;
  productSearch: Record<number, ProductSearchEntry>;
  closeProductSearch: (draftIdx: number) => void;
  selectProduct: (draftIdx: number, itemIdx: number, product: Product) => void;
  drafts: Draft[];
  fetchPricing: (draftsList: Draft[], urgent: boolean) => Promise<Draft[]>;
  setDrafts: Dispatch<SetStateAction<Draft[]>>;
  reorderItems: (draftIdx: number, fromIdx: number, toIdx: number) => void;
  removeDraftItem: (draftIdx: number, itemIdx: number) => void;
  addDraftItem: (draftIdx: number) => void;
}

export default function DraftItemTable({
  items = [],
  validItems = 0,
  isApproved = false,
  draftIdx,
  updateDraftItem,
  onProductSearchChange,
  productSearch,
  closeProductSearch,
  selectProduct,
  drafts,
  fetchPricing,
  setDrafts,
  reorderItems,
  removeDraftItem,
  addDraftItem,
}: DraftItemTableProps) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface/50 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Package size={16} className="text-primary" /> Itens sugeridos
        </div>
        <span className="text-xs text-fg-muted">{validItems} item(s) válidos</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-surface/70 text-xs text-fg-muted">
            <tr>
              <th className="w-10 p-3"></th>
              <th className="p-3 text-left">Produto</th>
              <th className="w-24 p-3 text-right">Qtd</th>
              <th className="w-28 p-3 text-right">R$/un</th>
              <th className="w-28 p-3 text-right">Total</th>
              <th className="w-10 p-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, ii) => {
              const amount = (item.qty || 0) * (item.rate || 0);
              return (
                <tr
                  key={ii}
                  draggable={!isApproved}
                  onDragStart={e => {
                    e.dataTransfer.setData('text/plain', String(ii));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                  onDrop={e => {
                    e.preventDefault();
                    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                    if (from !== ii) reorderItems(draftIdx, from, ii);
                  }}
                  className="border-t border-line transition-colors hover:bg-primary/5"
                >
                  <td className="p-2 text-center text-fg-muted">
                    <GripVertical size={14} className={cn(!isApproved && 'cursor-grab')} />
                  </td>
                  <td className="p-2 relative">
                    <div className="relative">
                      <Input
                        className="h-9 font-mono text-xs pr-8"
                        value={item.item_code}
                        onChange={e => {
                          updateDraftItem(draftIdx, ii, 'item_code', e.target.value);
                          onProductSearchChange(draftIdx, e.target.value);
                        }}
                        onBlur={() => {
                          setTimeout(() => closeProductSearch(draftIdx), 200);
                          if (!items[ii]._rateManual) {
                            const draft = drafts.find(d => d.index === draftIdx) || drafts[draftIdx];
                            if (draft) {
                              fetchPricing([draft], draft.edited.urgente).then(priced => {
                                setDrafts(prev => { const next = [...prev]; next[draftIdx] = priced[0]; return next; });
                              });
                            }
                          }
                        }}
                        onFocus={() => {
                          if (item.item_code) onProductSearchChange(draftIdx, item.item_code);
                        }}
                        placeholder="SKU"
                        disabled={isApproved}
                      />
                      {productSearch[draftIdx]?.loading && (
                        <Loader2 size={14} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-fg-muted" />
                      )}
                    </div>
                    {productSearch[draftIdx]?.open && productSearch[draftIdx]?.results && productSearch[draftIdx].results.length > 0 && (
                      <div className="absolute z-20 left-0 right-0 mt-1 bg-surface border border-line rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                        {productSearch[draftIdx].results?.map(p => (
                          <button
                            key={p.sku}
                            type="button"
                            disabled={isUnpricedProduct(p)}
                            title={isUnpricedProduct(p) ? 'Preço indisponível para este produto.' : undefined}
                            className={cn(
                              'w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-2',
                              isUnpricedProduct(p)
                                ? 'cursor-not-allowed opacity-50'
                                : 'hover:bg-surface-muted/50',
                            )}
                            onMouseDown={e => {
                              e.preventDefault();
                              if (isUnpricedProduct(p)) return;
                              selectProduct(draftIdx, ii, p);
                            }}
                          >
                            <div className="min-w-0">
                              <span className="font-mono text-primary">{p.sku}</span>
                              <span className="text-fg-muted ml-2">{String(p.nome || '')}</span>
                            </div>
                            {isUnpricedProduct(p) ? (
                              <span className="text-[10px] text-destructive shrink-0">Preço indisponível</span>
                            ) : p.categoria ? (
                              <span className="text-[10px] text-fg-muted shrink-0">{p.categoria}</span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    )}
                    {item.item_name && <p className="mt-1 text-xs text-fg-muted">{item.item_name}</p>}
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      min="1"
                      className="ml-auto h-9 w-20 text-right text-xs"
                      value={item.qty || ''}
                      onChange={e => { const v = Number(e.target.value); if (!isNaN(v)) updateDraftItem(draftIdx, ii, 'qty', v); }}
                      onBlur={async () => {
                        if (!items[ii]._rateManual) {
                          const priced = await fetchPricing([drafts.find(d => d.index === draftIdx) || drafts[draftIdx]], drafts[draftIdx].edited.urgente);
                          setDrafts(prev => {
                            const next = [...prev];
                            next[draftIdx] = priced[0];
                            return next;
                          });
                        }
                      }}
                      disabled={isApproved}
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="ml-auto h-9 w-24 text-right text-xs"
                      value={item.rate || ''}
                      onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updateDraftItem(draftIdx, ii, 'rate', v); }}
                      placeholder="0,00"
                      disabled={isApproved}
                    />
                  </td>
                  <td className="p-2 text-right text-sm font-medium text-fg">{formatBRL(amount)}</td>
                  <td className="p-2 text-center">
                    {!isApproved && (
                      <button
                        type="button"
                        onClick={() => removeDraftItem(draftIdx, ii)}
                        className="rounded-full p-1 text-fg-muted transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Remover item"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!isApproved && (
        <button
          type="button"
          onClick={() => addDraftItem(draftIdx)}
          className="flex w-full items-center justify-center gap-2 border-t border-line p-3 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
        >
          <Plus size={14} /> Adicionar produto
        </button>
      )}
    </div>
  );
}
