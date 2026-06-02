// src/components/SplitResultCard.jsx
// Compact result card for the split-panel auto page.
// Leaner version of DraftReviewCard — no full customer form, no summary sidebar.

import { useState } from 'react';
import { Pencil, Trash2, AlertTriangle, Send } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { formatBRL, capitalize } from '@/lib/formatters.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';

export default function SplitResultCard({
  draft,
  displayIdx,
  totalDrafts,
  isProcessing,
  onUpdateField,
  onUpdateItem,
  onRemoveItem,
  onCreateQuote,
  onDelete,
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const items = draft.edited.items || [];
  const total = items.reduce((sum, it) => sum + ((Number(it.qty) || 0) * (Number(it.rate) || 0)), 0);
  const totalUrgente = draft.edited.urgente ? total * 1.3 : total;
  const validItems = items.filter(it => it.item_code && it.qty > 0).length;

  return (
    <div className={cn(
      'rounded-xl border border-framer-hairline bg-card overflow-hidden',
      isProcessing && 'opacity-60 pointer-events-none',
    )}>
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 p-4 border-b border-framer-hairline bg-framer-surface-1/50">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-framer-ink-muted">
              Pedido {displayIdx + 1} de {totalDrafts}
            </span>
            {draft.edited.urgente && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
                <AlertTriangle size={10} /> Urgente
              </span>
            )}
          </div>
          <h3 className="mt-1 text-sm font-semibold text-framer-ink truncate">
            {capitalize(draft.edited.nome) || 'Cliente'}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-framer-ink-muted">
            {draft.edited.email && <span>{draft.edited.email}</span>}
            {draft.edited.telefone && <span>{draft.edited.telefone}</span>}
            {draft.edited.origem && (
              <span className="rounded bg-framer-surface-2 px-1.5 py-0.5 text-[10px]">{draft.edited.origem}</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] font-medium text-framer-ink-muted uppercase">Total</p>
          <p className="text-lg font-bold text-framer-ink">{formatBRL(totalUrgente)}</p>
          {draft.edited.urgente && (
            <p className="text-[10px] text-framer-ink-muted">Base: {formatBRL(total)}</p>
          )}
        </div>
      </div>

      {/* ── Items table ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-framer-hairline text-framer-ink-muted">
              <th className="py-2 pl-4 text-left font-medium">SKU</th>
              <th className="py-2 text-right font-medium">Qtd</th>
              <th className="py-2 text-right font-medium">Preço</th>
              <th className="py-2 pr-4 text-right font-medium">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.filter(it => it.item_code).map((item, ii) => (
              <tr key={ii} className="border-b border-framer-hairline last:border-b-0 hover:bg-framer-surface-1/30">
                <td className="py-2 pl-4">
                  <span className="font-mono text-[11px] font-medium text-framer-ink">{item.item_code}</span>
                  {item.item_name && (
                    <span className="ml-1.5 text-[10px] text-framer-ink-muted">{item.item_name}</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {editing ? (
                    <Input
                      type="number"
                      value={item.qty}
                      onChange={e => onUpdateItem(draft.index, ii, 'qty', Math.max(1, Number(e.target.value)))}
                      className="w-16 h-7 text-xs text-right ml-auto"
                    />
                  ) : (
                    <span>{item.qty}</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {editing ? (
                    <Input
                      type="number"
                      step="0.01"
                      value={item.rate || ''}
                      onChange={e => onUpdateItem(draft.index, ii, 'rate', Number(e.target.value))}
                      className="w-20 h-7 text-xs text-right ml-auto"
                    />
                  ) : (
                    <span>{item.rate ? formatBRL(item.rate) : '—'}</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-right font-medium">
                  {formatBRL((item.qty || 0) * (item.rate || 0))}
                </td>
              </tr>
            ))}
            {items.filter(it => it.item_code).length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-xs text-framer-ink-muted">
                  Nenhum item adicionado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Note ── */}
      {editing && (
        <div className="px-4 py-2 border-t border-framer-hairline">
          <textarea
            placeholder="Nota ou instrução (ex: frete grátis)"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-lg border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-xs text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-framer-accent-blue/30"
          />
        </div>
      )}

      {/* ── Name/contact quick edit ── */}
      {editing && (
        <div className="px-4 py-2 border-t border-framer-hairline space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-framer-ink-muted">Nome</label>
              <Input
                value={draft.edited.nome || ''}
                onChange={e => onUpdateField(draft.index, 'nome', e.target.value)}
                className="mt-0.5 h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-framer-ink-muted">Email</label>
              <Input
                value={draft.edited.email || ''}
                onChange={e => onUpdateField(draft.index, 'email', e.target.value)}
                className="mt-0.5 h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-framer-ink-muted">Telefone</label>
              <Input
                value={draft.edited.telefone || ''}
                onChange={e => onUpdateField(draft.index, 'telefone', e.target.value)}
                className="mt-0.5 h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-framer-ink-muted">Origem</label>
              <Input
                value={draft.edited.origem || ''}
                onChange={e => onUpdateField(draft.index, 'origem', e.target.value)}
                className="mt-0.5 h-7 text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex items-center gap-2 p-3 border-t border-framer-hairline bg-framer-surface-1/30">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing(!editing)}
        >
          <Pencil size={13} />
          {editing ? 'Concluir' : 'Editar'}
        </Button>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(draft.index)}
          className="text-framer-ink-muted hover:text-red-600"
        >
          <Trash2 size={13} />
        </Button>

        <Button
          size="sm"
          onClick={() => onCreateQuote(draft.index)}
          disabled={isProcessing || validItems === 0 || !draft.edited.nome?.trim()}
        >
          <Send size={13} />
          Criar orçamento
        </Button>
      </div>
    </div>
  );
}
