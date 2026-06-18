import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Package,
  Tag,
  FileText,
  Edit3,
  Save,
  X,
  AlertTriangle,
  Search,
  Check,
  Trash2,
} from 'lucide-react';
import { apiGet, apiPut, apiPost, apiDelete } from '@/lib/api.js';
import { formatBRL, formatDate } from '@/lib/formatters.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { useSetTopBarActions } from '@/components/layout/Layout.jsx';
import SkeletonDetail from '@/components/SkeletonDetail.jsx';

const BRACKETS = [30, 100, 300, 500, 1000];

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
  return Object.fromEntries(BRACKETS.map((faixa) => [faixa, '']));
}

function buildEditedState(produto, precos = []) {
  const rates = buildEmptyRates();
  for (const faixa of BRACKETS) {
    const row = precos.find((p) => Number(p.faixa) === faixa);
    rates[faixa] = row?.rate != null ? String(row.rate) : '';
  }

  return {
    sku: produto?.sku || '',
    nome: produto?.nome || '',
    descricao: produto?.descricao || '',
    categoria: produto?.categoria || '',
    unidade: produto?.unidade || 'Und',
    ativo: produto?.ativo ?? true,
    rates,
  };
}

function SectionCard({ title, description, icon: Icon, children }) {
  return (
    <section className="bg-surface rounded-xl border border-line shadow-sm p-5 space-y-4">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 rounded-full bg-surface-muted p-2 text-fg-muted">
            <Icon size={16} />
          </div>
        )}
        <div>
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {description && <p className="text-xs text-fg-muted mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function InfoField({ label, value, children }) {
  return (
    <div>
      <span className="text-fg-muted text-[11px] uppercase tracking-wide">{label}</span>
      {children || <p className="mt-1 text-sm font-medium text-fg break-words">{value || '—'}</p>}
    </div>
  );
}

