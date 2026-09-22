import { useState, useEffect, useCallback, useRef, useMemo, type ChangeEvent } from 'react';
import {
  Search,
  AlertTriangle,
  Tag,
  PlusCircle,
  Archive,
  ArchiveRestore,
  X,
  PackageOpen,
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
import { Input } from '@/components/ui/input';
import { FilterChip } from '@/components/ui/filter-chip';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/EmptyState';
import SkeletonTable from '@/components/shared/SkeletonTable';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import PageToolbar from '@/components/shared/PageToolbar';
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
    (event: ChangeEvent<HTMLSelectElement>) => {
      const newLimit = Number(event.target.value);
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

  const getPageNumbers = (): number[] => {
    if (totalPages <= 1) return [];
    const start = Math.max(1, Math.min(page - 3, totalPages - 6));
    const end = Math.min(totalPages, start + 6);
    const numbers: number[] = [];
    for (let current = start; current <= end; current += 1) numbers.push(current);
    return numbers;
  };

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

  return (
    <PageShell className="pb-28">
      {showHeader && (
        <PageHeader
          className="[&_h1]:text-[28px] [&_h1]:tracking-[-0.035em]"
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
              <Button size="md" onClick={() => navigate('/products/new')}>
                <PlusCircle />
                Novo produto
              </Button>
            </>
          }
        />
      )}

      <PageToolbar className="w-full items-center gap-3">
        <div className="min-w-0 flex-1 basis-full lg:w-52 lg:flex-none lg:basis-auto">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
              aria-hidden="true"
            />
            <Input
              id="product-search"
              placeholder="Buscar produto ou SKU"
              value={searchInput}
              onChange={onSearchChange}
              className="pl-9"
              aria-label="Buscar produtos"
            />
          </div>
        </div>

        <Select value={status} onChange={(event) => setStatusFilter(event.target.value as ProductStatus)} aria-label="Filtrar produtos por status" className="lg:w-36">
          <option value="all">Todos os status</option><option value="active">Ativos</option><option value="archived">Arquivados</option>
        </Select>
        <button type="button" className="ml-auto rounded-control px-3 py-2 text-xs text-fg-muted hover:bg-raised hover:text-fg" aria-pressed={selectionMode} onClick={() => { setSelectionMode((current) => !current); setSelectedIds([]); }}>{selectionMode ? 'Cancelar seleção' : 'Selecionar'}</button>
      <details className="relative text-xs text-fg-muted">
        <summary className="w-fit cursor-pointer rounded-control px-2 py-1 hover:bg-raised">Ordenar</summary>
      <div className="absolute right-0 top-full z-20 min-w-[280px] rounded-card bg-raised p-3 shadow-xl">
      <PageToolbar className="justify-between gap-2">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Ordenar produtos"
        >
          <span className="mr-1 text-xs font-medium text-fg-muted">Ordenar por</span>
          {SORT_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              selected={sort === option.value}
              onClick={() => setSortFilter(option.value)}
            >
              {option.label}
            </FilterChip>
          ))}
        </div>
        {(hasFilters || sort !== DEFAULT_SORT) && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            <X />
            Limpar filtros
          </Button>
        )}
      </PageToolbar>
      </div>
      </details>
      </PageToolbar>

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

      {loading && <SkeletonTable cols={5} rows={6} size="sm" />}

      {!loading && error && (
        <div
          className="flex flex-col items-center gap-3 rounded-card border border-destructive/30 bg-destructive/5 px-5 py-12 text-center text-fg-muted"
          role="alert"
        >
          <AlertTriangle size={32} className="text-destructive" aria-hidden="true" />
          <h2 className="text-base font-semibold text-fg">Erro ao carregar produtos</h2>
          <p className="max-w-md text-sm">Não foi possível carregar o catálogo. Tente novamente.</p>
          <Button
            variant="outline"
            onClick={() => void fetchData(search, page, limit, sort, status)}
          >
            Tentar novamente
          </Button>
        </div>
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
        <section aria-label="Produtos do catálogo" className="space-y-3">
          {selectionMode && <label className="flex w-fit items-center gap-2 text-xs font-medium text-fg-muted">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={(event) => toggleSelectAll(event.target.checked)}
              aria-label="Selecionar todos os produtos desta página"
              className="h-4 w-4 rounded border-line accent-light-sage focus:ring-light-sage"
            />
            Selecionar página
          </label>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.map((product, index) => {
              const sku = product.sku || product.item_code || '';
              const isSelected = selectedIds.includes(sku);
              const archived = isArchivedProduct(product);
              const state = productStatus(product);
              const name = product.nome || product.item_name || 'Produto sem nome';
              const category = product.categoria?.trim();
              const visualTone = ['bg-sage', 'bg-orange', 'bg-taupe'][index % 3];
              return (
                <article
                  key={sku}
                  data-state={isSelected ? 'selected' : undefined}
                  className="group rounded-card bg-surface p-4 transition-colors hover:bg-surface-hover data-[state=selected]:ring-2 data-[state=selected]:ring-light-sage"
                >
                  <div className={`relative flex h-[110px] items-end justify-between rounded-[17px] p-4 text-on-solid ${visualTone}`}>
                    <strong className="text-[23px] font-semibold tracking-tight tabular-nums">{product.pricing_available && product.preco_minimo != null ? formatBRL(product.preco_minimo) : 'Preço indisponível'}</strong>
                    <PackageOpen size={48} strokeWidth={1.25} className="opacity-35" aria-hidden="true" />
                    {selectionMode && <label className="absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-control bg-page/80">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(sku)}
                        aria-label={`Selecionar produto ${sku}`}
                        className="h-4 w-4 rounded border-line accent-light-sage focus:ring-light-sage"
                      />
                    </label>}
                  </div>
                  <div className="space-y-3 px-1 pt-4">
                    <button
                      type="button"
                      onClick={() => navigate(`/products/${encodeURIComponent(sku)}`)}
                      className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-sage focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                      aria-label={`Abrir produto ${sku}: ${name}`}
                    >
                      <span className="block truncate text-sm font-semibold text-fg" title={name}>
                        {name}
                      </span>
                      <span className="mt-1 block truncate text-xs text-fg-muted">
                        <span className="font-mono">{sku || 'SKU não informado'}</span>
                        <span aria-hidden="true"> · </span>
                        {category || 'Sem categoria'}
                      </span>
                    </button>
                    <div className="flex items-center justify-between gap-3 pt-2">
                      <span className="truncate text-xs text-fg-muted">
                        Preço-base / {normalizeUom(product.unidade || product.stock_uom)}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <StatusBadge status={state.status} label={state.label} />
                        <span className="hidden group-hover:inline-flex group-focus-within:inline-flex"><Button
                          variant="ghost"
                          size="icon"
                          className="text-fg-muted hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`${archived ? 'Restaurar' : 'Arquivar'} produto ${sku}`}
                          title={`${archived ? 'Restaurar produto' : 'Arquivar produto (não exclui)'} — ${sku}`}
                          onClick={() => requestArchive(sku, archived)}
                        >
                          {archived ? <ArchiveRestore /> : <Archive />}
                        </Button></span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-3 text-fg-muted"><span>Página {page} de {totalPages || 1} · {totalRecords} produto{totalRecords !== 1 ? 's' : ''}</span><label className="flex items-center gap-2 text-xs">Itens por página <Select value={limit} onChange={onLimitChange} aria-label="Itens por página">{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</Select></label></div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              ‹ <span className="hidden sm:inline">Anterior</span>
            </Button>
            {getPageNumbers().map((number) => (
              <Button
                key={number}
                variant={number === page ? 'default' : 'outline'}
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => setPage(number)}
              >
                {number}
              </Button>
            ))}
            <span className="px-2 text-xs text-fg-muted sm:hidden">
              {page}/{totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              <span className="hidden sm:inline">Próximo</span> ›
            </Button>
          </div>
        </div>
      )}

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
            variant="outline"
            className={
              status === 'archived'
                ? ''
                : 'text-destructive border-destructive/20 hover:bg-destructive/10'
            }
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
    </PageShell>
  );
}
