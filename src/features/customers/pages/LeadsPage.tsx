import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  Eye,
  Mail,
  Phone,
  ReceiptText,
  Sparkles,
  Users,
  UserPlus,
  X,
} from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPut } from '@/lib/api/api';
import { fmtPhone, formatBRL, formatDate, whatsappContactUrl } from '@/lib/formatting/formatters';
import { createQuoteForClient } from '@/features/customers/quote-prefill';
import { Button } from '@/components/ui/button';
import InlineAlert from '@/components/shared/InlineAlert';
import ErrorState from '@/components/shared/ErrorState';
import { SearchField } from '@/components/ui/search-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import PageHeader from '@/components/shared/PageHeader';
import ListPageLayout, { ListSection } from '@/components/shared/ListPageLayout';
import ListPagination from '@/components/shared/ListPagination';
import EntityIdentity from '@/components/shared/EntityIdentity';
import ExportCsvButton from '@/components/shared/ExportCsvButton';
import BulkActionBar from '@/components/shared/BulkActionBar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { useToast } from '@/components/shared/toast';
import { StatusBadge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  parseHashAllowedInteger,
  parseHashOption,
  parseHashPositiveInteger,
  parseHashString,
  useHashQueryState,
} from '@/hooks/useHashQueryState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import SkeletonTable from '@/components/shared/SkeletonTable';
import Skeleton from '@/components/shared/Skeleton';
import { DetailDrawer } from '@/components/shared/DetailDrawer';
import { QualityBadges, type QualityBadge } from '@/features/customers/components/QualityBadges';
import { ContextActions, type ContextAction } from '@/features/customers/components/ContextActions';
import { CustomerActionMenu } from '@/features/customers/components/CustomerActionMenu';
import {
  projectClientDetail,
  projectClientListResponse,
  type ProjectedClientDetail,
  type ProjectedClientRow,
} from '@/lib/localProjections';

interface Address {
  endereco?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
}

type DataRow = ProjectedClientRow;
type ClientDetail = ProjectedClientDetail;
type LeadsResponse = unknown;

interface EditFields {
  nome: string;
  empresa: string;
  email: string;
  telefone: string;
  documento: string;
  observacoes: string;
  endereco: Address;
}

interface LeadsPageProps {
  navigate?: (path: string) => void;
}

const PAGE_SIZES = [10, 25, 50];
const parseLeadStatus = parseHashOption<'active' | 'archived' | 'all'>([
  'active',
  'archived',
  'all',
]);
const parseLeadLimit = parseHashAllowedInteger(PAGE_SIZES);
const EMPTY_FIELDS: EditFields = {
  nome: '',
  empresa: '',
  email: '',
  telefone: '',
  documento: '',
  observacoes: '',
  endereco: {},
};

type PendingLeadArchive =
  | { kind: 'row'; row: DataRow }
  | { kind: 'bulk'; rows: DataRow[]; restoring: boolean };

function isArchivedRow(row: DataRow): boolean {
  return row.status === 'archived' || row.arquivado === true;
}

function rowLabel(row: DataRow): string {
  return row.nome || row.id || 'Cliente sem nome';
}

function archiveDialogText(pending: PendingLeadArchive): {
  title: string;
  message: string;
  confirmLabel: string;
  variant: 'destructive' | 'default';
} {
  if (pending.kind === 'bulk') {
    const action = pending.restoring ? 'Restaurar' : 'Arquivar';
    const count = pending.rows.length;
    return {
      title: `${action} clientes`,
      message: `${action} ${count} cliente${count === 1 ? '' : 's'}?`,
      confirmLabel: action,
      variant: pending.restoring ? 'default' : 'destructive',
    };
  }
  const restoring = isArchivedRow(pending.row);
  const action = restoring ? 'Restaurar' : 'Arquivar';
  return {
    title: `${action} cliente`,
    message: `${action} o cliente ${rowLabel(pending.row)}?`,
    confirmLabel: action,
    variant: restoring ? 'default' : 'destructive',
  };
}

function isValidEmail(value: string): boolean {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return !digits || (digits.length >= 10 && digits.length <= 15);
}

