import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  AlertTriangle,
  Tag,
  Package,
  ChevronRight,
  Trash2,
  PlusCircle,
  X,
} from 'lucide-react';
import { useHashRoute } from '@/hooks/useHashRoute.js';
import { apiGet, apiDelete, apiPost } from '@/lib/api.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import SkeletonTable from '@/components/SkeletonTable.jsx';
import { useSetTopBarActions } from '@/components/layout/Layout.jsx';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table.jsx';

const PAGE_SIZES = [10, 25, 50];

export default function ProductsPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const searchTimer = useRef(null);
  const selectAllRef = useRef(null);
  const [, navigate] = useHashRoute();
  const setTopBarActions = useSetTopBarActions();

  // ── Criar Produto modal ──
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProduct, setNewProduct] = useState({ sku: '', nome: '', categoria: '', unidade: 'Und' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const fetchData = useCallback(async (searchVal, pageNum, limitVal) => {
    setLoading(true);
    setError(null);
    setSelectedIds([]);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pageNum));
      params.set('limit', String(limitVal));
      if (searchVal) params.set('search', searchVal);

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

  const openCreateModal = useCallback(() => {
    setNewProduct({ sku: '', nome: '', categoria: '', unidade: 'Und' });
    setCreateError(null);
    setShowCreateModal(true);
  }, []);

  const closeCreateModal = useCallback(() => {
    setShowCreateModal(false);
    setCreateError(null);
  }, []);

  const handleCreateProduct = useCallback(async (e) => {
    e.preventDefault();
    const sku = newProduct.sku.trim();
    const nome = newProduct.nome.trim();
    if (!sku) { setCreateError('SKU é obrigatório.'); return; }
    if (!nome) { setCreateError('Nome do produto é obrigatório.'); return; }
    setCreating(true);
    setCreateError(null);
    try {
      await apiPost('/products', { sku, nome, categoria: newProduct.categoria.trim() || undefined, unidade: newProduct.unidade.trim() || 'Und' });
      setShowCreateModal(false);
      fetchData(search, page, limit);
    } catch (err) {
      setCreateError(err.message || 'Erro ao criar produto.');
    } finally {
      setCreating(false);
    }
  }, [newProduct, search, page, limit, fetchData]);

  // TopBar actions — Criar Produto
  useEffect(() => {
    setTopBarActions(
      <Button size="sm" className="min-h-10" onClick={openCreateModal}>
        <PlusCircle size={16} className="mr-2" />
        Criar Produto
      </Button>
    );
    return () => setTopBarActions(null);
  }, [setTopBarActions, openCreateModal]);

  useEffect(() => { fetchData(search, page, limit); }, [fetchData, search, page, limit]);

  const onSearchChange = useCallback((e) => {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      fetchData(val, 1, limit);
    }, 350);
  }, [limit, fetchData]);

  const onLimitChange = useCallback((e) => {
    const newLimit = parseInt(e.target.value, 10);
    setLimit(newLimit);
    setPage(1);
    fetchData(search, 1, newLimit);
  }, [search, fetchData]);

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
      await fetchData(search, nextPage, limit);
    } catch (err) {
      alert('Erro ao excluir produtos selecionados: ' + (err.message || 'Tente novamente.'));
    }
  }, [data, selectedIds, page, search, limit, fetchData]);

  const selectedCount = selectedIds.length;

  return (
    <div className="space-y-4 pb-28">
      {/* Search + Page size */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por SKU ou nome…"
            value={search}
            onChange={onSearchChange}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Itens por página</span>
          <select
            value={limit}
            onChange={onLimitChange}
            className="border border-framer-hairline rounded-[10px] px-3 py-2 text-sm bg-framer-surface-1 text-framer-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
          >
            {PAGE_SIZES.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading */}
      {loading && <SkeletonTable cols={5} rows={6} title="Carregando produtos…" />}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <AlertTriangle size={32} className="text-red-400" />
          <p>Erro ao carregar produtos</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => fetchData(search, page, limit)}>Tentar novamente</Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && data.length === 0 && (
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <Tag size={36} className="text-muted-foreground/40" />
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
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                  </TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Unidade</TableHead>
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
                      className={`cursor-pointer hover:bg-muted/50 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                      onClick={() => navigate(`/products/${encodeURIComponent(sku)}`)}
                    >
                      <TableCell className="w-12 px-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelected(sku)}
                          aria-label={`Selecionar produto ${sku}`}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{sku}</TableCell>
                      <TableCell>{p.nome || p.item_name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.categoria || p.item_group || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{p.unidade || p.stock_uom || 'und'}</TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleDelete(sku)}
                          className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-red-500/10 hover:text-red-600 transition-colors"
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
                  className={`rounded-xl border border-border bg-card shadow-sm transition-colors ${isSelected ? 'ring-2 ring-primary/30' : ''}`}
                >
                  <div className="flex items-start gap-3 p-4">
                    <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(sku)}
                        aria-label={`Selecionar produto ${sku}`}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/products/${encodeURIComponent(sku)}`)}
                      className="flex-1 text-left min-w-0 space-y-2"
                      aria-label={`Abrir produto ${sku}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-framer-accent-blue/10 text-framer-accent-blue">
                          <Package size={16} />
                        </span>
                        <span className="font-mono text-xs font-medium text-framer-accent-blue">{sku}</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-card-foreground line-clamp-2">{p.nome || p.item_name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[p.categoria || p.item_group || 'Sem categoria', p.unidade || p.stock_uom || 'und'].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => handleDelete(sku)}
                      className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-red-500/10 hover:text-red-600 transition-colors shrink-0"
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
          <span className="text-muted-foreground">
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
        <div className="mx-auto max-w-7xl px-4">
          <div className="overflow-hidden rounded-t-2xl border border-b-0 border-framer-hairline bg-framer-surface-1/95 backdrop-blur shadow-[0_-12px_24px_rgba(0,0,0,0.08)]">
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
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

      {/* ── Criar Produto Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={closeCreateModal} />
          <div className="relative bg-card rounded-2xl border border-border shadow-xl w-full max-w-md p-6 space-y-4 z-10">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Criar Produto</h2>
              <button onClick={closeCreateModal} className="p-1 rounded hover:bg-muted transition-colors" aria-label="Fechar">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateProduct} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">SKU *</label>
                <Input
                  value={newProduct.sku}
                  onChange={e => setNewProduct(prev => ({ ...prev, sku: e.target.value }))}
                  placeholder="LNC-SED-70"
                  className="mt-1"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Nome *</label>
                <Input
                  value={newProduct.nome}
                  onChange={e => setNewProduct(prev => ({ ...prev, nome: e.target.value }))}
                  placeholder="Nome do produto"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Categoria</label>
                <Input
                  value={newProduct.categoria}
                  onChange={e => setNewProduct(prev => ({ ...prev, categoria: e.target.value }))}
                  placeholder="Lenços, Bonés..."
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Unidade</label>
                <Input
                  value={newProduct.unidade}
                  onChange={e => setNewProduct(prev => ({ ...prev, unidade: e.target.value }))}
                  placeholder="Und"
                  className="mt-1"
                />
              </div>
              {createError && (
                <p className="text-sm text-red-500">{createError}</p>
              )}
              <div className="flex items-center gap-2 pt-2">
                <Button type="submit" disabled={creating} className="flex-1">
                  {creating ? 'Criando…' : 'Criar Produto'}
                </Button>
                <Button type="button" variant="outline" onClick={closeCreateModal} disabled={creating}>
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
