import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Pencil, FileText, Trash2, Save, X, Plus, GripVertical, Phone, AlertTriangle } from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api.js';
import { formatBRL, formatDate } from '@/lib/formatters.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { StatusBadge } from '@/components/ui/badge.jsx';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table.jsx';
import SkeletonDetail from '@/components/SkeletonDetail.jsx';

const STATUS_LABELS = {
  Draft: 'Rascunho',
  Open: 'Aberto',
  Replied: 'Respondido',
  Ordered: 'Convertido',
  Lost: 'Perdido',
  Expired: 'Expirado',
  Cancelled: 'Cancelado',
};

export default function QuotationDetailPage({ id, navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('view'); // 'view' | 'edit'
  const [editedItems, setEditedItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  // ── Load ──
  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet(`/quotations?id=${encodeURIComponent(id)}`);
      if (!result || !result.id) throw new Error('Orçamento não encontrado.');
      setData(result);
      setEditedItems((result.items || []).map(item => ({ ...item })));
      setMode('view');
    } catch (err) {
      console.error('[detail]', err);
      setError(err.message || 'Erro ao carregar orçamento.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  // ── Computed ──
  const items = mode === 'edit' ? editedItems : (data?.items || []);
  const total = items.reduce((s, item) => s + (item.qty || 0) * (item.rate || 0), 0);

  // ── Edit mode helpers ──
  const updateItem = useCallback((idx, field, value) => {
    setEditedItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === 'rate') next[idx]._rateManual = true;
      if (field === 'item_code') delete next[idx]._rateManual;
      return next;
    });
  }, []);

  const removeItem = useCallback((idx) => {
    setEditedItems(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const addItem = useCallback(() => {
    setEditedItems(prev => [...prev, { item_code: '', item_name: '', qty: 1, rate: 0, uom: 'und' }]);
  }, []);

  // ── Auto-pricing lookup ──
  const lookupPrice = useCallback(async (idx, sku, qty) => {
    if (!sku || !qty) return;
    try {
      const result = await apiPost('/pricing-lookup', { sku, qty: Number(qty) });
      if (result?.rate !== undefined && result?.rate !== null) {
        setEditedItems(prev => {
          const next = [...prev];
          if (!next[idx]._rateManual) {
            next[idx] = { ...next[idx], rate: result.rate, item_name: result.item_name || next[idx].item_name };
          }
          return next;
        });
      }
    } catch (err) {
      // Silent — pricing lookup is best-effort
      console.warn('[detail] pricing lookup failed:', err.message);
    }
  }, []);

  // ── Save ──
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus('Salvando…');
    try {
      const payload = { id, items: editedItems };
      await apiPut('/quotations', payload);
      setSaveStatus('Salvo!');
      setTimeout(() => setSaveStatus(''), 2000);
      // Reload
      await loadDetail();
    } catch (err) {
      setSaveStatus('Erro ao salvar: ' + (err.message || 'Tente novamente.'));
    } finally {
      setSaving(false);
    }
  }, [id, editedItems, loadDetail]);

  const handleCancel = useCallback(() => {
    setEditedItems((data?.items || []).map(item => ({ ...item })));
    setMode('view');
  }, [data]);

  // ── Delete ──
  const handleDelete = useCallback(async () => {
    if (!confirm(`Tem certeza que deseja excluir o orçamento ${id}?\n\nEsta ação não pode ser desfeita.`)) return;
    try {
      await apiDelete(`/quotations?id=${encodeURIComponent(id)}`);
      navigate('/quotations');
    } catch (err) {
      alert('Erro ao excluir: ' + (err.message || 'Tente novamente.'));
    }
  }, [id, navigate]);

  // ── Drag-and-drop reorder ──
  const handleDragStart = useCallback((e, idx) => {
    e.dataTransfer.setData('text/plain', String(idx));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e, targetIdx) => {
    e.preventDefault();
    const sourceIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (sourceIdx === targetIdx) return;
    setEditedItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(sourceIdx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  }, []);

  // ── Loading / Error ──
  if (loading) {
    return <SkeletonDetail title="Carregando orçamento…" />;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/quotations')} className="text-sm text-primary hover:underline">
          ← Voltar para Orçamentos
        </button>
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <AlertTriangle size={32} className="text-red-400" />
          <p>Erro ao carregar orçamento</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={loadDetail}>Tentar novamente</Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Back */}
      <button
        onClick={() => navigate('/quotations')}
        className="text-sm text-primary hover:underline inline-flex items-center gap-1"
      >
        <ArrowLeft size={14} /> Voltar para lista
      </button>

      {/* Detail card */}
      <div className="bg-white rounded-lg border shadow-sm">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-semibold">{data.id}</span>
            <StatusBadge
              status={data.status}
              label={STATUS_LABELS[data.status] || data.status}
            />
          </div>
        </div>

        {/* Meta */}
        <div className="px-6 py-4 border-b grid grid-cols-3 gap-6">
          <div>
            <span className="text-xs text-muted-foreground">Cliente</span>
            <p className="font-medium">{data.cliente || '—'}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Data</span>
            <p>{formatDate(data.data)}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Validade</span>
            <p>{formatDate(data.validade)}</p>
          </div>
        </div>

        {/* Items table */}
        <div className="px-6 py-4">
          <Table>
            <TableHeader>
              <TableRow>
                {mode === 'edit' && <TableHead className="w-8"></TableHead>}
                <TableHead>SKU</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">
                  {mode === 'edit' ? 'Preço Unit. (R$)' : 'Preço Unit.'}
                </TableHead>
                <TableHead className="text-right">Total</TableHead>
                {mode === 'edit' && <TableHead className="w-8"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, idx) => {
                const amount = (item.qty || 0) * (item.rate || 0);

                if (mode === 'edit') {
                  return (
                    <TableRow
                      key={idx}
                      draggable
                      onDragStart={e => handleDragStart(e, idx)}
                      onDragOver={handleDragOver}
                      onDrop={e => handleDrop(e, idx)}
                    >
                      {/* Drag handle */}
                      <TableCell className="cursor-grab text-muted-foreground p-2">
                        <GripVertical size={14} />
                      </TableCell>
                      {/* SKU */}
                      <TableCell>
                        <Input
                          className="h-8 text-sm font-mono"
                          placeholder="SKU"
                          value={item.item_code || ''}
                          onChange={e => {
                            updateItem(idx, 'item_code', e.target.value);
                            // Auto-pricing on SKU change
                            clearTimeout(e.target._timer);
                            e.target._timer = setTimeout(() => {
                              lookupPrice(idx, e.target.value, editedItems[idx]?.qty);
                            }, 400);
                          }}
                        />
                      </TableCell>
                      {/* Name */}
                      <TableCell>
                        <Input
                          className="h-8 text-sm"
                          placeholder="Nome do produto"
                          value={item.item_name || ''}
                          onChange={e => updateItem(idx, 'item_name', e.target.value)}
                        />
                      </TableCell>
                      {/* Qty */}
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="1"
                          className="h-8 w-20 text-sm ml-auto"
                          value={item.qty || ''}
                          onChange={e => {
                            const val = Number(e.target.value);
                            if (!isNaN(val)) {
                              updateItem(idx, 'qty', val);
                              clearTimeout(e.target._timer);
                              e.target._timer = setTimeout(() => {
                                lookupPrice(idx, editedItems[idx]?.item_code, val);
                              }, 400);
                            }
                          }}
                        />
                      </TableCell>
                      {/* Rate */}
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          className="h-8 w-28 text-sm ml-auto"
                          value={item.rate || ''}
                          onChange={e => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) updateItem(idx, 'rate', val);
                          }}
                        />
                      </TableCell>
                      {/* Amount (calculated) */}
                      <TableCell className="text-right font-mono">
                        {formatBRL(amount)}
                      </TableCell>
                      {/* Remove */}
                      <TableCell className="p-2">
                        <button
                          onClick={() => removeItem(idx)}
                          className="text-muted-foreground hover:text-red-600 transition-colors"
                          title="Remover"
                        >
                          <X size={16} />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                }

                // View mode
                return (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-sm">{item.item_code}</TableCell>
                    <TableCell>{item.item_name || item.item_code}</TableCell>
                    <TableCell className="text-right">{item.qty}</TableCell>
                    <TableCell className="text-right">{formatBRL(item.rate)}</TableCell>
                    <TableCell className="text-right font-mono">{formatBRL(amount)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Totals */}
        <div className="px-6 py-3 border-t text-right font-semibold">
          Total: {formatBRL(total)}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t flex items-center gap-3">
          {mode === 'view' && (
            <>
              <Button onClick={() => setMode('edit')} variant="outline" size="sm">
                <Pencil size={14} /> Editar
              </Button>
              <a
                href={`/api/view?q=${encodeURIComponent(data.id)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">
                  <FileText size={14} /> Visualizar
                </Button>
              </a>
              <a
                href={`https://wa.me/?text=${encodeURIComponent('Olá ' + (data.cliente || '') + '! Segue orçamento ' + data.id + ':\n' + window.location.origin + '/api/view?q=' + encodeURIComponent(data.id))}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm" className="text-green-600">
                  <Phone size={14} /> WhatsApp
                </Button>
              </a>
              <div className="flex-1" />
              <Button onClick={handleDelete} variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50">
                <Trash2 size={14} /> Excluir
              </Button>
            </>
          )}

          {mode === 'edit' && (
            <>
              <Button onClick={handleSave} disabled={saving} variant="success" size="sm">
                <Save size={14} /> Salvar
              </Button>
              <Button onClick={handleCancel} variant="outline" size="sm" disabled={saving}>
                <X size={14} /> Cancelar
              </Button>
              <Button onClick={addItem} variant="outline" size="sm">
                <Plus size={14} /> + Item
              </Button>
              {saveStatus && (
                <span className={`text-xs ${saveStatus.startsWith('Erro') ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {saveStatus}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
