// src/components/DraftReviewCard.jsx
// Full review card for a single draft: header, client metadata, items table, summary, and actions.
// Extracted from AutoQuotePage.jsx.

import { Check, X, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBRL } from '@/lib/formatters';
import { Button } from '@/components/ui/button.jsx';
import Skeleton from '@/components/Skeleton.jsx';
import CustomerMetadataForm from '@/components/CustomerMetadataForm.jsx';
import DraftItemTable from '@/components/DraftItemTable.jsx';

// ── Card status icon ──
function CardIcon({ status }) {
  switch (status) {
    case 'draft':    return <Pencil size={16} />;
    case 'approved': return <Check size={18} className="text-primary" />;
    case 'done':     return <Check size={18} className="text-primary font-bold" />;
    case 'error':    return <X size={18} className="text-destructive/60 font-bold" />;
    case 'processing':
    default:         return <Skeleton className="h-4 w-4 rounded-full" />;
  }
}

export default function DraftReviewCard({
  draft,
  displayIdx,
  totalDrafts,
  isApproved,
  items,
  total,
  validItems,
  onApprove,
  onDiscard,
  // CustomerMetadataForm props
  updateDraftField,
  updateDraftAddressField,
  onUrgenteToggle,
  // DraftItemTable props
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
  const i = draft.index;

  return (
    <div
      key={i}
      className={cn(
        'overflow-hidden rounded-[24px] border border-line bg-surface shadow-sm transition-all',
        isApproved && 'border-primary/40 bg-primary/5',
      )}
    >
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 border-b border-line bg-surface/50 p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
            isApproved ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary',
          )}>
            <CardIcon status={isApproved ? 'approved' : 'draft'} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-fg-muted">Pedido {displayIdx + 1} de {totalDrafts}</span>
              {isApproved && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Aprovado</span>}
              {draft.edited.urgente && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">Urgente</span>}
            </div>
          </div>
        </div>
        <div className="rounded-[20px] border border-line bg-surface px-5 py-4 text-left lg:min-w-[220px] lg:text-right">
          <p className="text-xs font-medium text-fg-muted">Total estimado</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-fg">{formatBRL(total)}</p>
        </div>
      </div>

      {/* ── Content grid ── */}
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-5">
          <CustomerMetadataForm
            draft={draft}
            draftIdx={i}
            isApproved={isApproved}
            updateDraftField={updateDraftField}
            updateDraftAddressField={updateDraftAddressField}
            onUrgenteToggle={onUrgenteToggle}
          />

          <DraftItemTable
            items={items}
            validItems={validItems}
            isApproved={isApproved}
            draftIdx={i}
            updateDraftItem={updateDraftItem}
            onProductSearchChange={onProductSearchChange}
            productSearch={productSearch}
            closeProductSearch={closeProductSearch}
            selectProduct={selectProduct}
            drafts={drafts}
            fetchPricing={fetchPricing}
            setDrafts={setDrafts}
            reorderItems={reorderItems}
            removeDraftItem={removeDraftItem}
            addDraftItem={addDraftItem}
          />
        </div>

        {/* ── Sidebar: Summary + Actions ── */}
        <aside className="space-y-4">
          <div className="rounded-[20px] border border-line bg-surface/50 p-4">
            <h3 className="text-sm font-semibold text-fg">Resumo</h3>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Produtos</dt>
                <dd className="font-medium text-fg">{items.length}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Unidades</dt>
                <dd className="font-medium text-fg">{items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Prazo</dt>
                <dd className="max-w-[140px] text-right font-medium text-fg">{draft.edited.prazo_producao || 'Padrão'}</dd>
              </div>
              <div className="border-t border-line pt-3">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-fg-muted">Total</dt>
                  <dd className="text-lg font-semibold text-fg">{formatBRL(total)}</dd>
                </div>
              </div>
            </dl>
          </div>
          {!isApproved && (
            <div className="space-y-2">
              <Button onClick={() => onApprove(i)} variant="default" size="lg" className="w-full">
                <Check size={16} /> Aprovar e criar orçamento
              </Button>
              <Button onClick={() => onDiscard(i)} variant="ghost" size="lg" className="w-full">
                <X size={16} /> Descartar pedido
              </Button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
