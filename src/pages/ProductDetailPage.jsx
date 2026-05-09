import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Package, Edit3, Save, X, AlertTriangle } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api.js';
import { formatBRL, formatDate } from '@/lib/formatters.js';
import PageHeader from '@/components/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import SkeletonDetail from '@/components/SkeletonDetail.jsx';
import Skeleton from '@/components/Skeleton.jsx';

const BRACKETS = [30, 100, 300, 500, 1000];

function priceTone(row) {
  if (row?.status === 'missing' || row?.rate == null) {
    return 'bg-red-50 text-red-800 border-red-200';
  }
  return 'bg-green-50 text-green-800 border-green-200';
}

function urgentTone(row) {
  if (row?.status === 'missing' || row?.urgent_rate == null) {
    return 'bg-red-50 text-red-800 border-red-200';
  }
  return 'bg-amber-50 text-amber-900 border-amber-200';
}

function sourceBadgeClass(origem) {
  if (origem === 'pricing_rule_bracket') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (origem === 'pricing_rule_sku') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (origem === 'item_price') return 'bg-slate-50 text-slate-700 border-slate-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

function SourceBadge({ row }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceBadgeClass(row?.origem)}`}
      title={row?.rule_title || row?.rule_name || row?.item_price_name || row?.price_list || row?.origem_label}
    >
      {row?.origem_label || 'Não encontrado'}
    </span>
  );
}

export default function ProductDetailPage({ sku, navigate }) {
  const decodedSku = decodeURIComponent(sku || '');
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editedRates, setEditedRates] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const fetchProduct = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet(`/products/${encodeURIComponent(decodedSku)}?sku=${encodeURIComponent(decodedSku)}`);
      setProduct(result);
    } catch (err) {
      if (err.status === 404) setError('not_found');
      else setError(err.message || 'Erro ao carregar produto.');
    } finally {
      setLoading(false);
    }
  }, [decodedSku]);

  useEffect(() => { fetchProduct(); }, [fetchProduct]);

  const startEditing = () => {
    const rates = {};
    for (const faixa of BRACKETS) {
      const row = product?.precos?.find(p => Number(p.faixa) === faixa);
      rates[faixa] = row?.rate != null ? row.rate : '';
    }
    setEditedRates(rates);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditedRates({});
  };

  const saveRates = async () => {
    setSaving(true);
    setToast(null);
    try {
      const precos = BRACKETS.map(faixa => {
        const raw = editedRates[faixa];
        const rate = raw === '' || raw === null || raw === undefined ? null : Number(raw);
        return { faixa, rate };
      }).filter(p => p.rate != null && !Number.isNaN(p.rate));

      if (precos.length === 0) {
        setToast({ type: 'error', message: 'Nenhum preço válido para salvar.' });
        return;
      }

      const result = await apiPost(`/product-pricing?sku=${encodeURIComponent(decodedSku)}`, { precos });
      if (!result.success) {
        const msg = result.resultados
          ?.filter(r => r.status === 'erro')
          .map(r => `Faixa ${r.faixa}: ${r.error || 'erro'}`)
          .join('; ') || 'Erro ao salvar.';
        setToast({ type: 'error', message: msg });
        return;
      }

      setToast({ type: 'success', message: `${result.atualizados} preço(s) atualizado(s) com sucesso!` });
      setEditing(false);
      setEditedRates({});
      await fetchProduct();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Erro ao salvar preços.' });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (loading) {
    return <SkeletonDetail title="Carregando produto…" />;
  }

  if (error === 'not_found') {
    return (
      <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
        <span className="text-4xl">🔍</span>
        <p className="text-lg font-medium">Produto não encontrado</p>
        <p className="text-sm">O SKU &quot;{decodedSku}&quot; não existe no catálogo.</p>
        <Button variant="outline" className="min-h-10" onClick={() => navigate('/products')}>
          <ArrowLeft size={16} className="mr-2" />
          Voltar para produtos
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
          <Button variant="outline" className="min-h-10" onClick={() => navigate('/products')}>
            <ArrowLeft size={16} className="mr-2" />
            Voltar
          </Button>
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
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-in slide-in-from-top-2 ${
          toast.type === 'success'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {toast.type === 'success' ? '✅' : '❌'} {toast.message}
        </div>
      )}

      <PageHeader
        title={produto.nome || decodedSku}
        description={`SKU: ${produto.sku} · ${produto.categoria || 'Sem grupo'} · ${produto.ativo ? 'Ativo' : 'Inativo'}`}
        action={(
          <Button variant="outline" className="min-h-10" aria-label="Voltar para produtos" onClick={() => navigate('/products')}>
            <ArrowLeft size={16} className="mr-2" />
            Voltar
          </Button>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4">
          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            {hasImage ? (
              <img
                src={produto.imagem}
                alt={produto.nome}
                className="w-full h-64 lg:h-80 object-cover"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <div className="w-full h-64 lg:h-80 flex flex-col items-center justify-center bg-muted/20 text-muted-foreground gap-2">
                <Package size={48} />
                <span className="text-sm">Sem imagem</span>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-5">
          <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{produto.categoria || 'Sem grupo'}</span>
              <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{produto.unidade || 'und'}</span>
              {produto.marca && <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{produto.marca}</span>}
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${produto.ativo ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {produto.ativo ? 'Ativo' : 'Inativo'}
              </span>
            </div>
          </div>

          <div className="bg-white rounded-lg border shadow-sm p-4 md:p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold">Tabela de preços por quantidade</h2>
                <p className="text-xs text-muted-foreground">Base ERPNext: Pricing Rule por faixa → Pricing Rule do SKU → Item Price Standard Selling. Urgente aplica +30%.</p>
              </div>
              {!editing && (
                <Button variant="outline" size="sm" className="min-h-10" aria-label="Editar preços" onClick={startEditing}>
                  <Edit3 size={14} className="mr-1.5" />
                  Editar preços
                </Button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Faixa</th>
                    <th className="pb-2 pr-4 font-medium text-right">Preço base</th>
                    <th className="pb-2 pr-4 font-medium text-right">Urgente (+30%)</th>
                    <th className="pb-2 font-medium">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {BRACKETS.map((faixa) => {
                    const row = precos.find(p => Number(p.faixa) === faixa) || { faixa, status: 'missing', origem_label: 'Não encontrado' };
                    const rate = editing ? editedRates[faixa] : row.rate;
                    return (
                      <tr key={faixa} className="border-b last:border-0">
                        <td className="py-3 pr-4 font-medium">{faixa} un.</td>
                        <td className="py-3 pr-4 text-right">
                          {editing ? (
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              aria-label={`Preço da faixa ${faixa} unidades`}
                              value={rate ?? ''}
                              onChange={(e) => setEditedRates(prev => ({ ...prev, [faixa]: e.target.value }))}
                              className="w-32 text-right inline-block min-h-10"
                              placeholder="0,00"
                            />
                          ) : (
                            <span className={`inline-flex items-center rounded-md border px-2 py-1 font-mono ${priceTone(row)}`}>
                              {row.rate != null ? formatBRL(row.rate) : 'sem preço'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-right">
                          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono ${urgentTone(row)}`}>
                            {row.urgent_rate != null ? formatBRL(row.urgent_rate) : 'sem preço'}
                            {row.urgent_rate != null ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-sans font-semibold">urgente</span> : <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-sans font-semibold">sem preço</span>}
                          </span>
                        </td>
                        <td className="py-3">
                          <SourceBadge row={row} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {editing && (
              <div className="flex gap-2 pt-2 flex-wrap">
                <Button onClick={saveRates} disabled={saving} size="sm" className="min-h-10" aria-label="Salvar preços">
                  {saving ? <><Skeleton className="h-3.5 w-3.5 rounded-full border-2 border-background mr-1.5" />Salvando…</> : <><Save size={14} className="mr-1.5" />Salvar</>}
                </Button>
                <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving} className="min-h-10" aria-label="Cancelar edição de preços">
                  <X size={14} className="mr-1.5" />
                  Cancelar
                </Button>
              </div>
            )}
          </div>

          {produto.descricao && (
            <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
              <h2 className="text-lg font-semibold">Descrição</h2>
              <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: produto.descricao }} />
            </div>
          )}

          {produto.modificado_em && (
            <p className="text-xs text-muted-foreground">Última modificação: {formatDate(produto.modificado_em)}</p>
          )}
        </div>
      </div>
    </div>
  );
}
