import { useState, useEffect, useCallback, useMemo } from 'react';
import { Package, Edit3, Save, X, AlertTriangle, Search, Check } from 'lucide-react';
import { apiGet, apiPut, apiPost } from '@/lib/api.js';
import { formatBRL, formatDate } from '@/lib/formatters.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { useSetTopBarActions } from '@/components/layout/Layout.jsx';
import SkeletonDetail from '@/components/SkeletonDetail.jsx';
import Skeleton from '@/components/Skeleton.jsx';

const BRACKETS = [30, 100, 300, 500, 1000];

function formatPct(v) {
  return Math.round(v) + '%';
}

function buildEmptyProduct() {
  return {
    produto: {
      sku: '',
      nome: '',
      descricao: '',
      categoria: '',
      unidade: 'Und',
      ativo: true,
      imagem: null,
      modificado_em: null,
    },
    precos: [],
  };
}

function buildEmptyRates() {
  return Object.fromEntries(BRACKETS.map(faixa => [faixa, '']));
}

export default function ProductDetailPage({ sku, navigate }) {
  const decodedSku = decodeURIComponent(sku || '');
  const isNewProduct = decodedSku === 'new';
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [atividades, setAtividades] = useState([]);
  const setTopBarActions = useSetTopBarActions();

  const fetchProduct = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isNewProduct) {
        setProduct(buildEmptyProduct());
        setAtividades([]);
        setEdited({
          sku: '',
          nome: '',
          descricao: '',
          categoria: '',
          unidade: 'Und',
          custo: '',
          ativo: true,
          prazo: '',
          rates: buildEmptyRates(),
        });
        setEditing(true);
        setLoading(false);
        return;
      }

      const result = await apiGet(`/product-detail?sku=${encodeURIComponent(decodedSku)}`);
      setProduct(result);
    } catch (err) {
      if (err.status === 404) setError('not_found');
      else setError(err.message || 'Erro ao carregar produto.');
    } finally {
      setLoading(false);
    }
  }, [decodedSku, isNewProduct]);

  const fetchAtividades = useCallback(async () => {
    if (isNewProduct) return;
    try {
      const result = await apiGet(`/product-activity?sku=${encodeURIComponent(decodedSku)}&limit=10`);
      setAtividades(result.atividades || []);
    } catch { /* silencioso */ }
  }, [decodedSku, isNewProduct]);

  useEffect(() => { fetchProduct(); }, [fetchProduct]);
  useEffect(() => { fetchAtividades(); }, [fetchAtividades]);

  // ── KPI memoized values ──
  const custo = useMemo(() => {
    const val = parseFloat(edited.custo);
    return !isNaN(val) && val > 0 ? val : 0;
  }, [edited.custo]);

  const precosRates = useMemo(() => {
    if (!product?.precos) return [];
    return BRACKETS.map(faixa => {
      const row = product.precos.find(p => Number(p.faixa) === faixa);
      const rate = editing
        ? (() => { const r = parseFloat(edited.rates?.[faixa]); return !isNaN(r) && r > 0 ? r : null; })()
        : (row?.rate != null ? row.rate : null);
      return { faixa, rate };
    });
  }, [product, edited.rates, editing]);

  const kpis = useMemo(() => {
    const valid = precosRates.filter(p => p.rate != null);
    if (valid.length === 0 || custo <= 0) return null;

    const withMargin = valid.map(p => {
      const margin = ((p.rate - custo) / p.rate) * 100;
      const totalProfit = (p.rate - custo) * p.faixa;
      return { ...p, margin, totalProfit };
    });

    const avgMargin = withMargin.reduce((s, p) => s + p.margin, 0) / withMargin.length;
    const avgMarginReais = withMargin.reduce((s, p) => s + (p.rate - custo), 0) / withMargin.length;
    const bestProfit = withMargin.reduce((a, b) => a.totalProfit > b.totalProfit ? a : b);

    return { avgMargin, avgMarginReais, bestProfit, withMargin };
  }, [precosRates, custo]);

  // ── Start / Cancel editing ──
  const startEditing = () => {
    const { produto, precos = [] } = product || {};
    const rates = {};
    for (const faixa of BRACKETS) {
      const row = precos.find(p => Number(p.faixa) === faixa);
      rates[faixa] = row?.rate != null ? row.rate : '';
    }
    setEdited({
      sku: produto?.sku || '',
      nome: produto?.nome || '',
      descricao: produto?.descricao || '',
      categoria: produto?.categoria || '',
      unidade: produto?.unidade || '',
      custo: edited.custo || '',
      ativo: produto?.ativo ?? true,
      prazo: edited.prazo || '',
      rates,
    });
    setEditing(true);
  };

  const cancelEditing = () => {
    if (isNewProduct) {
      navigate('/products');
      return;
    }

    setEditing(false);
    // Keep custo/prazo across cancel so KPIs don't disappear
    setEdited(prev => ({ custo: prev.custo, prazo: prev.prazo, rates: {} }));
  };

  const saveProduct = async () => {
    setSaving(true);
    setToast(null);
    try {
      const { produto } = product || {};
      const { sku: editedSku, nome, descricao, categoria, unidade, ativo, rates = {} } = edited;
      const normalizedSku = (editedSku || '').trim();
      const normalizedNome = (nome || '').trim();

      if (isNewProduct && !normalizedSku) {
        setToast({ type: 'error', message: 'SKU é obrigatório.' });
        return;
      }
      if (!normalizedNome) {
        setToast({ type: 'error', message: 'Nome do produto é obrigatório.' });
        return;
      }

      const precos = BRACKETS.map(faixa => {
        const raw = rates[faixa];
        const rate = raw === '' || raw === null || raw === undefined ? null : Number(raw);
        return { faixa, rate };
      }).filter(p => p.rate != null && !Number.isNaN(p.rate));

      if (isNewProduct) {
        await apiPost('/products', {
          sku: normalizedSku,
          nome: normalizedNome,
          categoria: categoria?.trim() || undefined,
          unidade: unidade?.trim() || 'Und',
        });

        const extraBody = {};
        if ((descricao || '').trim()) extraBody.descricao = descricao;
        if (ativo !== true) extraBody.ativo = ativo;
        if (precos.length > 0) extraBody.precos = precos;
        if (Object.keys(extraBody).length > 0) {
          await apiPut(`/product-update?sku=${encodeURIComponent(normalizedSku)}`, extraBody);
        }

        setToast({ type: 'success', message: 'Produto criado com sucesso!' });
        navigate(`/products/${encodeURIComponent(normalizedSku)}`);
        return;
      }

      const metadata = {};
      if (nome !== produto.nome) metadata.nome = nome;
      if (descricao !== (produto.descricao || '')) metadata.descricao = descricao;
      if (categoria !== (produto.categoria || '')) metadata.categoria = categoria;
      if (unidade !== (produto.unidade || '')) metadata.unidade = unidade;
      if (ativo !== produto.ativo) metadata.ativo = ativo;

      const body = {};
      if (Object.keys(metadata).length > 0) Object.assign(body, metadata);
      if (precos.length > 0) body.precos = precos;

      if (Object.keys(body).length === 0) {
        setToast({ type: 'error', message: 'Nenhuma alteração para salvar.' });
        return;
      }

      const result = await apiPut(`/product-update?sku=${encodeURIComponent(decodedSku)}`, body);
      if (!result.success) {
        setToast({ type: 'error', message: 'Erro ao salvar produto.' });
        return;
      }

      setToast({ type: 'success', message: 'Produto atualizado com sucesso!' });
      setEditing(false);
      await fetchProduct();
      // Preserve custo after save
      setEdited(prev => ({ custo: prev.custo, prazo: prev.prazo, rates: {} }));
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Erro ao salvar produto.' });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!setTopBarActions) return undefined;

    if (loading || error || !product?.produto) {
      setTopBarActions(null);
      return () => setTopBarActions(null);
    }

    setTopBarActions(
      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <Button onClick={saveProduct} disabled={saving} size="sm" aria-label={isNewProduct ? 'Criar produto' : 'Salvar produto'}>
              {saving ? (
                <>
                  <Skeleton className="h-3.5 w-3.5 rounded-full border-2 border-background" />
                  {isNewProduct ? 'Criando…' : 'Salvando…'}
                </>
              ) : (
                <>
                  <Save size={14} />
                  {isNewProduct ? 'Criar Produto' : 'Salvar'}
                </>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving} aria-label="Cancelar edição">
              <X size={14} />
              Cancelar
            </Button>
          </>
        ) : (
          <Button size="sm" aria-label="Editar produto" onClick={startEditing}>
            <Edit3 size={14} />
            Editar produto
          </Button>
        )}
      </div>
    );

    return () => setTopBarActions(null);
  }, [decodedSku, edited, error, isNewProduct, loading, product, saving, setTopBarActions, editing]);

  // ── Loading / Error states ──
  if (loading) return <SkeletonDetail />;

  if (error === 'not_found') {
    return (
      <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
        <Search size={40} className="text-fg-muted/40" />
        <p className="text-lg font-medium">Produto não encontrado</p>
        <p className="text-sm">O SKU &quot;{decodedSku}&quot; não existe no catálogo.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
        <AlertTriangle size={40} className="text-destructive" />
        <p className="text-lg font-medium">Erro ao carregar produto</p>
        <p className="text-sm">{error}</p>
        <Button variant="outline" className="min-h-10" onClick={fetchProduct}>Tentar novamente</Button>
      </div>
    );
  }

  const { produto } = product || {};
  if (!produto) return null;
  const hasImage = produto.imagem && typeof produto.imagem === 'string' && produto.imagem.length > 0;

  // ── Bar width helper: reduction % relative to 30 un. ──
  const baseRate = precosRates.find(p => p.faixa === 30)?.rate || null;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-in slide-in-from-top-2 ${
          toast.type === 'success'
            ? 'bg-success/10 text-success border border-success/30'
            : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-800/40'
        }`}>
          {toast.type === 'success' ? <Check size={16} className="inline" /> : <X size={16} className="inline" />} {toast.message}
        </div>
      )}

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* ── LEFT: Image only ── */}
        <div className="lg:col-span-4">
          <div className="bg-surface rounded-2xl border border-line shadow-sm overflow-hidden">
            {hasImage ? (
              <div className="aspect-square">
                <img src={produto.imagem} alt={produto.nome} className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              </div>
            ) : (
              <div className="aspect-square bg-gradient-to-br from-surface to-surface-muted flex flex-col items-center justify-center text-fg-muted gap-2">
                <Package size={48} className="text-fg-muted/30" />
                <span className="text-xs text-fg-muted">Imagem</span>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: All content + edit fields ── */}
        <div className="lg:col-span-8 space-y-5">

          {/* View: Tags + Title + SKU + Badge + Short desc */}
          {!editing && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">{produto.categoria || 'Sem grupo'}</span>
                <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">{produto.unidade || 'und'}</span>
              </div>
              <div>
                <h2 className="text-2xl font-bold inline">{produto.nome || decodedSku}</h2>
                <div className="inline-flex items-center gap-2 text-xs ml-3 align-middle">
                  <span className="rounded-md bg-surface-muted px-2 py-0.5 font-mono text-fg-muted">{produto.sku}</span>
                  <span className={`rounded-md px-2 py-0.5 font-medium ${produto.ativo ? 'bg-success/10 text-success' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'}`}>
                    {produto.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                {produto.descricao && (
                  <p className="text-sm text-fg-muted mt-1.5">{produto.descricao}</p>
                )}
              </div>
            </div>
          )}

          {/* Edit: Produto card */}
          {editing && (
            <div className="bg-surface rounded-2xl border border-line shadow-sm p-5 space-y-4 relative">
              {/* Toggle Ativo */}
              <label className="absolute top-3 right-3 inline-flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-fg-muted">Ativo</span>
                <div className="relative">
                  <input type="checkbox" checked={edited.ativo} onChange={(e) => setEdited(prev => ({ ...prev, ativo: e.target.checked }))}
                    className="sr-only peer" />
                  <div className="w-9 h-5 rounded-full bg-surface-muted peer-checked:bg-success transition-colors"></div>
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow peer-checked:translate-x-4 transition-transform"></div>
                </div>
              </label>
              <h3 className="text-sm font-bold text-fg-muted uppercase tracking-widest">{isNewProduct ? 'Novo Produto' : 'Produto'}</h3>

              {/* Row 1: Nome 100% */}
              <div>
                <label className="text-xs font-medium text-fg-muted">Nome</label>
                <Input value={edited.nome} onChange={(e) => setEdited(prev => ({ ...prev, nome: e.target.value }))}
                  className="min-h-10" placeholder="Nome do produto" />
              </div>

              {/* Row 2: Descrição 100% */}
              <div>
                <label className="text-xs font-medium text-fg-muted">Descrição</label>
                <Input value={edited.descricao} onChange={(e) => setEdited(prev => ({ ...prev, descricao: e.target.value }))}
                  className="min-h-10" placeholder="Descrição do produto…" />
              </div>

              {/* Row 3: SKU | Categoria | Unidade */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-fg-muted">SKU</label>
                  <Input
                    value={isNewProduct ? edited.sku : produto.sku}
                    disabled={!isNewProduct}
                    onChange={(e) => setEdited(prev => ({ ...prev, sku: e.target.value }))}
                    className={`min-h-10 font-mono ${isNewProduct ? '' : 'opacity-60'}`}
                    placeholder="LNC-SED-70"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-fg-muted">Categoria</label>
                  <Input value={edited.categoria} onChange={(e) => setEdited(prev => ({ ...prev, categoria: e.target.value }))}
                    className="min-h-10" placeholder="Grupo" />
                </div>
                <div>
                  <label className="text-xs font-medium text-fg-muted">Unidade</label>
                  <Input value={edited.unidade} onChange={(e) => setEdited(prev => ({ ...prev, unidade: e.target.value }))}
                    className="min-h-10" placeholder="und" />
                </div>
              </div>

              {/* Row 4: Prazo de produção | Custo unitário */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-fg-muted">Prazo de produção (dias)</label>
                  <Input type="number" value={edited.prazo || ''} onChange={(e) => setEdited(prev => ({ ...prev, prazo: e.target.value }))}
                    className="min-h-10" placeholder="dias" min="1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-fg-muted">Custo unitário (R$)</label>
                  <Input type="number" step="0.01" min="0" value={edited.custo || ''}
                    onChange={(e) => setEdited(prev => ({ ...prev, custo: e.target.value }))}
                    className="min-h-10" placeholder="0,00" />
                </div>
              </div>
            </div>
          )}

          {/* ── PRICING ── */}
          <div className="bg-surface rounded-2xl border border-line shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-bold text-fg-muted uppercase tracking-widest">Preços por quantidade</h3>

            {/* View: horizontal cards */}
            {!editing && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
                {BRACKETS.map((faixa) => {
                  const row = precosRates.find(p => p.faixa === faixa);
                  const rate = row?.rate;
                  const barWidth = rate && baseRate ? (rate / baseRate) * 100 : 100;
                  const isStar = faixa === 1000;
                  const marginData = kpis?.withMargin?.find(m => m.faixa === faixa);

                  return (
                    <div key={faixa} className="text-center">
                      <div className={`rounded-xl p-3 border ${isStar ? 'bg-primary/5 border-primary/20 ring-1 ring-primary/10' : 'bg-surface border-surface-muted'}`}>
                        <p className={`text-[10px] font-semibold mb-1 ${isStar ? 'text-primary font-bold' : 'text-fg-muted'}`}>
                          {faixa.toLocaleString('pt-BR')} un.
                        </p>
                        <div className={`w-full h-2 rounded-full mb-2 ${isStar ? 'bg-primary/10' : 'bg-surface-muted'}`}>
                          <div className={`h-full rounded-full ${isStar ? 'bg-primary' : 'bg-fg-muted/30'}`} style={{ width: `${barWidth}%` }}></div>
                        </div>
                        <p className={`font-mono text-sm font-bold ${isStar ? 'text-fg font-extrabold' : 'text-fg'}`}>
                          {rate != null ? formatBRL(rate) : '—'}
                        </p>
                        {custo > 0 && marginData && marginData.margin > 0 && (
                          <p className={`text-[10px] font-medium mt-0.5 ${
                            marginData.margin > 50 ? 'text-success' : marginData.margin > 30 ? 'text-warning' : 'text-destructive'
                          }`}>
                            margem {formatPct(marginData.margin)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Edit: price inputs */}
            {editing && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
                {BRACKETS.map((faixa) => {
                  const isStar = faixa === 1000;
                  return (
                    <div key={faixa} className="text-center">
                      <p className={`text-[10px] font-semibold mb-1.5 ${isStar ? 'text-primary font-bold' : 'text-fg-muted'}`}>
                        {faixa.toLocaleString('pt-BR')} un.
                      </p>
                      <Input
                        type="number" step="0.01" min="0"
                        aria-label={`Preço da faixa ${faixa} unidades`}
                        value={edited.rates?.[faixa] ?? ''}
                        onChange={(e) => setEdited(prev => ({ ...prev, rates: { ...prev.rates, [faixa]: e.target.value } }))}
                        className={`w-full text-center min-h-10 font-mono font-semibold ${isStar ? 'border-primary/20 bg-primary/5 font-bold' : ''}`}
                        placeholder="0,00"
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-fg-muted text-center">Barras = redução % em relação a 30 un. Urgente: +30%.</p>
          </div>

          {/* ── KPI Summary Row ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-surface rounded-xl border border-line shadow-sm p-4">
              <p className="text-xs text-fg-muted uppercase font-semibold tracking-wide mb-1">Custo Unitário</p>
              <p className="text-2xl font-bold text-fg">{custo > 0 ? formatBRL(custo) : '—'}</p>
              <p className="text-xs text-fg-muted mt-0.5">base para cálculos</p>
            </div>
            <div className="bg-surface rounded-xl border border-line shadow-sm p-4">
              <p className="text-xs text-fg-muted uppercase font-semibold tracking-wide mb-1">Margem Média (%)</p>
              <p className="text-2xl font-bold text-success">{kpis ? formatPct(kpis.avgMargin) : '—'}</p>
              <p className="text-xs text-fg-muted mt-0.5">média entre faixas</p>
            </div>
            <div className="bg-surface rounded-xl border border-line shadow-sm p-4">
              <p className="text-xs text-fg-muted uppercase font-semibold tracking-wide mb-1">Margem Média (R$)</p>
              <p className="text-2xl font-bold text-primary">{kpis ? formatBRL(kpis.avgMarginReais) : '—'}</p>
              <p className="text-xs text-fg-muted mt-0.5">{kpis ? 'média entre faixas' : custo > 0 ? 'adicione preços' : 'defina o custo'}</p>
            </div>
            <div className="bg-surface rounded-xl border border-line shadow-sm p-4">
              <p className="text-xs text-fg-muted uppercase font-semibold tracking-wide mb-1">Lucro Total Máximo</p>
              <p className="text-2xl font-bold text-success">{kpis ? formatBRL(kpis.bestProfit.totalProfit) : '—'}</p>
              <p className="text-xs text-fg-muted mt-0.5">{kpis ? `${kpis.bestProfit.faixa.toLocaleString('pt-BR')} un.` : custo > 0 ? 'adicione preços' : 'defina o custo'}</p>
            </div>
          </div>

          {/* ── Atividade recente ── */}
          {!editing && atividades.length > 0 && (
            <div className="bg-surface rounded-2xl border border-line shadow-sm p-5 space-y-3">
              <h3 className="text-sm font-bold text-fg-muted uppercase tracking-widest">Atividade recente</h3>
              <div className="space-y-2 text-sm">
                {atividades.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-line last:border-0">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      a.tipo === 'orcamento' ? 'bg-primary/10 text-primary' :
                      a.tipo === 'preco' ? 'bg-success/10 text-success' :
                      'bg-yellow-50 text-yellow-600 dark:bg-yellow-500/10 dark:text-yellow-400'
                    }`}>
                      {a.tipo === 'orcamento' ? 'O' : a.tipo === 'preco' ? '$' : 'E'}
                    </span>
                    <span className="flex-1 text-fg-muted">{a.texto}</span>
                    <span className="text-xs text-fg-muted">{a.data}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Footer ── */}
          {!editing && (
            <p className="text-xs text-fg-muted text-center">
              {produto.modificado_em ? `Atualizado em ${formatDate(produto.modificado_em)}` : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
