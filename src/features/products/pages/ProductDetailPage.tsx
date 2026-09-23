import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
  type ComponentType,
} from 'react';
import {
  Package,
  Tag,
  FileText,
  Edit3,
  Save,
  X,
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
import InlineAlert from '@/components/shared/InlineAlert';
import EmptyState from '@/components/shared/EmptyState';
import ErrorState from '@/components/shared/ErrorState';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { useToast } from '@/components/shared/toast';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import SkeletonDetail from '@/components/shared/SkeletonDetail';
import { getHashHistoryPreviousRoute, useRouteGuardContext } from '@/hooks/useHashRoute';
import { routePath } from '@/app/match-route';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

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
  custo_unitario?: string | number | null;
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
  custoUnitario: string;
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

function decodeSku(value: string): string {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return value || '';
  }
}
function formatQuantity(value: number | string | undefined): string {
  if (value == null) return '—';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : String(value);
}

function buildEditedState(
  produto?: Produto | null,
  precos: Preco[] = [],
  precoBase?: string | number | null
): EditedProduct {
  return {
    sku: produto?.sku || '',
    nome: produto?.nome || '',
    descricao: produto?.descricao || '',
    categoria: produto?.categoria || '',
    marca: produto?.marca || '',
    unidade: produto?.unidade || 'Und',
    ativo: produto?.ativo ?? true,
    precoBase: precoBase == null ? '' : String(precoBase),
    custoUnitario: produto?.custo_unitario == null ? '' : String(produto.custo_unitario),
    tiers: precos
      .map((row) => ({
        minimum_quantity: String(row.minimum_quantity ?? row.faixa ?? row.qty ?? ''),
        unit_price: row.unit_price == null ? String(row.rate ?? '') : String(row.unit_price),
      }))
      .filter((row) => row.minimum_quantity !== '' || row.unit_price !== ''),
  };
}

const SAFE_PRODUCT_ERROR_MESSAGES = new Set(['SKU já cadastrado.']);

function selectContextualErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : '';
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status: number }).status
    : 0;
  if (status >= 400 && status < 500 && message) return message;
  return SAFE_PRODUCT_ERROR_MESSAGES.has(message) ? message : fallback;
}

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: ComponentType<{ size?: number }>;
  children: ReactNode;
}

function SectionCard({ title, description, icon: Icon, children }: SectionCardProps) {
  return (
    <section className="space-y-4 rounded-card bg-surface p-5 sm:p-[22px]">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 rounded-control bg-raised p-2 text-light-sage" aria-hidden="true">
            <Icon size={16} />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
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
    <div className="min-w-0">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children || <p className="mt-1 break-words text-sm font-medium text-fg">{value || '—'}</p>}
    </div>
  );
}

interface ProductDetailPageProps {
  sku: string;
  navigate: (hash: string) => void;
}

