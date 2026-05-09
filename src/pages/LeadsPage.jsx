import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Phone, Mail } from 'lucide-react';
import { apiGet } from '@/lib/api.js';
import { fmtPhone } from '@/lib/formatters.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table.jsx';
import SkeletonTable from '@/components/SkeletonTable.jsx';

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

  const TipoBadge = ({ tipo: t }) => (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium
      ${t === 'lead' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}
    `}>
      {t === 'lead' ? 'Lead' : t === 'cliente' ? 'Cliente' : t || '—'}
    </span>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads / Clientes"
        description={`${totalRecords} registro${totalRecords !== 1 ? 's' : ''}`}
      />

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
          aria-label="Buscar leads e clientes"
        />
      </div>

      {/* Loading */}
      {loading && <SkeletonTable cols={5} rows={8} title="Carregando leads e clientes…" />}

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

      {/* ── Desktop Table ── */}
      {!loading && !error && data.length > 0 && (
        <div className="hidden md:block bg-white rounded-lg border shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="w-[120px] text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map(row => (
                <TableRow key={row.id || row.email}>
                  <TableCell className="font-medium">{row.nome || '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{row.email || '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{fmtPhone(row.telefone)}</TableCell>
                  <TableCell><TipoBadge tipo={row.tipo} /></TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                      {row.telefone && (
                        <a
                          href={`https://wa.me/${row.telefone.replace(/\D/g, '')}`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-green-50 hover:text-green-600 transition-colors"
                          aria-label={`WhatsApp ${row.nome || row.email}`}
                          title={`WhatsApp ${row.nome || row.email}`}
                        >
                          <Phone size={18} />
                        </a>
                      )}
                      {row.email && (
                        <a
                          href={`mailto:${row.email}`}
                          className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-muted transition-colors"
                          aria-label={`Email ${row.nome || row.email}`}
                          title={`Email ${row.nome || row.email}`}
                        >
                          <Mail size={18} />
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Mobile Cards ── */}
      {!loading && !error && data.length > 0 && (
        <div className="md:hidden space-y-3">
          {data.map(row => (
            <div key={row.id || row.email} className="bg-white rounded-lg border shadow-sm p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{row.nome || '—'}</span>
                <TipoBadge tipo={row.tipo} />
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {row.email && <div className="flex items-center gap-1"><Mail size={12} /> {row.email}</div>}
                {row.telefone && <div className="flex items-center gap-1"><Phone size={12} /> {fmtPhone(row.telefone)}</div>}
              </div>
              <div className="flex items-center gap-1 pt-1">
                {row.telefone && (
                  <a
                    href={`https://wa.me/${row.telefone.replace(/\D/g, '')}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-green-50 hover:text-green-600 transition-colors"
                    aria-label={`WhatsApp ${row.nome || row.email}`}
                  >
                    <Phone size={18} />
                  </a>
                )}
                {row.email && (
                  <a
                    href={`mailto:${row.email}`}
                    className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-muted transition-colors"
                    aria-label={`Email ${row.nome || row.email}`}
                  >
                    <Mail size={18} />
                  </a>
                )}
              </div>
            </div>
          ))}
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
