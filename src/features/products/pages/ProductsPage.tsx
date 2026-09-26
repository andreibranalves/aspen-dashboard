import { useState, useEffect, useCallback, useRef, useMemo, type ChangeEvent } from 'react';
import {
  Tag,
  PlusCircle,
  Archive,
  ArchiveRestore,
  X,
} from 'lucide-react';
import { useHashRoute } from '@/hooks/useHashRoute';
import {
  parseHashAllowedInteger,
  parseHashOption,
  parseHashPositiveInteger,
  parseHashString,
  useHashQueryState,
} from '@/hooks/useHashQueryState';
import { apiGet, apiDelete, apiPatch } from '@/lib/api/api';
import { formatBRL } from '@/lib/formatting/formatters';
import { clearProductCache } from '@/lib/api/productCache';
import { Button } from '@/components/ui/button';
import ErrorState from '@/components/shared/ErrorState';
import { SearchField } from '@/components/ui/search-field';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/EmptyState';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import PageHeader from '@/components/shared/PageHeader';
import ListPageLayout, { ListSection } from '@/components/shared/ListPageLayout';
import ListPagination from '@/components/shared/ListPagination';
import DataList, { type DataListColumn } from '@/components/shared/DataList';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { Text } from '@/components/ui/text';
import ExportCsvButton from '@/components/shared/ExportCsvButton';
import BulkActionBar from '@/components/shared/BulkActionBar';
import { useToast } from '@/components/shared/toast';
import { projectProductListResponse, type ProjectedProductListRow } from '@/lib/localProjections';

type Product = ProjectedProductListRow & { categoria?: string };
type ProductsApiResponse = unknown;

const PAGE_SIZES = [10, 25, 50];
const DEFAULT_SORT = 'modified desc';

interface SortOption {
  value: string;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: 'item_name asc', label: 'Nome (A–Z)' },
  { value: DEFAULT_SORT, label: 'Atualização (mais recente)' },
  { value: 'modified asc', label: 'Atualização (mais antiga)' },
  { value: 'item_code asc', label: 'Código SKU (A–Z)' },
];

type ProductStatus = 'active' | 'archived' | 'all';
const parseProductStatus = parseHashOption<ProductStatus>(['active', 'archived', 'all']);
const parseProductSort = parseHashOption(SORT_OPTIONS.map((option) => option.value));
const parseProductLimit = parseHashAllowedInteger(PAGE_SIZES);

type PendingProductArchive =
  | { kind: 'single'; sku: string; archived: boolean }
  | { kind: 'bulk'; skus: string[]; archived: boolean };

/** Normaliza abreviações de unidade para o padrão pt-BR (un/pç). */
function normalizeUom(value: string | undefined): string {
  const raw = (value || '').trim().toLowerCase();
  if (!raw) return 'und';
  if (['nos', 'no', 'un', 'unds'].includes(raw)) return 'un';
  if (['pc', 'pç', 'pcs', 'pca'].includes(raw)) return 'pç';
  return raw;
}

function isArchivedProduct(product: Product): boolean {
  return product.ativo === false;
}

function archiveDialogText(pending: PendingProductArchive): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  if (pending.kind === 'single') {
    const action = pending.archived ? 'Restaurar' : 'Arquivar';
    return {
      title: `${action} produto`,
      message: `Tem certeza que deseja ${action.toLowerCase()} o produto ${pending.sku}?`,
      confirmLabel: action,
    };
  }
  const action = pending.archived ? 'Restaurar' : 'Arquivar';
  const count = pending.skus.length;
  return {
    title: `${action} produtos`,
    message: `Tem certeza que deseja ${action.toLowerCase()} ${count} produto${count !== 1 ? 's' : ''}?`,
    confirmLabel: action,
  };
}

function productStatus(product: Product): { status: string; label: string } {
  return isArchivedProduct(product)
    ? { status: 'Archived', label: 'Arquivado' }
    : { status: 'Active', label: 'Ativo' };
}

interface ProductsPageProps {
  showHeader?: boolean;
  onCountChange?: (count: number) => void;
}

