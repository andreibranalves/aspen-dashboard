import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, Plus, Trash2, UserPlus, Check, Loader2, ExternalLink, MessageCircle } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api.js';
import { formatBRL, fmtPhone, capitalize } from '@/lib/formatters.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import PageHeader from '@/components/PageHeader.jsx';

// ── Types ──
const CLIENT_TYPE = { EXISTING: 'existing', NEW: 'new' };

export default function ManualOrcamentoPage() {
  // ── Client state ──
  const [clientType, setClientType] = useState(CLIENT_TYPE.EXISTING);
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [newClient, setNewClient] = useState({ nome: '', email: '', telefone: '' });
  const clientTimer = useRef(null);

  // ── Product state ──
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [productSearching, setProductSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [productQty, setProductQty] = useState(100);
  const [productRate, setProductRate] = useState(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const productTimer = useRef(null);

  // ── Cart state ──
  const [items, setItems] = useState([]); // { sku, nome, qty, rate, _key }

  // ── Form state ──
  const [prazo, setPrazo] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [urgente, setUrgente] = useState(false);

  // ── Submit state ──
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // ── Client search ──
  const searchClients = useCallback(async (term) => {
    if (!term || term.length < 2) { setClientResults([]); return; }
    setClientSearching(true);
    try {
      const res = await apiGet(`/leads-clients?search=${encodeURIComponent(term)}&limit=10&tipo=todos`);
      setClientResults(res.data || []);
    } catch {
      setClientResults([]);
    } finally {
      setClientSearching(false);
    }
  }, []);

  const onClientSearchChange = useCallback((e) => {
    const val = e.target.value;
    setClientSearch(val);
    setSelectedClient(null);
    clearTimeout(clientTimer.current);
    clientTimer.current = setTimeout(() => searchClients(val), 300);
  }, [searchClients]);

  const selectClient = useCallback((c) => {
    setSelectedClient(c);
    setClientSearch(`${c.nome} (${c.email || c.telefone || c.id})`);
    setClientResults([]);
    setClientType(CLIENT_TYPE.EXISTING);
  }, []);

  // ── Product search ──
  const searchProducts = useCallback(async (term) => {
    if (!term || term.length < 2) { setProductResults([]); return; }
    setProductSearching(true);
    try {
      const res = await apiGet(`/products?search=${encodeURIComponent(term)}&limit=8`);
      setProductResults(res.data || []);
    } catch {
      setProductResults([]);
    } finally {
      setProductSearching(false);
    }
  }, []);

  const onProductSearchChange = useCallback((e) => {
    const val = e.target.value;
    setProductSearch(val);
    setSelectedProduct(null);
    setProductRate(null);
    clearTimeout(productTimer.current);
    productTimer.current = setTimeout(() => searchProducts(val), 300);
  }, [searchProducts]);

  const selectProduct = useCallback(async (p) => {
    setSelectedProduct(p);
    setProductSearch(`${p.sku} — ${p.nome}`);
    setProductResults([]);
    setProductRate(null);
    // Fetch pricing on select
    if (productQty > 0) {
      setPricingLoading(true);
      try {
        const res = await apiPost('/pricing-lookup', {
          items: [{ item_code: p.sku, qty: productQty }],
          urgent: urgente,
        });
        const item = res.items?.[0];
        if (item?.rate != null) setProductRate(item.rate);
        else setProductRate(0);
      } catch {
        setProductRate(0);
      } finally {
        setPricingLoading(false);
      }
    }
  }, [productQty, urgente]);

  // Re-fetch pricing when qty changes for selected product
  const onProductQtyChange = useCallback(async (e) => {
    const qty = Number(e.target.value) || 0;
    setProductQty(qty);
    if (selectedProduct && qty > 0) {
      setPricingLoading(true);
      try {
        const res = await apiPost('/pricing-lookup', {
          items: [{ item_code: selectedProduct.sku, qty }],
          urgent: urgente,
        });
        const item = res.items?.[0];
        setProductRate(item?.rate != null ? item.rate : 0);
      } catch {
        setProductRate(0);
      } finally {
        setPricingLoading(false);
      }
    }
  }, [selectedProduct, urgente]);

  // ── Cart operations ──
  const addToCart = useCallback(() => {
    if (!selectedProduct || productQty <= 0) return;
    setItems(prev => [
      ...prev,
      {
        _key: `${selectedProduct.sku}-${Date.now()}`,
        sku: selectedProduct.sku,
        nome: selectedProduct.nome,
        qty: productQty,
        rate: productRate || 0,
      },
    ]);
    // Reset product selection
    setSelectedProduct(null);
    setProductSearch('');
    setProductRate(null);
    setProductQty(100);
  }, [selectedProduct, productQty, productRate]);

  const updateItemQty = useCallback(async (_key, newQty) => {
    const qty = Number(newQty) || 1;
    setItems(prev => prev.map(it => it._key === _key ? { ...it, qty } : it));
    // Re-fetch pricing for this item
    const item = items.find(it => it._key === _key);
    if (!item) return;
    try {
      const res = await apiPost('/pricing-lookup', {
        items: [{ item_code: item.sku, qty }],
        urgent: urgente,
      });
      const priced = res.items?.[0];
      if (priced?.rate != null) {
        setItems(prev => prev.map(it => it._key === _key ? { ...it, rate: priced.rate } : it));
      }
    } catch { /* keep current rate */ }
  }, [items, urgente]);

  const removeItem = useCallback((_key) => {
    setItems(prev => prev.filter(it => it._key !== _key));
  }, []);

  // ── Computed ──
  const subtotal = items.reduce((sum, it) => sum + it.qty * it.rate, 0);

  // ── Get active client info ──
  const getClientInfo = useCallback(() => {
    if (clientType === CLIENT_TYPE.EXISTING && selectedClient) {
      return {
        nome: selectedClient.nome,
        email: selectedClient.email || '',
        telefone: selectedClient.telefone || '',
      };
    }
    return {
      nome: newClient.nome.trim(),
      email: newClient.email.trim(),
      telefone: newClient.telefone.trim(),
    };
  }, [clientType, selectedClient, newClient]);

  // ── Submit ──
  const handleSubmit = useCallback(async () => {
    const { nome, email, telefone } = getClientInfo();
    if (!nome) { alert('Informe o nome do cliente.'); return; }
    if (items.length === 0) { alert('Adicione ao menos um produto.'); return; }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const payload = {
        extracted: {
          nome,
          email: email || undefined,
          telefone: telefone || undefined,
          urgente,
          items: items.map(it => ({
            item_code: it.sku,
            qty: it.qty,
            rate: it.rate,
            manual_rate: true, // Preço já calculado, não buscar de novo
          })),
          prazo_producao: prazo || undefined,
          ...(observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
        },
      };

      const res = await apiPost('/orcamento', payload);
      setResult(res);
    } catch (err) {
      setError(err.message || 'Erro ao criar orçamento.');
    } finally {
      setSubmitting(false);
    }
  }, [getClientInfo, items, urgente, prazo, observacoes]);

  // ── WhatsApp link builder ──
  const buildWaLink = useCallback((telefone, nome, quotationId) => {
    if (!telefone) return null;
    const digits = telefone.replace(/\D/g, '').replace(/^55(\d{10,11})$/, '$1');
    if (digits.length < 10) return null;
    const text = `Olá, ${nome}! Segue seu orçamento ${quotationId}. Qualquer dúvida estamos à disposição. — Aspen Estamparia`;
    return `https://wa.me/55${digits}?text=${encodeURIComponent(text)}`;
  }, []);

  // ── Reset all ──
  const resetForm = useCallback(() => {
    setItems([]);
    setResult(null);
    setError(null);
    setPrazo('');
    setObservacoes('');
    setUrgente(false);
    setSelectedClient(null);
    setClientSearch('');
    setNewClient({ nome: '', email: '', telefone: '' });
    setClientType(CLIENT_TYPE.EXISTING);
    setSelectedProduct(null);
    setProductSearch('');
    setProductQty(100);
    setProductRate(null);
  }, []);

  // ── Render ──
  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Novo Orçamento Manual"
        description="Monte seu orçamento selecionando cliente e produtos do catálogo."
      />

      {/* ══ Success Result ══ */}
      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center">
              <Check size={18} className="text-white" />
            </div>
            <div>
              <p className="font-medium text-emerald-800">Orçamento criado com sucesso!</p>
              <p className="text-sm text-emerald-700">
                {capitalize(result.cliente)} · {result.quotation_id}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {result.pdf_url && (
              <a
                href={result.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-emerald-300 rounded text-sm text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <ExternalLink size={14} /> Visualizar PDF
              </a>
            )}
            {result.short_url && (
              <a
                href={result.short_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-emerald-300 rounded text-sm text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <ExternalLink size={14} /> Link do Orçamento
              </a>
            )}
            {(() => {
              const info = getClientInfo();
              const waLink = buildWaLink(info.telefone, result.cliente, result.quotation_id);
              return waLink ? (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 transition-colors"
                >
                  <MessageCircle size={14} /> WhatsApp
                </a>
              ) : null;
            })()}
          </div>

          <Button variant="outline" size="sm" onClick={resetForm}>
            Novo Orçamento
          </Button>
        </div>
      )}

      {/* ══ Error ══ */}
      {error && !result && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <span className="text-red-500 text-lg shrink-0">⚠</span>
          <div>
            <p className="font-medium text-red-800">Erro ao criar orçamento</p>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {!result && (
        <>
          {/* ══ 1. Cliente ══ */}
          <section aria-label="Seleção de cliente" className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
            <h2 className="text-base font-semibold text-gray-700 flex items-center gap-2">
              <UserPlus size={18} /> 1. Cliente
            </h2>

            {/* Toggle existing/new */}
            <div className="flex gap-1 bg-muted rounded-lg p-0.5 w-fit">
              <button
                onClick={() => { setClientType(CLIENT_TYPE.EXISTING); setNewClient({ nome: '', email: '', telefone: '' }); }}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  clientType === CLIENT_TYPE.EXISTING ? 'bg-white shadow-sm font-medium' : 'text-muted-foreground',
                )}
                aria-label="Buscar cliente existente"
              >
                Buscar existente
              </button>
              <button
                onClick={() => { setClientType(CLIENT_TYPE.NEW); setSelectedClient(null); setClientSearch(''); }}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  clientType === CLIENT_TYPE.NEW ? 'bg-white shadow-sm font-medium' : 'text-muted-foreground',
                )}
                aria-label="Cadastrar novo cliente"
              >
                Novo cliente
              </button>
            </div>

            {clientType === CLIENT_TYPE.EXISTING ? (
              <div className="space-y-2">
                <div className="relative max-w-md">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nome, email ou telefone…"
                    value={clientSearch}
                    onChange={onClientSearchChange}
                    className="pl-9"
                    aria-label="Buscar cliente"
                  />
                  {clientSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 size={14} className="animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* Search results */}
                {clientResults.length > 0 && (
                  <div className="border rounded-lg divide-y max-h-60 overflow-y-auto">
                    {clientResults.map(c => (
                      <button
                        key={c.id}
                        onClick={() => selectClient(c)}
                        className={cn(
                          'w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex items-center justify-between',
                          selectedClient?.id === c.id && 'bg-primary/5 border-l-2 border-primary',
                        )}
                        aria-label={`Selecionar ${c.nome}`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{c.nome || c.id}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {[c.email, c.telefone ? fmtPhone(c.telefone) : '', c.tipo === 'lead' ? 'Lead' : 'Cliente']
                              .filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ml-2',
                          c.tipo === 'lead' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700',
                        )}>
                          {c.tipo === 'lead' ? 'Lead' : 'Cliente'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Nome *</label>
                  <Input
                    placeholder="Nome completo"
                    value={newClient.nome}
                    onChange={e => setNewClient(prev => ({ ...prev, nome: e.target.value }))}
                    aria-label="Nome do cliente"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Email</label>
                  <Input
                    type="email"
                    placeholder="email@exemplo.com"
                    value={newClient.email}
                    onChange={e => setNewClient(prev => ({ ...prev, email: e.target.value }))}
                    aria-label="Email do cliente"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Telefone</label>
                  <Input
                    placeholder="(11) 99999-9999"
                    value={newClient.telefone}
                    onChange={e => setNewClient(prev => ({ ...prev, telefone: e.target.value }))}
                    aria-label="Telefone do cliente"
                  />
                </div>
              </div>
            )}

            {/* Selected client indicator */}
            {selectedClient && clientType === CLIENT_TYPE.EXISTING && (
              <div className="flex items-center gap-2 text-sm bg-blue-50 text-blue-700 rounded px-3 py-1.5">
                <Check size={14} />
                <span className="font-medium">{selectedClient.nome}</span>
                {selectedClient.email && <span className="text-blue-500">· {selectedClient.email}</span>}
                {selectedClient.telefone && <span className="text-blue-500">· {fmtPhone(selectedClient.telefone)}</span>}
              </div>
            )}
          </section>

          {/* ══ 2. Produtos ══ */}
          <section aria-label="Adição de produtos" className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
            <h2 className="text-base font-semibold text-gray-700 flex items-center gap-2">
              <Plus size={18} /> 2. Produtos
            </h2>

            <div className="space-y-3">
              {/* Search bar */}
              <div className="relative max-w-md">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por SKU ou nome do produto…"
                  value={productSearch}
                  onChange={onProductSearchChange}
                  className="pl-9"
                  aria-label="Buscar produto"
                />
                {productSearching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 size={14} className="animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Product results */}
              {productResults.length > 0 && (
                <div className="border rounded-lg divide-y max-h-60 overflow-y-auto">
                  {productResults.map(p => (
                    <button
                      key={p.sku}
                      onClick={() => selectProduct(p)}
                      className={cn(
                        'w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors',
                        selectedProduct?.sku === p.sku && 'bg-primary/5 border-l-2 border-primary',
                      )}
                      aria-label={`Selecionar ${p.sku} ${p.nome}`}
                    >
                      <p className="text-sm font-medium">
                        <span className="font-mono text-primary">{p.sku}</span> — {p.nome}
                      </p>
                      {p.categoria && (
                        <p className="text-xs text-muted-foreground">{p.categoria}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Selected product card */}
              {selectedProduct && (
                <div className="border rounded-lg p-3 bg-muted/20 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-primary">{selectedProduct.sku}</span>
                    <span className="text-sm text-gray-600">{selectedProduct.nome}</span>
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">Quantidade</label>
                      <Input
                        type="number"
                        min="1"
                        className="w-24"
                        value={productQty || ''}
                        onChange={onProductQtyChange}
                        aria-label="Quantidade do produto"
                      />
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <label className="text-xs text-muted-foreground block mb-0.5">Preço unitário</label>
                      <div className="flex items-center gap-2">
                        {pricingLoading ? (
                          <span className="text-sm text-muted-foreground flex items-center gap-1">
                            <Loader2 size={12} className="animate-spin" /> Calculando…
                          </span>
                        ) : productRate != null ? (
                          <span className="text-sm font-medium">{formatBRL(productRate)}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                        {productRate != null && productQty > 0 && (
                          <span className="text-xs text-muted-foreground">
                            Total: <span className="font-medium">{formatBRL(productRate * productQty)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      onClick={addToCart}
                      disabled={!selectedProduct || productQty <= 0 || pricingLoading}
                      size="sm"
                      className="min-h-[40px] min-w-[40px]"
                      aria-label="Adicionar produto ao orçamento"
                    >
                      <Plus size={14} className="mr-1" /> Adicionar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ══ 3. Resumo ══ */}
          {items.length > 0 && (
            <section aria-label="Resumo do orçamento" className="bg-white rounded-lg border shadow-sm p-4 space-y-4">
              <h2 className="text-base font-semibold text-gray-700">
                3. Resumo ({items.length} {items.length === 1 ? 'item' : 'itens'})
              </h2>

              {/* Items table — desktop */}
              <div className="hidden md:block overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">SKU</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Produto</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Qtd</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Unitário</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((it) => (
                      <tr key={it._key} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono text-xs">{it.sku}</td>
                        <td className="px-3 py-2 truncate max-w-[200px]">{it.nome}</td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min="1"
                            className="h-7 text-xs w-20 ml-auto"
                            value={it.qty}
                            onChange={e => updateItemQty(it._key, Number(e.target.value))}
                            aria-label={`Quantidade de ${it.sku}`}
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{formatBRL(it.rate)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatBRL(it.qty * it.rate)}</td>
                        <td className="px-1 py-2 text-center">
                          <button
                            onClick={() => removeItem(it._key)}
                            className="text-muted-foreground hover:text-red-600 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
                            aria-label={`Remover ${it.sku}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Items — mobile cards */}
              <div className="md:hidden space-y-2">
                {items.map((it) => (
                  <div key={it._key} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-mono text-xs text-primary">{it.sku}</span>
                        <p className="text-sm font-medium">{it.nome}</p>
                      </div>
                      <button
                        onClick={() => removeItem(it._key)}
                        className="text-muted-foreground hover:text-red-600 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
                        aria-label={`Remover ${it.sku}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">Qtd:</span>
                        <Input
                          type="number"
                          min="1"
                          className="h-7 text-xs w-20"
                          value={it.qty}
                          onChange={e => updateItemQty(it._key, Number(e.target.value))}
                          aria-label={`Quantidade de ${it.sku}`}
                        />
                      </div>
                      <span className="text-muted-foreground">× {formatBRL(it.rate)}</span>
                      <span className="font-medium ml-auto">{formatBRL(it.qty * it.rate)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Subtotal */}
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-sm font-medium text-gray-600">Subtotal</span>
                <span className="text-lg font-bold">{formatBRL(subtotal)}</span>
              </div>

              {/* Prazo + Urgente + Observações */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Prazo de produção (dias)
                  </label>
                  <Input
                    placeholder="Ex: 10 a 15 dias"
                    value={prazo}
                    onChange={e => setPrazo(e.target.value)}
                    aria-label="Prazo de produção"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer min-h-[40px]">
                    <input
                      type="checkbox"
                      checked={urgente}
                      onChange={e => setUrgente(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Pedido urgente (+30%)</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Observações</label>
                <textarea
                  className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                  placeholder="Observações adicionais…"
                  value={observacoes}
                  onChange={e => setObservacoes(e.target.value)}
                  aria-label="Observações do orçamento"
                />
              </div>

              {/* Submit */}
              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || items.length === 0}
                  className="min-h-[44px] min-w-[200px]"
                  aria-label="Criar orçamento"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin mr-2" />
                      Criando…
                    </>
                  ) : (
                    'Criar Orçamento'
                  )}
                </Button>
                <Button variant="outline" onClick={resetForm} disabled={submitting}>
                  Limpar
                </Button>
              </div>
            </section>
          )}

          {/* Empty cart hint */}
          {items.length === 0 && (
            <div className="flex flex-col items-center py-12 text-muted-foreground gap-3">
              <span className="text-3xl">🛒</span>
              <p>Nenhum produto adicionado ainda.</p>
              <p className="text-sm">Busque por SKU ou nome e selecione produtos para montar o orçamento.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
