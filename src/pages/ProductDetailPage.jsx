import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Package, Edit3, Save, X, AlertTriangle, Search, Check } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api.js';
import { formatBRL, formatDate } from '@/lib/formatters.js';
import PageHeader from '@/components/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import SkeletonDetail from '@/components/SkeletonDetail.jsx';
import Skeleton from '@/components/Skeleton.jsx';

const BRACKETS = [30, 100, 300, 500, 1000];

function priceTone(row) {
  if (row?.status === 'missing' || row?.rate == null) {
    return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-800/40';
  }
  return 'bg-framer-success/10 text-framer-success border-framer-success/30';
}

export default function ProductDetailPage({ sku, navigate }) {
  const decodedSku = decodeURIComponent(sku || '');
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [atividades, setAtividades] = useState([]);

  const fetchProduct = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet(`/product-detail?sku=${encodeURIComponent(decodedSku)}`);
      setProduct(result);
    } catch (err) {
      if (err.status === 404) setError('not_found');
      else setError(err.message || 'Erro ao carregar produto.');
    } finally {
      setLoading(false);
    }
  }, [decodedSku]);

  const fetchAtividades = useCallback(async () => {
    try {
      const result = await apiGet(`/product-activity?sku=${encodeURIComponent(decodedSku)}&limit=10`);
      setAtividades(result.atividades || []);
    } catch { /* silencioso */ }
  }, [decodedSku]);

  useEffect(() => { fetchProduct(); }, [fetchProduct]);
  useEffect(() => { fetchAtividades(); }, [fetchAtividades]);

  // ── Start / Cancel editing ──
  const startEditing = () => {
    const { produto, precos = [] } = product || {};
    const rates = {};
    for (const faixa of BRACKETS) {
      const row = precos.find(p => Number(p.faixa) === faixa);
      rates[faixa] = row?.rate != null ? row.rate : '';
    }
    setEdited({
      nome: produto?.nome || '',
      descricao: produto?.descricao || '',
      categoria: produto?.categoria || '',
      unidade: produto?.unidade || '',
      marca: produto?.marca || '',
      ativo: produto?.ativo ?? true,
      rates,
    });
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEdited({});
  };

  const saveProduct = async () => {
    setSaving(true);
    setToast(null);
    try {
      const { produto } = product || {};
      const { nome, descricao, categoria, unidade, marca, ativo, rates } = edited;

      const precos = BRACKETS.map(faixa => {
        const raw = rates[faixa];
        const rate = raw === '' || raw === null || raw === undefined ? null : Number(raw);
        return { faixa, rate };
      }).filter(p => p.rate != null && !Number.isNaN(p.rate));

      const metadata = {};
      if (nome !== produto.nome) metadata.nome = nome;
      if (descricao !== (produto.descricao || '')) metadata.descricao = descricao;
      if (categoria !== (produto.categoria || '')) metadata.categoria = categoria;
      if (unidade !== (produto.unidade || '')) metadata.unidade = unidade;
      if (marca !== (produto.marca || '')) metadata.marca = marca;
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
      setEdited({});
      await fetchProduct();
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

  // ── KPI helpers ──
  const precosArr = product?.precos || [];
  const precosValidos = precosArr.filter(p => p.rate != null).sort((a, b) => a.rate - b.rate);
  const menorPreco = precosValidos[0];
  const maiorPreco = precosValidos[precosValidos.length - 1];
  const economiaPct = maiorPreco?.rate && menorPreco?.rate
    ? Math.round((1 - menorPreco.rate / maiorPreco.rate) * 100)
    : 0;

  // ── Loading / Error states ──
  if (loading) return <SkeletonDetail title="Carregando produto…" />;

  if (error === 'not_found') {
    return (
      <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
        <Search size={40} className="text-muted-foreground/40" />
        <p className="text-lg font-medium">Produto não encontrado</p>
        <p className="text-sm">O SKU &quot;{decodedSku}&quot; não existe no catálogo.</p>
        <Button variant="outline" className="min-h-10" onClick={() => navigate('/products')}>
          <ArrowLeft size={16} className="mr-2" />Voltar para produtos
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
        <AlertTriangle size={40} className="text-destructive" />
        <p className="text-lg font-medium">Erro ao carregar produto</p>
        <p className="text-sm">{error}</p>
        <div className="flex gap-2">
          <Button variant="outline" className="min-h-10" onClick={() => navigate('/products')}><ArrowLeft size={16} className="mr-2" />Voltar</Button>
          <Button variant="outline" className="min-h-10" onClick={fetchProduct}>Tentar novamente</Button>
        </div>
      </div>
    );
  }

  const { produto } = product || {};
  if (!produto) return null;
  const hasImage = produto.imagem && typeof produto.imagem === 'string' && produto.imagem.length > 0;

  return (
    <div className="space-y-5">
      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-in slide-in-from-top-2 ${
          toast.type === 'success'
            ? 'bg-framer-success/10 text-framer-success border border-framer-success/30'
            : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-800/40'
        }`}>
          {toast.type === 'success' ? <Check size={16} className="inline" /> : <X size={16} className="inline" />} {toast.message}
        </div>
      )}

      {/* ── Page Header ── */}
      <PageHeader
        title={editing ? <span className="italic text-muted-foreground">Editando…</span> : (produto.nome || decodedSku)}
        description={editing ? 'Altere os campos abaixo e salve.' : `SKU: ${produto.sku} · ${produto.categoria || 'Sem grupo'} · ${produto.ativo ? 'Ativo' : 'Inativo'}`}
        action={(
          <div className="flex gap-2 flex-wrap">
            {editing ? (
              <>
                <Button onClick={saveProduct} disabled={saving} size="sm" className="min-h-10" aria-label="Salvar produto">
                  {saving ? <><Skeleton className="h-3.5 w-3.5 rounded-full border-2 border-background mr-1.5" />Salvando…</> : <><Save size={14} className="mr-1.5" />Salvar</>}
                </Button>
                <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving} className="min-h-10" aria-label="Cancelar edição">
                  <X size={14} className="mr-1.5" />Cancelar
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" className="min-h-10" aria-label="Editar produto" onClick={startEditing}>
                  <Edit3 size={14} className="mr-1.5" />Editar produto
                </Button>
                <Button variant="outline" className="min-h-10" aria-label="Voltar para produtos" onClick={() => navigate('/products')}>
                  <ArrowLeft size={16} className="mr-2" />Voltar
                </Button>
              </>
            )}
          </div>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── LEFT: Image only ── */}
        <div className="lg:col-span-4">
          <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
            {hasImage ? (
              <img src={produto.imagem} alt={produto.nome} className="w-full h-64 lg:h-80 object-cover"
                onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : (
              <div className="w-full h-64 lg:h-80 flex flex-col items-center justify-center bg-framer-surface-1/40 text-framer-ink-muted gap-2">
                <Package size={48} /><span className="text-sm">Sem imagem</span>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: All content ── */}
        <div className="lg:col-span-8 space-y-5">

          {/* View: Tags + Title + SKU + Short desc */}
          {!editing && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{produto.categoria || 'Sem grupo'}</span>
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{produto.unidade || 'und'}</span>
                {produto.marca && <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{produto.marca}</span>}
              </div>
              <div>
                <h2 className="text-2xl font-bold inline">{produto.nome || decodedSku}</h2>
                <span className="inline-flex items-center gap-2 text-xs ml-3 align-middle">
                  <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-muted-foreground">{produto.sku}</span>
                  <span className={`rounded-md px-2 py-0.5 font-medium ${produto.ativo ? 'bg-framer-success/10 text-framer-success' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'}`}>
                    {produto.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </span>
                {produto.descricao && (
                  <p className="text-sm text-muted-foreground mt-1.5">{produto.descricao}</p>
                )}
              </div>
            </div>
          )}

          {/* Edit: Produto card (sketch-b layout) */}
          {editing && (
            <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-4 relative">
              {/* Toggle Ativo */}
              <label className="absolute top-3 right-3 inline-flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-muted-foreground">Ativo</span>
                <input type="checkbox" checked={edited.ativo} onChange={(e) => setEdited(prev => ({ ...prev, ativo: e.target.checked }))}
                  className="sr-only peer" />
                <div className="w-9 h-5 rounded-full bg-muted peer-checked:bg-framer-success transition-colors"></div>
                <div className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-white shadow peer-checked:-translate-x-4 transition-transform"></div>
              </label>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Produto</h3>

              {/* Row 1: Nome 100% */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Nome</label>
                <Input value={edited.nome} onChange={(e) => setEdited(prev => ({ ...prev, nome: e.target.value }))}
                  className="min-h-10" placeholder="Nome do produto" />
              </div>

              {/* Row 2: Descrição 100% */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Descrição</label>
                <Input value={edited.descricao} onChange={(e) => setEdited(prev => ({ ...prev, descricao: e.target.value }))}
                  className="min-h-10" placeholder="Descrição do produto…" />
              </div>

              {/* Row 3: SKU | Categoria | Unidade */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">SKU</label>
                  <Input value={produto.sku} disabled className="min-h-10 opacity-60 font-mono" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Categoria</label>
                  <Input value={edited.categoria} onChange={(e) => setEdited(prev => ({ ...prev, categoria: e.target.value }))}
                    className="min-h-10" placeholder="Grupo" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Unidade</label>
                  <Input value={edited.unidade} onChange={(e) => setEdited(prev => ({ ...prev, unidade: e.target.value }))}
                    className="min-h-10" placeholder="und" />
                </div>
              </div>

              {/* Row 4: Prazo de produção | Marca */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Prazo de produção (dias)</label>
                  <Input type="number" value={edited.prazo || ''} onChange={(e) => setEdited(prev => ({ ...prev, prazo: e.target.value }))}
                    className="min-h-10" placeholder="dias" min="1" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Marca</label>
                  <Input value={edited.marca} onChange={(e) => setEdited(prev => ({ ...prev, marca: e.target.value }))}
                    className="min-h-10" placeholder="Marca" />
                </div>
              </div>
            </div>
          )}

          {/* ── Pricing Card ── */}
          <div className="bg-card rounded-lg border border-border shadow-sm p-4 md:p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Preços por quantidade</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Base ERPNext: Pricing Rule por faixa. Urgente aplica +30%.</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    {BRACKETS.map((faixa) => (
                      <th key={faixa} className="pb-2 pr-1 font-medium text-center text-xs uppercase tracking-wide">{faixa}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {BRACKETS.map((faixa) => {
                      const row = product.precos?.find(p => Number(p.faixa) === faixa) || { faixa, status: 'missing' };
                      return (
                        <td key={faixa} className="py-3 pr-1 text-center">
                          {editing ? (
                            <Input
                              type="number" step="0.01" min="0"
                              aria-label={`Preço da faixa ${faixa} unidades`}
                              value={edited.rates?.[faixa] ?? ''}
                              onChange={(e) => setEdited(prev => ({ ...prev, rates: { ...prev.rates, [faixa]: e.target.value } }))}
                              className="w-28 text-center inline-block min-h-10" placeholder="0,00"
                            />
                          ) : (
                            <span className={`inline-flex items-center rounded-md border px-2.5 py-1 font-mono text-sm font-medium ${priceTone(row)}`}>
                              {row.rate != null ? formatBRL(row.rate) : '—'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── View: Description Card ── */}
          {!editing && produto.descricao && (
            <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Descrição</h2>
              <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: produto.descricao }} />
            </div>
          )}

          {/* ── KPI Row ── */}
          {!editing && precosValidos.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-card rounded-lg border border-border shadow-sm p-4">
                <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">Menor preço</p>
                <p className="text-2xl font-bold text-framer-success">{menorPreco ? formatBRL(menorPreco.rate) : '—'}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{menorPreco ? `em ${menorPreco.faixa} un.` : '—'}</p>
              </div>
              <div className="bg-card rounded-lg border border-border shadow-sm p-4">
                <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">Maior preço</p>
                <p className="text-2xl font-bold">{maiorPreco ? formatBRL(maiorPreco.rate) : '—'}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{maiorPreco ? `em ${maiorPreco.faixa} un.` : '—'}</p>
              </div>
              <div className="bg-card rounded-lg border border-border shadow-sm p-4">
                <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">Economia max</p>
                <p className="text-2xl font-bold text-framer-accent-blue">{economiaPct}%</p>
                <p className="text-xs text-muted-foreground mt-0.5">1.000 vs 30 un.</p>
              </div>
              <div className="bg-card rounded-lg border border-border shadow-sm p-4">
                <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">Urgente (+30%)</p>
                <p className="text-2xl font-bold text-framer-warning">{menorPreco ? formatBRL(menorPreco.rate * 1.3) : '—'}</p>
                <p className="text-xs text-muted-foreground mt-0.5">menor preço urgente</p>
              </div>
            </div>
          )}

          {/* ── Atividade recente ── */}
          {!editing && atividades.length > 0 && (
            <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Atividade recente</h2>
              <div className="space-y-2 text-sm">
                {atividades.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      a.tipo === 'orcamento' ? 'bg-framer-accent-blue/10 text-framer-accent-blue' :
                      a.tipo === 'preco' ? 'bg-framer-success/10 text-framer-success' :
                      'bg-yellow-50 text-yellow-600 dark:bg-yellow-500/10 dark:text-yellow-400'
                    }`}>
                      {a.tipo === 'orcamento' ? 'O' : a.tipo === 'preco' ? '$' : 'E'}
                    </span>
                    <span className="flex-1 text-muted-foreground">{a.texto}</span>
                    <span className="text-xs text-muted-foreground">{a.data}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Footer ── */}
          {produto.modificado_em && !editing && (
            <p className="text-xs text-muted-foreground text-center">Última modificação: {formatDate(produto.modificado_em)}</p>
          )}
        </div>
      </div>
    </div>
  );
}