export default function ProductsPage({ showHeader = true, onCountChange }: ProductsPageProps) {
  const [data, setData] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useHashQueryState('search', '', parseHashString);
  const [searchInput, setSearchInput] = useState(search);
  const [page, setPage] = useHashQueryState('page', 1, parseHashPositiveInteger);
  const [limit, setLimit] = useHashQueryState('limit', 10, parseProductLimit);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  useEffect(() => { onCountChange?.(totalRecords); }, [onCountChange, totalRecords]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [sort, setSort] = useHashQueryState('sort', DEFAULT_SORT, parseProductSort);
  const [status, setStatus] = useHashQueryState<ProductStatus>(
    'status',
    'all',
    parseProductStatus
  );
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRequestGenerationRef = useRef(0);
  const listRequestKeyRef = useRef<string | null>(null);
  const clearPendingSearch = useCallback(() => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
  }, []);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const [, navigate] = useHashRoute();

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const fetchData = useCallback(
    async (
      searchValue: string,
      pageValue: number,
      limitValue: number,
      sortValue: string,
      statusValue: ProductStatus
    ) => {
      const requestKey = JSON.stringify([
        searchValue,
        pageValue,
        limitValue,
        sortValue,
        statusValue,
      ]);
      const requestGeneration =
        requestKey === listRequestKeyRef.current
          ? listRequestGenerationRef.current
          : listRequestGenerationRef.current + 1;
      listRequestGenerationRef.current = requestGeneration;
      listRequestKeyRef.current = requestKey;
      setLoading(true);
      setError(null);
      setSelectedIds([]);
      try {
        const params = new URLSearchParams();
        params.set('page', String(pageValue));
        params.set('limit', String(limitValue));
        if (searchValue) params.set('search', searchValue);
        if (sortValue) params.set('order_by', sortValue);
        params.set('status', statusValue);

        const result = await apiGet<ProductsApiResponse>(`/products?${params.toString()}`);
        if (requestGeneration !== listRequestGenerationRef.current) return;
        const projected = projectProductListResponse(result);
        if (!projected) throw new Error('Resposta inválida ao carregar produtos.');
        const responseRows =
          result && typeof result === 'object' && Array.isArray((result as { data?: unknown }).data)
            ? (result as { data: unknown[] }).data
            : [];
        const categories = new Map<string, string>();
        for (const row of responseRows) {
          if (!row || typeof row !== 'object') continue;
          const raw = row as Record<string, unknown>;
          const sku = typeof raw.sku === 'string' ? raw.sku : raw.item_code;
          if (typeof sku === 'string' && typeof raw.categoria === 'string' && raw.categoria.trim()) {
            categories.set(sku, raw.categoria.trim());
          }
        }
        setData(projected.data.map((product) => ({ ...product, categoria: categories.get(product.sku) })));
        setTotalPages(projected.pagination.total_pages);
        setTotalRecords(projected.pagination.total);
      } catch {
        if (requestGeneration !== listRequestGenerationRef.current) return;
        setData([]);
        setTotalPages(0);
        setTotalRecords(0);
        setError('Não foi possível carregar o catálogo. Tente novamente.');
      } finally {
        if (requestGeneration === listRequestGenerationRef.current) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void fetchData(search, page, limit, sort, status);
  }, [fetchData, search, page, limit, sort, status]);

  useEffect(() => () => clearPendingSearch(), [clearPendingSearch]);

  const onSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setSearchInput(value);
      clearPendingSearch();
      searchTimer.current = setTimeout(() => {
        searchTimer.current = null;
        setSearch(value);
        setPage(1);
      }, 350);
    },
    [clearPendingSearch, setPage, setSearch]
  );

  const onLimitChange = useCallback(
    (newLimit: number) => {
      clearPendingSearch();
      setLimit(newLimit);
      setPage(1);
    },
    [clearPendingSearch, setLimit, setPage]
  );

  const setStatusFilter = useCallback(
    (value: ProductStatus) => {
      clearPendingSearch();
      setStatus(value);
      setPage(1);
    },
    [clearPendingSearch, setPage, setStatus]
  );

  const setSortFilter = useCallback(
    (value: string) => {
      clearPendingSearch();
      setSort(value);
      setPage(1);
    },
    [clearPendingSearch, setPage, setSort]
  );

  const clearFilters = useCallback(() => {
    clearPendingSearch();
    setSearchInput('');
    setSearch('');
    setStatus('all');
    setSort(DEFAULT_SORT);
    setPage(1);
  }, [clearPendingSearch, setPage, setSearch, setSort, setStatus]);

  // ── Selection ──

  const toggleSelected = useCallback((sku: string) => {
    setSelectedIds((previous) =>
      previous.includes(sku) ? previous.filter((id) => id !== sku) : [...previous, sku]
    );
  }, []);

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedIds(
        checked ? data.map((row) => row.sku || row.item_code || '').filter(Boolean) : []
      );
    },
    [data]
  );

  const allSelected = data.length > 0 && selectedIds.length === data.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  // ── Archive / restore ──

  const { toast } = useToast();
  const [pendingArchive, setPendingArchive] = useState<PendingProductArchive | null>(null);
  const archiveDialog = useMemo(
    () => (pendingArchive ? archiveDialogText(pendingArchive) : null),
    [pendingArchive]
  );

  const requestArchive = useCallback((sku: string, archived: boolean) => {
    setPendingArchive({ kind: 'single', sku, archived });
  }, []);

  const requestBulkArchive = useCallback(() => {
    const skus = data
      .filter((row) => selectedIds.includes(row.sku || row.item_code || ''))
      .map((row) => row.sku || row.item_code || '')
      .filter(Boolean);
    if (skus.length === 0) return;
    setPendingArchive({ kind: 'bulk', skus, archived: status === 'archived' });
  }, [data, selectedIds, status]);

  const runArchive = useCallback(
    async (pending: PendingProductArchive) => {
      if (pending.kind === 'single') {
        const { sku, archived } = pending;
        try {
          if (archived) {
            await apiPatch(`/product-update?sku=${encodeURIComponent(sku)}`, { ativo: true });
          } else {
            await apiDelete(`/products?id=${encodeURIComponent(sku)}`);
          }
          clearProductCache();
          toast(archived ? `Produto ${sku} restaurado.` : `Produto ${sku} arquivado.`, 'success');
          await fetchData(search, page, limit, sort, status);
        } catch {
          toast(
            archived ? `Erro ao restaurar o produto ${sku}.` : `Erro ao arquivar o produto ${sku}.`,
            'error'
          );
        }
        return;
      }

      const { skus, archived } = pending;
      const results = await Promise.allSettled(
        skus.map((sku) =>
          archived
            ? apiPatch(`/product-update?sku=${encodeURIComponent(sku)}`, { ativo: true })
            : apiDelete(`/products?id=${encodeURIComponent(sku)}`)
        )
      );
      const successCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = results.length - successCount;
      clearProductCache();
      const nextPage = successCount === data.length && page > 1 ? page - 1 : page;
      setPage(nextPage);
      await fetchData(search, nextPage, limit, sort, status);
      const action = archived ? 'restaurado' : 'arquivado';
      if (failedCount === 0) {
        toast(
          `${successCount} produto${successCount !== 1 ? 's' : ''} ${action}${successCount !== 1 ? 's' : ''}.`,
          'success'
        );
      } else if (successCount > 0) {
        toast(`${successCount} concluído(s); ${failedCount} falhou(aram).`, 'error');
      } else {
        toast(
          archived
            ? 'Erro ao restaurar os produtos selecionados.'
            : 'Erro ao arquivar os produtos selecionados.',
          'error'
        );
      }
    },
    [data.length, fetchData, limit, page, search, setPage, sort, status, toast]
  );

  const selectedCount = selectedIds.length;
  const hasFilters = Boolean(search.trim()) || status !== 'all';

  const productSku = (product: (typeof data)[number]) => product.sku || product.item_code || '';
  const productName = (product: (typeof data)[number]) => product.nome || product.item_name || 'Produto sem nome';
  const priceLabel = (product: (typeof data)[number]) =>
    product.pricing_available && product.preco_minimo != null ? formatBRL(product.preco_minimo) : 'Sem preço';

  const selectBox = (product: (typeof data)[number]) => (
    <input
      type="checkbox"
      checked={selectedIds.includes(productSku(product))}
      onChange={() => toggleSelected(productSku(product))}
      aria-label={`Selecionar produto ${productSku(product)}`}
      className="size-4 rounded-xs border-line accent-light-sage"
    />
  );

  const archiveButton = (product: (typeof data)[number]) => {
    const sku = productSku(product);
    const archived = isArchivedProduct(product);
    return (
      <Button
        variant="ghost-muted-destructive"
        size="icon"
        aria-label={`${archived ? 'Restaurar' : 'Arquivar'} produto ${sku}`}
        title={`${archived ? 'Restaurar produto' : 'Arquivar produto (não exclui)'} — ${sku}`}
        onClick={() => requestArchive(sku, archived)}
      >
        {archived ? <ArchiveRestore /> : <Archive />}
      </Button>
    );
  };

  const columns: DataListColumn<(typeof data)[number]>[] = [
    ...(selectionMode
      ? [{
          key: 'select',
          interactive: true,
          header: (
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={(event: ChangeEvent<HTMLInputElement>) => toggleSelectAll(event.target.checked)}
              aria-label="Selecionar todos os produtos desta página"
              className="size-4 rounded-xs border-line accent-light-sage"
            />
          ),
          cell: selectBox,
        }]
      : []),
    {
      key: 'product',
      header: 'Produto',
      cell: (product) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <Text variant="title" truncate title={productName(product)}>{productName(product)}</Text>
          <Text variant="id">{productSku(product) || '—'}</Text>
        </div>
      ),
    },
    { key: 'category', header: 'Categoria', hideBelow: 'lg', cell: (product) => <Text variant="meta">{product.categoria?.trim() || '—'}</Text> },
    { key: 'uom', header: 'Unidade', cell: (product) => <Text variant="meta">{normalizeUom(product.unidade || product.stock_uom)}</Text> },
    { key: 'price', header: 'Preço-base', align: 'right', cell: (product) => <Text variant="value">{priceLabel(product)}</Text> },
    { key: 'status', header: 'Status', cell: (product) => { const state = productStatus(product); return <StatusBadge status={state.status} label={state.label} />; } },
    { key: 'actions', header: <span className="sr-only">Ações</span>, interactive: true, align: 'right', cell: archiveButton },
  ];

  return (
    <ListPageLayout
      header={showHeader && (
        <PageHeader
          title="Produtos"
          actions={
            <>
              <ExportCsvButton resource="products" filters={{ search, status, order_by: sort }}>
                Exportar produtos
              </ExportCsvButton>
              <ExportCsvButton
                resource="product-pricing"
                filters={{ search, status, order_by: sort }}
              >
                Exportar faixas de preço
              </ExportCsvButton>
              <Button onClick={() => navigate('/products/new')}>
                <PlusCircle />
                Novo produto
              </Button>
            </>
          }
        />
      )}
    >
      <ListSection
        label="Lista de produtos"
        pagination={!loading && !error && data.length > 0 && (
          <ListPagination label="Paginação de produtos" page={page} limit={limit} pageSizes={PAGE_SIZES} hasNext={page < totalPages} onPageChange={setPage} onLimitChange={onLimitChange} />
        )}
        toolbar={<>
        <SearchField
          id="product-search"
          placeholder="Buscar produto ou SKU"
          value={searchInput}
          onChange={onSearchChange}
          aria-label="Buscar produtos"
        />
        <Select value={status} onChange={(event) => setStatusFilter(event.target.value as ProductStatus)} aria-label="Filtrar produtos por status">
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="archived">Arquivados</option>
        </Select>
        <Select value={sort} onChange={(event) => setSortFilter(event.target.value)} aria-label="Ordenar produtos">
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
        {(hasFilters || sort !== DEFAULT_SORT) && (
          <Button type="button" variant="ghost" onClick={clearFilters}>
            <X aria-hidden="true" />
            Limpar filtros
          </Button>
        )}
        <Button type="button" variant="ghost" className="ml-auto" aria-pressed={selectionMode} onClick={() => { setSelectionMode((current) => !current); setSelectedIds([]); }}>
          {selectionMode ? 'Cancelar seleção' : 'Selecionar'}
        </Button>
      </>}
      >

      {showHeader && <div
        className="flex min-h-5 items-center justify-between gap-3 text-xs text-fg-muted"
        aria-live="polite"
      >
        <span>
          {loading
            ? 'Carregando produtos…'
            : `${totalRecords} produto${totalRecords === 1 ? '' : 's'} no catálogo`}
        </span>
        {search && !loading && (
          <span className="max-w-[50%] truncate">Busca: &quot;{search}&quot;</span>
        )}
      </div>}

      {loading && <SkeletonTable cols={5} rows={Math.min(limit, 10)} />}

      {!loading && error && (
        <ErrorState title="Não foi possível carregar os produtos" onRetry={() => void fetchData(search, page, limit, sort, status)} />
      )}

      {!loading && !error && data.length === 0 && (
        <EmptyState
          icon={Tag}
          title={
            hasFilters
              ? 'Nenhum produto encontrado para estes filtros'
              : 'Nenhum produto encontrado'
          }
          description={
            hasFilters
              ? 'Ajuste a busca ou os filtros para encontrar produtos.'
              : 'Cadastre o primeiro produto para começar a montar seus orçamentos.'
          }
          actions={
            hasFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                <X />
                Limpar filtros
              </Button>
            ) : (
              <Button onClick={() => navigate('/products/new')}>
                <PlusCircle />
                Novo produto
              </Button>
            )
          }
        />
      )}

      {!loading && !error && data.length > 0 && (
        <DataList
          label="Produtos do catálogo"
          items={data}
          getKey={(product) => productSku(product)}
          columns={columns}
          getHref={(product) => `#/products/${encodeURIComponent(productSku(product))}`}
          getRowLabel={(product) => `Abrir produto ${productSku(product)}: ${productName(product)}`}
          isSelected={(product) => selectedIds.includes(productSku(product))}
          mobileLead={selectionMode ? selectBox : undefined}
          mobileAside={archiveButton}
          mobileRow={(product) => {
            const state = productStatus(product);
            return (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Text variant="title" truncate>{productName(product)}</Text>
                  <Text variant="value" className="shrink-0">{priceLabel(product)}</Text>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Text variant="meta" truncate>
                    <span className="font-mono">{productSku(product) || '—'}</span>
                    {product.categoria?.trim() && ` · ${product.categoria.trim()}`}
                  </Text>
                  <StatusBadge status={state.status} label={state.label} className="shrink-0" />
                </div>
              </div>
            );
          }}
        />
      )}

      </ListSection>

      <BulkActionBar visible={selectedCount > 0}>
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <span>
            {selectedCount} produto{selectedCount !== 1 ? 's' : ''} selecionado
            {selectedCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setSelectedIds([])}
            disabled={selectedCount === 0}
          >
            Limpar seleção
          </Button>
          <Button
            variant={status === 'archived' ? 'outline' : 'outline-destructive'}
            onClick={requestBulkArchive}
            disabled={selectedCount === 0}
          >
            {status === 'archived' ? <ArchiveRestore /> : <Archive />}
            {status === 'archived' ? 'Restaurar produtos' : 'Arquivar produtos'}
          </Button>
        </div>
      </BulkActionBar>

      <ConfirmDialog
        open={archiveDialog !== null}
        title={archiveDialog?.title}
        message={archiveDialog?.message}
        confirmLabel={archiveDialog?.confirmLabel}
        cancelLabel="Cancelar"
        variant={pendingArchive?.archived ? 'default' : 'destructive'}
        onConfirm={() => {
          const pending = pendingArchive;
          setPendingArchive(null);
          if (pending) void runArchive(pending);
        }}
        onCancel={() => setPendingArchive(null)}
      />
    </ListPageLayout>
  );
}