function addressText(address?: Address | null): string {
  if (!address) return 'Endereço não cadastrado';
  const first = [address.endereco, address.numero].filter(Boolean).join(', ');
  const second = [address.bairro, address.complemento].filter(Boolean).join(' · ');
  const city = [address.municipio, address.uf].filter(Boolean).join('/');
  return (
    [first, second, city, address.cep].filter(Boolean).join(' · ') || 'Endereço não cadastrado'
  );
}

function formatDocument(value?: string | null): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (digits.length === 14)
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return value || '—';
}

function qualityBadges(detail: ClientDetail): QualityBadge[] {
  const labels: Record<string, QualityBadge> = {
    sem_telefone: { label: 'Sem telefone', type: 'warning' },
    sem_email: { label: 'Sem e-mail', type: 'warning' },
    sem_cnpj: { label: 'Sem documento', type: 'info' },
    endereco_incompleto: { label: 'Endereço incompleto', type: 'warning' },
  };
  return detail.quality_flags?.length
    ? detail.quality_flags.map((flag) => labels[flag] || { label: flag, type: 'warning' })
    : [];
}

function fieldsFromDetail(detail: ClientDetail): EditFields {
  return {
    nome: detail.display_name || detail.nome || '',
    empresa: detail.empresa || '',
    email: detail.email || '',
    telefone: detail.telefone || '',
    documento: detail.tax_id || detail.documento || '',
    observacoes: detail.notes ?? detail.observacoes ?? '',
    endereco: { ...(detail.address || {}) },
  };
}

function addressPayload(address: Address): Address {
  return {
    endereco: address.endereco?.trim() || '',
    numero: address.numero?.trim() || '',
    bairro: address.bairro?.trim() || '',
    complemento: address.complemento?.trim() || '',
    municipio: address.municipio?.trim() || '',
    uf: address.uf?.trim() || '',
    cep: address.cep?.trim() || '',
  };
}

function statusLabel(row: DataRow): string {
  return isArchivedRow(row) ? 'Arquivado' : 'Ativo';
}

function statusKey(row: DataRow): 'Archived' | 'Active' {
  return isArchivedRow(row) ? 'Archived' : 'Active';
}

