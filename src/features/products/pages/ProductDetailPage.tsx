import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
  type ChangeEvent,
  type ComponentType,
} from 'react';
import {
  Package,
  Tag,
  FileText,
  Edit3,
  Save,
  X,
  AlertTriangle,
  Search,
  Copy,
  Trash2,
  Archive,
  ArchiveRestore,
} from 'lucide-react';
import { parseHashString, useHashQueryState } from '@/hooks/useHashQueryState';
import { apiGet, apiPut, apiPost, apiDelete, apiPatch } from '@/lib/api/api';
import { clearProductCache } from '@/lib/api/productCache';
import { formatBRL, formatDate } from '@/lib/formatting/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { useToast } from '@/components/shared/toast';
import { useSetTopBarActions } from '@/components/layout/Layout';
import SkeletonDetail from '@/components/shared/SkeletonDetail';

interface Produto {
  sku: string;
  nome: string;
  descricao: string | null;
  categoria: string;
  marca: string | null;
  unidade: string;
  ativo: boolean;
  imagem: string | null;
  modificado_em: string | null;
  preco_base?: string | number | null;
}

interface Preco {
  faixa?: number | string;
  qty?: number | string;
  rate?: number | string | null;
  minimum_quantity?: number | string;
  unit_price?: number | string | null;
}

interface ProductDetail {
  produto: Produto;
  precos: Preco[];
  preco_base?: string | number | null;
  pricing_available?: boolean;
}

interface RequestRecord {
  key: string;
  generation: number;
  promise: Promise<void>;
}

interface Atividade {
  tipo: string;
  data: string;
  texto: string;
  id: string;
}

interface EditedProduct {
  sku: string;
  nome: string;
  descricao: string;
  categoria: string;
  marca: string;
  unidade: string;
  ativo: boolean;
  precoBase: string;
  tiers: Array<{ minimum_quantity: string; unit_price: string }>;
}

function buildEmptyProduct(): ProductDetail {
  return {
    produto: {
      sku: '',
      nome: '',
      descricao: '',
      categoria: '',
      marca: '',
      unidade: 'Und',
      ativo: true,
      imagem: null,
      modificado_em: null,
    },
    precos: [],
    preco_base: null,
  };
}

function buildDuplicateDraft(source: ProductDetail): ProductDetail {
  return {
    ...source,
    produto: {
      ...source.produto,
      sku: '',
      ativo: true,
      modificado_em: null,
    },
  };
}

function formatActivityDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function buildEditedState(produto?: Produto | null, precos: Preco[] = [], precoBase?: string | number | null): EditedProduct {
  return {
    sku: produto?.sku || '',
    nome: produto?.nome || '',
    descricao: produto?.descricao || '',
    categoria: produto?.categoria || '',
    marca: produto?.marca || '',
    unidade: produto?.unidade || 'Und',
    ativo: produto?.ativo ?? true,
    precoBase: precoBase == null ? '' : String(precoBase),
    tiers: precos
      .map((row) => ({
        minimum_quantity: String(row.minimum_quantity ?? row.faixa ?? row.qty ?? ''),
        unit_price: row.unit_price == null ? String(row.rate ?? '') : String(row.unit_price),
      }))
      .filter((row) => row.minimum_quantity !== '' || row.unit_price !== ''),
  };
}

function selectContextualErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown })?.message;
  if (typeof message !== 'string') return fallback;
  const trimmedMessage = message.trim();
  return trimmedMessage && !/^Erro \d+$/i.test(trimmedMessage) ? message : fallback;
}

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: ComponentType<{ size?: number }>;
  children: ReactNode;
}

