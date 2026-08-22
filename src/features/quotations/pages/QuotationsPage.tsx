import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
  type ComponentType,
  type MouseEvent,
} from 'react';
import {
  Search,
  Sparkles,
  Pencil,
  FileText,
  Trash2,
  AlertTriangle,
  Clipboard,
  PlusCircle,
  Copy,
  MailCheck,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '@/lib/api/api';
import { formatBRL, formatDate } from '@/lib/formatting/formatters';
import { buildQuotationPreviewUrl } from '@/lib/formatting/printFormats';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import PageHeader from '@/components/shared/PageHeader';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { useToast } from '@/components/shared/toast';
import { quotationStatusLabel, quotationStatusBadgeKey } from '@/lib/statusLabels';
import { useSetTopBarActions } from '@/components/layout/Layout';
import {
  parseHashAllowedInteger,
  parseHashOption,
  parseHashPositiveInteger,
  parseHashString,
  useHashQueryState,
} from '@/hooks/useHashQueryState';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { projectQuotationListRow, type ProjectedQuotationListRow } from '@/lib/localProjections';

// Rótulos canônicos pt-BR vindos de @/lib/statusLabels (quotationStatusLabel /
// quotationStatusBadgeKey). Os valores de filtro continuam os crus da API
// ('enviado'); apenas o texto exibido usa o vocabulário canônico ('Emitido').
const STATUS_OPTIONS = [
  { value: '', label: 'Todos', summaryKey: null },
  { value: 'rascunho', label: 'Rascunho', summaryKey: 'Rascunho' },
  { value: 'enviado', label: 'Emitido', summaryKey: 'Enviado' },
  { value: 'aprovado', label: 'Aprovado', summaryKey: 'Aprovado' },
  { value: 'perdido', label: 'Perdido', summaryKey: 'Perdido' },
] as const;
const PAGE_SIZES = [10, 25, 50];
const parseQuotationStatus = parseHashOption<string>(STATUS_OPTIONS.map((option) => option.value));
const parseQuotationLimit = parseHashAllowedInteger(PAGE_SIZES);

type QuotationRow = ProjectedQuotationListRow;

interface QuotationsApiResponse {
  data?: unknown;
  pagination?: {
    total_pages?: unknown;
    total?: unknown;
  };
  status_summary?: unknown;
}

interface DuplicateQuotationResponse {
  success: boolean;
  new_id: string;
}

interface QuotationsPageProps {
  navigate: (hash: string) => void;
}

interface ActionBtnProps {
  icon: ComponentType<{ size?: number }>;
  label: string;
  href?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  colorClass?: string;
}

export default function QuotationsPage({ navigate }: QuotationsPageProps) {
  const [data, setData] = useState<QuotationRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useHashQueryState('search', '', parseHashString);
  const [status, setStatus] = useHashQueryState('status', '', parseQuotationStatus);
  const [page, setPage] = useHashQueryState('page', 1, parseHashPositiveInteger);
  const [limit, setLimit] = useHashQueryState('limit', 10, parseQuotationLimit);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [statusSummary, setStatusSummary] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const setTopBarActions = useSetTopBarActions();
  const { toast } = useToast();

  // TopBar actions
  useEffect(() => {
    setTopBarActions?.(
      <div className="flex items-center gap-2">
        <Button onClick={() => navigate('/auto')} variant="outline" size="sm">
          <Sparkles size={16} />
          Auto
        </Button>
        <Button onClick={() => navigate('/manual')} variant="default" size="sm">
          <PlusCircle size={16} />
          Novo Orçamento
        </Button>
      </div>
    );
    return () => setTopBarActions?.(null);
  }, [navigate, setTopBarActions]);

  const fetchData = useCallback(
    async (searchVal: string, statusVal: string, pageNum: number, limitVal: number) => {
      setLoading(true);
      setError(null);
      setSelectedIds([]);
      try {
        const params = new URLSearchParams();
        params.set('page', String(pageNum));
        params.set('limit', String(limitVal));
        if (searchVal) params.set('search', searchVal);
        if (statusVal) params.set('status', statusVal);

        const result = await apiGet<QuotationsApiResponse>(`/quotations?${params.toString()}`);
        if (!Array.isArray(result.data) || !result.pagination || typeof result.status_summary !== 'object' || result.status_summary === null || Array.isArray(result.status_summary)) {
          throw new Error('Resposta inválida ao carregar orçamentos.');
        }
        const projectedRows = result.data.map(projectQuotationListRow);
        const totalPages = result.pagination.total_pages;
        const totalRecords = result.pagination.total;
        if (
          projectedRows.some((row): row is null => row === null) ||
          typeof totalPages !== 'number' || !Number.isSafeInteger(totalPages) || totalPages < 0 ||
          typeof totalRecords !== 'number' || !Number.isSafeInteger(totalRecords) || totalRecords < 0
        ) {
          throw new Error('Resposta inválida ao carregar orçamentos.');
        }
        const projectedSummary: Record<string, number> = {};
        for (const [key, value] of Object.entries(result.status_summary as Record<string, unknown>)) {
          if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Resposta inválida ao carregar orçamentos.');
          if (['Rascunho', 'Enviado', 'Aprovado', 'Perdido'].includes(key)) projectedSummary[key] = value;
        }
        setData(projectedRows as QuotationRow[]);
        setTotalPages(totalPages);
        setTotalRecords(totalRecords);
        setStatusSummary(projectedSummary);
      } catch (err) {
        console.error('[quotations]', err);
        setError((err as Error).message || 'Erro ao carregar orçamentos.');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Debounced search
  const onSearchChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setSearch(val);
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
      }
      searchTimer.current = setTimeout(() => {
        setPage(1);
        fetchData(val, status, 1, limit);
      }, 350);
    },
    [status, limit, fetchData]
  );

  const onStatusClick = useCallback(
    (s: string) => {
      setStatus(s);
      setPage(1);
      fetchData(search, s, 1, limit);
    },
    [search, limit, fetchData]
  );

  const onPageChange = useCallback(
    (p: number) => {
      setPage(p);
      fetchData(search, status, p, limit);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [search, status, limit, fetchData]
  );

  const onLimitChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const newLimit = parseInt(e.target.value, 10);
      setLimit(newLimit);
      setPage(1);
      fetchData(search, status, 1, newLimit);
    },
    [search, status, fetchData]
  );

  // Initial load
  useEffect(() => {
    fetchData(search, status, page, limit);
  }, []);

  const handleDelete = useCallback(async () => {
    const id = deleteTarget;
    if (!id) return;
    setDeleteTarget(null);
    try {
      await apiDelete(`/quotations?id=${encodeURIComponent(id)}`);
      setData((prev) => prev.filter((r) => r.id !== id));
      setTotalRecords((prev) => prev - 1);
      setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
      toast(`Orçamento ${id} excluído.`, 'success');
    } catch (err) {
      toast(`Erro ao excluir: ${(err as Error).message || 'Tente novamente.'}`, 'error');
    }
  }, [deleteTarget, toast]);

  const handleDuplicate = useCallback(
    async () => {
      const id = duplicateTarget;
      if (!id) return;
      setDuplicateTarget(null);
      try {
        const result = await apiPost<DuplicateQuotationResponse>('/duplicate-quotation', {
          quotation_id: id,
        });
        if (result.success) {
          toast(`Orçamento ${result.new_id} criado a partir de ${id}.`, 'success');
          navigate(`/quotations/${encodeURIComponent(result.new_id)}`);
        } else {
          toast('Não foi possível duplicar o orçamento. Tente novamente.', 'error');
        }
      } catch (err) {
        toast(`Erro ao duplicar: ${(err as Error).message || 'Tente novamente.'}`, 'error');
      }
    },
    [duplicateTarget, navigate, toast]
  );

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]
    );
  }, []);

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? data.map((row) => row.id) : []);
    },
    [data]
  );

  const handleBulkDelete = useCallback(async () => {
    const selectedRows = data.filter((row) => selectedIds.includes(row.id));
    if (selectedRows.length === 0) return;
    setBulkDeleteOpen(false);
    setBulkDeleting(true);

    try {
      await Promise.all(
        selectedRows.map((row) => apiDelete(`/quotations?id=${encodeURIComponent(row.id)}`))
      );
      const nextPage = selectedRows.length === data.length && page > 1 ? page - 1 : page;
      setPage(nextPage);
      await fetchData(search, status, nextPage, limit);
      toast(
        selectedRows.length === 1
          ? 'Orçamento excluído.'
          : `${selectedRows.length} orçamentos excluídos.`,
        'success'
      );
    } catch (err) {
      toast(
        'Erro ao excluir orçamentos selecionados: ' +
          ((err as Error).message || 'Tente novamente.'),
        'error'
      );
    } finally {
      setBulkDeleting(false);
    }
  }, [data, selectedIds, page, search, status, limit, fetchData, toast]);

  const totalsQty = data.length;
  const totalsSum = data.reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const selectedRows = data.filter((row) => selectedIds.includes(row.id));
  const selectedCount = selectedRows.length;
  const selectedTotal = selectedRows.reduce((sum, row) => sum + (Number(row.valor) || 0), 0);
  const allSelected = data.length > 0 && selectedCount === data.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const bulkDeleteTotal = selectedRows.reduce((sum, row) => sum + (Number(row.valor) || 0), 0);
  const hasActiveFilters = Boolean(search.trim()) || Boolean(status);

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
  const ActionBtn = ({ icon: Icon, label, href, onClick, colorClass = '' }: ActionBtnProps) => {
    const cls = `inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-surface-muted transition-colors ${colorClass}`;
    if (href) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cls}
          aria-label={label}
          title={label}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon size={18} />
        </a>
      );
    }
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        className={cls}
        aria-label={label}
        title={label}
      >
        <Icon size={18} />
      </button>
    );
  };

  const actionButtons = (row: QuotationRow) => {
    return (
      <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
        <ActionBtn
          icon={Pencil}
          label={`Editar orçamento ${row.id}`}
          onClick={() => navigate(`/quotations/${encodeURIComponent(row.id)}`)}
        />
        <ActionBtn
          icon={Trash2}
          label={`Excluir orçamento ${row.id}`}
          onClick={() => setDeleteTarget(row.id)}
          colorClass="hover:bg-destructive/10 hover:text-destructive"
        />
        {row.revision_id && (
          <ActionBtn
            icon={FileText}
            label={`Abrir PDF do orçamento ${row.id}`}
            href={buildQuotationPreviewUrl(row.revision_id)}
          />
        )}
        <ActionBtn
          icon={Copy}
          label={`Duplicar orçamento ${row.id}`}
          onClick={() => setDuplicateTarget(row.id)}
        />
      </div>
    );
  };

  const EmailMarker = ({ row }: { row: QuotationRow }) => (
    <div
      className="flex items-center gap-1.5"
      title={
        row.email_sent
          ? `Último e-mail enviado em ${formatDate(row.email_sent_at)}`
          : 'Nenhum e-mail enviado para este orçamento ainda'
      }
    >
      {row.email_sent ? (
        <>
          <MailCheck size={14} className="shrink-0 text-success" aria-hidden="true" />
          {row.email_sent_at && (
            <span className="whitespace-nowrap text-[11px] text-fg-muted">
              {formatDate(row.email_sent_at)}
            </span>
          )}
        </>
      ) : (
        <span className="text-fg-muted/40" aria-hidden="true">—</span>
      )}
    </div>
  );

  const statusBadge = (row: QuotationRow) => (
    <StatusBadge
      status={quotationStatusBadgeKey(row.status_canonical)}
      label={quotationStatusLabel(row.status_canonical)}
    />
  );

  return (
    <div className="space-y-4 pb-28 animate-fade-in max-w-[1060px] mx-auto">
      {/* PageHeader + primary action */}
      <PageHeader title="Orçamentos" />

      {/* Search + Page size */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <Input
            placeholder="Buscar por Nº ou Cliente…"
            value={search}
            onChange={onSearchChange}
            className="pl-9"
            aria-label="Buscar orçamentos"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <span>Itens por página</span>
          <select
            value={limit}
            onChange={onLimitChange}
            className="border border-line rounded-[10px] px-3 py-2 text-sm bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => onStatusClick(option.value)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors
              ${
                status === option.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface-muted text-fg-muted hover:text-fg'
              }`}
          >
            {option.label}
            {option.value === '' && totalRecords > 0 && (
              <span
                className={`font-normal ${
                  status === option.value ? 'text-primary-foreground/80' : 'text-fg-muted'
                }`}
              >
                ({totalRecords})
              </span>
            )}
            {option.summaryKey && statusSummary[option.summaryKey] !== undefined && (
              <span
                className={`font-normal ${
                  status === option.value ? 'text-primary-foreground/80' : 'text-fg-muted'
                }`}
              >
                ({statusSummary[option.summaryKey]})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && <SkeletonTable cols={6} rows={8} />}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <AlertTriangle size={32} className="text-destructive/60" />
          <p>Erro ao carregar orçamentos</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => fetchData(search, status, page, limit)}>
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && data.length === 0 && (
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <Clipboard size={36} className="text-fg-muted/40" />
          {hasActiveFilters ? (
            <>
              <p>Nenhum orçamento encontrado</p>
              <p className="text-sm">Tente ajustar os filtros ou criar um novo orçamento.</p>
            </>
          ) : (
            <>
              <p>Nenhum orçamento por aqui ainda</p>
              <p className="text-sm">Crie seu primeiro orçamento para começar.</p>
              <Button onClick={() => navigate('/manual')}>
                <PlusCircle size={16} className="mr-2" />
                Novo orçamento
              </Button>
            </>
          )}
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
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    aria-label="Selecionar todos os orçamentos desta página"
                    className="h-4 w-4 rounded border-line text-primary focus:ring-primary"
                  />
                </TableHead>
                <TableHead className="w-[160px]">Nº</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="whitespace-nowrap">E-mail</TableHead>
                <TableHead className="text-center w-[180px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow
                  key={row.id}
                  className={`cursor-pointer bg-surface ${selectedIds.includes(row.id) ? 'bg-primary/5' : ''}`}
                  onClick={() => navigate(`/quotations/${encodeURIComponent(row.id)}`)}
                >
                  <TableCell className="w-12 px-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(row.id)}
                      onChange={() => toggleSelected(row.id)}
                      aria-label={`Selecionar orçamento ${row.id}`}
                      className="h-4 w-4 rounded border-line text-primary focus:ring-primary"
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm [font-variant-numeric:tabular-nums]">{row.id}</TableCell>
                  <TableCell className="whitespace-nowrap text-fg-muted">
                    {formatDate(row.data)}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate">{row.cliente}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono">{formatBRL(row.valor)}</TableCell>
                  <TableCell>{statusBadge(row)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <EmailMarker row={row} />
                  </TableCell>
                  <TableCell className="text-center">{actionButtons(row)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Mobile Cards (hidden on desktop) ── */}
      {!loading && !error && data.length > 0 && (
        <div className="md:hidden space-y-3">
          {data.map((row) => (
            <div
              key={row.id}
              className={`bg-surface rounded-lg border border-line shadow-sm p-4 space-y-3 cursor-pointer ${selectedIds.includes(row.id) ? 'ring-2 ring-primary/30' : ''}`}
              onClick={() => navigate(`/quotations/${encodeURIComponent(row.id)}`)}
            >
              <div className="flex items-center justify-between gap-3">
                <div
                  className="flex items-center gap-2 min-w-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleSelected(row.id)}
                    aria-label={`Selecionar orçamento ${row.id}`}
                    className="h-4 w-4 rounded border-line text-primary focus:ring-primary"
                  />
                  <span className="font-mono text-sm font-semibold truncate">{row.id}</span>
                </div>
                {statusBadge(row)}
              </div>
              <EmailMarker row={row} />
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg-muted">{row.cliente || '—'}</span>
                <span className="text-fg-muted text-xs">{formatDate(row.data)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold">{formatBRL(row.valor)}</span>
                <div className="flex items-center gap-0.5">
                  <ActionBtn
                    icon={Pencil}
                    label={`Editar orçamento ${row.id}`}
                    onClick={() => navigate(`/quotations/${encodeURIComponent(row.id)}`)}
                  />
                  {row.revision_id && (
                    <ActionBtn
                      icon={FileText}
                      label={`Abrir PDF do orçamento ${row.id}`}
                      href={buildQuotationPreviewUrl(row.revision_id)}
                    />
                  )}
                  <ActionBtn
                    icon={Copy}
                    label={`Duplicar orçamento ${row.id}`}
                    onClick={() => setDuplicateTarget(row.id)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Totals bar + Pagination (desktop only, mobile cards are self-contained) */}
      {!loading && !error && data.length > 0 && (
        <div className="hidden md:flex bg-surface rounded-lg border border-line shadow-sm p-4 items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-xs text-fg-muted">Nesta página</span>
              <p className="font-semibold">
                {totalsQty} orçamento{totalsQty !== 1 ? 's' : ''}
              </p>
            </div>
            <div>
              <span className="text-xs text-fg-muted">Valor Total (página)</span>
              <p className="font-semibold">{formatBRL(totalsSum)}</p>
            </div>
            <div className="text-xs text-fg-muted">
              {status
                ? STATUS_OPTIONS.find((option) => option.value === status)?.label || status
                : 'todos os status'}
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-fg-muted">
                Página {page} de {totalPages} · {totalRecords} orçamento
                {totalRecords !== 1 ? 's' : ''}
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
                {getPageNumbers().map((p) => (
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
          <span className="text-fg-muted text-xs">
            Página {page} de {totalPages} · {totalRecords} registro{totalRecords !== 1 ? 's' : ''}
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

      <div
        className={`fixed inset-x-0 bottom-0 z-40 transition-all duration-300 ${selectedCount > 0 ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}
        >
          <div className="mx-auto max-w-[1060px] px-4">
            <div className="overflow-hidden rounded-t-2xl border border-b-0 border-line bg-surface/95 backdrop-blur shadow-[0_-12px_24px_rgba(0,0,0,0.08)]">
              <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6">
                <div className="flex flex-wrap items-center gap-6">
                  <div className="flex items-center gap-2 text-sm font-medium text-fg">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                      aria-label="Selecionar todos os orçamentos desta página"
                      className="h-4 w-4 rounded border-line text-primary focus:ring-primary"
                    />
                    <span>
                      {selectedCount} orçamento{selectedCount !== 1 ? 's' : ''} selecionado
                      {selectedCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs text-fg-muted">Valor total selecionado</span>
                    <p className="font-semibold text-lg">{formatBRL(selectedTotal)}</p>
                  </div>
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
                    variant="default"
                    onClick={() => setBulkDeleteOpen(true)}
                    disabled={selectedCount === 0 || bulkDeleting}
                  >
                    <Trash2 size={16} className="mr-2" />
                    Excluir orçamentos
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

      {/* Confirmação: excluir orçamento */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Excluir orçamento?"
        message={`Tem certeza que deseja excluir o orçamento ${deleteTarget || ''}? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Confirmação: duplicar orçamento */}
      <ConfirmDialog
        open={duplicateTarget !== null}
        title="Duplicar orçamento?"
        message={`Duplicar o orçamento ${duplicateTarget || ''}? Será criada uma cópia com nova numeração.`}
        confirmLabel="Duplicar"
        cancelLabel="Cancelar"
        variant="default"
        onConfirm={handleDuplicate}
        onCancel={() => setDuplicateTarget(null)}
      />

      {/* Confirmação: exclusão em massa */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        title="Excluir orçamentos selecionados?"
        message={`Tem certeza que deseja excluir ${selectedCount} orçamento${selectedCount !== 1 ? 's' : ''}? Valor total: ${formatBRL(bulkDeleteTotal)}. Essa ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteOpen(false)}
      />
    </div>
  );
}
