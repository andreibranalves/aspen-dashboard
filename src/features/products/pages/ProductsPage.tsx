import { useState, useEffect, useCallback, useRef, useMemo, type ChangeEvent } from 'react';
import {
  Search,
  AlertTriangle,
  Eye,
  Tag,
  PlusCircle,
  Archive,
  ArchiveRestore,
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
import { EmptyState } from '@/components/ui/empty-state';
import SkeletonTable from '@/components/shared/SkeletonTable';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import PageToolbar from '@/components/shared/PageToolbar';
import BulkActionBar from '@/components/shared/BulkActionBar';
import { useToast } from '@/components/shared/toast';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { projectProductListResponse, type ProjectedProductListRow } from '@/lib/localProjections';

type Product = ProjectedProductListRow;
type ProductsApiResponse = unknown;

const PAGE_SIZES = [10, 25, 50];

interface SortOption {
  value: string;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: 'item_name asc', label: 'Nome (A–Z)' },
  { value: 'modified desc', label: 'Criação (mais recente)' },
  { value: 'modified asc', label: 'Criação (mais antiga)' },
  { value: 'item_code asc', label: 'Código SKU (A–Z)' },
];

type ProductStatus = 'active' | 'archived' | 'all';
const parseProductStatus = parseHashOption<ProductStatus>(['active', 'archived', 'all']);
const parseProductSort = parseHashOption(SORT_OPTIONS.map((option) => option.value));
const parseProductLimit = parseHashAllowedInteger(PAGE_SIZES);

type PendingProductArchive =
  | { kind: 'single'; sku: string; archived: boolean }
  | { kind: 'bulk'; skus: string[] };

/** Normaliza abreviações de unidade para o padrão pt-BR (un/pç). */
function normalizeUom(value: string | undefined): string {
  const raw = (value || '').trim().toLowerCase();
  if (!raw) return 'und';
  if (['nos', 'no', 'un', 'unds'].includes(raw)) return 'un';
  if (['pc', 'pç', 'pcs', 'pca'].includes(raw)) return 'pç';
  return raw;
}

function archiveDialogText(pending: PendingProductArchive): { title: string; message: string; confirmLabel: string } {
  if (pending.kind === 'single') {
    const action = pending.archived ? 'Restaurar' : 'Arquivar';
    return {
      title: `${action} produto`,
      message: `Tem certeza que deseja ${action.toLowerCase()} o produto ${pending.sku}?`,
      confirmLabel: action,
    };
  }
  const count = pending.skus.length;
  return {
    title: 'Arquivar produtos',
    message: `Tem certeza que deseja arquivar ${count} produto${count !== 1 ? 's' : ''}?`,
    confirmLabel: 'Arquivar',
  };
}

