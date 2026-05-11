import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, AlertTriangle, Tag, Package, ChevronRight } from 'lucide-react';
import { useHashRoute } from '@/hooks/useHashRoute.js';
import { apiGet } from '@/lib/api.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import SkeletonTable from '@/components/SkeletonTable.jsx';
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
  const searchTimer = useRef(null);
  const [, navigate] = useHashRoute();

  const fetchData = useCallback(async (searchVal, pageNum, limitVal) => {
    setLoading(true);
    setError(null);
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

  return (
    <div className="space-y-4">
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
      {loading && <SkeletonTable cols={4} rows={6} title="Carregando produtos…" />}

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
                  <TableHead>SKU</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Unidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map(p => (
                  <TableRow
                    key={p.id || p.sku}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/products/${encodeURIComponent(p.sku || p.item_code)}`)}
                  >
                    <TableCell className="font-mono text-sm">{p.sku || p.item_code}</TableCell>
                    <TableCell>{p.nome || p.item_name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.categoria || p.item_group || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{p.unidade || p.stock_uom || 'und'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-3">
            {data.map(p => {
              const sku = p.sku || p.item_code;
              return (
                <button
                  key={p.id || sku}
                  type="button"
                  onClick={() => navigate(`/products/${encodeURIComponent(sku)}`)}
                  className="w-full rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                  aria-label={`Abrir produto ${sku}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
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
                    </div>
                    <ChevronRight size={17} className="mt-1 shrink-0 text-muted-foreground" />
                  </div>
                </button>
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
    </div>
  );
}
