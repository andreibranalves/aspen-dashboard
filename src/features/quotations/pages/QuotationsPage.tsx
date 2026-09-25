import { useState, useEffect, useCallback, useRef, type ChangeEvent, type CSSProperties } from 'react';
import {
  Pencil,
  FileText,
  Trash2,
  Clipboard,
  PlusCircle,
  Copy,
  MailCheck,
  MoreHorizontal,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '@/lib/api/api';
import { formatBRL, formatDate } from '@/lib/formatting/formatters';
import { buildQuotationPreviewUrl } from '@/lib/formatting/printFormats';
import { Button } from '@/components/ui/button';
import ErrorState from '@/components/shared/ErrorState';
import { SearchField } from '@/components/ui/search-field';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import ListPageLayout, { ListSection } from '@/components/shared/ListPageLayout';
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
import DataList, { type DataListColumn } from '@/components/shared/DataList';
import StatusFilterBar from '@/components/shared/StatusFilterBar';
import { Text } from '@/components/ui/text';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { projectQuotationListRow, type ProjectedQuotationListRow } from '@/lib/localProjections';
import { MenuItem } from '@/components/ui/menu-item';

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
        <Button
          type="button"
          variant="ghost-muted"
          size="icon-sm"
          popoverTarget={menuId}
          popoverTargetAction="toggle"
          aria-controls={menuId}
          aria-expanded={openActionRow === row.id}
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
          <MoreHorizontal aria-hidden="true" />
        </Button>
        <div
          id={menuId}
          popover="auto"
          aria-label={`Ações do orçamento ${label}`}
          className="fixed inset-auto top-(--menu-top) left-(--menu-left) m-0 w-48 rounded-control border border-line bg-surface p-1 shadow-lg"
          style={{ '--menu-top': `${actionMenuPosition.top}px`, '--menu-left': `${actionMenuPosition.left}px` } as CSSProperties}
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
          <MenuItem
            onClick={(event) => {
              event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
              navigate(`/quotations/${encodeURIComponent(row.id)}`);
            }}
          >
            <Pencil /> Editar
          </MenuItem>
          {row.revisionId && (
            <MenuItem asChild>
              <a
                href={buildQuotationPreviewUrl(row.revisionId)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) =>
                  event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
                }
              >
                <FileText /> Visualizar PDF
              </a>
            </MenuItem>
          )}
          <MenuItem
            onClick={(event) => {
              event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
              setDuplicateTarget(row.id);
            }}
          >
            <Copy /> Duplicar
          </MenuItem>
          <MenuItem
            tone="destructive"
            onClick={(event) => {
              event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
              setDeleteTarget(row.id);
            }}
          >
            <Trash2 /> Excluir
          </MenuItem>
        </div>
      </div>
    );
  };

  const emailSentMark = (row: QuotationRow) =>
    row.emailSent ? (
      <MailCheck
        size={14}
        className="shrink-0 text-success"
        role="img"
        aria-label={`E-mail enviado${row.emailSentAt ? ` em ${formatDate(row.emailSentAt)}` : ''}`}
      />
    ) : null;

  const selectBox = (row: QuotationRow) => (
    <input
      type="checkbox"
      checked={selectedIds.includes(row.id)}
      onChange={() => toggleSelected(row.id)}
      aria-label={`Selecionar orçamento ${row.businessNumber}`}
      className="size-4 rounded-xs border-line text-primary"
    />
  );

  const columns: DataListColumn<QuotationRow>[] = [
    ...(selectionMode
      ? [{
          key: 'select',
          interactive: true,
          header: (
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={(e: ChangeEvent<HTMLInputElement>) => toggleSelectAll(e.target.checked)}
              aria-label="Selecionar todos os orçamentos desta página"
              className="size-4 rounded-xs border-line text-primary"
            />
          ),
          cell: selectBox,
        }]
      : []),
    {
      key: 'quotation',
      header: 'Orçamento',
      cell: (row) => (
        <div className="flex flex-col">
          <Text variant="record">{row.businessNumber}</Text>
          {row.revision > 1 && <Text variant="caption">Revisão {row.revision}</Text>}
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Cliente',
      cell: (row) => (
        <EntityIdentity
          name={row.cliente || 'Cliente não informado'}
          secondary={row.name && row.name !== row.cliente ? row.name : undefined}
        />
      ),
    },
    { key: 'date', header: 'Data', cell: (row) => <Text variant="meta">{formatDate(row.data) || '—'}</Text> },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <div className="flex items-center gap-2">
          {statusBadge(row)}
          {emailSentMark(row)}
        </div>
      ),
    },
    { key: 'total', header: 'Valor', align: 'right', cell: (row) => <Text variant="value">{formatBRL(row.total)}</Text> },
    { key: 'actions', header: <span className="sr-only">Ações</span>, interactive: true, align: 'right', cell: (row) => actionButtons(row, 'desktop') },
  ];

  const statusBadge = (row: QuotationRow) => (
    <StatusBadge
      status={quotationStatusBadgeKey(row.status)}
      label={quotationStatusLabel(row.status)}
    />
  );

  return (
    <ListPageLayout
      className={selectedCount > 0 ? 'max-sm:pb-48' : undefined}
        header={
  <PageHeader title="Orçamentos" />
        }
      >

      <ListSection
        label="Lista de orçamentos"
        pagination={!loading && !error && data.length > 0 && (
          <ListPagination label="Paginação de orçamentos" page={page} limit={limit} pageSizes={PAGE_SIZES} hasNext={page < totalPages} onPageChange={onPageChange} onLimitChange={onLimitChange} />
        )}
        toolbar={<>
          <StatusFilterBar
            label="Filtrar por status"
            value={status}
            onValueChange={onStatusClick}
            options={STATUS_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
              count: option.summaryKey === null ? undefined : summaryPending ? null : (statusSummary[option.summaryKey] ?? 0),
            }))}
            className="w-full lg:w-auto"
          />
          <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto lg:flex-1">
            <SearchField placeholder="Buscar orçamento ou cliente" value={search} onChange={onSearchChange} aria-label="Buscar orçamentos" />
            <Button type="button" variant="ghost" size="md" className="ml-auto shrink-0" onClick={() => { setSelectionMode((current) => !current); setSelectedIds([]); }} aria-pressed={selectionMode}>{selectionMode ? 'Cancelar seleção' : 'Selecionar'}</Button>
          </div>
        </>}
      >

      {/* Loading */}
      {loading && <SkeletonTable cols={7} rows={8} />}

      {/* Error */}
      {!loading && error && (
        <ErrorState title="Não foi possível carregar os orçamentos" description="Os filtros atuais serão mantidos." onRetry={() => fetchData(search, status, page, limit)} />
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
        <DataList
          label="Orçamentos"
          items={data}
          getKey={(row) => row.id}
          columns={columns}
          getHref={(row) => `#/quotations/${encodeURIComponent(row.id)}`}
          getRowLabel={(row) => `Abrir orçamento ${row.businessNumber}`}
          isSelected={(row) => selectedIds.includes(row.id)}
          mobileLead={selectionMode ? selectBox : undefined}
          mobileAside={(row) => actionButtons(row, 'mobile')}
          mobileRow={(row) => (
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <Text variant="title" truncate>{row.cliente || 'Cliente não informado'}</Text>
                <Text variant="value" className="shrink-0">{formatBRL(row.total)}</Text>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Text variant="meta" truncate>
                  <span className="font-mono">{row.businessNumber}</span>
                  {row.revision > 1 && ` · Rev. ${row.revision}`} · {formatDate(row.data) || '—'}
                </Text>
                <div className="flex shrink-0 items-center gap-1.5">
                  {emailSentMark(row)}
                  {statusBadge(row)}
                </div>
              </div>
            </div>
          )}
        />
      )}

      </ListSection>

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
            variant="outline-destructive"
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
    </ListPageLayout>
  );
}
