import { useState, useEffect, useCallback, useRef } from 'react';
import { Search } from 'lucide-react';
import { apiGet } from '@/lib/api.js';
import { fmtPhone } from '@/lib/formatters.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table.jsx';

const TIPOS = ['', 'lead', 'cliente'];
const TIPO_DISPLAY = ['Todos', 'Leads', 'Clientes'];

export default function LeadsPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [tipo, setTipo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const searchTimer = useRef(null);

  const fetchData = useCallback(async (searchVal, tipoVal, pageNum) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pageNum));
      params.set('limit', '50');
      if (searchVal) params.set('search', searchVal);
      if (tipoVal) params.set('tipo', tipoVal);

      const result = await apiGet(`/leads-clients?${params.toString()}`);
      setData(result.data || []);
      setTotalPages(result.pagination?.total_pages || 0);
      setTotalRecords(result.pagination?.total || 0);
    } catch (err) {
      setError(err.message || 'Erro ao carregar leads e clientes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(search, tipo, page); }, [fetchData, search, tipo, page]);

  const onSearchChange = useCallback((e) => {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
    }, 350);
  }, []);

  const onTipoClick = useCallback((t) => {
    setTipo(t);
    setPage(1);
  }, []);

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
      {/* Tipo chips */}
      <div className="flex gap-2">
        {TIPOS.map((t, i) => (
          <button
            key={t}
            onClick={() => onTipoClick(t)}
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors
              ${tipo === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}
            `}
          >
            {TIPO_DISPLAY[i]}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome…"
          value={search}
          onChange={onSearchChange}
          className="pl-9"
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
          Carregando leads e clientes…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <span className="text-2xl">⚠️</span>
          <p>Erro ao carregar leads e clientes</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => fetchData(search, tipo, page)}>Tentar novamente</Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && data.length === 0 && (
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <span className="text-3xl">👥</span>
          <p>Nenhum lead ou cliente encontrado</p>
          <p className="text-sm">Tente ajustar a busca ou os filtros.</p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && data.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Tipo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map(row => (
                <TableRow key={row.id || row.email}>
                  <TableCell className="font-medium">{row.nome || '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{row.email || '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{fmtPhone(row.telefone)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium
                      ${row.tipo === 'lead' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}
                    `}>
                      {row.tipo === 'lead' ? 'Lead' : row.tipo === 'cliente' ? 'Cliente' : row.tipo || '—'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {page} de {totalPages} · {totalRecords} registro{totalRecords !== 1 ? 's' : ''}
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
