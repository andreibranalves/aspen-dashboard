import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api/api';
import { formatBRL } from '@/lib/formatting/formatters';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { STAGES, type ProductionOrder } from '../productionTypes';

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

const displayDate = (value: string | null) => value ? value.split('-').reverse().join('/') : '—';

export default function ProductionOrderPanel({ id, readOnly, onChange }: { id: string; readOnly: boolean; onChange: () => void }) {
  const [order, setOrder] = useState<ProductionOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepDate, setStepDate] = useState(today());
  const [entryAmount, setEntryAmount] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [artDate, setArtDate] = useState('');
  const [balanceDate, setBalanceDate] = useState('');
  const [dueOverride, setDueOverride] = useState('');
  const [note, setNote] = useState('');
  const [confirmDelivery, setConfirmDelivery] = useState(false);
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);

  const install = useCallback((data: ProductionOrder) => {
    setOrder(data);
    setEntryDate(data.entry_received_date || '');
    setEntryAmount(String(data.entry_received_amount));
    setArtDate(data.art_approved_date || '');
    setBalanceDate(data.balance_received_date || '');
    setDueOverride(data.due_date_override || '');
    setUndoToken(data.undo_token);
    setUndoVisible(Boolean(data.undo_token));
    if (data.undo_token) window.setTimeout(() => setUndoVisible(false), 10000);
  }, []);
  const load = useCallback(async () => {
    try { install(await apiGet<ProductionOrder>(`/production-orders?id=${encodeURIComponent(id)}`)); }
    catch { setError('Não foi possível carregar a produção.'); }
  }, [id, install]);
  useEffect(() => { void load(); }, [load]);

  const change = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      install(await apiPost<ProductionOrder>('/production-orders', { id, ...body }));
      window.dispatchEvent(new Event('production-orders-changed'));
      onChange();
      setConfirmDelivery(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o pedido.');
    } finally { setBusy(false); }
  };

  if (!order) return <section className="rounded-card border border-line bg-surface p-5">{error || 'Carregando produção…'}</section>;
  const index = STAGES.indexOf(order.stage);
  const next = STAGES[index + 1];
  const openBalance = order.received_amount < order.grand_total;
  return <section className="space-y-5 rounded-card border border-line bg-surface p-5" aria-label="Produção do pedido">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Heading level="section">Produção</Heading>
      <span className="text-sm font-medium capitalize">{order.stage}</span>
    </div>
    {order.alert && <p className={`text-sm font-semibold ${order.alert === 'atrasado' ? 'text-destructive' : 'text-warning'}`}>{order.alert}</p>}
    {order.due_date && <p className="text-sm">Prazo final: {displayDate(order.due_date)} · {order.production_days} dias úteis</p>}
    {order.stalled_days !== null && <p className="text-sm text-fg-muted">Parado há {order.stalled_days} dias</p>}
    {!readOnly && next && <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
      <label className="flex flex-col gap-1 text-sm">Data
        <input type="date" value={stepDate} onChange={(event) => setStepDate(event.target.value)} className="block rounded-control border border-line bg-surface px-2 py-1" />
      </label>
      {index === 0 && <label className="flex flex-col gap-1 text-sm">Valor da entrada
        <input type="number" min="0" max={order.grand_total} step="0.01" value={entryAmount || String(Math.round(order.grand_total * 50) / 100)}
          onChange={(event) => setEntryAmount(event.target.value)} className="block w-36 rounded-control border border-line bg-surface px-2 py-1" />
      </label>}
      <Button disabled={busy} onClick={() => {
        if (next === 'entregue' && openBalance) { setConfirmDelivery(true); return; }
        void change({ action: 'advance', stage: next, date: stepDate,
          ...(index === 0 ? { amount: Number(entryAmount || Math.round(order.grand_total * 50) / 100) } : {}) });
      }}>Avançar para {next}</Button>
      {confirmDelivery && <div className="w-full space-y-2 rounded-control border border-warning p-3 text-sm">
        <p>Há saldo em aberto de {formatBRL(order.grand_total - order.received_amount)}.</p>
        <Button disabled={busy} onClick={() => void change({ action: 'advance', stage: 'entregue', date: stepDate })}>Confirmar entrega</Button>
      </div>}
    </div>}
    {undoToken && undoVisible && <Button variant="outline" disabled={busy} onClick={() => void change({ action: 'undo', token: undoToken })}>Desfazer mudança</Button>}
    <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">Entrada recebida
        <input type="date" value={entryDate} disabled={readOnly} onChange={(event) => setEntryDate(event.target.value)} className="block w-full rounded-control border border-line bg-surface px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1 text-sm">Valor da entrada
        <input type="number" min="0" max={order.grand_total} step="0.01" value={entryAmount} disabled={readOnly} onChange={(event) => setEntryAmount(event.target.value)} className="block w-full rounded-control border border-line bg-surface px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1 text-sm">Arte aprovada
        <input type="date" value={artDate} disabled={readOnly} onChange={(event) => setArtDate(event.target.value)} className="block w-full rounded-control border border-line bg-surface px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1 text-sm">Saldo recebido
        <input type="date" value={balanceDate} disabled={readOnly} onChange={(event) => setBalanceDate(event.target.value)} className="block w-full rounded-control border border-line bg-surface px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1 text-sm">Prazo final manual
        <input type="date" value={dueOverride} disabled={readOnly} onChange={(event) => setDueOverride(event.target.value)} className="block w-full rounded-control border border-line bg-surface px-2 py-1" />
      </label>
    </div>
    <p className="text-sm font-medium">Recebido {formatBRL(order.received_amount)} de {formatBRL(order.grand_total)}</p>
    {!readOnly && <Button variant="outline" disabled={busy} onClick={() => void change({
      action: 'dates', entry_received_date: entryDate || null, entry_received_amount: entryAmount ? Number(entryAmount) : null,
      art_approved_date: artDate || null, balance_received_date: balanceDate || null, due_date_override: dueOverride || null,
    })}>Salvar datas e valores</Button>}
    <div className="space-y-3 border-t border-line pt-4">
      <Heading level="section">Anotações</Heading>
      {!readOnly && <div className="flex gap-2">
        <input aria-label="Nova anotação" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000}
          className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-2 text-sm" />
        <Button disabled={busy || !note.trim()} onClick={() => { void change({ action: 'note', content: note }); setNote(''); }}>Adicionar</Button>
      </div>}
      {order.notes?.length === 0 && <p className="text-sm text-fg-muted">Nenhuma anotação.</p>}
      {order.notes?.map((item) => <div key={item.id} className="border-b border-line pb-3 text-sm">
        <p className="whitespace-pre-wrap">{item.content}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <span>{new Date(item.created_at).toLocaleString('pt-BR')}</span>
          {item.kind === 'note' && !readOnly && <>
            <Button variant="link" size="inline" disabled={busy} onClick={() => {
              const content = window.prompt('Editar anotação', item.content);
              if (content !== null) void change({ action: 'edit_note', note_id: item.id, content });
            }}>Editar</Button>
            <Button variant="link" size="inline" disabled={busy} onClick={() => {
              if (window.confirm('Apagar anotação?')) void change({ action: 'delete_note', note_id: item.id });
            }}>Apagar</Button>
          </>}
        </div>
      </div>)}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
