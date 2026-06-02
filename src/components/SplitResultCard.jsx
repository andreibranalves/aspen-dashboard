// src/components/SplitResultCard.jsx
// Compact result card for the split-panel auto page.
// Leaner version of DraftReviewCard — no full customer form, no summary sidebar.

import { useState } from 'react';
import { Pencil, Trash2, AlertTriangle, Send, FileText, Check } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { formatBRL, capitalize } from '@/lib/formatters.js';
import { DEFAULT_LEAD_SOURCE, LEAD_SOURCES } from '@/lib/clientMetadata.js';
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
  viewUrl,
}) {
  const [editing, setEditing] = useState(false);
  const isDone = draft.status === 'done' && draft.result?.success;
  const resultData = draft.result?.data;
  const items = isDone ? (resultData?.items || draft.edited.items || []) : (draft.edited.items || []);
  const total = items.reduce((sum, it) => sum + ((Number(it.qty) || 0) * (Number(it.rate) || 0)), 0);
  const totalUrgente = draft.edited.urgente ? total * 1.3 : total;
  const validItems = items.filter(it => it.item_code && it.qty > 0).length;
  const displayName = resultData?.cliente || draft.edited.nome;

  function toggleEditing() {
    if (!editing && !draft.edited.origem) {
      onUpdateField(draft.index, 'origem', DEFAULT_LEAD_SOURCE);
    }
    setEditing(prev => !prev);
  }

  return (
    <div className={cn(
      'rounded-xl border border-framer-hairline bg-card overflow-hidden',
      isProcessing && 'opacity-60 pointer-events-none',
    )}>
      {/* ── Header ── */}
      <div className={cn(
        'flex items-start justify-between gap-3 p-4 bg-framer-surface-1/50',
        !isDone && 'border-b border-framer-hairline',
      )}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-framer-ink-muted">
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
                <span className="text-[10px] font-medium text-framer-ink-muted">Nome</span>
                <Input
                  aria-label="Nome"
                  value={draft.edited.nome || ''}
                  onChange={e => onUpdateField(draft.index, 'nome', e.target.value)}
                  placeholder="Nome"
                  className="h-7 text-xs"
                />
              </label>
              <div className="grid grid-cols-[4fr_3fr_3fr] gap-2">
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium text-framer-ink-muted">E-mail</span>
                  <Input
                    aria-label="E-mail"
                    value={draft.edited.email || ''}
                    onChange={e => onUpdateField(draft.index, 'email', e.target.value)}
                    placeholder="Email"
                    className="h-7 text-xs"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium text-framer-ink-muted">Telefone</span>
                  <Input
                    aria-label="Telefone"
                    value={draft.edited.telefone || ''}
                    onChange={e => onUpdateField(draft.index, 'telefone', e.target.value)}
                    placeholder="Telefone"
                    className="h-7 text-xs"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium text-framer-ink-muted">Origem</span>
                  <select
                    aria-label="Origem"
                    value={draft.edited.origem || DEFAULT_LEAD_SOURCE}
                    onChange={e => onUpdateField(draft.index, 'origem', e.target.value)}
                    className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-framer-ink shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-framer-accent-blue/30"
                  >
                    {LEAD_SOURCES.map(source => (
                      <option key={source.value} value={source.value}>{source.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : (
            <>
              <h3 className="mt-1 text-sm font-semibold text-framer-ink truncate">
                {capitalize(displayName) || 'Cliente'}
              </h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-framer-ink-muted">
                {draft.edited.email && <span>{draft.edited.email}</span>}
                {draft.edited.telefone && <span>{draft.edited.telefone}</span>}
                {draft.edited.origem && (
                  <span className="rounded bg-framer-surface-2 px-1.5 py-0.5 text-[10px]">{draft.edited.origem}</span>
                )}
              </div>
            </>
          )}
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
      {!isDone && (
        <div className="overflow-x-auto">
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col />
            <col className="w-24" />
            <col className="w-28" />
            <col className="w-28" />
          </colgroup>
          <thead>
            <tr className="border-b border-framer-hairline text-framer-ink-muted">
              <th className="py-2 pl-4 pr-3 text-left font-medium">Nome</th>
              <th className="px-3 py-2 text-center font-medium">Qtd</th>
              <th className="px-3 py-2 text-center font-medium">Preço</th>
              <th className="py-2 pl-3 pr-4 text-right font-medium">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.filter(it => it.item_code).map((item, ii) => (
              <tr key={ii} className="border-b border-framer-hairline last:border-b-0 hover:bg-framer-surface-1/30">
                <td className="py-2 pl-4 pr-3">
                  <span className="block truncate font-medium text-framer-ink">
                    {item.item_name || item.item_code}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  {editing ? (
                    <Input
                      type="number"
                      value={item.qty}
                      onChange={e => onUpdateItem(draft.index, ii, 'qty', Math.max(1, Number(e.target.value)))}
                      className="mx-auto h-7 w-16 text-center text-xs"
                    />
                  ) : (
                    item.qty
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {editing ? (
                    <Input
                      type="number"
                      step="0.01"
                      value={item.rate || ''}
                      onChange={e => onUpdateItem(draft.index, ii, 'rate', Number(e.target.value))}
                      className="mx-auto h-7 w-20 text-center text-xs"
                    />
                  ) : (
                    item.rate ? formatBRL(item.rate) : '—'
                  )}
                </td>
                <td className="py-2 pl-3 pr-4 text-right font-medium">
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
      )}

      {/* ── Actions ── */}
      <div className="flex items-center gap-2 p-3 border-t border-framer-hairline bg-framer-surface-1/30">
        {!isDone && (
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleEditing}
          >
            <Pencil size={13} />
            {editing ? 'Concluir' : 'Editar'}
          </Button>
        )}

        <div className="flex-1" />

        {!isDone && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(draft.index)}
            className="text-framer-ink-muted hover:text-red-600"
          >
            <Trash2 size={13} />
          </Button>
        )}

        {isDone ? (
          <a href={viewUrl || '#'} target="_blank" rel="noopener noreferrer" className={!viewUrl ? 'pointer-events-none' : undefined}>
            <Button size="sm" disabled={!viewUrl} className="bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90">
              <FileText size={13} />
              Abrir orçamento
            </Button>
          </a>
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
