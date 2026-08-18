import { useState, useEffect, useCallback, useRef, type ChangeEvent } from 'react';
import {
  Search,
  AlertTriangle,
  Tag,
  PlusCircle,
  Archive,
  ArchiveRestore,
} from 'lucide-react';
import { useHashRoute } from '@/hooks/useHashRoute';
import { apiGet, apiDelete, apiPatch } from '@/lib/api/api';
import { formatBRL } from '@/lib/formatting/formatters';
import { clearProductCache } from '@/lib/api/productCache';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { useSetTopBarActions } from '@/components/layout/Layout';
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
  { value: 'item_name asc', label: 'nome' },
  { value: 'modified desc', label: 'mais recentes' },
  { value: 'modified asc', label: 'data de atualização' },
  { value: 'item_code asc', label: 'código (sku)' },
];

export default function ProductsPage() {
  const [data, setData] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(10);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sort, setSort] = useState<string>('modified desc');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPendingSearch = useCallback(() => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
  }, []);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const [, navigate] = useHashRoute();
  const setTopBarActions = useSetTopBarActions();

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

  // TopBar actions — Criar Produto
  useEffect(() => {
    setTopBarActions?.(
      <Button size="sm" onClick={() => navigate('/products/new')}>
        <PlusCircle size={16} />
        Criar Produto
      </Button>
    );
    return () => setTopBarActions?.(null);
  }, [setTopBarActions, navigate]);

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

  const handleDelete = useCallback(async (sku: string, archived: boolean) => {
    const action = archived ? 'restaurar' : 'arquivar';
    if (!confirm(`Tem certeza que deseja ${action} o produto ${sku}?`)) return;
    try {
      if (archived) {
        await apiPatch(`/product-update?sku=${encodeURIComponent(sku)}`, { ativo: true });
      } else {
        await apiDelete(`/products?id=${encodeURIComponent(sku)}`);
      }
      clearProductCache();
      await fetchData(search, page, limit, sort, status);
    } catch (err) {
      alert(`Erro ao ${action}: ` + ((err as Error).message || 'Tente novamente.'));
    }
  }, [fetchData, limit, page, search, sort, status]);

  const handleBulkDelete = useCallback(async () => {
    const selected = data.filter((row) => selectedIds.includes(row.sku || row.item_code || ''));
    if (selected.length === 0 || status === 'archived') return;

    const action = 'arquivar';
    if (!confirm(`Tem certeza que deseja ${action} ${selected.length} produto${selected.length !== 1 ? 's' : ''}?`)) return;

    try {
      await Promise.all(selected.map((row) => apiDelete(`/products?id=${encodeURIComponent(row.sku || row.item_code || '')}`)));
      clearProductCache();
      const nextPage = selected.length === data.length && page > 1 ? page - 1 : page;
      setPage(nextPage);
      await fetchData(search, nextPage, limit, sort, status);
    } catch (err) {
      alert('Erro ao excluir produtos selecionados: ' + ((err as Error).message || 'Tente novamente.'));
    }
  }, [data, selectedIds, page, search, limit, sort, status, fetchData]);

  const selectedCount = selectedIds.length;

  return (
    <div className="space-y-4 pb-28 animate-fade-in max-w-[1060px] mx-auto">
      {/* Page title */}
      <h1 className="text-2xl font-semibold text-fg">Produtos</h1>

      {/* Search + Page size */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <Input
            placeholder="Buscar por SKU ou nome…"
            value={search}
            onChange={onSearchChange}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <span>Itens por página</span>
          <select
            value={limit}
            onChange={onLimitChange}
            className="border border-line rounded-[10px] px-3 py-2 text-sm bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            {PAGE_SIZES.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
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
                className={`rounded-full px-3 py-1.5 transition-colors ${status === value ? 'bg-primary text-white' : 'text-fg-muted hover:text-fg'}`}
              >
                {value === 'active' ? 'Ativos' : value === 'archived' ? 'Arquivados' : 'Todos'}
              </button>
            ))}
        </div>
      </div>

      {/* Sorting */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-fg-muted mr-1">Ordenar por</span>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              clearPendingSearch();
              setSort(opt.value);
              setPage(1);
            }}
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              sort === opt.value
                ? 'bg-primary text-white'
                : 'bg-surface-muted text-fg-muted hover:bg-surface-muted hover:text-fg'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

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
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <Tag size={36} className="text-fg-muted/40" />
          <p>Nenhum produto encontrado</p>
          <p className="text-sm">Tente ajustar a busca ou os filtros.</p>
        </div>
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
                  <TableHead className="text-center pl-4">Preço</TableHead>
                  <TableHead className="text-center w-[60px]">Ações</TableHead>
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
                      <TableCell className="text-fg-muted max-w-[200px] truncate pl-0">{p.descricao || '—'}</TableCell>
                      <TableCell className="font-mono text-sm pl-6">{sku}</TableCell>
                      <TableCell className="text-fg-muted text-center pr-4">{p.unidade || p.stock_uom || 'und'}</TableCell>
                      <TableCell className="text-center font-medium pl-4">
                        {p.pricing_available && p.preco_minimo != null ? formatBRL(p.preco_minimo) : '—'}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleDelete(sku, p.ativo === false)}
                          className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-destructive/100/10 hover:text-destructive transition-colors"
                          aria-label={`${p.ativo === false ? 'Restaurar' : 'Arquivar'} produto ${sku}`}
                          title={`${p.ativo === false ? 'Restaurar' : 'Arquivar'} ${sku}`}
                        >
                          {p.ativo === false ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                        </button>
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
                  className={`rounded-xl border border-line bg-surface shadow-sm transition-colors ${isSelected ? 'ring-2 ring-primary/30' : ''}`}
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
                          {p.unidade || p.stock_uom || 'und'}
                          {p.pricing_available && p.preco_minimo != null && (
                            <>
                              {' · '}
                              <span className="font-medium text-fg">{formatBRL(p.preco_minimo)}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => handleDelete(sku, p.ativo === false)}
                      className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-destructive/100/10 hover:text-destructive transition-colors shrink-0"
                      aria-label={`${p.ativo === false ? 'Restaurar' : 'Arquivar'} produto ${sku}`}
                      title={`${p.ativo === false ? 'Restaurar' : 'Arquivar'} ${sku}`}
                    >
                      {p.ativo === false ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                    </button>
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

      {/* Bulk delete toolbar (floating bottom bar) */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 transition-all duration-300 ${selectedCount > 0 ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}
      >
        <div className="mx-auto max-w-[1060px] px-4">
          <div className="overflow-hidden rounded-t-2xl border border-b-0 border-line bg-surface/95 backdrop-blur shadow-[0_-12px_24px_rgba(0,0,0,0.08)]">
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6">
              <div className="flex items-center gap-2 text-sm font-medium text-fg">
                <span>
                  {selectedCount} produto{selectedCount !== 1 ? 's' : ''} selecionado{selectedCount !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setSelectedIds([])} disabled={selectedCount === 0}>
                  Limpar seleção
                </Button>
                <Button variant="default" onClick={handleBulkDelete} disabled={selectedCount === 0}>
                  <Archive size={16} className="mr-2" />
                  Arquivar produtos
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