export default function ProductsPage() {
  const [data, setData] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useHashQueryState('search', '', parseHashString);
  const [page, setPage] = useHashQueryState('page', 1, parseHashPositiveInteger);
  const [limit, setLimit] = useHashQueryState('limit', 10, parseProductLimit);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sort, setSort] = useHashQueryState('sort', 'modified desc', parseProductSort);
  const [status, setStatus] = useHashQueryState<ProductStatus>('status', 'active', parseProductStatus);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPendingSearch = useCallback(() => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
  }, []);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const [, navigate] = useHashRoute();

  const fetchData = useCallback(async (searchVal: string, pageNum: number, limitVal: number, sortVal: string, statusVal = status) => {
    setLoading(true);
    setError(null);
    setSelectedIds([]);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pageNum));
      params.set('limit', String(limitVal));
      if (searchVal) params.set('search', searchVal);
      if (sortVal) params.set('order_by', sortVal);
      params.set('status', statusVal);

      const result = await apiGet<ProductsApiResponse>(`/products?${params.toString()}`);
      const projected = projectProductListResponse(result);
      if (!projected) throw new Error('Resposta inválida ao carregar produtos.');
      setData(projected.data);
      setTotalPages(projected.pagination.total_pages);
      setTotalRecords(projected.pagination.total);
    } catch (err) {
      setData([]);
      setTotalPages(0);
      setTotalRecords(0);
      setError((err as Error).message || 'Erro ao carregar produtos.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { fetchData(search, page, limit, sort, status); }, [fetchData, search, page, limit, sort, status]);
  useEffect(() => () => clearPendingSearch(), [clearPendingSearch]);

  const onSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearch(val);
    clearPendingSearch();
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      setPage(1);
      fetchData(val, 1, limit, sort, status);
    }, 350);
  }, [clearPendingSearch, limit, sort, status, fetchData]);

  const onLimitChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    const newLimit = parseInt(e.target.value, 10);
    clearPendingSearch();
    setLimit(newLimit);
    setPage(1);
    fetchData(search, 1, newLimit, sort, status);
  }, [clearPendingSearch, search, sort, status, fetchData]);

  const getPageNumbers = (): number[] => {
    if (totalPages <= 1) return [];
    const start = Math.max(1, page - 3);
    const end = Math.min(totalPages, start + 6);
    const nums: number[] = [];
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  };

  // ── Selection ──

  const toggleSelected = useCallback((sku: string) => {
    setSelectedIds((prev) =>
      prev.includes(sku) ? prev.filter((id) => id !== sku) : [...prev, sku]
    );
  }, []);

  const toggleSelectAll = useCallback((checked: boolean) => {
    setSelectedIds(checked ? data.map((row) => row.sku || row.item_code || '') : []);
  }, [data]);

  const allSelected = data.length > 0 && selectedIds.length === data.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  // ── Delete ──

  const { toast } = useToast();
  const [pendingArchive, setPendingArchive] = useState<PendingProductArchive | null>(null);
  const archiveDialog = useMemo(
    () => (pendingArchive ? archiveDialogText(pendingArchive) : null),
    [pendingArchive],
  );

  const requestArchive = useCallback((sku: string, archived: boolean) => {
    setPendingArchive({ kind: 'single', sku, archived });
  }, []);

  const requestBulkArchive = useCallback(() => {
    const skus = data
      .filter((row) => selectedIds.includes(row.sku || row.item_code || ''))
      .map((row) => row.sku || row.item_code || '')
      .filter(Boolean);
    if (skus.length === 0 || status === 'archived') return;
    setPendingArchive({ kind: 'bulk', skus });
  }, [data, selectedIds, status]);

  const runArchive = useCallback(async (pending: PendingProductArchive) => {
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
      } catch (err) {
        toast(`Erro ao ${archived ? 'restaurar' : 'arquivar'} o produto ${sku}: ` + ((err as Error).message || 'Tente novamente.'), 'error');
      }
      return;
    }

    const skus = pending.skus;
    try {
      await Promise.all(skus.map((sku) => apiDelete(`/products?id=${encodeURIComponent(sku)}`)));
      clearProductCache();
      const nextPage = skus.length === data.length && page > 1 ? page - 1 : page;
      setPage(nextPage);
      toast(`${skus.length} produto${skus.length !== 1 ? 's' : ''} arquivado${skus.length !== 1 ? 's' : ''}.`, 'success');
      await fetchData(search, nextPage, limit, sort, status);
    } catch (err) {
      toast('Erro ao arquivar produtos selecionados: ' + ((err as Error).message || 'Tente novamente.'), 'error');
    }
  }, [data.length, fetchData, limit, page, search, setPage, sort, status, toast]);

  const selectedCount = selectedIds.length;

  return (
    <PageShell className="pb-28">
      {/* PageHeader */}
      <PageHeader
        title="Produtos"
        description="Catálogo com preços da tabela — edite cada item na sua página de detalhe."
        actions={
          <Button onClick={() => navigate('/products/new')}>
            <PlusCircle />
            Novo produto
          </Button>
        }
      />

      {/* Search + Page size + Status */}
      <PageToolbar>
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <Input
            placeholder="Buscar por SKU ou nome…"
            value={search}
            onChange={onSearchChange}
            className="pl-9"
            aria-label="Buscar produtos"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <span>Itens por página</span>
          <Select
            value={limit}
            onChange={onLimitChange}
            aria-label="Itens por página"
          >
            {PAGE_SIZES.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-line bg-surface p-1 text-xs">
            {(['active', 'archived', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  clearPendingSearch();
                  setStatus(value);
                  setPage(1);
                }}
                className={`rounded-full px-3 py-1.5 transition-colors ${status === value ? 'bg-primary text-on-solid' : 'text-fg-muted hover:text-fg'}`}
              >
                {value === 'active' ? 'Ativos' : value === 'archived' ? 'Arquivados' : 'Todos'}
              </button>
            ))}
        </div>
      </PageToolbar>

      {/* Sorting */}
      <PageToolbar className="gap-2">
        <span className="text-sm text-fg-muted mr-1">Ordenar por</span>
        {SORT_OPTIONS.map(opt => (
          <FilterChip
            key={opt.value}
            selected={sort === opt.value}
            onClick={() => {
              clearPendingSearch();
              setSort(opt.value);
              setPage(1);
            }}
          >
            {opt.label}
          </FilterChip>
        ))}
      </PageToolbar>

      {/* Loading */}
      {loading && <SkeletonTable cols={5} rows={6} />}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <AlertTriangle size={32} className="text-destructive/60" />
          <p>Erro ao carregar produtos</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => fetchData(search, page, limit, sort)}>Tentar novamente</Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && data.length === 0 && (
        <EmptyState
          icon={Tag}
          title="Nenhum produto encontrado"
          description="Ajuste os filtros ou cadastre um novo produto."
          actions={
            <Button onClick={() => navigate('/products/new')}>
              <PlusCircle />
              Novo produto
            </Button>
          }
        />
      )}

      {/* Table / Mobile cards */}
      {!loading && !error && data.length > 0 && (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 px-3">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                      aria-label="Selecionar todos os produtos desta página"
                      className="h-4 w-4 rounded border-line text-primary focus:ring-primary"
                    />
                  </TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead className="pl-0">Descrição</TableHead>
                  <TableHead className="pl-6">SKU</TableHead>
                  <TableHead className="text-center pr-4">Unidade</TableHead>
                  <TableHead className="text-right pl-4">Preço</TableHead>
                  <TableHead className="text-center w-[100px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map(p => {
                  const sku = p.sku || p.item_code || '';
                  const isSelected = selectedIds.includes(sku);
                  return (
                    <TableRow
                      key={sku}
                      className={`cursor-pointer hover:bg-surface-muted/50 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                      onClick={() => navigate(`/products/${encodeURIComponent(sku)}`)}
                    >
                      <TableCell className="w-12 px-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelected(sku)}
                          aria-label={`Selecionar produto ${sku}`}
                          className="h-4 w-4 rounded border-line text-primary focus:ring-primary"
                        />
                      </TableCell>
                      <TableCell>{p.nome || p.item_name}</TableCell>
                      <TableCell title={p.descricao || undefined} className="text-fg-muted max-w-[200px] truncate pl-0">{p.descricao || '—'}</TableCell>
                      <TableCell className="font-mono text-sm whitespace-nowrap pl-6">{sku}</TableCell>
                      <TableCell className="text-fg-muted text-center whitespace-nowrap pr-4">{normalizeUom(p.unidade || p.stock_uom)}</TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap pl-4">
                        {p.pricing_available && p.preco_minimo != null ? formatBRL(p.preco_minimo) : '—'}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Ver detalhes do produto ${sku}`}
                            title={`Ver detalhes ${sku}`}
                            onClick={() => navigate(`/products/${encodeURIComponent(sku)}`)}
                          >
                            <Eye />
                          </Button>
                          <span className="ml-1 border-l border-line pl-1 inline-flex items-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`${p.ativo === false ? 'Restaurar' : 'Arquivar'} produto ${sku}`}
                              title={`${p.ativo === false ? 'Restaurar produto' : 'Arquivar produto (não exclui)'} — ${sku}`}
                              onClick={() => requestArchive(sku, p.ativo === false)}
                            >
                              {p.ativo === false ? <ArchiveRestore /> : <Archive />}
                            </Button>
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-3">
            {data.map(p => {
              const sku = p.sku || p.item_code || '';
              const isSelected = selectedIds.includes(sku);
              return (
                <div
                  key={sku}
                  className={`rounded-lg border border-line bg-surface shadow-sm transition-colors ${isSelected ? 'ring-2 ring-primary/30' : ''}`}
                >
                  <div className="flex items-start gap-3 p-4">
                    <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(sku)}
                        aria-label={`Selecionar produto ${sku}`}
                        className="h-4 w-4 rounded border-line text-primary focus:ring-primary"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/products/${encodeURIComponent(sku)}`)}
                      className="flex-1 text-left min-w-0 space-y-2"
                      aria-label={`Abrir produto ${sku}`}
                    >
                      <div>
                        <p className="text-sm font-semibold text-card-foreground line-clamp-2">{p.nome || p.item_name}</p>
                        {p.descricao && (
                          <p className="mt-0.5 text-xs text-fg-muted line-clamp-1">{p.descricao}</p>
                        )}
                        <p className="mt-1 text-xs text-fg-muted">
                          <span className="font-mono text-primary">{sku}</span>
                          {' · '}
                          {normalizeUom(p.unidade || p.stock_uom)}
                          {p.pricing_available && p.preco_minimo != null && (
                            <>
                              {' · '}
                              <span className="font-medium text-fg">{formatBRL(p.preco_minimo)}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive/50 hover:bg-destructive/10 hover:text-destructive shrink-0"
                      aria-label={`${p.ativo === false ? 'Restaurar' : 'Arquivar'} produto ${sku}`}
                      title={`${p.ativo === false ? 'Restaurar produto' : 'Arquivar produto (não exclui)'} — ${sku}`}
                      onClick={() => requestArchive(sku, p.ativo === false)}
                    >
                      {p.ativo === false ? <ArchiveRestore /> : <Archive />}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-fg-muted">
            Página {page} de {totalPages} · {totalRecords} produto{totalRecords !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ‹ Anterior
            </Button>
            {getPageNumbers().map(p => (
              <Button key={p} variant={p === page ? 'default' : 'outline'} size="sm" onClick={() => setPage(p)}>
                {p}
              </Button>
            ))}
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Próximo ›
            </Button>
          </div>
        </div>
      )}

      {/* Bulk archive toolbar (floating bottom bar) */}
      <BulkActionBar visible={selectedCount > 0}>
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <span>
            {selectedCount} produto{selectedCount !== 1 ? 's' : ''} selecionado{selectedCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setSelectedIds([])} disabled={selectedCount === 0}>
            Limpar seleção
          </Button>
          <Button variant="default" onClick={requestBulkArchive} disabled={selectedCount === 0}>
            <Archive className="mr-2" />
            Arquivar produtos
          </Button>
        </div>
      </BulkActionBar>

      <ConfirmDialog
        open={archiveDialog !== null}
        title={archiveDialog?.title}
        message={archiveDialog?.message}
        confirmLabel={archiveDialog?.confirmLabel}
        cancelLabel="Cancelar"
        variant="destructive"
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
