import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Plus, Sparkles, Phone, Pencil, FileText, Trash2, AlertTriangle, Clipboard, PlusCircle } from 'lucide-react';
import { apiGet, apiDelete } from '@/lib/api.js';
import { formatBRL, formatDate } from '@/lib/formatters.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { StatusBadge } from '@/components/ui/badge.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table.jsx';
import SkeletonTable from '@/components/SkeletonTable.jsx';

const STATUS_LABELS = {
  Draft: 'Rascunho',
  Open: 'Aberto',
  Replied: 'Respondido',
  Ordered: 'Convertido',
  Lost: 'Perdido',
  Expired: 'Expirado',
  Cancelled: 'Cancelado',
};

const STATUSES = ['', 'Draft', 'Open', 'Replied', 'Ordered', 'Lost', 'Expired', 'Cancelled'];
const STATUS_DISPLAY = ['Todos', 'Rascunho', 'Aberto', 'Respondido', 'Convertido', 'Perdido', 'Expirado', 'Cancelado'];
const PAGE_SIZES = [10, 25, 50];

export default function QuotationsPage({ navigate }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [statusSummary, setStatusSummary] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);
  const searchTimer = useRef(null);
  const selectAllRef = useRef(null);

  const fetchData = useCallback(async (searchVal, statusVal, pageNum, limitVal) => {
    setLoading(true);
    setError(null);
    setSelectedIds([]);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pageNum));
      params.set('limit', String(limitVal));
      if (searchVal) params.set('search', searchVal);
      if (statusVal) params.set('status', statusVal);

      const result = await apiGet(`/quotations?${params.toString()}`);
      setData(result.data || []);
      setTotalPages(result.pagination?.total_pages || 0);
      setTotalRecords(result.pagination?.total || 0);
      setStatusSummary(result.status_summary || {});
    } catch (err) {
      console.error('[quotations]', err);
      setError(err.message || 'Erro ao carregar orçamentos.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  const onSearchChange = useCallback((e) => {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      fetchData(val, status, 1, limit);
    }, 350);
  }, [status, limit, fetchData]);

  const onStatusClick = useCallback((s) => {
    setStatus(s);
    setPage(1);
    fetchData(search, s, 1, limit);
  }, [search, limit, fetchData]);

  const onPageChange = useCallback((p) => {
    setPage(p);
    fetchData(search, status, p, limit);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [search, status, limit, fetchData]);

  const onLimitChange = useCallback((e) => {
    const newLimit = parseInt(e.target.value, 10);
    setLimit(newLimit);
    setPage(1);
    fetchData(search, status, 1, newLimit);
  }, [search, status, fetchData]);

  // Initial load
  useEffect(() => {
    fetchData('', '', 1, limit);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = useCallback(async (id) => {
    if (!confirm(`Tem certeza que deseja excluir o orçamento ${id}?\n\nEsta ação não pode ser desfeita.`)) return;
    try {
      await apiDelete(`/quotations?id=${encodeURIComponent(id)}`);
      setData(prev => prev.filter(r => r.id !== id));
      setTotalRecords(prev => prev - 1);
    } catch (err) {
      alert('Erro ao excluir: ' + (err.message || 'Tente novamente.'));
    }
  }, []);

  const toggleSelected = useCallback((id) => {
    setSelectedIds(prev => (
      prev.includes(id)
        ? prev.filter(itemId => itemId !== id)
        : [...prev, id]
    ));
  }, []);

  const toggleSelectAll = useCallback((checked) => {
    setSelectedIds(checked ? data.map(row => row.id) : []);
  }, [data]);

  const handleBulkDelete = useCallback(async () => {
    const selectedRows = data.filter(row => selectedIds.includes(row.id));
    if (selectedRows.length === 0) return;

    const totalSelected = selectedRows.reduce((sum, row) => sum + (Number(row.valor) || 0), 0);
    if (!confirm(
      `Tem certeza que deseja excluir ${selectedRows.length} proposta${selectedRows.length !== 1 ? 's' : ''}?\n\n` +
      `Valor total: ${formatBRL(totalSelected)}\n\nEssa ação não pode ser desfeita.`
    )) return;

    try {
      await Promise.all(selectedRows.map(row => apiDelete(`/quotations?id=${encodeURIComponent(row.id)}`)));
      const nextPage = selectedRows.length === data.length && page > 1 ? page - 1 : page;
      setPage(nextPage);
      await fetchData(search, status, nextPage, limit);
    } catch (err) {
      alert('Erro ao excluir propostas selecionadas: ' + (err.message || 'Tente novamente.'));
    }
  }, [data, selectedIds, page, search, status, limit, fetchData]);

  const totalsQty = data.length;
  const totalsSum = data.reduce((s, r) => s + (r.valor || 0), 0);
  const selectedRows = data.filter(row => selectedIds.includes(row.id));
  const selectedCount = selectedRows.length;
  const selectedTotal = selectedRows.reduce((sum, row) => sum + (Number(row.valor) || 0), 0);
  const allSelected = data.length > 0 && selectedCount === data.length;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  // Pagination helpers
  const getPageNumbers = () => {
    if (totalPages <= 1) return [];
    const start = Math.max(1, page - 3);
    const end = Math.min(totalPages, start + 6);
    const nums = [];
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  };

  // Action button component (reusable) — 40x40 hit area
  const ActionBtn = ({ icon: Icon, label, href, onClick, colorClass = '' }) => {
    const cls = `inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-framer-surface-2 transition-colors ${colorClass}`;
    if (href) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls}
          aria-label={label} title={label} onClick={e => e.stopPropagation()}>
          <Icon size={18} />
        </a>
      );
    }
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
        className={cls}
        aria-label={label}
        title={label}
      >
        <Icon size={18} />
      </button>
    );
  };

  const actionButtons = (row) => (
    <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
      <ActionBtn icon={Phone} label={`Enviar WhatsApp para ${row.cliente || row.id}`}
        href={`https://wa.me/?text=${encodeURIComponent('Olá ' + (row.cliente || '') + '! Segue orçamento ' + row.id)}`}
        colorClass="hover:bg-green-500/10 hover:text-green-600" />
      <ActionBtn icon={Pencil} label={`Editar orçamento ${row.id}`}
        onClick={() => navigate(`/quotations/${encodeURIComponent(row.id)}`)} />
      <ActionBtn icon={FileText} label={`Abrir PDF do orçamento ${row.id}`}
        href={`/api/view?q=${encodeURIComponent(row.id)}`}
        colorClass="hover:bg-red-500/10 hover:text-red-600" />
      <ActionBtn icon={Trash2} label={`Excluir orçamento ${row.id}`}
        onClick={() => handleDelete(row.id)}
        colorClass="hover:bg-red-500/10 hover:text-red-600" />
    </div>
  );

  return (
    <div className="space-y-4 pb-28">
      {/* PageHeader + primary action */}
      <PageHeader
        title="Orçamentos"
        description={`${totalRecords} orçamento${totalRecords !== 1 ? 's' : ''} — ${status ? (STATUS_LABELS[status] || status) : 'todos os status'}`}
        action={
          <div className="flex items-center gap-2">
            <Button onClick={() => navigate('/auto')} variant="default" size="sm">
              <Sparkles size={16} />
              Auto
            </Button>
            <Button onClick={() => navigate('/manual')} variant="outline" size="sm">
              <PlusCircle size={16} />
              Novo Orçamento
            </Button>
          </div>
        }
      />

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s, i) => (
          <button
            key={s}
            onClick={() => onStatusClick(s)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors
              ${status === s
                ? 'bg-framer-surface-2 text-framer-ink'
                : 'bg-framer-canvas text-framer-ink-muted hover:text-framer-ink hover:bg-framer-surface-1'
              }`}
          >
            {STATUS_DISPLAY[i]}
            {s === '' && totalRecords > 0 && (
              <span className="opacity-70">({totalRecords})</span>
            )}
            {s !== '' && statusSummary[s] !== undefined && (
              <span className="opacity-70">({statusSummary[s]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Search + Page size */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por Nº ou Cliente…"
            value={search}
            onChange={onSearchChange}
            className="pl-9"
            aria-label="Buscar orçamentos"
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
      {loading && <SkeletonTable cols={6} rows={8} title="Carregando orçamentos…" />}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <AlertTriangle size={32} className="text-red-400" />
          <p>Erro ao carregar orçamentos</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => fetchData(search, status, page, limit)}>
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && data.length === 0 && (
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <Clipboard size={36} className="text-muted-foreground/40" />
          <p>Nenhum orçamento encontrado</p>
          <p className="text-sm">Tente ajustar os filtros ou criar um novo orçamento.</p>
        </div>
      )}

      {/* ── Desktop Table (hidden on mobile) ── */}
      {!loading && !error && data.length > 0 && (
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 px-3">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={e => toggleSelectAll(e.target.checked)}
                    aria-label="Selecionar todos os orçamentos desta página"
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                </TableHead>
                <TableHead className="w-[160px]">Nº</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center w-[180px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map(row => (
                <TableRow
                  key={row.id}
                  className={`cursor-pointer bg-card ${selectedIds.includes(row.id) ? 'bg-primary/5' : ''}`}
                  onClick={() => navigate(`/quotations/${encodeURIComponent(row.id)}`)}
                >
                  <TableCell className="w-12 px-3" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(row.id)}
                      onChange={() => toggleSelected(row.id)}
                      aria-label={`Selecionar orçamento ${row.id}`}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{row.id}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(row.data)}
                  </TableCell>
                  <TableCell>{row.cliente}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBRL(row.valor)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={row.status}
                      label={STATUS_LABELS[row.status] || row.status}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    {actionButtons(row)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Mobile Cards (hidden on desktop) ── */}
      {!loading && !error && data.length > 0 && (
        <div className="md:hidden space-y-3">
          {data.map(row => (
            <div
              key={row.id}
              className={`bg-card rounded-lg border border-border shadow-sm p-4 space-y-3 cursor-pointer ${selectedIds.includes(row.id) ? 'ring-2 ring-primary/30' : ''}`}
              onClick={() => navigate(`/quotations/${encodeURIComponent(row.id)}`)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleSelected(row.id)}
                    aria-label={`Selecionar orçamento ${row.id}`}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="font-mono text-sm font-semibold truncate">{row.id}</span>
                </div>
                <StatusBadge
                  status={row.status}
                  label={STATUS_LABELS[row.status] || row.status}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{row.cliente || '—'}</span>
                <span className="text-muted-foreground text-xs">{formatDate(row.data)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold">{formatBRL(row.valor)}</span>
                <div className="flex items-center gap-0.5">
                  <ActionBtn icon={Phone} label={`WhatsApp ${row.id}`}
                    href={`https://wa.me/?text=${encodeURIComponent('Olá ' + (row.cliente || '') + '! Segue orçamento ' + row.id)}`}
                    colorClass="hover:bg-green-500/10 hover:text-green-600" />
                  <ActionBtn icon={FileText} label={`PDF ${row.id}`}
                    href={`/api/view?q=${encodeURIComponent(row.id)}`}
                    colorClass="hover:bg-red-500/10 hover:text-red-600" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Totals bar + Pagination (desktop only, mobile cards are self-contained) */}
      {!loading && !error && data.length > 0 && (
        <div className="hidden md:flex bg-card rounded-lg border border-border shadow-sm p-4 items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-xs text-muted-foreground">Nesta página</span>
              <p className="font-semibold">{totalsQty} orçamento{totalsQty !== 1 ? 's' : ''}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Valor Total (página)</span>
              <p className="font-semibold">{formatBRL(totalsSum)}</p>
            </div>
            <div className="text-xs text-muted-foreground">
              {status ? (STATUS_LABELS[status] || status) : 'todos os status'}
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                Página {page} de {totalPages} · {totalRecords} orçamento{totalRecords !== 1 ? 's' : ''}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                >
                  ‹ Anterior
                </Button>
                {getPageNumbers().map(p => (
                  <Button
                    key={p}
                    variant={p === page ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onPageChange(p)}
                  >
                    {p}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => onPageChange(page + 1)}
                >
                  Próximo ›
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pagination (mobile only) */}
      {!loading && !error && data.length > 0 && totalPages > 1 && (
        <div className="md:hidden flex items-center justify-between text-sm pt-2">
          <span className="text-muted-foreground text-xs">
            Página {page} de {totalPages} · {totalRecords} registro{totalRecords !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              ‹ Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              Próximo ›
            </Button>
          </div>
        </div>
      )}

      <div className={`fixed inset-x-0 bottom-0 z-40 transition-all duration-300 ${selectedCount > 0 ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}>
        <div className="mx-auto max-w-7xl px-4">
          <div className="overflow-hidden rounded-t-2xl border border-b-0 border-framer-hairline bg-framer-surface-1/95 backdrop-blur shadow-[0_-12px_24px_rgba(0,0,0,0.08)]">
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={e => toggleSelectAll(e.target.checked)}
                    aria-label="Selecionar todos os orçamentos desta página"
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span>{selectedCount} proposta{selectedCount !== 1 ? 's' : ''} selecionada{selectedCount !== 1 ? 's' : ''}</span>
                </div>
                <div>
                  <span className="block text-xs text-muted-foreground">Valor total selecionado</span>
                  <p className="font-semibold text-lg">{formatBRL(selectedTotal)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setSelectedIds([])} disabled={selectedCount === 0}>
                  Limpar seleção
                </Button>
                <Button variant="default" onClick={handleBulkDelete} disabled={selectedCount === 0}>
                  <Trash2 size={16} className="mr-2" />
                  Excluir propostas
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
