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

  useEffect(() => { fetchProduct(); }, [fetchProduct]);

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

  // ── Save ──
  const saveProduct = async () => {
    setSaving(true);
    setToast(null);
    try {
      const { produto } = product || {};
      const { nome, descricao, categoria, unidade, marca, ativo, rates } = edited;

      // Build pricing array
      const precos = BRACKETS.map(faixa => {
        const raw = rates[faixa];
        const rate = raw === '' || raw === null || raw === undefined ? null : Number(raw);
        return { faixa, rate };
      }).filter(p => p.rate != null && !Number.isNaN(p.rate));

      // Build metadata payload — only send changed fields
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

  const { produto, precos = [] } = product || {};
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
        description={editing
          ? 'Altere os campos abaixo e salve.'
          : `SKU: ${produto.sku} · ${produto.categoria || 'Sem grupo'} · ${produto.ativo ? 'Ativo' : 'Inativo'}`
        }
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
        {/* ── Sidebar: Image ── */}
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

        {/* ── Main content ── */}
        <div className="lg:col-span-8 space-y-5">

          {/* ── Info Card ── */}
          <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-3">
            {editing ? (
              /* ── Edit: Info Fields ── */
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Nome</label>
                  <Input value={edited.nome} onChange={(e) => setEdited(prev => ({ ...prev, nome: e.target.value }))}
                    className="min-h-10" placeholder="Nome do produto" />
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
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Marca</label>
                  <Input value={edited.marca} onChange={(e) => setEdited(prev => ({ ...prev, marca: e.target.value }))}
                    className="min-h-10" placeholder="Marca" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <select value={edited.ativo ? '1' : '0'}
                    onChange={(e) => setEdited(prev => ({ ...prev, ativo: e.target.value === '1' }))}
                    className="w-full min-h-10 rounded-md border border-input bg-transparent px-3 py-2 text-sm">
                    <option value="1">Ativo</option>
                    <option value="0">Inativo</option>
                  </select>
                </div>
              </div>
            ) : (
              /* ── View: Info Badges ── */
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{produto.categoria || 'Sem grupo'}</span>
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{produto.unidade || 'und'}</span>
                {produto.marca && <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{produto.marca}</span>}
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${produto.ativo ? 'bg-framer-success/10 text-framer-success' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'}`}>
                  {produto.ativo ? 'Ativo' : 'Inativo'}
                </span>
              </div>
            )}
          </div>

          {/* ── Pricing Card ── */}
          <div className="bg-card rounded-lg border border-border shadow-sm p-4 md:p-5 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Tabela de preços por quantidade</h2>
              <p className="text-xs text-muted-foreground">Base ERPNext: Pricing Rule por faixa → Pricing Rule do SKU → Item Price Standard Selling. Urgente aplica +30%.</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    {BRACKETS.map((faixa) => (
                      <th key={faixa} className="pb-2 pr-1 font-medium text-center">{faixa}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {BRACKETS.map((faixa) => {
                      const row = precos.find(p => Number(p.faixa) === faixa) || { faixa, status: 'missing' };
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
                            <span className={`inline-flex items-center rounded-md border px-2 py-1 font-mono ${priceTone(row)}`}>
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

          {/* ── Description Card ── */}
          {(editing || produto.descricao) && (
            <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-3">
              <h2 className="text-lg font-semibold">Descrição</h2>
              {editing ? (
                <textarea
                  value={edited.descricao}
                  onChange={(e) => setEdited(prev => ({ ...prev, descricao: e.target.value }))}
                  className="w-full min-h-[120px] rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-y"
                  placeholder="Descrição do produto…"
                />
              ) : (
                <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: produto.descricao }} />
              )}
            </div>
          )}

          {/* ── Footer ── */}
          {produto.modificado_em && (
            <p className="text-xs text-muted-foreground">Última modificação: {formatDate(produto.modificado_em)}</p>
          )}
        </div>
      </div>
    </div>
  );
}
