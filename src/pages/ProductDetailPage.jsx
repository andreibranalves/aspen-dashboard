import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Package, Edit3, Save, X, AlertTriangle } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api.js';
import { formatBRL, formatDate } from '@/lib/formatters.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';

const BRACKETS = [30, 100, 300, 500, 1000];

export default function ProductDetailPage({ sku, navigate }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editedRates, setEditedRates] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success'|'error', message }

  // ── Fetch product detail ──
  const fetchProduct = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet(`/products/${encodeURIComponent(sku)}?sku=${encodeURIComponent(sku)}`);
      setProduct(result);
    } catch (err) {
      if (err.status === 404) {
        setError('not_found');
      } else {
        setError(err.message || 'Erro ao carregar produto.');
      }
    } finally {
      setLoading(false);
    }
  }, [sku]);

  useEffect(() => { fetchProduct(); }, [fetchProduct]);

  // ── Edit mode ──
  const startEditing = () => {
    if (!product?.precos) return;
    const rates = {};
    for (const p of product.precos) {
      rates[p.faixa] = p.rate != null ? p.rate : '';
    }
    setEditedRates(rates);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditedRates({});
  };

  const handleRateChange = (faixa, value) => {
    setEditedRates(prev => ({ ...prev, [faixa]: value }));
  };

  const saveRates = async () => {
    setSaving(true);
    setToast(null);
    try {
      const precos = BRACKETS.map(faixa => {
        const raw = editedRates[faixa];
        const rate = raw === '' || raw === null || raw === undefined ? null : Number(raw);
        return { faixa, rate: Number.isNaN(rate) ? null : rate };
      }).filter(p => p.rate != null);

      if (precos.length === 0) {
        setToast({ type: 'error', message: 'Nenhum preço válido para salvar.' });
        setSaving(false);
        return;
      }

      const result = await apiPut(`/products/${encodeURIComponent(sku)}/pricing`, { precos });

      if (result.success) {
        setToast({ type: 'success', message: `${result.atualizados} preço(s) atualizado(s) com sucesso!` });
        setEditing(false);
        setEditedRates({});
        // Recarrega os dados para refletir as mudanças
        await fetchProduct();
      } else {
        const msg = result.resultados
          ?.filter(r => r.status === 'erro')
          .map(r => `Faixa ${r.faixa}: ${r.error || 'erro'}`)
          .join('; ') || 'Erro ao salvar.';
        setToast({ type: 'error', message: msg });
      }
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Erro ao salvar preços.' });
    } finally {
      setSaving(false);
    }
  };

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        Carregando produto…
      </div>
    );
  }

  // ── 404 / not found ──
  if (error === 'not_found') {
    return (
      <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
        <span className="text-4xl">🔍</span>
        <p className="text-lg font-medium">Produto não encontrado</p>
        <p className="text-sm">O SKU &quot;{sku}&quot; não existe no catálogo.</p>
        <Button variant="outline" onClick={() => navigate('/products')}>
          <ArrowLeft size={16} className="mr-2" />
          Voltar para produtos
        </Button>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
        <AlertTriangle size={40} className="text-destructive" />
        <p className="text-lg font-medium">Erro ao carregar produto</p>
        <p className="text-sm">{error}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/products')}>
            <ArrowLeft size={16} className="mr-2" />
            Voltar
          </Button>
          <Button variant="outline" onClick={fetchProduct}>Tentar novamente</Button>
        </div>
      </div>
    );
  }

  const { produto, precos } = product || {};
  if (!produto) return null;

  const hasImage = produto.imagem && typeof produto.imagem === 'string' && produto.imagem.length > 0;

  // ── Render ──
  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-in slide-in-from-top-2 ${
          toast.type === 'success'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {toast.type === 'success' ? '✅' : '❌'} {toast.message}
        </div>
      )}

      {/* Breadcrumb */}
      <button
        onClick={() => navigate('/products')}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={16} />
        Voltar para produtos
      </button>

      {/* Main content: desktop 2-col, mobile stacked */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── Left column: Product image ── */}
        <div className="lg:col-span-4">
          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            {hasImage ? (
              <img
                src={produto.imagem}
                alt={produto.nome}
                className="w-full h-64 lg:h-80 object-cover"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            ) : (
              <div className="w-full h-64 lg:h-80 flex flex-col items-center justify-center bg-muted/20 text-muted-foreground gap-2">
                <Package size={48} />
                <span className="text-sm">Sem imagem</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: Metadata + Pricing + Description ── */}
        <div className="lg:col-span-8 space-y-5">
          {/* Metadata */}
          <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
            <div>
              <h2 className="text-xl font-semibold">{produto.nome}</h2>
              <p className="text-sm text-muted-foreground font-mono mt-0.5">SKU: {produto.sku}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {produto.categoria && (
                <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{produto.categoria}</span>
              )}
              {produto.unidade && (
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{produto.unidade}</span>
              )}
              {produto.marca && (
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{produto.marca}</span>
              )}
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${produto.ativo ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {produto.ativo ? 'Ativo' : 'Inativo'}
              </span>
            </div>
          </div>

          {/* ── Pricing Table ── */}
          <div className="bg-white rounded-lg border shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Preços por faixa</h3>
              {!editing && (
                <Button variant="outline" size="sm" onClick={startEditing}>
                  <Edit3 size={14} className="mr-1.5" />
                  Editar preços
                </Button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Faixa</th>
                    <th className="pb-2 pr-4 font-medium">Qtd. mínima</th>
                    <th className="pb-2 font-medium text-right">Preço unitário</th>
                  </tr>
                </thead>
                <tbody>
                  {(editing ? BRACKETS : (precos || [])).map((item) => {
                    const faixa = editing ? item : item.faixa;
                    const rate = editing ? editedRates[faixa] : item.rate;
                    return (
                      <tr key={faixa} className="border-b last:border-0">
                        <td className="py-2.5 pr-4 font-medium">{faixa} un.</td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{faixa}</td>
                        <td className="py-2.5 text-right">
                          {editing ? (
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={rate ?? ''}
                              onChange={(e) => handleRateChange(faixa, e.target.value)}
                              className="w-28 text-right inline-block"
                              placeholder="0,00"
                            />
                          ) : (
                            <span className={rate != null ? 'font-mono' : 'text-muted-foreground italic'}>
                              {rate != null ? formatBRL(rate) : '—'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Edit mode actions */}
            {editing && (
              <div className="flex gap-2 pt-2">
                <Button onClick={saveRates} disabled={saving} size="sm">
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-background border-t-transparent mr-1.5" />
                      Salvando…
                    </>
                  ) : (
                    <>
                      <Save size={14} className="mr-1.5" />
                      Salvar
                    </>
                  )}
                </Button>
                <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving}>
                  <X size={14} className="mr-1.5" />
                  Cancelar
                </Button>
              </div>
            )}
          </div>

          {/* ── Description ── */}
          {produto.descricao && (
            <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
              <h3 className="text-lg font-semibold">Descrição</h3>
              <div
                className="prose prose-sm max-w-none text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: produto.descricao }}
              />
            </div>
          )}

          {/* Footer */}
          {produto.modificado_em && (
            <p className="text-xs text-muted-foreground">
              Última modificação: {formatDate(produto.modificado_em)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
