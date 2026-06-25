import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  AlertTriangle,
  Tag,
  Trash2,
  PlusCircle,
} from 'lucide-react';
import { useHashRoute } from '@/hooks/useHashRoute.js';
import { apiGet, apiDelete } from '@/lib/api.js';
import { formatBRL } from '@/lib/formatters';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input';
import SkeletonTable from '@/components/SkeletonTable.jsx';
import { useSetTopBarActions } from '@/components/layout/Layout.jsx';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

const PAGE_SIZES = [10, 25, 50];

const SORT_OPTIONS = [
  { value: 'item_name asc', label: 'nome' },
  { value: 'modified desc', label: 'mais recentes' },
  { value: 'modified asc', label: 'data de atualização' },
  { value: 'item_code asc', label: 'código (sku)' },
];

export default function ProductsPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [sort, setSort] = useState('modified desc');
  const searchTimer = useRef(null);
  const selectAllRef = useRef(null);
  const [, navigate] = useHashRoute();
  const setTopBarActions = useSetTopBarActions();

  const fetchData = useCallback(async (searchVal, pageNum, limitVal, sortVal) => {
    setLoading(true);
    setError(null);
    setSelectedIds([]);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pageNum));
      params.set('limit', String(limitVal));
      if (searchVal) params.set('search', searchVal);
      if (sortVal) params.set('order_by', sortVal);

      const result = await apiGet(`/products?${params.toString()}`);
      setData(result.data || []);
      setTotalPages(result.pagination?.total_pages || 0);
      setTotalRecords(result.pagination?.total || 0);
    } catch (err) {
      setError(err.message || 'Erro ao carregar produtos.');
    } finally {
      setLoading(false);
    }
  }, []);

  // TopBar actions — Criar Produto
  useEffect(() => {
    setTopBarActions(
      <Button size="sm" onClick={() => navigate('/products/new')}>
        <PlusCircle size={16} />
        Criar Produto
      </Button>
    );
    return () => setTopBarActions(null);
  }, [setTopBarActions, navigate]);

  useEffect(() => { fetchData(search, page, limit, sort); }, [fetchData, search, page, limit, sort]);

  const onSearchChange = useCallback((e) => {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      fetchData(val, 1, limit, sort);
    }, 350);
  }, [limit, sort, fetchData]);

  const onLimitChange = useCallback((e) => {
    const newLimit = parseInt(e.target.value, 10);
    setLimit(newLimit);
    setPage(1);
    fetchData(search, 1, newLimit, sort);
  }, [search, sort, fetchData]);

  const getPageNumbers = () => {
    if (totalPages <= 1) return [];
    const start = Math.max(1, page - 3);
    const end = Math.min(totalPages, start + 6);
    const nums = [];
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  };

  // ── Selection ──

  const toggleSelected = useCallback((sku) => {
    setSelectedIds((prev) =>
      prev.includes(sku) ? prev.filter((id) => id !== sku) : [...prev, sku]
    );
  }, []);

  const toggleSelectAll = useCallback((checked) => {
    setSelectedIds(checked ? data.map((row) => row.sku) : []);
  }, [data]);

  const allSelected = data.length > 0 && selectedIds.length === data.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  // ── Delete ──

  const handleDelete = useCallback(async (sku) => {
    if (!confirm(`Tem certeza que deseja excluir o produto ${sku}?\n\nEsta ação não pode ser desfeita.`)) return;
    try {
      await apiDelete(`/products?id=${encodeURIComponent(sku)}`);
      setData((prev) => prev.filter((r) => r.sku !== sku));
      setTotalRecords((prev) => prev - 1);
      setSelectedIds((prev) => prev.filter((id) => id !== sku));
    } catch (err) {
      alert('Erro ao excluir: ' + (err.message || 'Tente novamente.'));
    }
  }, []);

  const handleBulkDelete = useCallback(async () => {
    const selected = data.filter((row) => selectedIds.includes(row.sku));
    if (selected.length === 0) return;

    if (!confirm(`Tem certeza que deseja excluir ${selected.length} produto${selected.length !== 1 ? 's' : ''}?\n\nEssa ação não pode ser desfeita.`)) return;

    try {
      await Promise.all(selected.map((row) => apiDelete(`/products?id=${encodeURIComponent(row.sku)}`)));
      const nextPage = selected.length === data.length && page > 1 ? page - 1 : page;
      setPage(nextPage);
      await fetchData(search, nextPage, limit, sort);
    } catch (err) {
      alert('Erro ao excluir produtos selecionados: ' + (err.message || 'Tente novamente.'));
    }
  }, [data, selectedIds, page, search, limit, sort, fetchData]);

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
      </div>

      {/* Sorting */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-fg-muted mr-1">Ordenar por</span>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => { setSort(opt.value); setPage(1); }}
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
                  const sku = p.sku || p.item_code;
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
                        {p.preco_minimo != null ? formatBRL(p.preco_minimo) : '—'}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleDelete(sku)}
                          className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-destructive/100/10 hover:text-destructive transition-colors"
                          aria-label={`Excluir produto ${sku}`}
                          title={`Excluir ${sku}`}
                        >
                          <Trash2 size={18} />
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
              const sku = p.sku || p.item_code;
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
                          {p.preco_minimo != null && (
                            <>
                              {' · '}
                              <span className="font-medium text-fg">{formatBRL(p.preco_minimo)}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => handleDelete(sku)}
                      className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-destructive/100/10 hover:text-destructive transition-colors shrink-0"
                      aria-label={`Excluir produto ${sku}`}
                      title={`Excluir ${sku}`}
                    >
                      <Trash2 size={18} />
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
                  <Trash2 size={16} className="mr-2" />
                  Excluir produtos
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
