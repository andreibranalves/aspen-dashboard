// src/components/DraftItemTable.jsx
// Items table with SKU autocomplete, qty/rate inputs, drag reorder, and add/remove.
// Extracted from AutoQuotePage.jsx.

import { GripVertical, X, Plus, Package, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Input } from '@/components/ui/input.jsx';
import { formatBRL } from '@/lib/formatters.js';

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
}) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-framer-hairline">
      <div className="flex items-center justify-between gap-3 border-b border-framer-hairline bg-framer-surface-1/50 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-framer-ink">
          <Package size={16} className="text-primary" /> Itens sugeridos
        </div>
        <span className="text-xs text-framer-ink-muted">{validItems} item(s) válidos</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-framer-surface-1/70 text-xs text-framer-ink-muted">
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
                  className="border-t border-framer-hairline transition-colors hover:bg-primary/5"
                >
                  <td className="p-2 text-center text-muted-foreground">
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
                        <Loader2 size={14} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    {productSearch[draftIdx]?.open && productSearch[draftIdx]?.results?.length > 0 && (
                      <div className="absolute z-20 left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                        {productSearch[draftIdx].results.map(p => (
                          <button
                            key={p.sku}
                            type="button"
                            className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center justify-between gap-2"
                            onMouseDown={e => {
                              e.preventDefault();
                              selectProduct(draftIdx, ii, p);
                            }}
                          >
                            <div className="min-w-0">
                              <span className="font-mono text-framer-accent-blue">{p.sku}</span>
                              <span className="text-framer-ink-muted ml-2">{p.nome}</span>
                            </div>
                            {p.categoria && <span className="text-[10px] text-muted-foreground shrink-0">{p.categoria}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {item.item_name && <p className="mt-1 text-xs text-framer-ink-muted">{item.item_name}</p>}
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
                  <td className="p-2 text-right text-sm font-medium text-framer-ink">{formatBRL(amount)}</td>
                  <td className="p-2 text-center">
                    {!isApproved && (
                      <button
                        type="button"
                        onClick={() => removeDraftItem(draftIdx, ii)}
                        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600"
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
          className="flex w-full items-center justify-center gap-2 border-t border-framer-hairline p-3 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
        >
          <Plus size={14} /> Adicionar produto
        </button>
      )}
    </div>
  );
}