function SectionCard({ title, description, icon: Icon, children }: SectionCardProps) {
  return (
    <section className="bg-surface rounded-lg border border-line shadow-sm p-5 space-y-4">
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

interface InfoFieldProps {
  label: string;
  value?: ReactNode;
  children?: ReactNode;
}

function InfoField({ label, value, children }: InfoFieldProps) {
  return (
    <div>
      <span className="text-fg-muted text-[11px] uppercase tracking-wide">{label}</span>
      {children || <p className="mt-1 text-sm font-medium text-fg break-words">{value || '—'}</p>}
    </div>
  );
}

interface SelectFieldProps {
  value?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

function SelectField({
  value,
  onChange,
  children,
  disabled = false,
  className = '',
}: SelectFieldProps) {
  return (
    <select
      value={value || ''}
      onChange={onChange}
      disabled={disabled}
      className={`mt-1 h-10 w-full rounded-md border border-line bg-surface px-3.5 text-[15px] text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:opacity-50 ${className}`}
    >
      {children}
    </select>
  );
}

interface ProductDetailPageProps {
  sku: string;
  navigate: (hash: string) => void;
}

export default function ProductDetailPage({ sku, navigate }: ProductDetailPageProps) {
  const decodedSku = decodeURIComponent(sku || '');
  const isNewProduct = decodedSku === 'new';
  const [duplicateFrom] = useHashQueryState('duplicate', '', parseHashString);
  const duplicateSku = duplicateFrom.trim();
  const isDuplicateDraft = isNewProduct && Boolean(duplicateSku);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<boolean>(false);
  const [edited, setEdited] = useState<Partial<EditedProduct>>({});
  const [saving, setSaving] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const { toast } = useToast();
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState<boolean>(false);
  const [atividades, setAtividades] = useState<Atividade[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState<boolean>(() => !isNewProduct);
  const [activityRefresh, setActivityRefresh] = useState(0);
  const mountedRef = useRef(false);
  const lifecycleCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSkuRef = useRef(decodedSku);
  const productRequestRef = useRef<RequestRecord | null>(null);
  const activityRequestRef = useRef<RequestRecord | null>(null);
  const productGenerationRef = useRef(0);
  const activityGenerationRef = useRef(0);
  currentSkuRef.current = decodedSku;
  const setTopBarActions = useSetTopBarActions();

  useEffect(() => {
    if (lifecycleCleanupRef.current !== null) {
      clearTimeout(lifecycleCleanupRef.current);
      lifecycleCleanupRef.current = null;
    }
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      lifecycleCleanupRef.current = setTimeout(() => {
        lifecycleCleanupRef.current = null;
        if (mountedRef.current) return;
        currentSkuRef.current = '';
        productRequestRef.current = null;
        activityRequestRef.current = null;
        productGenerationRef.current += 1;
        activityGenerationRef.current += 1;
      }, 0);
    };
  }, []);

  const fetchProduct = useCallback(async (options: { force?: boolean } = {}) => {
    if (!mountedRef.current || currentSkuRef.current !== decodedSku) return;
    const requestKey = `${decodedSku}:${duplicateSku}`;
    const previousRequest = productRequestRef.current;
    if (!options.force && previousRequest?.key === requestKey) {
      return previousRequest.promise;
    }
    if (currentSkuRef.current !== decodedSku) return;

    const generation = ++productGenerationRef.current;
    setLoading(true);
    setError(null);

    const requestRecord: RequestRecord = {
      key: requestKey,
      generation,
      promise: Promise.resolve(),
    };
    productRequestRef.current = requestRecord;
    const request = (async () => {
      const isCurrentRequest = () =>
        mountedRef.current &&
        currentSkuRef.current === decodedSku &&
        productRequestRef.current?.key === requestKey &&
        productRequestRef.current?.generation === generation;

      try {
        if (isNewProduct) {
          const draft = isDuplicateDraft
            ? buildDuplicateDraft(await apiGet<ProductDetail>(
              `/product-detail?sku=${encodeURIComponent(duplicateSku)}`
            ))
            : buildEmptyProduct();
          if (!isCurrentRequest()) return;
          setProduct(draft);
          setAtividades([]);
          setActivityError(null);
          setEdited(buildEditedState(draft.produto, draft.precos, draft.preco_base ?? draft.produto.preco_base));
          setEditing(true);
          return;
        }

        const result = await apiGet<ProductDetail>(
          `/product-detail?sku=${encodeURIComponent(decodedSku)}`
        );
        if (!isCurrentRequest()) return;
        setProduct(result);
        setEditing(false);
        setEdited({});
      } catch (err) {
        if (!isCurrentRequest()) return;
        const apiErr = err as { status?: number; message?: string };
        if (apiErr.status === 404) setError('not_found');
        else setError(apiErr.message || 'Erro ao carregar produto.');
      } finally {
        if (isCurrentRequest()) setLoading(false);
      }
    })();
    requestRecord.promise = request;
    try {
      await request;
    } finally {
      if (productRequestRef.current === requestRecord) productRequestRef.current = null;
    }
  }, [decodedSku, duplicateSku, isDuplicateDraft, isNewProduct]);

  const fetchAtividades = useCallback(async (options: { force?: boolean } = {}) => {
    if (!mountedRef.current || currentSkuRef.current !== decodedSku) return;
    const requestKey = `${decodedSku}:${activityRefresh}`;
    if (isNewProduct) {
      activityRequestRef.current = null;
      setAtividades([]);
      setActivityError(null);
      setActivityLoading(false);
      return;
    }

    const previousRequest = activityRequestRef.current;
    if (!options.force && previousRequest?.key === requestKey) {
      return previousRequest.promise;
    }

    const generation = ++activityGenerationRef.current;
    setAtividades([]);
    setActivityError(null);
    setActivityLoading(true);

    const requestRecord: RequestRecord = {
      key: requestKey,
      generation,
      promise: Promise.resolve(),
    };
    activityRequestRef.current = requestRecord;
    const request = (async () => {
      const isCurrentRequest = () =>
        mountedRef.current &&
        currentSkuRef.current === decodedSku &&
        activityRequestRef.current?.key === requestKey &&
        activityRequestRef.current?.generation === generation;

      try {
        const result = await apiGet<{ atividades?: Atividade[] }>(
          `/product-activity?sku=${encodeURIComponent(decodedSku)}&limit=3`
        );
        if (!isCurrentRequest()) return;
        setAtividades(result.atividades || []);
      } catch {
        if (!isCurrentRequest()) return;
        setAtividades([]);
        setActivityError('Não foi possível carregar a atividade.');
      } finally {
        if (isCurrentRequest()) setActivityLoading(false);
      }
    })();
    requestRecord.promise = request;
    try {
      await request;
    } finally {
      if (activityRequestRef.current === requestRecord) activityRequestRef.current = null;
    }
  }, [activityRefresh, decodedSku, isNewProduct]);

  useEffect(() => {
    void fetchProduct();
  }, [fetchProduct]);

  useEffect(() => {
    void fetchAtividades();
  }, [fetchAtividades]);

  const startEditing = useCallback(() => {
    const { produto, precos = [], preco_base } = product || {};
    setEdited(buildEditedState(produto, precos, preco_base ?? produto?.preco_base));
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

  const refreshActivity = useCallback(() => {
    if (!mountedRef.current) return;
    activityRequestRef.current = null;
    setAtividades([]);
    setActivityError(null);
    setActivityLoading(true);
    setActivityRefresh((current) => current + 1);
  }, []);

  const saveProduct = useCallback(async () => {
    if (!mountedRef.current || currentSkuRef.current !== decodedSku) return;
    setSaving(true);

    try {
      const { produto } = product || {};
      const {
        sku: editedSku,
        nome,
        descricao,
        categoria,
        marca,
        unidade,
        ativo,
        precoBase = '',
        tiers = [],
      } = edited as EditedProduct;
      const normalizedSku = (editedSku || '').trim();
      const normalizedNome = (nome || '').trim();

      if (isNewProduct && !normalizedSku) {
        toast('SKU é obrigatório.', 'error');
        return;
      }

      if (!normalizedNome) {
        toast('Nome do produto é obrigatório.', 'error');
        return;
      }

      const createPayload: Record<string, unknown> = {
        sku: normalizedSku,
        nome: normalizedNome,
        descricao: descricao.trim(),
        categoria: categoria?.trim() || undefined,
        marca: marca?.trim() || undefined,
        unidade: unidade?.trim() || 'Und',
        preco_base: precoBase.trim() === '' ? null : precoBase.trim(),
        precos: tiers.map((tier) => ({
          minimum_quantity: tier.minimum_quantity,
          unit_price: tier.unit_price,
        })),
      };

      if (isNewProduct) {
        await apiPost('/products', createPayload);
        if (!mountedRef.current || currentSkuRef.current !== decodedSku) return;
        if (ativo !== true) {
          await apiPut(`/product-update?sku=${encodeURIComponent(normalizedSku)}`, { ativo });
          if (!mountedRef.current || currentSkuRef.current !== decodedSku) return;
        }
        if (!mountedRef.current || currentSkuRef.current !== decodedSku) return;
        toast('Produto criado com sucesso!', 'success');
        clearProductCache();
        navigate(`/products/${encodeURIComponent(normalizedSku)}`);
        return;
      }

      const metadata: Record<string, unknown> = {};
      if (normalizedNome !== (produto?.nome || '')) metadata.nome = normalizedNome;
      if ((descricao || '') !== (produto?.descricao || '')) metadata.descricao = descricao || '';
      if ((categoria || '') !== (produto?.categoria || '')) metadata.categoria = categoria || '';
      if ((marca || '') !== (produto?.marca || '')) metadata.marca = marca || '';
      if ((unidade || '') !== (produto?.unidade || '')) metadata.unidade = unidade || '';
      if (ativo !== produto?.ativo) metadata.ativo = ativo;

      const body: Record<string, unknown> = {
        ...metadata,
        preco_base: createPayload.preco_base,
        precos: createPayload.precos,
      };

      const result = await apiPut<{ success?: boolean }>(
        `/product-update?sku=${encodeURIComponent(decodedSku)}`,
        body
      );
      if (!mountedRef.current || currentSkuRef.current !== decodedSku) return;
      if (!result.success) {
        toast('Erro ao salvar produto.', 'error');
        return;
      }

      toast('Produto atualizado com sucesso!', 'success');
      clearProductCache();
      setEditing(false);
      refreshActivity();
      await fetchProduct({ force: true });
    } catch (err) {
      if (!mountedRef.current || currentSkuRef.current !== decodedSku) return;
      const apiErr = err as { message?: string };
      toast(apiErr.message || 'Erro ao salvar produto.', 'error');
    } finally {
      if (mountedRef.current && currentSkuRef.current === decodedSku) setSaving(false);
    }
  }, [
    decodedSku,
    edited,
    fetchProduct,
    isNewProduct,
    navigate,
    product,
    refreshActivity,
    toast,
  ]);

  const requestArchive = useCallback(() => {
    if (isNewProduct || !mountedRef.current || currentSkuRef.current !== decodedSku) return;
    if (!product) return;
    setConfirmArchiveOpen(true);
  }, [decodedSku, isNewProduct, product]);

  const deleteProduct = useCallback(async () => {
    if (isNewProduct || !mountedRef.current || currentSkuRef.current !== decodedSku) return;
    if (!product) return;
    const restoring = product.produto.ativo === false;

    setDeleting(true);
    try {
      if (restoring) {
        await apiPatch(`/product-update?sku=${encodeURIComponent(decodedSku)}`, { ativo: true });
      } else {
        await apiDelete(`/products?id=${encodeURIComponent(decodedSku)}`);
      }
      if (!mountedRef.current || currentSkuRef.current !== decodedSku) return;
      clearProductCache();
      refreshActivity();
      toast(restoring ? 'Produto restaurado.' : 'Produto arquivado.', 'success');
      await fetchProduct({ force: true });
    } catch (err) {
      if (!mountedRef.current || currentSkuRef.current !== decodedSku) return;
      const fallbackMessage = restoring
        ? 'Erro ao restaurar produto.'
        : 'Erro ao arquivar produto.';
      toast(selectContextualErrorMessage(err, fallbackMessage), 'error');
    } finally {
      if (mountedRef.current && currentSkuRef.current === decodedSku) setDeleting(false);
    }
  }, [decodedSku, fetchProduct, isNewProduct, product, refreshActivity, toast]);

  useEffect(() => {
    if (!setTopBarActions) return undefined;

    if (loading || error || !product?.produto) {
      setTopBarActions(null);
      return () => setTopBarActions(null);
    }

    setTopBarActions(
      <div className="flex items-center gap-2">
        {!isNewProduct && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/products/new?duplicate=${encodeURIComponent(decodedSku)}`)}
            disabled={saving || deleting}
            aria-label="Duplicar produto"
          >
            <Copy size={14} />
            Duplicar
          </Button>
        )}
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
            onClick={requestArchive}
            disabled={saving || deleting}
            aria-label={product?.produto.ativo === false ? 'Restaurar produto' : 'Arquivar produto'}
            className="text-destructive border-destructive/20 hover:bg-destructive/10"
          >
            {product?.produto.ativo === false ? (
              <ArchiveRestore size={14} />
            ) : (
              <Archive size={14} />
            )}
            {deleting
              ? 'Atualizando…'
              : product?.produto.ativo === false
                ? 'Restaurar'
                : 'Arquivar'}
          </Button>
        )}
      </div>
    );

    return () => setTopBarActions(null);
  }, [
    cancelEditing,
    decodedSku,
    deleteProduct,
    deleting,
    error,
    isNewProduct,
    loading,
    navigate,
    product,
    requestArchive,
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
        <p className="text-sm">O SKU &quot;{isDuplicateDraft ? duplicateSku : decodedSku}&quot; não existe no catálogo.</p>
        <Button variant="outline" onClick={() => navigate('/products')}>
          Voltar ao catálogo
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-16 text-fg-muted gap-3 max-w-[1060px] mx-auto">
        <AlertTriangle size={40} className="text-destructive" />
        <p className="text-lg font-medium">Erro ao carregar produto</p>
        <p className="text-sm">{error}</p>
        <Button variant="outline" className="min-h-10" onClick={() => fetchProduct({ force: true })}>
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
      {isDuplicateDraft && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-200">
          <strong>Rascunho de duplicação.</strong>{' '}
          Dados copiados; preencha o SKU antes de criar o produto.
        </div>
      )}


      <section className="bg-surface rounded-lg border border-line shadow-sm p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            {hasImage ? (
              <img
                src={produto.imagem ?? undefined}
                alt={produto.nome}
                className="h-16 w-16 shrink-0 rounded-lg border border-line object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Package size={20} />
              </div>
            )}

            <div className="min-w-0 space-y-1">
              <p className="text-xs text-fg-muted font-mono leading-none">{produto.sku || '—'}</p>
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-fg truncate">
                    {produto.nome || 'Sem nome'}
                  </h2>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${isNewProduct ? 'tone-warning-soft' : produto.ativo ? 'tone-success-soft' : 'bg-destructive/10 text-destructive dark:bg-destructive/10'}`}
                  >
                    {isNewProduct ? 'Rascunho' : produto.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                {produto.descricao && (
                  <p className="text-sm text-fg-muted mt-0.5">{produto.descricao}</p>
                )}
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
                className="mt-1 min-h-[110px] w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-[15px] leading-[1.3] text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
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
              <label className="text-fg-muted text-[11px] uppercase tracking-wide">Marca</label>
              <Input
                value={edited.marca || ''}
                onChange={(e) => setEdited((prev) => ({ ...prev, marca: e.target.value }))}
                className="mt-1 text-sm"
                placeholder="Marca"
              />
            </div>
          ) : (
            <InfoField label="Marca" value={produto.marca || '—'} />
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
          title="Preços do catálogo"
          description="Configure um preço base opcional e faixas dinâmicas por quantidade."
          icon={Tag}
        >
          {editing ? (
            <div className="space-y-4">
              {(!edited.precoBase || edited.precoBase.trim() === '') && (edited.tiers || []).length === 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-200">
                  Preço indisponível para este produto.
                </p>
              )}
              <div className="max-w-xs">
                <label className="text-xs font-medium text-fg-muted">Preço base (opcional)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  aria-label="Preço base"
                  value={edited.precoBase ?? ''}
                  onChange={(event) => setEdited((previous) => ({ ...previous, precoBase: event.target.value }))}
                  className="mt-1 text-sm font-mono"
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-fg-muted">Faixas de quantidade</p>
                    <p className="text-xs text-fg-muted">A maior quantidade mínima aplicável define o preço unitário.</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label="Adicionar faixa de preço"
                    onClick={() => setEdited((previous) => ({
                      ...previous,
                      tiers: [...(previous.tiers || []), { minimum_quantity: '', unit_price: '' }],
                    }))}
                  >
                    <Tag size={14} className="mr-1" /> Adicionar faixa
                  </Button>
                </div>
                {(edited.tiers || []).length === 0 && (
                  <p className="rounded-lg border border-dashed border-line px-3 py-3 text-sm text-fg-muted">
                    Nenhuma faixa configurada. O preço base será usado quando preenchido.
                  </p>
                )}
                <div className="space-y-2">
                  {(edited.tiers || []).map((tier, index) => (
                    <div key={`tier-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-end rounded-lg border border-line p-3">
                      <label className="text-xs text-fg-muted">
                        Quantidade mínima
                        <Input
                          type="number"
                          step="0.001"
                          min="0.001"
                          aria-label={`Quantidade mínima da faixa ${index + 1}`}
                          value={tier.minimum_quantity}
                          onChange={(event) => setEdited((previous) => ({
                            ...previous,
                            tiers: (previous.tiers || []).map((row, rowIndex) => rowIndex === index ? { ...row, minimum_quantity: event.target.value } : row),
                          }))}
                          className="mt-1 text-sm font-mono"
                        />
                      </label>
                      <label className="text-xs text-fg-muted">
                        Preço unitário
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          aria-label={`Preço unitário da faixa ${index + 1}`}
                          value={tier.unit_price}
                          onChange={(event) => setEdited((previous) => ({
                            ...previous,
                            tiers: (previous.tiers || []).map((row, rowIndex) => rowIndex === index ? { ...row, unit_price: event.target.value } : row),
                          }))}
                          className="mt-1 text-sm font-mono"
                        />
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Remover faixa ${index + 1}`}
                        onClick={() => setEdited((previous) => ({
                          ...previous,
                          tiers: (previous.tiers || []).filter((_row, rowIndex) => rowIndex !== index),
                        }))}
                        className="text-destructive border-destructive/20"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {(product?.preco_base ?? produto.preco_base) != null && String(product?.preco_base ?? produto.preco_base) !== '' ? (
                <div className="rounded-lg border border-line bg-surface/50 p-3 max-w-xs">
                  <p className="text-[11px] uppercase tracking-wide text-fg-muted font-medium">Preço base</p>
                  <p className="mt-1 text-sm font-medium text-fg font-mono">{formatBRL(product?.preco_base ?? produto.preco_base)}</p>
                </div>
              ) : null}
              {product?.precos && product.precos.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {product.precos.map((tier, index) => {
                    const quantity = tier.minimum_quantity ?? tier.faixa ?? tier.qty;
                    const rate = tier.unit_price ?? tier.rate;
                    return (
                      <div key={`saved-tier-${index}`} className="rounded-lg border border-line bg-surface/50 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-fg-muted font-medium">A partir de {String(quantity)} un.</p>
                        <p className="mt-2 text-sm font-medium text-fg font-mono">{rate != null ? formatBRL(rate) : '—'}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (product?.preco_base ?? produto.preco_base) == null ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-200">
                  Preço indisponível para este produto.
                </p>
              ) : null}
            </div>
          )}
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
          {activityLoading ? (
            <p className="text-sm text-fg-muted" role="status">Carregando atividade…</p>
          ) : activityError ? (
            <div className="space-y-3" role="alert">
              <p className="text-sm text-destructive">{activityError}</p>
              <Button variant="outline" className="min-h-10" onClick={refreshActivity}>
                Tentar novamente
              </Button>
            </div>
          ) : atividades.length > 0 ? (
            <div className="space-y-3">
              {atividades.map((atividade, index) => (
                <div
                  key={atividade.id || `${atividade.tipo}-${atividade.data}-${index}`}
                  className="rounded-lg border border-line bg-surface/50 px-4 py-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-fg break-words">{atividade.texto}</span>
                    <span className="shrink-0 text-xs text-fg-muted">
                      {formatActivityDate(atividade.data)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg-muted">Sem atividade recente para este produto.</p>
          )}
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirmArchiveOpen}
        title={product?.produto.ativo === false ? 'Restaurar produto' : 'Arquivar produto'}
        message={`Tem certeza que deseja ${product?.produto.ativo === false ? 'restaurar' : 'arquivar'} o produto ${decodedSku}?`}
        confirmLabel={product?.produto.ativo === false ? 'Restaurar' : 'Arquivar'}
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => {
          setConfirmArchiveOpen(false);
          void deleteProduct();
        }}
        onCancel={() => setConfirmArchiveOpen(false)}
      />
    </div>
  );
}
