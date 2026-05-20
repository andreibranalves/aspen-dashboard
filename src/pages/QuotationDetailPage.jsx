import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Pencil, FileText, Trash2, Save, X, Plus, GripVertical, Phone, AlertTriangle, ShoppingCart, Loader2 } from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';
import { formatBRL, formatDate } from '@/lib/formatters.js';
import { buildQuotationViewUrl } from '@/lib/printFormats.js';
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

function makeItemKey() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function QuotationDetailPage({ id, navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('view'); // 'view' | 'edit'
  const [editedItems, setEditedItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [converting, setConverting] = useState(false);
  const [convertStatus, setConvertStatus] = useState('');

  // ── Product autocomplete ──
  const [productSearchTerms, setProductSearchTerms] = useState({}); // { _key: searchText }
  const [productResults, setProductResults] = useState({});          // { _key: [...] }
  const [productSearching, setProductSearching] = useState({});      // { _key: bool }
  const [activeDropdown, setActiveDropdown] = useState(null);        // _key or null
  const productTimer = useRef(null);
  const pricingTimers = useRef({});  // { _key: timeoutId }

  // ── Load ──
  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet(`/quotations?id=${encodeURIComponent(id)}`);
      if (!result || !result.id) throw new Error('Orçamento não encontrado.');
      setData(result);
      setEditedItems((result.items || []).map(item => ({ ...item, _key: makeItemKey() })));
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

  // ── Edit mode helpers (key-based) ──
  const updateItem = useCallback((_key, field, value) => {
    setEditedItems(prev => prev.map(item =>
      item._key === _key ? { ...item, [field]: value, ...(field === 'rate' ? { _rateManual: true } : {}), ...(field === 'item_code' ? { _rateManual: undefined } : {}) } : item
    ));
  }, []);

  const removeItemByKey = useCallback((_key) => {
    setEditedItems(prev => prev.filter(item => item._key !== _key));
    // Clean up product search state for removed item
    setProductSearchTerms(prev => { const n = { ...prev }; delete n[_key]; return n; });
    setProductResults(prev => { const n = { ...prev }; delete n[_key]; return n; });
    setProductSearching(prev => { const n = { ...prev }; delete n[_key]; return n; });
    if (activeDropdown === _key) setActiveDropdown(null);
    delete pricingTimers.current[_key];
  }, [activeDropdown]);

  const addItem = useCallback(() => {
    const _key = makeItemKey();
    setEditedItems(prev => [...prev, { _key, item_code: '', item_name: '', qty: 1, rate: 0, uom: 'und' }]);
    setProductSearchTerms(prev => ({ ...prev, [_key]: '' }));
  }, []);

  // ── Product search (debounced, ref-based) ──
  const searchProducts = useCallback(async (_key, term) => {
    if (!term || term.length < 2) {
      setProductResults(prev => ({ ...prev, [_key]: [] }));
      return;
    }
    setProductSearching(prev => ({ ...prev, [_key]: true }));
    try {
      const res = await apiGet(`/products?search=${encodeURIComponent(term)}&limit=6`);
      setProductResults(prev => ({ ...prev, [_key]: res.data || [] }));
    } catch {
      setProductResults(prev => ({ ...prev, [_key]: [] }));
    } finally {
      setProductSearching(prev => ({ ...prev, [_key]: false }));
    }
  }, []);

  const onSkuChange = useCallback((_key, value) => {
    setProductSearchTerms(prev => ({ ...prev, [_key]: value }));
    updateItem(_key, 'item_code', value);
    clearTimeout(productTimer.current);
    productTimer.current = setTimeout(() => searchProducts(_key, value), 300);
  }, [updateItem, searchProducts]);

  // ── Auto-pricing lookup (ref-based debounce, key-based) ──
  const lookupPrice = useCallback(async (_key, sku, qty) => {
    if (!sku || !qty) return;
    try {
      const result = await apiPost('/pricing-lookup', { items: [{ item_code: sku, qty: Number(qty) }] });
      const priced = result?.items?.[0];
      if (priced?.rate !== undefined && priced?.rate !== null) {
        setEditedItems(prev => prev.map(item => {
          if (item._key !== _key || item._rateManual) return item;
          return { ...item, rate: priced.rate, item_name: priced.item_name || item.item_name };
        }));
      }
    } catch (err) {
      console.warn('[detail] pricing lookup failed:', err.message);
    }
  }, []);

  const schedulePricingLookup = useCallback((_key, sku, qty) => {
    clearTimeout(pricingTimers.current[_key]);
    pricingTimers.current[_key] = setTimeout(() => lookupPrice(_key, sku, qty), 400);
  }, [lookupPrice]);

  const selectProduct = useCallback((_key, product) => {
    if (!product?.sku) return;
    updateItem(_key, 'item_code', product.sku);
    updateItem(_key, 'item_name', product.nome || product.item_name || '');
    setProductSearchTerms(prev => ({ ...prev, [_key]: product.sku }));
    setProductResults(prev => ({ ...prev, [_key]: [] }));
    setActiveDropdown(null);
    // Auto-price after selecting
    setEditedItems(prev => {
      const item = prev.find(it => it._key === _key);
      if (!item) return prev;
      const qty = item.qty || 1;
      schedulePricingLookup(_key, product.sku, qty);
      return prev;
    });
  }, [updateItem, schedulePricingLookup]);

  // ── Save ──
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus('Salvando…');
    try {
      // Strip _key before sending to API
      const payload = { items: editedItems.map(({ _key, ...item }) => item) };
      await apiPut(`/quotations?id=${encodeURIComponent(id)}`, payload);
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
    setEditedItems((data?.items || []).map(item => ({ ...item, _key: makeItemKey() })));
    // Reset autocomplete state
    setProductSearchTerms({});
    setProductResults({});
    setProductSearching({});
    setActiveDropdown(null);
    pricingTimers.current = {};
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

  // ── Create Sales Order ──
  const handleCreateSalesOrder = useCallback(async () => {
    if (!window.confirm(`Gerar e confirmar pedido de venda para o orçamento ${id}?`)) return;
    setConverting(true);
    setConvertStatus('Gerando pedido de venda…');
    try {
      const result = await apiPost('/sales-order-from-quotation', { quotation_id: id });
      setConvertStatus(result.already_exists ? 'Pedido já existia.' : 'Pedido de venda criado e confirmado.');
      await loadDetail(); // refresh to show linked SO
      if (result.sales_order_id) navigate(`/sales-orders/${result.sales_order_id}`);
    } catch (err) {
      setConvertStatus(err.message || 'Erro ao gerar pedido de venda.');
    } finally {
      setConverting(false);
    }
  }, [id, loadDetail, navigate]);

  // ── Drag-and-drop reorder ──
  const handleDragStart = useCallback((e, _key) => {
    e.dataTransfer.setData('text/plain', _key);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e, targetKey) => {
    e.preventDefault();
    const sourceKey = e.dataTransfer.getData('text/plain');
    if (sourceKey === targetKey) return;
    setEditedItems(prev => {
      const sourceIdx = prev.findIndex(it => it._key === sourceKey);
      const targetIdx = prev.findIndex(it => it._key === targetKey);
      if (sourceIdx === -1 || targetIdx === -1) return prev;
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

  const quotationViewUrl = buildQuotationViewUrl(data.id);
  const fullQuotationViewUrl = new URL(quotationViewUrl, window.location.origin).toString();

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
      <div className="bg-card rounded-lg border border-border shadow-sm">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-semibold">{data.id}</span>
            <StatusBadge
              status={data.status}
              label={STATUS_LABELS[data.status] || data.status}
            />
          </div>
          <div className="flex items-center gap-3">
            {data.sales_order_id ? (
              <>
                <span className="text-xs text-muted-foreground">Pedido criado: SAL-ORD-{data.sales_order_id}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/sales-orders/${data.sales_order_id}`)}
                >
                  Abrir Pedido
                </Button>
              </>
            ) : mode === 'view' ? (
              <>
                <Button
                  onClick={handleCreateSalesOrder}
                  disabled={converting}
                  size="sm"
                >
                  <ShoppingCart size={14} />
                  {converting ? 'Gerando pedido de venda…' : 'Gerar Pedido de Venda'}
                </Button>
                {convertStatus && (
                  <span className={`text-xs ${convertStatus.startsWith('Erro') ? 'text-red-400' : 'text-muted-foreground'}`}>
                    {convertStatus}
                  </span>
                )}
              </>
            ) : null}
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
          <div className="w-full overflow-visible">
            <table className="w-full caption-bottom text-sm">
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
              {items.map((item) => {
                const amount = (item.qty || 0) * (item.rate || 0);
                const key = item._key;

                if (mode === 'edit') {
                  const searchTerm = productSearchTerms[key] || '';
                  const results = productResults[key] || [];
                  const searching = productSearching[key] || false;
                  const showDropdown = activeDropdown === key && results.length > 0;

                  return (
                    <TableRow
                      key={key}
                      draggable
                      onDragStart={e => handleDragStart(e, key)}
                      onDragOver={handleDragOver}
                      onDrop={e => handleDrop(e, key)}
                    >
                      {/* Drag handle */}
                      <TableCell className="cursor-grab text-muted-foreground p-2">
                        <GripVertical size={14} />
                      </TableCell>
                      {/* SKU with autocomplete */}
                      <TableCell className="relative">
                        <Input
                          className="h-8 text-sm font-mono"
                          placeholder="Buscar SKU ou nome…"
                          value={searchTerm || item.item_code || ''}
                          onFocus={() => setActiveDropdown(key)}
                          onBlur={() => setTimeout(() => setActiveDropdown(null), 200)}
                          onChange={e => onSkuChange(key, e.target.value)}
                        />
                        {searching && (
                          <div className="absolute right-2 top-2">
                            <Loader2 size={12} className="animate-spin text-muted-foreground" />
                          </div>
                        )}
                        {showDropdown && (
                          <div className="absolute z-50 left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                            {results.map((p) => (
                              <button
                                key={p.sku || p.item_code}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-primary/10 transition-colors flex items-center gap-2"
                                onMouseDown={e => { e.preventDefault(); selectProduct(key, p); }}
                              >
                                <span className="font-mono text-xs text-muted-foreground">{p.sku || p.item_code}</span>
                                <span className="truncate">{p.nome || p.item_name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      {/* Name */}
                      <TableCell>
                        <Input
                          className="h-8 text-sm"
                          placeholder="Nome do produto"
                          value={item.item_name || ''}
                          onChange={e => updateItem(key, 'item_name', e.target.value)}
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
                              updateItem(key, 'qty', val);
                              schedulePricingLookup(key, item.item_code, val);
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
                            if (!isNaN(val)) updateItem(key, 'rate', val);
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
                          onClick={() => removeItemByKey(key)}
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
                  <TableRow key={key}>
                    <TableCell className="font-mono text-sm">{item.item_code}</TableCell>
                    <TableCell>{item.item_name || item.item_code}</TableCell>
                    <TableCell className="text-right">{item.qty}</TableCell>
                    <TableCell className="text-right">{formatBRL(item.rate)}</TableCell>
                    <TableCell className="text-right font-mono">{formatBRL(amount)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            </table>
          </div>
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
                href={quotationViewUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">
                  <FileText size={14} /> Visualizar
                </Button>
              </a>
              <a
                href={`https://wa.me/?text=${encodeURIComponent('Olá ' + (data.cliente || '') + '! Segue orçamento ' + data.id + ':\n' + fullQuotationViewUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm" className="text-framer-success">
                  <Phone size={14} /> WhatsApp
                </Button>
              </a>
              <div className="flex-1" />
              <Button onClick={handleDelete} variant="outline" size="sm" className="text-red-700 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800/40 dark:hover:bg-red-500/10">
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
                <span className={`text-xs ${saveStatus.startsWith('Erro') ? 'text-red-400' : 'text-muted-foreground'}`}>
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
