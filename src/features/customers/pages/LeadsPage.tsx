import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  Eye,
  Mail,
  Phone,
  ReceiptText,
  Search,
  Sparkles,
  Users,
  UserPlus,
  X,
} from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPut } from '@/lib/api/api';
import { fmtPhone, formatBRL, formatDate, whatsappContactUrl } from '@/lib/formatting/formatters';
import { createQuoteForClient } from '@/features/customers/quote-prefill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import PageToolbar from '@/components/shared/PageToolbar';
import Pagination from '@/components/shared/Pagination';
import { Field } from '@/components/ui/field';
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
import { DetailDrawer } from '@/features/customers/components/DetailDrawer';
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
    'active',
    parseLeadStatus
  );
  const [page, setPage] = useHashQueryState('page', 1, parseHashPositiveInteger);
  const [limit, setLimit] = useHashQueryState('limit', 10, parseLeadLimit);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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
  const [editSubmitted, setEditSubmitted] = useState(false);
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
        setTotalRecords(projected.pagination.total);
      } catch {
        if (requestGeneration !== listRequestGenerationRef.current) return;
        setData([]);
        setTotalPages(0);
        setTotalRecords(0);
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

  // Validação inline: campos só mostram erro depois da primeira tentativa de salvar.
  const editFieldErrors = useMemo(() => {
    if (!editMode || !editSubmitted) return {} as Partial<Record<'nome' | 'email' | 'telefone', string>>;
    const errors: Partial<Record<'nome' | 'email' | 'telefone', string>> = {};
    if (!editFields.nome.trim()) errors.nome = 'Informe o nome.';
    if (!isValidEmail(editFields.email)) errors.email = 'E-mail inválido.';
    if (!isValidPhone(editFields.telefone)) errors.telefone = 'Telefone inválido.';
    return errors;
  }, [editFields, editMode, editSubmitted]);

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
    if (
      !fields.nome.trim() ||
      !isValidEmail(fields.email) ||
      !isValidPhone(fields.telefone)
    ) {
      // Erros de validação aparecem inline nos campos (editFieldErrors).
      setEditSubmitted(true);
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
    setStatus('active');
    setPage(1);
    void fetchData('', 1, 'active', limit);
  };

  const selectRow = (row: DataRow) => {
    const label = rowLabel(row);
    return (
      <div>
        <a
          href={`#/leads/cliente/${encodeURIComponent(row.id)}`}
          onClick={(event) => {
            if (!navigate) return;
            event.preventDefault();
            navigateToDetail(row.id);
          }}
          title={label}
          className="block max-w-[240px] break-words font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
        >
          {label}
        </a>
        {row.empresa && <p className="mt-0.5 text-xs text-fg-muted">{row.empresa}</p>}
      </div>
    );
  };

  return (
    <PageShell className="pb-28">
      <PageHeader
        title="Clientes"
        description={
          !loading && !error ? `${totalRecords} cliente${totalRecords === 1 ? '' : 's'}` : undefined
        }
        actions={
          <>
            <ExportCsvButton resource="clients" filters={{ search, status }}>
              Exportar CSV
            </ExportCsvButton>
            <Button onClick={() => navigate?.('/leads/cliente/new')}>
              <UserPlus />
              Novo contato
            </Button>
          </>
        }
      />

      <PageToolbar className="items-end">
        <div className="relative w-full max-w-[286px] flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
            aria-hidden="true"
          />
          <Input
            placeholder="Buscar clientes"
            value={search}
            onChange={onSearchChange}
            className="pl-9"
            aria-label="Buscar clientes"
          />
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-fg-muted">
          Itens por página
          <Select
            value={limit}
            onChange={(event) => {
              const value = Number(event.target.value);
              setLimit(value);
              setPage(1);
              void fetchData(search, 1, status, value);
            }}
            aria-label="Itens por página"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </label>
        <div
          className="flex items-center gap-1 rounded-full border border-line bg-surface p-1"
          role="group"
          aria-label="Filtrar clientes por status"
        >
          {(['active', 'archived', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() => {
                setStatus(value);
                setPage(1);
                void fetchData(search, 1, value, limit);
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page ${status === value ? 'bg-primary text-on-solid' : 'text-fg-muted hover:text-fg'}`}
            >
              {value === 'active' ? 'Ativos' : value === 'archived' ? 'Arquivados' : 'Todos'}
            </button>
          ))}
        </div>
        {data.length > 0 && (
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
      </PageToolbar>

      {loading && <SkeletonTable cols={6} rows={8} />}
      {!loading && error && (
        <div className="flex flex-col items-center gap-3 py-16 text-fg-muted" role="alert">
          <AlertTriangle size={32} className="text-destructive/60" aria-hidden="true" />
          <p>Erro ao carregar clientes</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => void fetchData()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {!loading && !error && data.length === 0 && (
        <EmptyState
          icon={Users}
          title={
            search || status !== 'active'
              ? 'Nenhum cliente corresponde aos filtros'
              : 'Nenhum cliente encontrado'
          }
          description={
            search || status !== 'active'
              ? 'Tente ajustar a busca ou o filtro de status.'
              : 'Cadastre um cliente para começar.'
          }
          actions={
            search || status !== 'active' ? (
              <Button variant="outline" onClick={clearFilters}>
                Limpar filtros
              </Button>
            ) : (
              <Button onClick={() => navigate?.('/leads/cliente/new')}>
                <UserPlus /> Novo contato
              </Button>
            )
          }
        />
      )}
      {!loading && !error && data.length > 0 && (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) => toggleAll(event.target.checked)}
                      aria-label="Selecionar todos os clientes"
                    />
                  </TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead className="hidden xl:table-cell">Documento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
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
                      className="cursor-pointer"
                      onClick={(event) => {
                        const target = event.target as HTMLElement;
                        if (target.closest('a,button,input,select,textarea,summary,details'))
                          return;
                        navigateToDetail(row.id);
                      }}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(row.id)}
                          onChange={() => toggleSelected(row.id)}
                          aria-label={`Selecionar ${label}`}
                        />
                      </TableCell>
                      <TableCell>{selectRow(row)}</TableCell>
                      <TableCell className="max-w-[280px]">
                        <div className="space-y-0.5 text-sm">
                          {row.email ? (
                            <a
                              href={`mailto:${row.email}`}
                              title={row.email}
                              className="block max-w-[260px] truncate text-fg hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                              className="block text-xs text-fg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                      <TableCell className="hidden max-w-[180px] xl:table-cell text-xs text-fg-muted">
                        <span title={row.documento || undefined}>
                          {row.documento
                            ? formatDocument(row.documento)
                            : 'Documento não informado'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={statusKey(row)} label={statusLabel(row)} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={`Novo orçamento para ${label}`}
                            aria-label={`Novo orçamento para ${label}`}
                            className="bg-primary/10 text-primary hover:bg-primary/20"
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
                          <CustomerActionMenu
                            archived={isArchivedRow(row)}
                            customerName={label}
                            onArchiveToggle={() => toggleArchive(row)}
                          />
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
                <article key={row.id} className="rounded-md border border-line bg-surface p-4">
                  <div className="flex items-start gap-3">
                    <input
                      className="mt-1 shrink-0"
                      type="checkbox"
                      checked={selectedIds.includes(row.id)}
                      onChange={() => toggleSelected(row.id)}
                      aria-label={`Marcar cartão mobile de ${label}`}
                    />
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
                        className="block break-words text-fg hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                        className="block text-xs text-fg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                      variant="ghost"
                      size="icon"
                      aria-label={`Novo orçamento para ${label}`}
                      title="Novo orçamento"
                      className="text-primary"
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

      <Pagination
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecords}
        label="Paginação de clientes"
        onPageChange={(nextPage) => {
          setPage(nextPage);
          void fetchData(search, nextPage, status, limit);
        }}
      />

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
                      setEditSubmitted(false);
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
          <div className="py-12 text-center text-sm text-fg-muted" role="status">
            Carregando detalhes…
          </div>
        )}
        {detailError && !detailLoading && (
          <div
            className="flex flex-col items-center gap-3 py-12 text-sm text-fg-muted"
            role="alert"
          >
            <AlertTriangle size={24} className="text-destructive/60" aria-hidden="true" />
            <p>{detailError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => selectedId && void loadDrawerDetail(selectedId)}
            >
              Tentar novamente
            </Button>
          </div>
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
              <div className="rounded-sm border border-line p-3">
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
            <Field label="Nome" required error={editFieldErrors.nome}>
              <Input
                value={editFields.nome}
                onChange={(event) =>
                  setEditFields((current) => ({ ...current, nome: event.target.value }))
                }
              />
            </Field>
            <Field label="Empresa">
              <Input
                value={editFields.empresa}
                onChange={(event) =>
                  setEditFields((current) => ({ ...current, empresa: event.target.value }))
                }
              />
            </Field>
            <Field label="E-mail" error={editFieldErrors.email}>
              <Input
                type="email"
                value={editFields.email}
                onChange={(event) =>
                  setEditFields((current) => ({ ...current, email: event.target.value }))
                }
              />
            </Field>
            <Field label="Telefone" error={editFieldErrors.telefone}>
              <Input
                value={editFields.telefone}
                onChange={(event) =>
                  setEditFields((current) => ({ ...current, telefone: event.target.value }))
                }
              />
            </Field>
            <Field label="Documento">
              <Input
                value={editFields.documento}
                onChange={(event) =>
                  setEditFields((current) => ({ ...current, documento: event.target.value }))
                }
              />
            </Field>
            <Field label="Observações">
              <Textarea
                value={editFields.observacoes}
                onChange={(event) =>
                  setEditFields((current) => ({ ...current, observacoes: event.target.value }))
                }
              />
            </Field>
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
    </PageShell>
  );
}
