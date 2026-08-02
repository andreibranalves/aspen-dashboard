import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
} from 'react';
import { Pencil, FileText, Trash2, Save, X, Plus, GripVertical, Phone, AlertTriangle, ShoppingCart, Loader2, Copy } from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { isCoreUnpricedProduct, searchProducts } from '@/lib/productCache';
import type { Product } from '@/types/domain';
import { formatBRL, formatDate } from '@/lib/formatters';
import { buildQuotationViewUrl } from '@/lib/printFormats';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import {
  TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import SkeletonDetail from '@/components/SkeletonDetail';

const STATUS_LABELS: Record<string, string> = {
  Draft: 'Rascunho',
  Open: 'Aberto',
  Replied: 'Respondido',
  Ordered: 'Convertido',
  Lost: 'Perdido',
  Expired: 'Expirado',
  Cancelled: 'Cancelado',
};

interface QuotationItem {
  _key: string;
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  _rateManual?: boolean;
}

interface QuotationData {
  id: string;
  status: string;
  cliente?: string;
  data?: string;
  validade?: string;
  sales_order_id?: string;
  items?: QuotationItem[];
}

interface QuotationDetailPageProps {
  id: string;
  navigate: (path: string) => void;
}

function makeItemKey(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function QuotationDetailPage({ id, navigate }: QuotationDetailPageProps) {
  const [data, setData] = useState<QuotationData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view'); // 'view' | 'edit'
  const [editedItems, setEditedItems] = useState<QuotationItem[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [converting, setConverting] = useState<boolean>(false);
  const [convertStatus, setConvertStatus] = useState<string>('');

  // ── Product autocomplete ──
  const [productSearchTerms, setProductSearchTerms] = useState<Record<string, string>>({}); // { _key: searchText }
  const [productResults, setProductResults] = useState<Record<string, Product[]>>({});          // { _key: [...] }
  const [productSearching, setProductSearching] = useState<Record<string, boolean>>({});      // { _key: bool }
  const [activeField, setActiveField] = useState<{ key: string; field: 'sku' | 'name' } | null>(null); // { key, field } or null
  const productTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pricingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});  // { _key: timeoutId }

  // ── Load ──
  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<QuotationData>(`/quotations?id=${encodeURIComponent(id)}`);
      if (!result || !result.id) throw new Error('Orçamento não encontrado.');
      setData(result);
      setEditedItems((result.items || []).map(item => ({ ...item, _key: makeItemKey() })));
      setMode('view');
    } catch (err) {
      console.error('[detail]', err);
      setError((err instanceof Error ? err.message : null) || 'Erro ao carregar orçamento.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  // ── Computed ──
  const items = mode === 'edit' ? editedItems : (data?.items || []);
  const total = items.reduce((s, item) => s + (item.qty || 0) * (item.rate || 0), 0);

  // ── Edit mode helpers (key-based) ──
  const updateItem = useCallback((_key: string, field: keyof QuotationItem, value: unknown) => {
    setEditedItems(prev => prev.map(item =>
      item._key === _key ? { ...item, [field]: value, ...(field === 'rate' ? { _rateManual: true } : {}), ...(field === 'item_code' ? { _rateManual: undefined } : {}) } : item
    ));
  }, []);

  const removeItemByKey = useCallback((_key: string) => {
    setEditedItems(prev => prev.filter(item => item._key !== _key));
    // Clean up product search state for removed item
    setProductSearchTerms(prev => { const n = { ...prev }; delete n[_key]; return n; });
    setProductResults(prev => { const n = { ...prev }; delete n[_key]; return n; });
    setProductSearching(prev => { const n = { ...prev }; delete n[_key]; return n; });
    if (activeField?.key === _key) setActiveField(null);
    delete pricingTimers.current[_key];
  }, [activeField]);

  const addItem = useCallback(() => {
    const _key = makeItemKey();
    setEditedItems(prev => [...prev, { _key, item_code: '', item_name: '', qty: 1, rate: 0 }]);
    setProductSearchTerms(prev => ({ ...prev, [_key]: '' }));
  }, []);

  // ── Product search (debounced, ref-based) ──
  const fetchProductOptions = useCallback(async (_key: string, term: string) => {
    if (!term || term.length < 2) {
      setProductResults(prev => ({ ...prev, [_key]: [] }));
      return;
    }
    setProductSearching(prev => ({ ...prev, [_key]: true }));
    try {
      const result = await searchProducts(term, 6);
      setProductResults(prev => ({ ...prev, [_key]: result }));
    } catch {
      setProductResults(prev => ({ ...prev, [_key]: [] }));
    } finally {
      setProductSearching(prev => ({ ...prev, [_key]: false }));
    }
  }, []);

  const onSkuChange = useCallback((_key: string, value: string) => {
    setProductSearchTerms(prev => ({ ...prev, [_key]: value }));
    updateItem(_key, 'item_code', value);
    if (productTimer.current) clearTimeout(productTimer.current);
    productTimer.current = setTimeout(() => fetchProductOptions(_key, value), 300);
  }, [updateItem, fetchProductOptions]);

  const onNameChange = useCallback((_key: string, value: string) => {
    updateItem(_key, 'item_name', value);
    if (productTimer.current) clearTimeout(productTimer.current);
    productTimer.current = setTimeout(() => fetchProductOptions(_key, value), 300);
  }, [updateItem, fetchProductOptions]);

  // ── Auto-pricing lookup (ref-based debounce, key-based) ──
  interface PricingLookupResponse {
    items?: Array<{
      rate?: number;
      item_name?: string;
    }>;
  }

  const lookupPrice = useCallback(async (_key: string, sku: string, qty: number) => {
    if (!sku || !qty) return;
    try {
      const result = await apiPost<PricingLookupResponse>('/pricing-lookup', { items: [{ item_code: sku, qty: Number(qty) }] });
      const priced = result?.items?.[0];
      if (priced?.rate !== undefined && priced?.rate !== null) {
        setEditedItems(prev => prev.map(item => {
          if (item._key !== _key || item._rateManual) return item;
          return { ...item, rate: priced.rate ?? item.rate, item_name: priced.item_name || item.item_name };
        }));
      }
    } catch (err) {
      console.warn('[detail] pricing lookup failed:', err instanceof Error ? err.message : err);
    }
  }, []);

  const schedulePricingLookup = useCallback((_key: string, sku: string, qty: number) => {
    if (pricingTimers.current[_key]) clearTimeout(pricingTimers.current[_key]);
    pricingTimers.current[_key] = setTimeout(() => lookupPrice(_key, sku, qty), 400);
  }, [lookupPrice]);

  const selectProduct = useCallback((_key: string, product: Product) => {
    if (!product?.sku) return;
    if (isCoreUnpricedProduct(product)) {
      setSaveStatus('Preço indisponível para este produto.');
      setProductResults(prev => ({ ...prev, [_key]: [] }));
      setActiveField(null);
      return;
    }
    updateItem(_key, 'item_code', product.sku);
    updateItem(_key, 'item_name', product.nome || product.item_name || '');
    setProductSearchTerms(prev => ({ ...prev, [_key]: product.sku }));
    setProductResults(prev => ({ ...prev, [_key]: [] }));
    setActiveField(null);
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
  interface SavePayload {
    items: Array<Omit<QuotationItem, '_key'>>;
  }

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus('Salvando…');
    try {
      // Strip _key before sending to API
      const payload: SavePayload = { items: editedItems.map(({ _key, ...item }) => item) };
      await apiPut(`/quotations?id=${encodeURIComponent(id)}`, payload);
      setSaveStatus('Salvo!');
      setTimeout(() => setSaveStatus(''), 2000);
      // Reload
      await loadDetail();
    } catch (err) {
      setSaveStatus('Erro ao salvar: ' + (err instanceof Error ? err.message : 'Tente novamente.'));
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
    setActiveField(null);
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
      alert('Erro ao excluir: ' + (err instanceof Error ? err.message : 'Tente novamente.'));
    }
  }, [id, navigate]);

  // ── Create Sales Order ──
  interface SalesOrderResponse {
    already_exists?: boolean;
    sales_order_id?: string;
  }

  const handleCreateSalesOrder = useCallback(async () => {
    if (!window.confirm(`Gerar e confirmar pedido de venda para o orçamento ${id}?`)) return;
    setConverting(true);
    setConvertStatus('Gerando pedido de venda…');
    try {
      const result = await apiPost<SalesOrderResponse>('/sales-order-from-quotation', { quotation_id: id });
      setConvertStatus(result.already_exists ? 'Pedido já existia.' : 'Pedido de venda criado e confirmado.');
      await loadDetail(); // refresh to show linked SO
      if (result.sales_order_id) navigate(`/sales-orders/${result.sales_order_id}`);
    } catch (err) {
      setConvertStatus(err instanceof Error ? err.message : 'Erro ao gerar pedido de venda.');
    } finally {
      setConverting(false);
    }
  }, [id, loadDetail, navigate]);

  // ── Duplicate ──
  const [duplicating, setDuplicating] = useState<boolean>(false);

  interface DuplicateResponse {
    success?: boolean;
    new_id?: string;
  }

  const handleDuplicate = useCallback(async () => {
    if (!confirm(`Duplicar o orçamento ${id}? Será criada uma cópia com nova numeração.`)) return;
    setDuplicating(true);
    try {
      const result = await apiPost<DuplicateResponse>('/duplicate-quotation', { quotation_id: id });
      if (result.success && result.new_id) {
        navigate(`/quotations/${result.new_id}`);
      }
    } catch (err) {
      alert('Erro ao duplicar: ' + (err instanceof Error ? err.message : 'Tente novamente.'));
    } finally {
      setDuplicating(false);
    }
  }, [id, navigate]);

  // ── Drag-and-drop reorder ──
  const handleDragStart = useCallback((e: DragEvent<HTMLTableCellElement>, _key: string) => {
    e.dataTransfer.setData('text/plain', _key);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLTableRowElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLTableRowElement>, targetKey: string) => {
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
    return <SkeletonDetail />;
  }

  if (error) {
    return (
      <div className="space-y-4 animate-fade-in">
        <button onClick={() => navigate('/quotations')} className="text-sm text-primary hover:underline">
          ← Voltar para Orçamentos
        </button>
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <AlertTriangle size={32} className="text-destructive/60" />
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
    <div className="space-y-4 max-w-[1060px] mx-auto">
      {/* Detail card */}
      <div className="bg-surface rounded-lg border border-line shadow-sm">
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
                <span className="text-xs text-fg-muted">Pedido criado: SAL-ORD-{data.sales_order_id}</span>
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
                  <span className={`text-xs ${convertStatus.startsWith('Erro') ? 'text-destructive/60' : 'text-fg-muted'}`}>
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
            <span className="text-xs text-fg-muted">Cliente</span>
            <p className="font-medium">{data.cliente || '—'}</p>
          </div>
          <div>
            <span className="text-xs text-fg-muted">Data</span>
            <p>{formatDate(data.data)}</p>
          </div>
          <div>
            <span className="text-xs text-fg-muted">Validade</span>
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
                <TableHead className="text-center w-20">Qtd</TableHead>
                <TableHead className="text-center">
                  {mode === 'edit' ? 'Preço Unit.' : 'Preço Unit.'}
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
                  const showDropdown = activeField?.key === key && results.length > 0;
                  const searchSpinner = searching && (
                    <div className="absolute right-2 top-2">
                      <Loader2 size={12} className="animate-spin text-fg-muted" />
                    </div>
                  );
                  const productDropdown = showDropdown && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-surface border border-line rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {results.map((p) => (
                        <button
                          key={p.sku || p.item_code}
                          type="button"
                          disabled={isCoreUnpricedProduct(p)}
                          title={isCoreUnpricedProduct(p) ? 'Preço indisponível para este produto.' : undefined}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-primary/10 transition-colors flex items-center gap-2"
                          onMouseDown={(e: MouseEvent<HTMLButtonElement>) => { e.preventDefault(); selectProduct(key, p); }}
                        >
                          <span className="font-mono text-xs text-fg-muted">{p.sku || p.item_code}</span>
                          <span className="truncate">{p.nome || p.item_name}</span>
                          {isCoreUnpricedProduct(p) && (
                            <span className="ml-auto shrink-0 text-[10px] text-destructive">Preço indisponível</span>
                          )}
                        </button>
                      ))}
                    </div>
                  );

                  return (
                    <TableRow
                      key={key}
                      onDragOver={handleDragOver}
                      onDrop={(e: DragEvent<HTMLTableRowElement>) => handleDrop(e, key)}
                    >
                      {/* Drag handle — only the grip icon is draggable, not the whole row */}
                      <TableCell
                        className="cursor-grab text-fg-muted p-2"
                        draggable
                        onDragStart={(e: DragEvent<HTMLTableCellElement>) => handleDragStart(e, key)}
                      >
                        <GripVertical size={14} />
                      </TableCell>
                      {/* SKU with autocomplete */}
                      <TableCell className="relative">
                        <Input
                          className="h-8 text-sm font-mono"
                          placeholder="Buscar SKU ou nome…"
                          value={searchTerm || item.item_code || ''}
                          onFocus={() => setActiveField({ key, field: 'sku' })}
                          onBlur={() => setTimeout(() => setActiveField(null), 200)}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => onSkuChange(key, e.target.value)}
                        />
                        {searchSpinner}
                        {activeField?.field === 'sku' && productDropdown}
                      </TableCell>
                      {/* Name with autocomplete */}
                      <TableCell className="relative">
                        <Input
                          className="h-8 text-sm"
                          placeholder="Buscar produto…"
                          value={item.item_name || ''}
                          onFocus={() => setActiveField({ key, field: 'name' })}
                          onBlur={() => setTimeout(() => setActiveField(null), 200)}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => onNameChange(key, e.target.value)}
                        />
                        {activeField?.field === 'name' && productDropdown}
                      </TableCell>
                      {/* Qty */}
                      <TableCell className="text-center">
                        <Input
                          type="number"
                          min="1"
                          className="h-8 w-20 text-sm mx-auto"
                          value={item.qty || ''}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => {
                            const val = Number(e.target.value);
                            if (!isNaN(val)) {
                              updateItem(key, 'qty', val);
                              schedulePricingLookup(key, item.item_code, val);
                            }
                          }}
                        />
                      </TableCell>
                      {/* Rate */}
                      <TableCell className="text-center">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          className="h-8 w-28 text-sm mx-auto"
                          value={item.rate || ''}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => {
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
                          className="text-fg-muted hover:text-destructive transition-colors"
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
                    <TableCell className="text-center">{item.qty}</TableCell>
                    <TableCell className="text-center">{formatBRL(item.rate)}</TableCell>
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
              <Button onClick={handleDuplicate} variant="outline" size="sm" disabled={duplicating}>
                <Copy size={14} /> {duplicating ? 'Duplicando…' : 'Duplicar'}
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
                <Button variant="outline" size="sm" className="text-success">
                  <Phone size={14} /> WhatsApp
                </Button>
              </a>
              <div className="flex-1" />
              <Button onClick={handleDelete} variant="outline" size="sm" className="text-red-700 border-red-200 hover:bg-destructive/10 dark:text-destructive/60 dark:border-red-800/40 dark:hover:bg-destructive/100/10">
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
                <Plus size={14} /> Item
              </Button>
              {saveStatus && (
                <span className={`text-xs ${saveStatus.startsWith('Erro') ? 'text-destructive/60' : 'text-fg-muted'}`}>
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