export default function LeadsPage({ navigate }: LeadsPageProps) {
  const [data, setData] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useHashQueryState('search', '', parseHashString);
  const [status, setStatus] = useHashQueryState<'active' | 'archived' | 'all'>(
    'status',
    'all',
    parseLeadStatus
  );
  const [page, setPage] = useHashQueryState('page', 1, parseHashPositiveInteger);
  const [limit, setLimit] = useHashQueryState('limit', 10, parseLeadLimit);
  const [totalPages, setTotalPages] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRequestGenerationRef = useRef(0);
  const listRequestKeyRef = useRef<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();
  const [pendingArchive, setPendingArchive] = useState<PendingLeadArchive | null>(null);
  const archiveDialog = useMemo(
    () => (pendingArchive ? archiveDialogText(pendingArchive) : null),
    [pendingArchive]
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editFields, setEditFields] = useState<EditFields>(EMPTY_FIELDS);
  const [confirmDrawerDiscard, setConfirmDrawerDiscard] = useState(false);
  const [drawerDiscardAction, setDrawerDiscardAction] = useState<(() => void) | null>(null);
  const drawerRequestRef = useRef(0);

  const fetchData = useCallback(
    async (searchValue = search, pageValue = page, statusValue = status, limitValue = limit) => {
      const requestKey = JSON.stringify([searchValue, pageValue, statusValue, limitValue]);
      const requestGeneration =
        requestKey === listRequestKeyRef.current
          ? listRequestGenerationRef.current
          : listRequestGenerationRef.current + 1;
      listRequestGenerationRef.current = requestGeneration;
      listRequestKeyRef.current = requestKey;
      setLoading(true);
      setError(null);
      setSelectedIds([]);
      try {
        const params = new URLSearchParams({
          page: String(pageValue),
          limit: String(limitValue),
          status: statusValue,
        });
        if (searchValue) params.set('search', searchValue);
        const result = await apiGet<LeadsResponse>(`/leads-clients?${params.toString()}`);
        if (requestGeneration !== listRequestGenerationRef.current) return;
        const projected = projectClientListResponse(result);
        if (!projected) throw new Error('Resposta inválida ao carregar clientes.');
        const safePage =
          projected.pagination.total_pages > 0
            ? Math.min(pageValue, projected.pagination.total_pages)
            : 1;
        if (safePage !== pageValue) {
          setPage(safePage);
          return;
        }
        setData(projected.data);
        setTotalPages(projected.pagination.total_pages);
      } catch {
        if (requestGeneration !== listRequestGenerationRef.current) return;
        setData([]);
        setTotalPages(0);
        setError('Não foi possível carregar os clientes. Tente novamente.');
      } finally {
        if (requestGeneration === listRequestGenerationRef.current) setLoading(false);
      }
    },
    [limit, page, search, setPage, status]
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        selectedIds.length > 0 && selectedIds.length < data.length;
    }
  }, [data.length, selectedIds.length]);

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    []
  );

  const onSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setSearch(value);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        setPage(1);
        void fetchData(value, 1, status, limit);
      }, 300);
    },
    [fetchData, limit, setPage, setSearch, status]
  );

  const loadDrawerDetail = useCallback(async (id: string) => {
    const requestId = ++drawerRequestRef.current;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const result = await apiGet<unknown>(`/client-detail?name=${encodeURIComponent(id)}`);
      const projected = projectClientDetail(result);
      if (!projected) throw new Error('Resposta inválida ao carregar cliente.');
      if (requestId !== drawerRequestRef.current) return;
      setDetail(projected);
    } catch {
      if (requestId !== drawerRequestRef.current) return;
      setDetail(null);
      setDetailError('Não foi possível carregar os detalhes. Tente novamente.');
    } finally {
      if (requestId === drawerRequestRef.current) setDetailLoading(false);
    }
  }, []);

  const openDrawer = useCallback(
    (row: DataRow) => {
      setSelectedId(row.id);
      setDrawerOpen(true);
      setDetail(null);
      setDetailSaving(false);
      setEditMode(false);
      setConfirmDrawerDiscard(false);
      setDrawerDiscardAction(null);
      void loadDrawerDetail(row.id);
    },
    [loadDrawerDetail]
  );

  const closeDrawer = useCallback(() => {
    drawerRequestRef.current += 1;
    setDrawerOpen(false);
    setSelectedId(null);
    setDetail(null);
    setDetailSaving(false);
    setDetailError(null);
    setEditMode(false);
    setConfirmDrawerDiscard(false);
    setDrawerDiscardAction(null);
  }, []);

  const drawerHasUnsavedChanges = Boolean(
    drawerOpen &&
    editMode &&
    detail &&
    JSON.stringify(editFields) !== JSON.stringify(fieldsFromDetail(detail))
  );

  const requestDrawerClose = useCallback(
    (afterClose?: () => void) => {
      if (drawerHasUnsavedChanges) {
        setDrawerDiscardAction(() => afterClose || null);
        setConfirmDrawerDiscard(true);
        return;
      }
      closeDrawer();
      afterClose?.();
    },
    [closeDrawer, drawerHasUnsavedChanges]
  );

  const updateDetail = useCallback(async () => {
    if (!selectedId || !detail) return;
    const requestId = drawerRequestRef.current;
    const fields = editFields;
    if (!fields.nome.trim()) {
      setDetailError('Nome é obrigatório.');
      return;
    }
    if (!isValidEmail(fields.email)) {
      setDetailError('E-mail inválido.');
      return;
    }
    if (!isValidPhone(fields.telefone)) {
      setDetailError('Telefone inválido.');
      return;
    }
    setDetailSaving(true);
    setDetailError(null);
    try {
      const result = await apiPut<unknown>(
        `/client-detail?name=${encodeURIComponent(selectedId)}`,
        {
          nome: fields.nome.trim(),
          empresa: fields.empresa.trim() || null,
          email: fields.email.trim() || null,
          telefone: fields.telefone.trim() || null,
          documento: fields.documento.replace(/\D/g, '') || null,
          notes: fields.observacoes.trim() || null,
          endereco: addressPayload(fields.endereco),
        }
      );
      const projected = projectClientDetail(result);
      if (!projected) throw new Error('Resposta inválida ao salvar cliente.');
      if (requestId !== drawerRequestRef.current) return;
      setDetail(projected);
      setEditFields(fieldsFromDetail(projected));
      setEditMode(false);
      setData((rows) =>
        rows.map((row) =>
          row.id === selectedId
            ? {
                ...row,
                nome: projected.display_name || projected.nome,
                empresa: projected.empresa,
                email: projected.email,
                telefone: projected.telefone,
                municipio: projected.address?.municipio,
                uf: projected.address?.uf,
                documento: projected.tax_id || projected.documento,
              }
            : row
        )
      );
      toast('Cliente atualizado com sucesso.', 'success');
    } catch {
      if (requestId === drawerRequestRef.current) {
        setDetailError('Não foi possível salvar as alterações. Tente novamente.');
      }
    } finally {
      if (requestId === drawerRequestRef.current) setDetailSaving(false);
    }
  }, [detail, editFields, selectedId, toast]);

  const toggleArchive = useCallback((row: DataRow) => {
    setPendingArchive({ kind: 'row', row });
  }, []);

  const runToggleArchive = useCallback(
    async (row: DataRow) => {
      const archived = isArchivedRow(row);
      const label = rowLabel(row);
      try {
        if (archived)
          await apiPatch(`/client-detail?name=${encodeURIComponent(row.id)}`, { arquivado: false });
        else await apiDelete(`/leads-clients?id=${encodeURIComponent(row.id)}`);
        toast(archived ? `Cliente ${label} restaurado.` : `Cliente ${label} arquivado.`, 'success');
        await fetchData();
      } catch {
        toast('Não foi possível alterar o status do cliente. Tente novamente.', 'error');
      }
    },
    [fetchData, toast]
  );

  const navigateToDetail = useCallback(
    (id: string) => {
      navigate?.(`/leads/cliente/${encodeURIComponent(id)}`);
    },
    [navigate]
  );

  const contextActions = useCallback((): ContextAction[] => {
    if (!detail) return [];
    const actions: ContextAction[] = [
      {
        label: 'Abrir ficha completa',
        icon: ChevronRight,
        onClick: () => requestDrawerClose(() => navigateToDetail(detail.id)),
        title: 'Abrir página completa do cadastro',
      },
    ];
    if (detail.telefone)
      actions.push({
        label: 'WhatsApp',
        icon: Phone,
        href: whatsappContactUrl(detail.telefone),
        title: 'Abrir WhatsApp',
      });
    if (detail.email)
      actions.push({
        label: 'E-mail',
        icon: Mail,
        href: `mailto:${detail.email}`,
        title: 'Enviar e-mail',
      });
    actions.push({
      label: 'Novo orçamento',
      icon: Sparkles,
      onClick: () => requestDrawerClose(() => createQuoteForClient(detail, navigate)),
      title: 'Novo orçamento com os dados deste cliente',
    });
    return actions;
  }, [detail, navigate, navigateToDetail, requestDrawerClose]);

  const allSelected = data.length > 0 && selectedIds.length === data.length;
  const toggleAll = (checked: boolean) => setSelectedIds(checked ? data.map((row) => row.id) : []);
  const toggleSelected = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );

  const requestBulkArchive = () => {
    if (!selectedIds.length) return;
    const selected = data.filter((row) => selectedIds.includes(row.id));
    const restoring = status === 'archived';
    const actionable = selected.filter((row) =>
      restoring ? isArchivedRow(row) : !isArchivedRow(row)
    );
    if (!actionable.length) {
      toast(
        restoring
          ? 'Selecione clientes arquivados para restaurar.'
          : 'Selecione clientes ativos para arquivar.',
        'info'
      );
      return;
    }
    setPendingArchive({ kind: 'bulk', rows: actionable, restoring });
  };

  const runBulkArchive = useCallback(
    async (rows: DataRow[], restoring: boolean) => {
      const results = await Promise.allSettled(
        rows.map((row) =>
          restoring
            ? apiPatch(`/client-detail?name=${encodeURIComponent(row.id)}`, { arquivado: false })
            : apiDelete(`/leads-clients?id=${encodeURIComponent(row.id)}`)
        )
      );
      const successCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = results.length - successCount;
      await fetchData();
      if (failedCount === 0) {
        toast(
          `${successCount} cliente${successCount === 1 ? '' : 's'} ${restoring ? 'restaurado' : 'arquivado'}${successCount === 1 ? '' : 's'}.`,
          'success'
        );
      } else if (successCount > 0) {
        toast(`${successCount} concluído(s); ${failedCount} falhou(aram).`, 'error');
      } else {
        toast(
          `Não foi possível ${restoring ? 'restaurar' : 'arquivar'} os clientes selecionados. Tente novamente.`,
          'error'
        );
      }
    },
    [fetchData, toast]
  );

  const confirmPendingArchive = useCallback(() => {
    const pending = pendingArchive;
    setPendingArchive(null);
    if (!pending) return;
    if (pending.kind === 'row') void runToggleArchive(pending.row);
    else void runBulkArchive(pending.rows, pending.restoring);
  }, [pendingArchive, runBulkArchive, runToggleArchive]);

  const clearFilters = () => {
    setSearch('');
    setStatus('all');
    setPage(1);
    void fetchData('', 1, 'all', limit);
  };

  const selectRow = (row: DataRow) => {
    const label = rowLabel(row);
    return (
      <EntityIdentity name={label} secondary={row.empresa && row.nome && row.empresa !== row.nome ? row.nome : undefined} primary={
        <a
          href={`#/leads/cliente/${encodeURIComponent(row.id)}`}
          onClick={(event) => {
            if (!navigate) return;
            event.preventDefault();
            navigateToDetail(row.id);
          }}
          title={label}
          className="block max-w-[240px] break-words font-medium text-fg underline-offset-4 hover:underline"
        >
          {label}
        </a>
      } />
    );
  };

  return (
    <ListPageLayout
        header={
  <PageHeader
          title="Clientes"
          actions={
            <>
              <ExportCsvButton resource="clients" filters={{ search, status }}>
                Exportar CSV
              </ExportCsvButton>
              <Button onClick={() => navigate?.('/leads/new')}>
                <UserPlus />
                Novo cliente
              </Button>
            </>
          }
        />
        }
      >

      <ListSection
        label="Lista de clientes"
        pagination={!loading && !error && data.length > 0 && (
          <ListPagination label="Paginação de clientes" page={page} limit={limit} pageSizes={PAGE_SIZES} hasNext={page < totalPages} onPageChange={(nextPage) => { setPage(nextPage); void fetchData(search, nextPage, status, limit); }} onLimitChange={(value) => { setLimit(value); setPage(1); void fetchData(search, 1, status, value); }} />
        )}
        toolbar={<>
        <SearchField
          placeholder="Buscar nome, empresa ou e-mail"
          value={search}
          onChange={onSearchChange}
          aria-label="Buscar clientes"
        />
        <Select value={status} onChange={(event) => { const value = event.target.value as 'active' | 'archived' | 'all'; setStatus(value); setPage(1); void fetchData(search, 1, value, limit); }} aria-label="Filtrar clientes por status">
          <option value="all">Todos os status</option><option value="active">Ativos</option><option value="archived">Arquivados</option>
        </Select>
        <Button type="button" variant="ghost" className="ml-auto" onClick={() => { setSelectionMode((current) => !current); setSelectedIds([]); }} aria-pressed={selectionMode}>{selectionMode ? 'Cancelar seleção' : 'Selecionar'}</Button>
        {selectionMode && data.length > 0 && (
          <label className="flex min-h-9 items-center gap-2 text-sm text-fg md:hidden">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(event) => toggleAll(event.target.checked)}
              aria-label="Selecionar todos os clientes no celular"
            />
            Selecionar todos
          </label>
        )}
      </>}
      >

      {loading && <SkeletonTable cols={6} rows={8} />}
      {!loading && error && (
        <ErrorState title="Não foi possível carregar os clientes" onRetry={() => void fetchData()} />
      )}
      {!loading && !error && data.length === 0 && (
        <EmptyState
          icon={Users}
          title={
            search || status !== 'all'
              ? 'Nenhum cliente corresponde aos filtros'
              : 'Nenhum cliente encontrado'
          }
          description={
            search || status !== 'all'
              ? 'Tente ajustar a busca ou o filtro de status.'
              : 'Cadastre um cliente para começar.'
          }
          actions={
            search || status !== 'all' ? (
              <Button variant="outline" onClick={clearFilters}>
                Limpar filtros
              </Button>
            ) : (
              <Button onClick={() => navigate?.('/leads/new')}>
                <UserPlus /> Novo cliente
              </Button>
            )
          }
        />
      )}
      {!loading && !error && data.length > 0 && (
        <>
          <div className="hidden md:block">
            <Table className="min-w-[760px] [&_th]:h-12">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">
                    <div className="flex items-center gap-3">
                      {selectionMode && <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allSelected}
                        onChange={(event) => toggleAll(event.target.checked)}
                        aria-label="Selecionar todos os clientes"
                      />}
                      <span>Cliente</span>
                    </div>
                  </TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead>Orçamentos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-48" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => {
                  const label = rowLabel(row);
                  const phone = fmtPhone(row.telefone);
                  return (
                    <TableRow
                      key={row.id}
                      interactive
                      data-state={selectedIds.includes(row.id) ? 'selected' : undefined}
                      className="group cursor-pointer"
                      onClick={(event) => {
                        const target = event.target as HTMLElement;
                        if (target.closest('a,button,input,select,textarea,summary,details'))
                          return;
                        navigateToDetail(row.id);
                      }}
                    >
                      <TableCell className="min-w-[220px]">
                        <div className="flex items-start gap-3">
                          {selectionMode && <input
                            className="mt-1 shrink-0"
                            type="checkbox"
                            checked={selectedIds.includes(row.id)}
                            onChange={() => toggleSelected(row.id)}
                            aria-label={`Selecionar ${label}`}
                          />}
                          <div className="min-w-0 flex-1">{selectRow(row)}</div>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        <div className="space-y-0.5 text-sm">
                          {row.email ? (
                            <a
                              href={`mailto:${row.email}`}
                              title={row.email}
                              className="block max-w-[260px] truncate text-fg hover:text-primary"
                            >
                              {row.email}
                            </a>
                          ) : (
                            <span className="text-fg-muted">E-mail não informado</span>
                          )}
                          {phone ? (
                            <a
                              href={whatsappContactUrl(row.telefone)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Abrir conversa no WhatsApp"
                              className="block text-xs text-fg-muted hover:text-primary"
                            >
                              {phone}
                            </a>
                          ) : (
                            <span className="block text-xs text-fg-muted">
                              Telefone não informado
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {[row.municipio, row.uf].filter(Boolean).join(', ') || '—'}
                      </TableCell>
                      <TableCell>
                        <Button type="button" variant="link" size="inline" onClick={() => navigate?.(`/quotations?search=${encodeURIComponent(row.empresa || row.nome || '')}`)} aria-label={`Ver orçamentos de ${row.empresa || row.nome}`}>Ver</Button>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={statusKey(row)} label={statusLabel(row)} />
                      </TableCell>
                      <TableCell className="w-48 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="pointer-events-none inline-flex shrink-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"><Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Abrir cliente ${label}`}
                            onClick={() => navigateToDetail(row.id)}
                          >
                            <ChevronRight />
                          </Button></span>
                          <span className="pointer-events-none inline-flex shrink-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"><Button
                            variant="soft"
                            size="icon"
                            title={`Novo orçamento para ${label}`}
                            aria-label={`Novo orçamento para ${label}`}
                            onClick={() => createQuoteForClient(row, navigate)}
                          >
                            <ReceiptText />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void openDrawer(row)}
                            aria-label={`Visualização rápida ${label}`}
                          >
                            <Eye />
                          </Button></span>
                          <span className="pointer-events-none inline-flex shrink-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"><CustomerActionMenu
                            archived={isArchivedRow(row)}
                            customerName={label}
                            onArchiveToggle={() => toggleArchive(row)}
                          /></span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden">
            {data.map((row) => {
              const label = rowLabel(row);
              const phone = fmtPhone(row.telefone);
              return (
                <article key={row.id} className="rounded-card border border-line bg-surface p-5">
                  <div className="flex items-start gap-3">
                    {selectionMode && <input
                      className="mt-1 shrink-0"
                      type="checkbox"
                      checked={selectedIds.includes(row.id)}
                      onChange={() => toggleSelected(row.id)}
                      aria-label={`Marcar cartão mobile de ${label}`}
                    />}
                    <div className="min-w-0 flex-1">
                      {selectRow(row)}
                      <StatusBadge
                        status={statusKey(row)}
                        label={statusLabel(row)}
                        className="mt-2"
                      />
                    </div>
                    <CustomerActionMenu
                      archived={isArchivedRow(row)}
                      customerName={label}
                      onArchiveToggle={() => toggleArchive(row)}
                    />
                  </div>
                  <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                    {row.email ? (
                      <a
                        href={`mailto:${row.email}`}
                        className="block break-words text-fg hover:text-primary"
                      >
                        {row.email}
                      </a>
                    ) : (
                      <p className="text-fg-muted">E-mail não informado</p>
                    )}
                    {phone ? (
                      <a
                        href={whatsappContactUrl(row.telefone)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-fg-muted hover:text-primary"
                      >
                        {phone}
                      </a>
                    ) : (
                      <p className="text-xs text-fg-muted">Telefone não informado</p>
                    )}
                    <p className="break-words text-xs text-fg-muted">
                      {row.documento
                        ? `Documento: ${formatDocument(row.documento)}`
                        : 'Documento não informado'}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1 border-t border-line pt-3">
                    <Button
                      variant="soft"
                      size="icon"
                      aria-label={`Novo orçamento para ${label}`}
                      title="Novo orçamento"
                      onClick={() => createQuoteForClient(row, navigate)}
                    >
                      <ReceiptText />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void openDrawer(row)}
                      aria-label={`Visualização rápida ${label}`}
                    >
                      <Eye />
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
      </ListSection>

      {selectedIds.length > 0 && (
        <BulkActionBar visible>
          <span>
            {selectedIds.length} cliente{selectedIds.length === 1 ? '' : 's'} selecionado
            {selectedIds.length === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSelectedIds([])}>
              Limpar seleção
            </Button>
            <Button onClick={requestBulkArchive}>
              {status === 'archived' ? <ArchiveRestore /> : <Archive />}{' '}
              {status === 'archived' ? 'Restaurar clientes' : 'Arquivar clientes'}
            </Button>
          </div>
        </BulkActionBar>
      )}

      <DetailDrawer
        open={drawerOpen}
        onClose={() => requestDrawerClose()}
        title={detail?.display_name || detail?.nome || 'Carregando…'}
        description={detail ? 'Cliente' : undefined}
        className="lg:max-w-[420px]"
        actions={
          detail && (
            <div className="space-y-3">
              {qualityBadges(detail).length > 0 && <QualityBadges badges={qualityBadges(detail)} />}
              <ContextActions actions={contextActions()} />
              <div className="flex flex-wrap items-center gap-2">
                {!editMode ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditFields(fieldsFromDetail(detail));
                      setEditMode(true);
                    }}
                  >
                    Editar
                  </Button>
                ) : (
                  <>
                    <Button size="sm" onClick={() => void updateDetail()} disabled={detailSaving}>
                      <Check size={14} /> Salvar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditFields(fieldsFromDetail(detail));
                        setEditMode(false);
                      }}
                      disabled={detailSaving}
                    >
                      <X size={14} /> Cancelar
                    </Button>
                  </>
                )}
                <CustomerActionMenu
                  archived={isArchivedRow(detail)}
                  customerName={rowLabel(detail)}
                  onArchiveToggle={() => toggleArchive(detail)}
                />
              </div>
            </div>
          )
        }
      >
        {detailLoading && (
          <div className="space-y-4" role="status" aria-busy="true" aria-label="Carregando detalhes">
            <Skeleton className="h-24 rounded-card" />
            <Skeleton className="h-48 rounded-card" />
            <Skeleton className="h-32 rounded-card" />
          </div>
        )}
        {detailError && !detailLoading && (
          <InlineAlert
            action={
              <Button variant="outline" size="sm" onClick={() => selectedId && void loadDrawerDetail(selectedId)}>
                Tentar novamente
              </Button>
            }
          >
            {detailError}
          </InlineAlert>
        )}
        {detail && !detailLoading && !editMode && (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-fg-muted">Empresa</p>
              <p className="break-words">{detail.empresa || 'Empresa não informada'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-fg-muted">E-mail</p>
              <p className="break-words">{detail.email || 'E-mail não informado'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-fg-muted">Telefone</p>
              <p>{fmtPhone(detail.telefone) || 'Telefone não informado'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-fg-muted">Documento</p>
              <p>{formatDocument(detail.tax_id || detail.documento)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-fg-muted">Endereço</p>
              <p className="break-words">{addressText(detail.address)}</p>
            </div>
            {(detail.notes || detail.observacoes) && (
              <div>
                <p className="text-xs uppercase tracking-wide text-fg-muted">Observações</p>
                <p className="whitespace-pre-wrap break-words">
                  {detail.notes || detail.observacoes}
                </p>
              </div>
            )}
            {detail.latest_quotation && (
              <div className="rounded-control border border-line p-3">
                <p className="text-xs uppercase tracking-wide text-fg-muted">Orçamento recente</p>
                <p className="mt-1 break-words font-medium">{detail.latest_quotation.name}</p>
                <p className="text-xs text-fg-muted">
                  {detail.latest_quotation.status || '—'}
                  {detail.latest_quotation.date
                    ? ` · ${formatDate(detail.latest_quotation.date)}`
                    : ''}
                </p>
                {detail.latest_quotation.grand_total != null && (
                  <p className="mt-1 text-sm">{formatBRL(detail.latest_quotation.grand_total)}</p>
                )}
              </div>
            )}
            {detail.latest_quotation && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  requestDrawerClose(() =>
                    navigate?.(`/quotations/${encodeURIComponent(detail.latest_quotation!.name)}`)
                  )
                }
              >
                Abrir orçamento recente
              </Button>
            )}
          </div>
        )}
        {detail && !detailLoading && editMode && (
          <div className="space-y-3">
            <label className="block text-xs text-fg-muted">
              Nome
              <Input
                value={editFields.nome}
                onChange={(event) =>
                  setEditFields((current) => ({ ...current, nome: event.target.value }))
                }
              />
            </label>
            <label className="block text-xs text-fg-muted">
              Empresa
              <Input
                value={editFields.empresa}
                onChange={(event) =>
                  setEditFields((current) => ({ ...current, empresa: event.target.value }))
                }
              />
            </label>
            <label className="block text-xs text-fg-muted">
              E-mail
              <Input
                type="email"
                value={editFields.email}
                onChange={(event) =>
                  setEditFields((current) => ({ ...current, email: event.target.value }))
                }
              />
            </label>
            <label className="block text-xs text-fg-muted">
              Telefone
              <Input
                value={editFields.telefone}
                onChange={(event) =>
                  setEditFields((current) => ({ ...current, telefone: event.target.value }))
                }
              />
            </label>
            <label className="block text-xs text-fg-muted">
              Documento
              <Input
                value={editFields.documento}
                onChange={(event) =>
                  setEditFields((current) => ({ ...current, documento: event.target.value }))
                }
              />
            </label>
            <label className="block text-xs text-fg-muted">
              Observações
              <Textarea
                aria-label="Observações"
                value={editFields.observacoes}
                onChange={(event) =>
                  setEditFields((current) => ({ ...current, observacoes: event.target.value }))
                }
              />
            </label>
            <p className="break-words text-xs text-fg-muted">
              Endereço: {addressText(editFields.endereco)}
            </p>
          </div>
        )}
      </DetailDrawer>

      <ConfirmDialog
        open={archiveDialog !== null}
        title={archiveDialog?.title}
        message={archiveDialog?.message}
        confirmLabel={archiveDialog?.confirmLabel}
        cancelLabel="Cancelar"
        variant={archiveDialog?.variant}
        onConfirm={confirmPendingArchive}
        onCancel={() => setPendingArchive(null)}
      />
      <ConfirmDialog
        open={confirmDrawerDiscard}
        title="Descartar alterações?"
        message="As alterações do cadastro que ainda não foram salvas serão perdidas."
        confirmLabel="Descartar"
        cancelLabel="Continuar editando"
        variant="destructive"
        onConfirm={() => {
          const afterClose = drawerDiscardAction;
          setConfirmDrawerDiscard(false);
          setDrawerDiscardAction(null);
          closeDrawer();
          afterClose?.();
        }}
        onCancel={() => {
          setConfirmDrawerDiscard(false);
          setDrawerDiscardAction(null);
        }}
      />
    </ListPageLayout>
  );
}