function SelectField({ value, onChange, children, disabled = false, className = '' }) {
  return (
    <select
      value={value || ''}
      onChange={onChange}
      disabled={disabled}
      className={`mt-1 h-10 w-full rounded-[10px] border border-line bg-surface px-3.5 text-[15px] text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:opacity-50 ${className}`}
    >
      {children}
    </select>
  );
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
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState(null);
  const [atividades, setAtividades] = useState([]);
  const setTopBarActions = useSetTopBarActions();

  const fetchProduct = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isNewProduct) {
        const emptyProduct = buildEmptyProduct();
        setProduct(emptyProduct);
        setAtividades([]);
        setEdited(buildEditedState(emptyProduct.produto, []));
        setEditing(true);
        return;
      }

      const result = await apiGet(`/product-detail?sku=${encodeURIComponent(decodedSku)}`);
      setProduct(result);
      setEditing(false);
      setEdited({});
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
      const result = await apiGet(
        `/product-activity?sku=${encodeURIComponent(decodedSku)}&limit=3`
      );
      setAtividades(result.atividades || []);
    } catch {
      setAtividades([]);
    }
  }, [decodedSku, isNewProduct]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  useEffect(() => {
    fetchAtividades();
  }, [fetchAtividades]);

  const precosRates = useMemo(() => {
    return BRACKETS.map((faixa) => {
      if (editing) {
        const raw = edited.rates?.[faixa];
        const rate = raw === '' || raw == null ? null : Number(raw);
        return { faixa, rate: Number.isNaN(rate) ? null : rate };
      }

      const row = product?.precos?.find((p) => Number(p.faixa) === faixa);
      return { faixa, rate: row?.rate != null ? Number(row.rate) : null };
    });
  }, [editing, edited.rates, product?.precos]);

  const startEditing = useCallback(() => {
    const { produto, precos = [] } = product || {};
    setEdited(buildEditedState(produto, precos));
    setEditing(true);
  }, [product]);

  const cancelEditing = useCallback(() => {
    if (isNewProduct) {
      navigate('/products');
      return;
    }

    setEditing(false);
    setEdited({});
  }, [isNewProduct, navigate]);

  const saveProduct = useCallback(async () => {
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

      const precos = BRACKETS.map((faixa) => {
        const raw = rates[faixa];
        const rate = raw === '' || raw == null ? null : Number(raw);
        return { faixa, rate };
      }).filter((p) => p.rate != null && !Number.isNaN(p.rate));

      if (isNewProduct) {
        await apiPost('/products', {
          sku: normalizedSku,
          nome: normalizedNome,
          categoria: categoria?.trim() || undefined,
          unidade: unidade?.trim() || 'Und',
        });

        const extraBody = {};
        if ((descricao || '').trim()) extraBody.descricao = descricao.trim();
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
      if (normalizedNome !== (produto?.nome || '')) metadata.nome = normalizedNome;
      if ((descricao || '') !== (produto?.descricao || '')) metadata.descricao = descricao || '';
      if ((categoria || '') !== (produto?.categoria || '')) metadata.categoria = categoria || '';
      if ((unidade || '') !== (produto?.unidade || '')) metadata.unidade = unidade || '';
      if (ativo !== produto?.ativo) metadata.ativo = ativo;

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
      await fetchAtividades();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Erro ao salvar produto.' });
    } finally {
      setSaving(false);
    }
  }, [decodedSku, edited, fetchAtividades, fetchProduct, isNewProduct, navigate, product]);

  const deleteProduct = useCallback(async () => {
    if (isNewProduct) return;
    if (
      !window.confirm(
        `Tem certeza que deseja excluir o produto ${decodedSku}?\n\nEsta ação não pode ser desfeita.`
      )
    )
      return;

    setDeleting(true);
    setToast(null);
    try {
      await apiDelete(`/products?id=${encodeURIComponent(decodedSku)}`);
      navigate('/products');
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Erro ao excluir produto.' });
    } finally {
      setDeleting(false);
    }
  }, [decodedSku, isNewProduct, navigate]);

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
            <Button
              onClick={saveProduct}
              disabled={saving || deleting}
              size="sm"
              aria-label={isNewProduct ? 'Criar produto' : 'Salvar produto'}
            >
              <Save size={14} />
              {saving
                ? isNewProduct
                  ? 'Criando…'
                  : 'Salvando…'
                : isNewProduct
                  ? 'Criar produto'
                  : 'Salvar'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={cancelEditing}
              disabled={saving || deleting}
              aria-label="Cancelar edição"
            >
              <X size={14} />
              Cancelar
            </Button>
          </>
        ) : (
          <Button size="sm" aria-label="Editar produto" onClick={startEditing} disabled={deleting}>
            <Edit3 size={14} />
            Editar
          </Button>
        )}
        {!isNewProduct && (
          <Button
            variant="outline"
            size="sm"
            onClick={deleteProduct}
            disabled={saving || deleting}
            aria-label="Excluir produto"
            className="text-destructive border-destructive/20 hover:bg-destructive/10"
          >
            <Trash2 size={14} />
            {deleting ? 'Excluindo…' : 'Excluir'}
          </Button>
        )}
      </div>
    );

    return () => setTopBarActions(null);
  }, [
    cancelEditing,
    deleteProduct,
    deleting,
    error,
    isNewProduct,
    loading,
    product,
    saveProduct,
    saving,
    setTopBarActions,
    startEditing,
    editing,
  ]);

  if (loading) return <SkeletonDetail />;

  if (error === 'not_found') {
    return (
      <div className="flex flex-col items-center py-16 text-fg-muted gap-3 max-w-[1060px] mx-auto">
        <Search size={40} className="text-fg-muted/40" />
        <p className="text-lg font-medium">Produto não encontrado</p>
        <p className="text-sm">O SKU &quot;{decodedSku}&quot; não existe no catálogo.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-16 text-fg-muted gap-3 max-w-[1060px] mx-auto">
        <AlertTriangle size={40} className="text-destructive" />
        <p className="text-lg font-medium">Erro ao carregar produto</p>
        <p className="text-sm">{error}</p>
        <Button variant="outline" className="min-h-10" onClick={fetchProduct}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const { produto } = product || {};
  if (!produto) return null;

  const hasImage = Boolean(!editing && produto.imagem && typeof produto.imagem === 'string');

  return (
    <div className="space-y-5 animate-fade-in max-w-[1060px] mx-auto">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-in slide-in-from-top-2 ${
            toast.type === 'success'
              ? 'bg-success/10 text-success border border-success/30'
              : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-800/40'
          }`}
        >
          {toast.type === 'success' ? (
            <Check size={16} className="inline mr-1" />
          ) : (
            <X size={16} className="inline mr-1" />
          )}
          {toast.message}
        </div>
      )}

      <section className="bg-surface rounded-xl border border-line shadow-sm p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            {hasImage ? (
              <img
                src={produto.imagem}
                alt={produto.nome}
                className="h-16 w-16 shrink-0 rounded-2xl border border-line object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Package size={20} />
              </div>
            )}

            <div className="min-w-0 space-y-1">
              <p className="text-xs text-fg-muted font-mono leading-none">{produto.sku || '—'}</p>
              <div className="space-y-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-fg truncate">
                    {produto.nome || 'Sem nome'}
                  </h2>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${produto.ativo ? 'bg-success/10 text-success' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'}`}
                  >
                    {produto.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                {produto.descricao && <p className="text-sm text-fg-muted">{produto.descricao}</p>}
              </div>
            </div>
          </div>
        </div>
      </section>

      <SectionCard title="Dados gerais" description="Cadastro básico do produto." icon={Package}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {editing ? (
            <div className="md:col-span-2">
              <label className="text-fg-muted text-[11px] uppercase tracking-wide">Nome</label>
              <Input
                value={edited.nome || ''}
                onChange={(e) => setEdited((prev) => ({ ...prev, nome: e.target.value }))}
                className="mt-1 text-sm"
                placeholder="Nome do produto"
              />
            </div>
          ) : (
            <InfoField label="Nome" value={produto.nome} />
          )}

          {editing ? (
            <div className="md:col-span-2">
              <label className="text-fg-muted text-[11px] uppercase tracking-wide">Descrição</label>
              <textarea
                value={edited.descricao || ''}
                onChange={(e) => setEdited((prev) => ({ ...prev, descricao: e.target.value }))}
                className="mt-1 min-h-[110px] w-full rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[15px] leading-[1.3] text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                placeholder="Descrição do produto"
              />
            </div>
          ) : (
            <InfoField label="Descrição" value={produto.descricao || '—'} />
          )}

          {editing ? (
            <div>
              <label className="text-fg-muted text-[11px] uppercase tracking-wide">SKU</label>
              <Input
                value={isNewProduct ? edited.sku || '' : produto.sku || ''}
                disabled={!isNewProduct}
                onChange={(e) => setEdited((prev) => ({ ...prev, sku: e.target.value }))}
                className="mt-1 text-sm font-mono"
                placeholder="LNC-SED-70"
              />
            </div>
          ) : (
            <InfoField label="SKU" value={produto.sku} />
          )}

          {editing ? (
            <div>
              <label className="text-fg-muted text-[11px] uppercase tracking-wide">Status</label>
              <SelectField
                value={edited.ativo ? 'ativo' : 'inativo'}
                onChange={(e) =>
                  setEdited((prev) => ({ ...prev, ativo: e.target.value === 'ativo' }))
                }
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </SelectField>
            </div>
          ) : (
            <InfoField label="Status" value={produto.ativo ? 'Ativo' : 'Inativo'} />
          )}

          {editing ? (
            <div>
              <label className="text-fg-muted text-[11px] uppercase tracking-wide">Categoria</label>
              <Input
                value={edited.categoria || ''}
                onChange={(e) => setEdited((prev) => ({ ...prev, categoria: e.target.value }))}
                className="mt-1 text-sm"
                placeholder="Categoria"
              />
            </div>
          ) : (
            <InfoField label="Categoria" value={produto.categoria || '—'} />
          )}

          {editing ? (
            <div>
              <label className="text-fg-muted text-[11px] uppercase tracking-wide">Unidade</label>
              <Input
                value={edited.unidade || ''}
                onChange={(e) => setEdited((prev) => ({ ...prev, unidade: e.target.value }))}
                className="mt-1 text-sm"
                placeholder="Und"
              />
            </div>
          ) : (
            <InfoField label="Unidade" value={produto.unidade || '—'} />
          )}

          <InfoField
            label="Criado / modificado"
            value={produto.modificado_em ? formatDate(produto.modificado_em) : '—'}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Preços por faixa"
        description="As 5 faixas sempre aparecem; sem preço definido mostramos “—”."
        icon={Tag}
      >
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {BRACKETS.map((faixa) => {
            const row = precosRates.find((p) => p.faixa === faixa);
            return (
              <div key={faixa} className="rounded-xl border border-line bg-surface/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-fg-muted font-medium">
                  {faixa.toLocaleString('pt-BR')} un.
                </p>
                {editing ? (
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    aria-label={`Preço da faixa ${faixa} unidades`}
                    value={edited.rates?.[faixa] ?? ''}
                    onChange={(e) =>
                      setEdited((prev) => ({
                        ...prev,
                        rates: { ...prev.rates, [faixa]: e.target.value },
                      }))
                    }
                    className="mt-2 text-sm font-mono"
                    placeholder="0,00"
                  />
                ) : (
                  <p className="mt-2 text-sm font-medium text-fg font-mono">
                    {row?.rate != null ? formatBRL(row.rate) : '—'}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      {!isNewProduct && (
        <SectionCard
          title="Atividade recente"
          description={
            produto.modificado_em
              ? `Última atualização: ${formatDate(produto.modificado_em)}`
              : 'Contexto recente do produto.'
          }
          icon={FileText}
        >
          {atividades.length > 0 ? (
            <div className="space-y-3">
              {atividades.map((atividade, index) => (
                <div
                  key={`${atividade.tipo}-${atividade.data}-${index}`}
                  className="rounded-xl border border-line bg-surface/50 px-4 py-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-fg break-words">{atividade.texto}</span>
                    <span className="shrink-0 text-xs text-fg-muted">{atividade.data}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg-muted">Sem atividade recente para este produto.</p>
          )}
        </SectionCard>
      )}
    </div>
  );
}
