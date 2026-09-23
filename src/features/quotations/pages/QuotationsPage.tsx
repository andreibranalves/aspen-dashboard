import { useState, useEffect, useCallback, useRef, type ChangeEvent } from 'react';
import {
  Pencil,
  FileText,
  Trash2,
  AlertTriangle,
  Clipboard,
  PlusCircle,
  Copy,
  MailCheck,
  MoreHorizontal,
  FilePlus2,
  Send,
  BadgeCheck,
  ChevronRight,
  CircleX,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '@/lib/api/api';
import { formatBRL, formatDate } from '@/lib/formatting/formatters';
import { buildQuotationPreviewUrl } from '@/lib/formatting/printFormats';
import { Button } from '@/components/ui/button';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { SearchField } from '@/components/ui/search-field';
import { StatusBadge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import PageToolbar from '@/components/shared/PageToolbar';
import ListPagination from '@/components/shared/ListPagination';
import EntityIdentity from '@/components/shared/EntityIdentity';
import BulkActionBar from '@/components/shared/BulkActionBar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { useToast } from '@/components/shared/toast';
import { quotationStatusLabel, quotationStatusBadgeKey } from '@/lib/statusLabels';
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

export default function QuotationsPage({ navigate }: QuotationsPageProps) {
  const [data, setData] = useState<QuotationRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useHashQueryState('search', '', parseHashString);
  const [status, setStatus] = useHashQueryState('status', '', parseQuotationStatus);
  const [page, setPage] = useHashQueryState('page', 1, parseHashPositiveInteger);
  const [limit, setLimit] = useHashQueryState('limit', 10, parseQuotationLimit);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [statusSummary, setStatusSummary] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<string | null>(null);
  const [openActionRow, setOpenActionRow] = useState<string | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState({ top: 8, left: 8 });
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGenerationRef = useRef(0);
  const requestKeyRef = useRef<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const fetchData = useCallback(
    async (searchVal: string, statusVal: string, pageNum: number, limitVal: number) => {
      const requestKey = JSON.stringify([searchVal, statusVal, pageNum, limitVal]);
      const requestGeneration =
        requestKey === requestKeyRef.current
          ? requestGenerationRef.current
          : requestGenerationRef.current + 1;
      requestGenerationRef.current = requestGeneration;
      requestKeyRef.current = requestKey;
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
        if (requestGeneration !== requestGenerationRef.current) return;
        if (
          !Array.isArray(result.data) ||
          !result.pagination ||
          typeof result.status_summary !== 'object' ||
          result.status_summary === null ||
          Array.isArray(result.status_summary)
        ) {
          throw new Error('Resposta inválida ao carregar orçamentos.');
        }
        const projectedRows = result.data.map(projectQuotationListRow);
        const totalPages = result.pagination.total_pages;
        const totalRecords = result.pagination.total;
        if (
          projectedRows.some((row): row is null => row === null) ||
          typeof totalPages !== 'number' ||
          !Number.isSafeInteger(totalPages) ||
          totalPages < 0 ||
          typeof totalRecords !== 'number' ||
          !Number.isSafeInteger(totalRecords) ||
          totalRecords < 0
        ) {
          throw new Error('Resposta inválida ao carregar orçamentos.');
        }
        const projectedSummary: Record<string, number> = {};
        for (const [key, value] of Object.entries(
          result.status_summary as Record<string, unknown>
        )) {
          if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
            throw new Error('Resposta inválida ao carregar orçamentos.');
          if (['Rascunho', 'Enviado', 'Aprovado', 'Perdido'].includes(key))
            projectedSummary[key] = value;
        }
        setData(projectedRows as QuotationRow[]);
        setTotalPages(totalPages);
        setStatusSummary(projectedSummary);
      } catch {
        if (requestGeneration !== requestGenerationRef.current) return;
        console.error('[quotations] failed to load list');
        setError('Não foi possível carregar os orçamentos. Tente novamente.');
      } finally {
        if (requestGeneration === requestGenerationRef.current) setLoading(false);
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
      }, 350);
    },
    [setPage, setSearch]
  );

  const onStatusClick = useCallback(
    (s: string) => {
      setStatus(s);
      setPage(1);
    },
    [setPage, setStatus]
  );

  const onPageChange = useCallback(
    (p: number) => {
      setPage(p);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [setPage]
  );

  const onLimitChange = useCallback(
    (newLimit: number) => {
      setLimit(newLimit);
      setPage(1);
    },
    [setLimit, setPage]
  );

  // Hash-backed query state is the source of truth for browser navigation.
  useEffect(() => {
    void fetchData(search, status, page, limit);
  }, [fetchData, limit, page, search, status]);

  const handleDelete = useCallback(async () => {
    const id = deleteTarget;
    if (!id) return;
    setDeleteTarget(null);
    try {
      await apiDelete(`/quotations?id=${encodeURIComponent(id)}`);
      setData((prev) => prev.filter((r) => r.id !== id));
      setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
      toast(`Orçamento ${id} excluído.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Não foi possível excluir o orçamento. Tente novamente.', 'error');
    }
  }, [deleteTarget, toast]);

  const handleDuplicate = useCallback(async () => {
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
    } catch {
      toast('Não foi possível duplicar o orçamento. Tente novamente.', 'error');
    }
  }, [duplicateTarget, navigate, toast]);

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
      const results = await Promise.allSettled(
        selectedRows.map((row) => apiDelete(`/quotations?id=${encodeURIComponent(row.id)}`))
      );
      const deletedCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = results.length - deletedCount;
      const nextPage = deletedCount === data.length && page > 1 ? page - 1 : page;
      setPage(nextPage);
      await fetchData(search, status, nextPage, limit);
      if (failedCount === 0) {
        toast(
          deletedCount === 1 ? 'Orçamento excluído.' : `${deletedCount} orçamentos excluídos.`,
          'success'
        );
      } else if (deletedCount > 0) {
        toast(`${deletedCount} excluído(s); ${failedCount} não foi(ram) excluído(s).`, 'error');
      } else {
        toast('Não foi possível excluir os orçamentos selecionados. Tente novamente.', 'error');
      }
    } finally {
      setBulkDeleting(false);
    }
  }, [data, selectedIds, page, search, status, limit, fetchData, toast]);

  const selectedRows = data.filter((row) => selectedIds.includes(row.id));
  const selectedCount = selectedRows.length;
  const selectedTotal = selectedRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  const allSelected = data.length > 0 && selectedCount === data.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const bulkDeleteTotal = selectedRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  const hasActiveFilters = Boolean(search.trim()) || Boolean(status);
  const clearFilters = useCallback(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearch('');
    setStatus('');
    setPage(1);
  }, [setPage, setSearch, setStatus]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const summaryPending = loading && Object.keys(statusSummary).length === 0;

  const actionButtons = (row: QuotationRow, placement: 'desktop' | 'mobile') => {
    const label = row.businessNumber;
    const menuId = `quotation-actions-${placement}-${row.id}`;
    return (
      <div onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          popoverTarget={menuId}
          popoverTargetAction="toggle"
          aria-controls={menuId}
          aria-expanded={openActionRow === row.id}
          className="flex h-8 w-8 items-center justify-center rounded-control text-fg-muted hover:bg-surface-hover hover:text-fg"
          aria-label={`Ações do orçamento ${label}`}
          title={`Ações do orçamento ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            const menuHeight = 184;
            setActionMenuPosition({
              top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menuHeight)),
              left: Math.max(8, Math.min(rect.right - 192, window.innerWidth - 200)),
            });
          }}
        >
          <MoreHorizontal aria-hidden="true" size={18} />
        </button>
        <div
          id={menuId}
          popover="auto"
          aria-label={`Ações do orçamento ${label}`}
          className="fixed inset-auto m-0 w-48 rounded-control border border-line bg-surface py-1 shadow-lg"
          style={{ top: `${actionMenuPosition.top}px`, left: `${actionMenuPosition.left}px` }}
          onToggle={(event) => {
            setOpenActionRow(event.nativeEvent.newState === 'open' ? row.id : null);
          }}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget;
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              event.currentTarget.hidePopover();
            }
          }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
            onClick={(event) => {
              event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
              navigate(`/quotations/${encodeURIComponent(row.id)}`);
            }}
          >
            <Pencil size={15} /> Editar
          </button>
          {row.revisionId && (
            <a
              href={buildQuotationPreviewUrl(row.revisionId)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
              onClick={(event) =>
                event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
              }
            >
              <FileText size={15} /> Visualizar PDF
            </a>
          )}
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
            onClick={(event) => {
              event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
              setDuplicateTarget(row.id);
            }}
          >
            <Copy size={15} /> Duplicar
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
            onClick={(event) => {
              event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
              setDeleteTarget(row.id);
            }}
          >
            <Trash2 size={15} /> Excluir
          </button>
        </div>
      </div>
    );
  };

  const EmailMarker = ({ row }: { row: QuotationRow }) => (
    <div
      className="flex items-center gap-1.5"
      aria-label={
        row.emailSent
          ? `E-mail enviado${row.emailSentAt ? ` em ${formatDate(row.emailSentAt)}` : ''}`
          : 'E-mail ainda não enviado'
      }
      title={
        row.emailSent
          ? `Último e-mail enviado em ${formatDate(row.emailSentAt)}`
          : 'Nenhum e-mail enviado para este orçamento ainda'
      }
    >
      {row.emailSent ? (
        <>
          <MailCheck size={14} className="shrink-0 text-success" aria-hidden="true" />
          {row.emailSentAt && (
            <span className="whitespace-nowrap text-[11px] text-fg-muted">
              {formatDate(row.emailSentAt)}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="text-fg-muted/40" aria-hidden="true">
            —
          </span>
          <span className="sr-only">E-mail ainda não enviado</span>
        </>
      )}
    </div>
  );

  const statusBadge = (row: QuotationRow) => (
    <StatusBadge
      status={quotationStatusBadgeKey(row.status)}
      label={quotationStatusLabel(row.status)}
    />
  );

  return (
    <PageShell className={selectedCount > 0 ? 'space-y-6 pb-48 sm:pb-28' : 'space-y-6 pb-4'}>
      <PageHeader
        title="Orçamentos"
        actions={
          <>
            <Button onClick={() => navigate('/novo-orcamento')} variant="default">
              <PlusCircle />
              Novo orçamento
            </Button>
          </>
        }
      />

      <StatGrid label="Resumo dos orçamentos">
        {[
          { label: 'Rascunhos', value: statusSummary.Rascunho ?? 0, note: 'Ainda não emitidos', Icon: FilePlus2 },
          { label: 'Emitidos', value: statusSummary.Enviado ?? 0, note: 'Aguardando decisão', Icon: Send },
          { label: 'Aprovados', value: statusSummary.Aprovado ?? 0, note: 'Prontos para avançar', Icon: BadgeCheck },
          { label: 'Perdidos', value: statusSummary.Perdido ?? 0, note: 'Com motivo registrado', Icon: CircleX },
        ].map(({ label, value, note, Icon }) => (
          <StatCard key={label} icon={Icon} label={label} value={String(value)} metadata={note} loading={summaryPending} />
        ))}
      </StatGrid>

      <section aria-label="Lista de orçamentos" className="overflow-hidden rounded-card bg-surface p-5">
        <PageToolbar className="mb-5">
          <SearchField placeholder="Buscar orçamento ou cliente" value={search} onChange={onSearchChange} aria-label="Buscar orçamentos" />
          <Select value={status} onChange={(event) => onStatusClick(event.target.value)} aria-label="Filtrar por status">
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <Button type="button" variant="ghost" className="ml-auto" onClick={() => { setSelectionMode((current) => !current); setSelectedIds([]); }} aria-pressed={selectionMode}>{selectionMode ? 'Cancelar seleção' : 'Selecionar'}</Button>
        </PageToolbar>

      {/* Loading */}
      {loading && <div className="p-4"><SkeletonTable cols={7} rows={8} /></div>}

      {/* Error */}
      {!loading && error && (
        <div
          role="alert"
          className="m-4 flex flex-col items-center gap-3 rounded-control border border-destructive/30 bg-destructive/10 px-4 py-12 text-center text-fg"
        >
          <AlertTriangle size={32} className="text-destructive" aria-hidden="true" />
          <p className="font-medium">Não foi possível carregar os orçamentos.</p>
          <p className="max-w-md text-sm text-fg-muted">
            Verifique sua conexão e tente novamente. Os filtros atuais serão mantidos.
          </p>
          <Button variant="outline" onClick={() => fetchData(search, status, page, limit)}>
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && data.length === 0 && (
        <EmptyState
          icon={Clipboard}
          title={
            hasActiveFilters ? 'Nenhum orçamento encontrado' : 'Nenhum orçamento por aqui ainda'
          }
          description={
            hasActiveFilters
              ? 'Não encontramos propostas com os filtros atuais. Ajuste a busca ou limpe os filtros.'
              : 'Crie seu primeiro orçamento para começar.'
          }
          actions={
            hasActiveFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                Limpar filtros
              </Button>
            ) : (
              <Button onClick={() => navigate('/novo-orcamento')}>
                <PlusCircle />
                Novo orçamento
              </Button>
            )
          }
        />
      )}

      {!loading && !error && data.length > 0 && (
        <div className="hidden md:block">
          <Table
            className="[&_td]:py-4 [&_th]:h-12"
            containerClassName="overflow-hidden"
          >
            <TableHeader>
              <TableRow>
                {selectionMode && <TableHead className="w-12 px-3">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    aria-label="Selecionar todos os orçamentos desta página"
                    className="h-4 w-4 rounded-xs border-line text-primary"
                  />
                </TableHead>}
                <TableHead className="w-[190px]">Orçamento</TableHead>
                <TableHead className="min-w-[220px]">Cliente / demanda</TableHead>
                <TableHead className="whitespace-nowrap">Data</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow
                  key={row.id}
                  className={`group cursor-pointer ${selectedIds.includes(row.id) ? 'bg-surface-selected' : ''}`}
                  onClick={() => navigate(`/quotations/${encodeURIComponent(row.id)}`)}
                >
                  {selectionMode && <TableCell className="w-12 px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(row.id)}
                      onChange={() => toggleSelected(row.id)}
                      aria-label={`Selecionar orçamento ${row.businessNumber}`}
                      className="h-4 w-4 rounded-xs border-line text-primary"
                    />
                  </TableCell>}
                  <TableCell className="whitespace-nowrap py-2 text-sm [font-variant-numeric:tabular-nums]">
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto max-w-[180px] justify-start truncate p-0 font-mono text-sm font-semibold"
                      title={row.businessNumber}
                      onClick={() => navigate(`/quotations/${encodeURIComponent(row.id)}`)}
                    >
                      {row.businessNumber}
                    </Button>
                    <span className="block text-[11px] text-fg-muted">Revisão {row.revision}</span>
                  </TableCell>
                  <TableCell className="max-w-[300px] py-2" title={row.cliente}>
                    <EntityIdentity name={row.cliente || 'Cliente não informado'} secondary={row.name && row.name !== row.cliente ? row.name : undefined} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-fg-muted">
                    <span className="block">
                      {formatDate(row.data) || '—'}
                    </span>
                  </TableCell>
                  <TableCell className="py-2">{statusBadge(row)}</TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-right font-medium [font-variant-numeric:tabular-nums]">
                    {formatBRL(row.total)}
                  </TableCell>
                  <TableCell className="w-24 py-2 text-right text-fg-muted">
                    <div className="flex items-center justify-end gap-1"><span className="pointer-events-none block shrink-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">{actionButtons(row, 'desktop')}</span><ChevronRight size={16} aria-hidden="true" /></div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="space-y-3 md:hidden">
          {data.map((row) => (
            <div
              key={row.id}
              className={`cursor-pointer space-y-3 rounded-card border border-line bg-surface p-5 ${selectedIds.includes(row.id) ? 'ring-2 ring-primary/30' : ''}`}
              onClick={() => navigate(`/quotations/${encodeURIComponent(row.id)}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className="flex min-w-0 items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleSelected(row.id)}
                    aria-label={`Selecionar orçamento ${row.businessNumber}`}
                    className="h-4 w-4 shrink-0 rounded-xs border-line text-primary"
                  />
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto min-w-0 justify-start truncate p-0 font-mono text-sm font-semibold"
                    title={row.businessNumber}
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate(`/quotations/${encodeURIComponent(row.id)}`);
                    }}
                  >
                    {row.businessNumber}
                  </Button>
                  <span className="shrink-0 text-xs text-fg-muted">· Rev. {row.revision}</span>
                </div>
                {statusBadge(row)}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-fg-muted">Cliente</p>
                <p className="break-words font-medium">{row.cliente || 'Cliente não informado'}</p>
                <p className="mt-0.5 break-words text-xs text-fg-muted">{row.name}</p>
              </div>
              <div className="text-xs text-fg-muted">
                <EmailMarker row={row} />
              </div>
              <div className="flex items-end justify-between gap-3 border-t border-line pt-3">
                <div>
                  <p className="text-xs text-fg-muted">Data · Valor</p>
                  <p className="text-sm text-fg-muted">
                    {formatDate(row.data) || '—'}
                  </p>
                  <p className="font-mono font-semibold [font-variant-numeric:tabular-nums]">
                    {formatBRL(row.total)}
                  </p>
                </div>
                {actionButtons(row, 'mobile')}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="border-t border-line pt-4"><ListPagination label="Paginação de orçamentos" page={page} limit={limit} pageSizes={PAGE_SIZES} hasNext={page < totalPages} onPageChange={onPageChange} onLimitChange={onLimitChange} /></div>
      )}
      </section>

      <BulkActionBar visible={selectedCount > 0}>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2 text-sm font-medium text-fg">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={(e) => toggleSelectAll(e.target.checked)}
              aria-label="Selecionar todos os orçamentos desta página"
              className="h-4 w-4 rounded-xs border-line text-primary"
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
            variant="outline"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => setBulkDeleteOpen(true)}
            disabled={selectedCount === 0 || bulkDeleting}
          >
            <Trash2 className="mr-2" />
            Excluir orçamentos
          </Button>
        </div>
      </BulkActionBar>

      {/* Confirmação: excluir orçamento */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Excluir orçamento?"
        message={`Excluir ${deleteTarget || 'este orçamento'} e todas as suas revisões permanentemente? Mensagens e arquivos já recebidos pelo cliente não serão apagados.`}
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
    </PageShell>
  );
}