export default function ProductDetailPage({ sku, navigate }: ProductDetailPageProps) {
  const decodedSku = decodeSku(sku);
  const isNewProduct = decodedSku === 'new';
  const [duplicateFrom] = useHashQueryState('duplicate', '', parseHashString);
  const duplicateSku = duplicateFrom.trim();

  const returnToCatalog = useCallback(() => {
    const previousRoute = getHashHistoryPreviousRoute();
    navigate(previousRoute && routePath(previousRoute) === '/catalog' ? previousRoute : '/catalog');
  }, [navigate]);
  const isDuplicateDraft = isNewProduct && Boolean(duplicateSku);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<boolean>(false);
  const [edited, setEdited] = useState<Partial<EditedProduct>>({});
  const [saving, setSaving] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const { toast } = useToast();
  const { setNavigationGuard } = useRouteGuardContext();
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState<boolean>(false);
  const [confirmDiscardEdits, setConfirmDiscardEdits] = useState<boolean>(false);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
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

  const fetchProduct = useCallback(
    async (options: { force?: boolean } = {}) => {
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
              ? buildDuplicateDraft(
                  await apiGet<ProductDetail>(
                    `/product-detail?sku=${encodeURIComponent(duplicateSku)}`
                  )
                )
              : buildEmptyProduct();
            if (!isCurrentRequest()) return;
            setProduct(draft);
            setAtividades([]);
            setActivityError(null);
            setEdited(
              buildEditedState(
                draft.produto,
                draft.precos,
                draft.preco_base ?? draft.produto.preco_base
              )
            );
            setEditing(true);
            return;
          }

          const result = await apiGet<ProductDetail>(
            `/product-detail?sku=${encodeURIComponent(decodedSku)}`
          );
          if (!isCurrentRequest()) return;
          setProduct(result);
          setEditing(true);
          setEdited(buildEditedState(result.produto, result.precos, result.preco_base ?? result.produto.preco_base));
        } catch (err) {
          if (!isCurrentRequest()) return;
          const apiErr = err as { status?: number };
          if (apiErr.status === 404) setError('not_found');
          else setError('load_error');
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
    },
    [decodedSku, duplicateSku, isDuplicateDraft, isNewProduct]
  );

  const fetchAtividades = useCallback(
    async (options: { force?: boolean } = {}) => {
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
    },
    [activityRefresh, decodedSku, isNewProduct]
  );

  useEffect(() => {
    void fetchProduct();
  }, [fetchProduct]);

  useEffect(() => {
    void fetchAtividades();
  }, [fetchAtividades]);

  const hasUnsavedChanges = Boolean(
    editing &&
      product &&
      JSON.stringify(edited) !==
        JSON.stringify(
          buildEditedState(
            product.produto,
            product.precos,
            product.preco_base ?? product.produto.preco_base
          )
        )
  );

  useEffect(() => {
    if (!hasUnsavedChanges) {
      setNavigationGuard(null);
      setPendingRoute(null);
      return () => setNavigationGuard(null);
    }
    setNavigationGuard(saving
      ? () => true
      : (nextRoute) => {
          setPendingRoute(nextRoute);
          return false;
        });
    return () => setNavigationGuard(null);
  }, [hasUnsavedChanges, saving, setNavigationGuard]);

  const startEditing = useCallback(() => {
    const { produto, precos = [], preco_base } = product || {};
    setEdited(buildEditedState(produto, precos, preco_base ?? produto?.preco_base));
    setEditing(true);
  }, [product]);

  const discardEditing = useCallback(() => {
    setConfirmDiscardEdits(false);
    if (isNewProduct) {
      setNavigationGuard(null);
      returnToCatalog();
      return;
    }

    setEditing(false);
    setEdited({});
  }, [isNewProduct, returnToCatalog, setNavigationGuard]);

  const cancelEditing = useCallback(() => {
    if (hasUnsavedChanges) {
      setConfirmDiscardEdits(true);
      return;
    }
    discardEditing();
  }, [discardEditing, hasUnsavedChanges]);

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
        custoUnitario = '',
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
        custo_unitario: custoUnitario.trim() === '' ? null : custoUnitario.trim(),
        precos: tiers.map((tier) => ({
          minimum_quantity: tier.minimum_quantity,
          unit_price: tier.unit_price,
        })),
      };

      if (isNewProduct) {
        await apiPost('/products', createPayload);
        if (ativo !== true) {
          try {
            await apiPut(`/product-update?sku=${encodeURIComponent(normalizedSku)}`, { ativo });
          } catch (error) {
            try {
              await apiDelete(`/products?id=${encodeURIComponent(normalizedSku)}`);
            } catch {
              // Best effort: preserve the original failure without exposing internals.
            }
            throw error;
          }
        }
        if (!mountedRef.current || currentSkuRef.current !== decodedSku) return;
        toast('Produto criado com sucesso!', 'success');
        clearProductCache();
        const currentRoute = window.location.hash.replace(/^#/, '').split('?')[0];
        if (currentRoute === '/products/new') {
          setNavigationGuard(null);
          navigate(`/products/${encodeURIComponent(normalizedSku)}`);
        }
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
        custo_unitario: createPayload.custo_unitario,
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
      toast(selectContextualErrorMessage(err, 'Erro ao salvar produto. Tente novamente.'), 'error');
    } finally {
      if (mountedRef.current && currentSkuRef.current === decodedSku) setSaving(false);
    }
  }, [decodedSku, edited, fetchProduct, isNewProduct, navigate, product, refreshActivity, toast]);

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

  if (loading) return <SkeletonDetail />;

  if (error === 'not_found') {
    return (
      <PageShell>
        <EmptyState
          icon={Search}
          title="Produto não encontrado"
          description={<span className="break-words">O SKU &quot;{isDuplicateDraft ? duplicateSku : decodedSku}&quot; não existe no catálogo.</span>}
          actions={<Button variant="outline" onClick={returnToCatalog}>Voltar ao catálogo</Button>}
        />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <ErrorState title="Não foi possível carregar o produto" onRetry={() => void fetchProduct({ force: true })} />
      </PageShell>
    );
  }

  const { produto } = product || {};
  if (!produto) {
    return (
      <PageShell>
        <EmptyState
          icon={Package}
          title="Dados do produto indisponíveis"
          description="Não há conteúdo suficiente para exibir este cadastro."
          actions={<Button variant="outline" onClick={returnToCatalog}>Voltar ao catálogo</Button>}
        />
      </PageShell>
    );
  }

  const hasImage = Boolean(!editing && produto.imagem && typeof produto.imagem === 'string');
  const displayName = produto.nome?.trim() || 'Produto sem nome';
  const basePrice = product?.preco_base ?? produto.preco_base;
  const hasBasePrice = basePrice != null && String(basePrice).trim() !== '';
  const hasTiers = Boolean(product?.precos && product.precos.length > 0);
  const tierPrices = product?.precos?.map((tier) => tier.unit_price ?? tier.rate).filter((price) => price != null && String(price).trim() !== '').map(Number).filter((price) => Number.isFinite(price) && price >= 0) || [];
  const previewPrice = hasBasePrice ? Number(basePrice) : tierPrices.length ? Math.min(...tierPrices) : null;
  const status = isNewProduct
    ? { value: 'Draft', label: 'Rascunho', className: 'tone-warning-soft' }
    : produto.ativo
      ? { value: 'Active', label: 'Ativo', className: '' }
      : { value: 'Archived', label: 'Arquivado', className: '' };
  const pageActions = (
    <>
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
            {saving ? (isNewProduct ? 'Criando…' : 'Salvando…') : isNewProduct ? 'Criar produto' : 'Salvar'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={cancelEditing}
            disabled={saving || deleting}
            aria-label="Cancelar edição"
          >
            <X size={14} /> Cancelar
          </Button>
        </>
      ) : (
        <Button size="sm" aria-label="Editar produto" onClick={startEditing} disabled={deleting}>
          <Edit3 size={14} /> Editar
        </Button>
      )}
      {!isNewProduct && (
        <Button variant="ghost" onClick={requestArchive} disabled={saving || deleting} aria-label={produto.ativo === false ? 'Restaurar produto' : 'Arquivar produto'} className="text-destructive hover:bg-destructive/10">
          {produto.ativo === false ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
          {deleting ? 'Atualizando…' : produto.ativo === false ? 'Restaurar' : 'Arquivar'}
        </Button>
      )}
    </>
  );

  return (
    <PageShell className="space-y-6">
      <fieldset disabled={saving} className="space-y-6">
      <PageHeader
        leading={
          hasImage ? (
            <img src={produto.imagem ?? undefined} alt={displayName} className="size-14 rounded-control object-cover" />
          ) : (
            <div className="grid size-14 place-items-center rounded-control bg-sage text-sage-ink" aria-label="Imagem não cadastrada">
              <Package size={20} aria-hidden="true" />
            </div>
          )
        }
        eyebrow={<span className="font-mono">{produto.sku || 'SKU não informado'}</span>}
        title={isNewProduct ? 'Novo produto' : displayName}
        meta={<StatusBadge status={status.value} label={status.label} className={status.className} />}
        actions={pageActions}
      />

      {isDuplicateDraft && (
        <InlineAlert tone="warning">
          <strong>Rascunho de duplicação.</strong> Dados copiados; preencha o SKU antes de criar o produto.
        </InlineAlert>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 xl:col-start-1 xl:row-start-1">
        <SectionCard title="Informações do produto" icon={Package}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {editing && (
              <div className="order-2">
                <label htmlFor="product-name" className="text-[11px] font-medium text-fg-muted">Nome</label>
                <Input
                  id="product-name"
                  value={edited.nome || ''}
                  onChange={(e) => setEdited((prev) => ({ ...prev, nome: e.target.value }))}
                  className="mt-1 text-sm"
                  placeholder="Nome do produto"
                />
              </div>
            )}

            {editing ? (
              <div className="order-7 md:col-span-2">
                <label htmlFor="product-description" className="text-[11px] font-medium text-fg-muted">
                  Descrição
                </label>
                <textarea
                  id="product-description"
                  value={edited.descricao || ''}
                  onChange={(event) =>
                    setEdited((previous) => ({ ...previous, descricao: event.target.value }))
                  }
                  className="mt-1.5 min-h-[112px] w-full resize-y rounded-control border border-border-control bg-raised px-3 py-2 text-sm leading-5 text-fg placeholder:text-fg-muted"
                  placeholder="Descrição do produto"
                  maxLength={4000}
                />
              </div>
            ) : (
              <InfoField label="Descrição" value={produto.descricao || '—'} />
            )}

            {editing ? (
              <div className="order-1">
                <label htmlFor="product-sku" className="text-[11px] font-medium text-fg-muted">SKU</label>
                <Input
                  id="product-sku"
                  value={isNewProduct ? edited.sku || '' : produto.sku || ''}
                  disabled={!isNewProduct}
                  onChange={(e) => setEdited((prev) => ({ ...prev, sku: e.target.value }))}
                  className="mt-1 text-sm font-mono"
                  placeholder="LNC-SED-70"
                  maxLength={120}
                />
              </div>
            ) : (
              <InfoField label="SKU" value={produto.sku} />
            )}

            {editing ? (
              <div className="order-6 flex min-w-0 flex-col">
                <label htmlFor="product-status" className="block text-[11px] font-medium text-fg-muted">Status</label>
                <Select
                  id="product-status"
                  value={edited.ativo ? 'ativo' : 'inativo'}
                  onChange={(event) =>
                    setEdited((previous) => ({
                      ...previous,
                      ativo: event.target.value === 'ativo',
                    }))
                  }
                  className="mt-1 w-full"
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </Select>
              </div>
            ) : (
              <InfoField label="Status" value={produto.ativo ? 'Ativo' : 'Arquivado'} />
            )}

            {editing ? (
              <div className="order-3">
                <label htmlFor="product-category" className="text-[11px] font-medium text-fg-muted">
                  Categoria
                </label>
                <Input
                  id="product-category"
                  value={edited.categoria || ''}
                  onChange={(e) => setEdited((prev) => ({ ...prev, categoria: e.target.value }))}
                  className="mt-1 text-sm"
                  placeholder="Categoria"
                  maxLength={255}
                />
              </div>
            ) : (
              <InfoField label="Categoria" value={produto.categoria || '—'} />
            )}

            {editing ? (
              <div className="order-5">
                <label htmlFor="product-brand" className="text-[11px] font-medium text-fg-muted">Marca</label>
                <Input
                  id="product-brand"
                  value={edited.marca || ''}
                  onChange={(e) => setEdited((prev) => ({ ...prev, marca: e.target.value }))}
                  className="mt-1 text-sm"
                  placeholder="Marca"
                  maxLength={255}
                />
              </div>
            ) : (
              <InfoField label="Marca" value={produto.marca || '—'} />
            )}

            {editing ? (
              <div className="order-8">
                <label htmlFor="product-unit-cost" className="text-[11px] font-medium text-fg-muted">
                  Custo unitário (R$)
                </label>
                <Input
                  id="product-unit-cost"
                  inputMode="decimal"
                  aria-label="Custo unitário"
                  value={edited.custoUnitario ?? ''}
                  onChange={(e) =>
                    setEdited((prev) => ({ ...prev, custoUnitario: e.target.value }))
                  }
                  className="mt-1 text-sm font-mono"
                  placeholder="0,00"
                />
              </div>
            ) : (
              <InfoField
                label="Custo unitário"
                value={produto.custo_unitario != null && String(produto.custo_unitario) !== '' ? formatBRL(produto.custo_unitario) : '—'}
              />
            )}

            {editing ? (
              <div className="order-4">
                <label htmlFor="product-unit" className="text-[11px] font-medium text-fg-muted">Unidade</label>
                <Input
                  id="product-unit"
                  value={edited.unidade || ''}
                  onChange={(e) => setEdited((prev) => ({ ...prev, unidade: e.target.value }))}
                  className="mt-1 text-sm"
                  placeholder="Und"
                  maxLength={32}
                />
              </div>
            ) : (
              <InfoField label="Unidade" value={produto.unidade || '—'} />
            )}

            <div className="order-9"><InfoField
              label="Criado / modificado"
              value={produto.modificado_em ? formatDate(produto.modificado_em) : '—'}
            /></div>
          </div>
        </SectionCard>
        </div>
        <div className="min-w-0 xl:col-start-1 xl:row-start-2">
        <SectionCard
          title="Faixas de preço"
          icon={Tag}
        >
          {editing ? (
            <div className="space-y-4">
              {!edited.precoBase?.trim() && (edited.tiers || []).length === 0 && (
                <InlineAlert tone="warning">Preço indisponível para este produto.</InlineAlert>
              )}
              <div className="max-w-xs">
                <label htmlFor="product-base-price" className="text-xs font-medium text-fg-muted">Preço base (opcional)</label>
                <Input
                  id="product-base-price"
                  type="number"
                  step="0.01"
                  min="0.01"
                  aria-label="Preço base"
                  value={edited.precoBase ?? ''}
                  onChange={(event) =>
                    setEdited((previous) => ({ ...previous, precoBase: event.target.value }))
                  }
                  className="mt-1 text-sm font-mono"
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-fg-muted">Faixas de quantidade</p>
                    <p className="text-xs text-fg-muted">
                      A maior quantidade mínima aplicável define o preço unitário.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label="Adicionar faixa de preço"
                    onClick={() =>
                      setEdited((previous) => ({
                        ...previous,
                        tiers: [
                          ...(previous.tiers || []),
                          { minimum_quantity: '', unit_price: '' },
                        ],
                      }))
                    }
                  >
                    <Tag size={14} className="mr-1" /> Adicionar faixa
                  </Button>
                </div>
                {(edited.tiers || []).length === 0 && (
                  <p className="rounded-control border border-dashed border-line bg-raised px-3 py-3 text-xs text-fg-muted">
                    Nenhuma faixa configurada. O preço base será usado quando preenchido.
                  </p>
                )}
                <div className="space-y-2">
                  {(edited.tiers || []).map((tier, index) => (
                    <div
                      key={`tier-${index}`}
                      className="grid grid-cols-1 items-end gap-3 rounded-control bg-raised p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                    >
                      <label className="text-xs text-fg-muted">
                        Quantidade mínima
                        <Input
                          type="number"
                          step="0.001"
                          min="0.001"
                          aria-label={`Quantidade mínima da faixa ${index + 1}`}
                          value={tier.minimum_quantity}
                          onChange={(event) =>
                            setEdited((previous) => ({
                              ...previous,
                              tiers: (previous.tiers || []).map((row, rowIndex) =>
                                rowIndex === index
                                  ? { ...row, minimum_quantity: event.target.value }
                                  : row
                              ),
                            }))
                          }
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
                          onChange={(event) =>
                            setEdited((previous) => ({
                              ...previous,
                              tiers: (previous.tiers || []).map((row, rowIndex) =>
                                rowIndex === index
                                  ? { ...row, unit_price: event.target.value }
                                  : row
                              ),
                            }))
                          }
                          className="mt-1 text-sm font-mono"
                        />
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Remover faixa ${index + 1}`}
                        onClick={() =>
                          setEdited((previous) => ({
                            ...previous,
                            tiers: (previous.tiers || []).filter(
                              (_row, rowIndex) => rowIndex !== index
                            ),
                          }))
                        }
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
              {hasBasePrice ? (
                <div className="max-w-xs rounded-control bg-raised p-4">
                  <p className="text-[11px] uppercase tracking-wide text-fg-muted font-medium">
                    Preço base
                  </p>
                  <p className="mt-1 text-sm font-medium text-fg font-mono">
                    {formatBRL(basePrice)}
                  </p>
                </div>
              ) : null}
              {hasTiers ? (
                <div className="overflow-x-auto rounded-control bg-surface">
                  <Table className="min-w-[360px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quantidade mínima</TableHead>
                        <TableHead className="text-right">Preço unitário</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {product?.precos?.map((tier, index) => {
                        const quantity = tier.minimum_quantity ?? tier.faixa ?? tier.qty;
                        const rate = tier.unit_price ?? tier.rate;
                        return (
                          <TableRow key={`saved-tier-${index}`}>
                            <TableCell className="font-mono text-sm">
                              A partir de {formatQuantity(quantity)} un.
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-medium">
                              {rate != null ? formatBRL(rate) : '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : !hasBasePrice ? (
                <InlineAlert tone="warning">Preço indisponível para este produto.</InlineAlert>
              ) : null}
            </div>
          )}
        </SectionCard>
        </div>
        <aside className="rounded-card bg-surface p-5 xl:col-start-2 xl:row-start-1" aria-label="Prévia do cadastro">
          <h2 className="text-base font-semibold">Prévia do cadastro</h2>
          <div className="mt-5 flex h-44 items-end justify-between rounded-control bg-sage p-5 text-sage-ink"><Package size={32} strokeWidth={1.5} aria-hidden="true" /><span className="text-xl font-semibold">{previewPrice === null ? '—' : formatBRL(previewPrice)}</span></div>
          {!hasBasePrice && tierPrices.length > 0 && <p className="mt-2 text-xs text-fg-muted">A partir de, conforme a quantidade.</p>}
          <p className="mt-4 text-xs leading-5 text-fg-muted">{produto.categoria || 'Sem categoria'} · {produto.unidade || 'Unidade não informada'}</p>
        </aside>
      </div>

      {!isNewProduct && (
        <SectionCard
          title="Atividade recente"
          description={
            produto.modificado_em
              ? `Última atualização: ${formatDate(produto.modificado_em)}`
              : undefined
          }
          icon={FileText}
        >
          {activityLoading ? (
            <p className="text-sm text-fg-muted" role="status">
              Carregando atividade…
            </p>
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
                  className="rounded-control bg-raised px-4 py-3 text-sm"
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

      </fieldset>
      <ConfirmDialog
        open={confirmArchiveOpen}
        title={product?.produto.ativo === false ? 'Restaurar produto' : 'Arquivar produto'}
        message={`Tem certeza que deseja ${product?.produto.ativo === false ? 'restaurar' : 'arquivar'} o produto ${decodedSku}?`}
        confirmLabel={product?.produto.ativo === false ? 'Restaurar' : 'Arquivar'}
        cancelLabel="Cancelar"
        variant={product?.produto.ativo === false ? 'default' : 'destructive'}
        onConfirm={() => {
          setConfirmArchiveOpen(false);
          void deleteProduct();
        }}
        onCancel={() => setConfirmArchiveOpen(false)}
      />
      <ConfirmDialog
        open={confirmDiscardEdits}
        title="Descartar alterações?"
        message="As alterações do cadastro e dos preços que ainda não foram salvas serão perdidas."
        confirmLabel="Descartar"
        cancelLabel="Continuar editando"
        variant="destructive"
        onConfirm={discardEditing}
        onCancel={() => setConfirmDiscardEdits(false)}
      />
      <ConfirmDialog
        open={pendingRoute !== null}
        title="Sair sem salvar?"
        message="As alterações do cadastro e dos preços que ainda não foram salvas serão perdidas."
        confirmLabel="Sair da página"
        cancelLabel="Continuar editando"
        variant="default"
        onConfirm={() => {
          const target = pendingRoute;
          setPendingRoute(null);
          setNavigationGuard(null);
          if (target) window.location.hash = target;
        }}
        onCancel={() => setPendingRoute(null)}
      />
    </PageShell>
  );
}
