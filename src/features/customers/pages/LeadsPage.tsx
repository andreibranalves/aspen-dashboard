import { useState, useEffect, useCallback, useRef, useMemo, type ChangeEvent } from 'react';
import { Search, Phone, Mail, AlertTriangle, Users, Eye, ChevronRight, Archive, ArchiveRestore, UserPlus, Check, X, Sparkles } from 'lucide-react';
import { apiGet, apiPut, apiPatch, apiDelete } from '@/lib/api/api';
import { fmtPhone } from '@/lib/formatting/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/shared/PageHeader';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { useToast } from '@/components/shared/toast';
import { useSetTopBarActions } from '@/components/layout/Layout';
import {
  parseHashAllowedInteger,
  parseHashOption,
  parseHashPositiveInteger,
  parseHashString,
  useHashQueryState,
} from '@/hooks/useHashQueryState';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { DetailDrawer } from '@/features/customers/components/DetailDrawer';
import { QualityBadges, type QualityBadge } from '@/features/customers/components/QualityBadges';
import { ContextActions, type ContextAction } from '@/features/customers/components/ContextActions';
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
const parseLeadStatus = parseHashOption<'active' | 'archived' | 'all'>(['active', 'archived', 'all']);
const parseLeadLimit = parseHashAllowedInteger(PAGE_SIZES);
const EMPTY_FIELDS: EditFields = { nome: '', email: '', telefone: '', documento: '', observacoes: '', endereco: {} };

type PendingLeadArchive =
  | { kind: 'row'; row: DataRow }
  | { kind: 'bulk'; rows: DataRow[]; restoring: boolean };

// Contexto para pré-preencher um orçamento no painel Auto (#/auto).
const QUOTE_PREFILL_KEY = 'aspen_quote_prefill';

function createQuoteForClient(
  client: { display_name?: string | null; nome?: string | null; email?: string | null; telefone?: string | null },
  navigate?: (path: string) => void,
): void {
  const prefill: Record<string, string> = {};
  const nome = client.display_name || client.nome;
  if (nome) prefill.nome = nome;
  if (client.email) prefill.email = client.email;
  if (client.telefone) prefill.telefone = client.telefone;
  try {
    window.sessionStorage.setItem(QUOTE_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    /* sessionStorage indisponível */
  }
  navigate?.('/auto');
}

function isArchivedRow(row: DataRow): boolean {
  return row.status === 'archived' || row.arquivado === true;
}

function archiveDialogText(pending: PendingLeadArchive): { title: string; message: string; confirmLabel: string } {
  if (pending.kind === 'bulk') {
    const action = pending.restoring ? 'Restaurar' : 'Arquivar';
    const count = pending.rows.length;
    return {
      title: `${action} clientes`,
      message: `${action} ${count} cliente${count === 1 ? '' : 's'}?`,
      confirmLabel: action,
    };
  }
  const action = isArchivedRow(pending.row) ? 'Restaurar' : 'Arquivar';
  return {
    title: `${action} cliente`,
    message: `${action} o cliente ${pending.row.nome || pending.row.id}?`,
    confirmLabel: action,
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
  return [first, second, city, address.cep].filter(Boolean).join(' · ') || 'Endereço não cadastrado';
}

function formatDocument(value?: string | null): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return value || '—';
}

function qualityBadges(detail: ClientDetail): QualityBadge[] {
  const labels: Record<string, QualityBadge> = {
    sem_telefone: { label: 'Sem telefone', type: 'warning' },
    sem_email: { label: 'Sem email', type: 'warning' },
    sem_cnpj: { label: 'Sem documento', type: 'info' },
    endereco_incompleto: { label: 'Endereço incompleto', type: 'warning' },
  };
  return detail.quality_flags?.length
    ? detail.quality_flags.map((flag) => labels[flag] || { label: flag, type: 'warning' })
    : [{ label: 'Cadastro completo', type: 'success' }];
}

function fieldsFromDetail(detail: ClientDetail): EditFields {
  return {
    nome: detail.display_name || detail.nome || '',
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

export default function LeadsPage({ navigate }: LeadsPageProps) {
  const [data, setData] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useHashQueryState('search', '', parseHashString);
  const [status, setStatus] = useHashQueryState<'active' | 'archived' | 'all'>('status', 'active', parseLeadStatus);
  const [page, setPage] = useHashQueryState('page', 1, parseHashPositiveInteger);
  const [limit, setLimit] = useHashQueryState('limit', 10, parseLeadLimit);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const setTopBarActions = useSetTopBarActions();
  const { toast } = useToast();
  const [pendingArchive, setPendingArchive] = useState<PendingLeadArchive | null>(null);
  const archiveDialog = useMemo(
    () => (pendingArchive ? archiveDialogText(pendingArchive) : null),
    [pendingArchive],
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editFields, setEditFields] = useState<EditFields>(EMPTY_FIELDS);

  const fetchData = useCallback(async (searchValue = search, pageValue = page, statusValue = status, limitValue = limit) => {
    setLoading(true);
    setError(null);
    setSelectedIds([]);
    try {
      const params = new URLSearchParams({ page: String(pageValue), limit: String(limitValue), status: statusValue });
      if (searchValue) params.set('search', searchValue);
      const result = await apiGet<LeadsResponse>(`/leads-clients?${params.toString()}`);
      const projected = projectClientListResponse(result);
      if (!projected) throw new Error('Resposta inválida ao carregar clientes.');
      setData(projected.data);
      setTotalPages(projected.pagination.total_pages);
      setTotalRecords(projected.pagination.total);
    } catch (err) {
      setData([]);
      setTotalPages(0);
      setTotalRecords(0);
      setError((err as Error).message || 'Erro ao carregar clientes.');
    } finally {
      setLoading(false);
    }
  }, [limit, page, search, status]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    setTopBarActions?.(
      <Button size="sm" onClick={() => navigate?.('/leads/cliente/new')}>
        <UserPlus size={16} /> Criar cliente
      </Button>,
    );
    return () => setTopBarActions?.(null);
  }, [navigate, setTopBarActions]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedIds.length > 0 && selectedIds.length < data.length;
  }, [data.length, selectedIds.length]);

  const onSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      void fetchData(value, 1, status, limit);
    }, 300);
  }, [fetchData, limit, status]);

  const openDrawer = useCallback(async (row: DataRow) => {
    setSelectedId(row.id);
    setDrawerOpen(true);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setEditMode(false);
    try {
      const result = await apiGet<unknown>(`/client-detail?name=${encodeURIComponent(row.id)}`);
      const projected = projectClientDetail(result);
      if (!projected) throw new Error('Resposta inválida ao carregar cliente.');
      setDetail(projected);
    } catch (err) {
      setDetailError((err as Error).message || 'Erro ao carregar detalhes.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedId(null);
    setDetail(null);
    setEditMode(false);
  }, []);

  const updateDetail = useCallback(async () => {
    if (!selectedId || !detail) return;
    const fields = editFields;
    if (!fields.nome.trim()) { setDetailError('Nome é obrigatório.'); return; }
    if (!isValidEmail(fields.email)) { setDetailError('E-mail inválido.'); return; }
    if (!isValidPhone(fields.telefone)) { setDetailError('Telefone inválido.'); return; }
    setDetailSaving(true);
    setDetailError(null);
    try {
      const result = await apiPut<unknown>(`/client-detail?name=${encodeURIComponent(selectedId)}`, {
        nome: fields.nome.trim(),
        email: fields.email.trim() || null,
        telefone: fields.telefone.trim() || null,
        documento: fields.documento.replace(/\D/g, '') || null,
        notes: fields.observacoes.trim() || null,
        endereco: addressPayload(fields.endereco),
      });
      const projected = projectClientDetail(result);
      if (!projected) throw new Error('Resposta inválida ao salvar cliente.');
      setDetail(projected);
      setEditMode(false);
      setData((rows) => rows.map((row) => row.id === selectedId ? {
        ...row,
        nome: projected.display_name || projected.nome,
        email: projected.email,
        telefone: projected.telefone,
      } : row));
    } catch (err) {
      setDetailError((err as Error).message || 'Erro ao salvar cliente.');
    } finally {
      setDetailSaving(false);
    }
  }, [detail, editFields, selectedId]);

  const toggleArchive = useCallback((row: DataRow) => {
    setPendingArchive({ kind: 'row', row });
  }, []);

  const runToggleArchive = useCallback(async (row: DataRow) => {
    const archived = isArchivedRow(row);
    const label = row.nome || row.id;
    try {
      if (archived) await apiPatch(`/client-detail?name=${encodeURIComponent(row.id)}`, { arquivado: false });
      else await apiDelete(`/leads-clients?id=${encodeURIComponent(row.id)}`);
      toast(archived ? `Cliente ${label} restaurado.` : `Cliente ${label} arquivado.`, 'success');
      await fetchData();
    } catch (err) {
      toast((err as Error).message || 'Não foi possível alterar o status do cliente.', 'error');
    }
  }, [fetchData, toast]);

  const navigateToDetail = useCallback((id: string) => {
    navigate?.(`/leads/cliente/${encodeURIComponent(id)}`);
  }, [navigate]);

  const contextActions = useCallback((): ContextAction[] => {
    if (!detail) return [];
    const actions: ContextAction[] = [{ label: 'Página completa', icon: ChevronRight, onClick: () => { closeDrawer(); navigateToDetail(detail.id); }, title: 'Abrir página completa do cadastro' }];
    if (detail.telefone) actions.push({ label: 'WhatsApp', icon: Phone, href: `https://wa.me/${detail.telefone.replace(/\D/g, '')}`, title: 'Abrir WhatsApp' });
    if (detail.email) actions.push({ label: 'E-mail', icon: Mail, href: `mailto:${detail.email}`, title: 'Enviar e-mail' });
    actions.push({ label: 'Criar orçamento', icon: Sparkles, onClick: () => { closeDrawer(); createQuoteForClient(detail, navigate); }, title: 'Criar orçamento com os dados deste cliente' });
    if (detail.latest_quotation) actions.push({ label: 'Orçamento recente', icon: ChevronRight, onClick: () => navigate?.(`/quotations/${encodeURIComponent(detail.latest_quotation!.name)}`), title: `Abrir ${detail.latest_quotation.name}` });
    return actions;
  }, [closeDrawer, detail, navigate, navigateToDetail]);

  const allSelected = data.length > 0 && selectedIds.length === data.length;
  const toggleAll = (checked: boolean) => setSelectedIds(checked ? data.map((row) => row.id) : []);
  const toggleSelected = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const requestBulkArchive = () => {
    if (!selectedIds.length) return;
    const selected = data.filter((row) => selectedIds.includes(row.id));
    const restoring = status === 'archived';
    const actionable = selected.filter((row) => (restoring ? isArchivedRow(row) : !isArchivedRow(row)));
    if (!actionable.length) {
      toast(restoring ? 'Selecione clientes arquivados para restaurar.' : 'Selecione clientes ativos para arquivar.', 'info');
      return;
    }
    setPendingArchive({ kind: 'bulk', rows: actionable, restoring });
  };

  const runBulkArchive = useCallback(async (rows: DataRow[], restoring: boolean) => {
    try {
      await Promise.all(rows.map((row) => restoring
        ? apiPatch(`/client-detail?name=${encodeURIComponent(row.id)}`, { arquivado: false })
        : apiDelete(`/leads-clients?id=${encodeURIComponent(row.id)}`)));
      const count = rows.length;
      toast(`${count} cliente${count === 1 ? '' : 's'} ${restoring ? 'restaurado' : 'arquivado'}${count === 1 ? '' : 's'}.`, 'success');
      await fetchData();
    } catch (err) {
      toast((err as Error).message || `Não foi possível ${restoring ? 'restaurar' : 'arquivar'} os clientes selecionados.`, 'error');
    }
  }, [fetchData, toast]);

  const confirmPendingArchive = useCallback(() => {
    const pending = pendingArchive;
    setPendingArchive(null);
    if (!pending) return;
    if (pending.kind === 'row') void runToggleArchive(pending.row);
    else void runBulkArchive(pending.rows, pending.restoring);
  }, [pendingArchive, runBulkArchive, runToggleArchive]);

  const pageNumbers = Array.from({ length: Math.max(0, totalPages) }, (_, index) => index + 1).slice(Math.max(0, page - 3), page + 4);

  // Sob a aba 'Ativos' todas as linhas exibem 'Ativo' — a coluna STATUS é redundante.
  const showStatusColumn = status !== 'active';

  return (
    <div className="space-y-4 pb-28 animate-fade-in max-w-[1060px] mx-auto">
      <PageHeader title="Clientes" />
      <div className="flex flex-wrap gap-2">
        {(['active', 'archived', 'all'] as const).map((value) => (
          <button key={value} type="button" onClick={() => { setStatus(value); setPage(1); void fetchData(search, 1, value, limit); }} className={`rounded-full px-3 py-1 text-xs font-medium ${status === value ? 'bg-primary text-primary-foreground' : 'bg-page text-fg-muted hover:text-fg'}`}>
            {value === 'active' ? 'Ativos' : value === 'archived' ? 'Arquivados' : 'Todos'}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <Input placeholder="Buscar por nome, documento, e-mail ou telefone…" value={search} onChange={onSearchChange} className="pl-9" aria-label="Buscar clientes" />
        </div>
        <select value={limit} onChange={(event) => { const value = Number(event.target.value); setLimit(value); setPage(1); void fetchData(search, 1, status, value); }} className="border border-line rounded-[10px] px-3 py-2 text-sm bg-surface text-fg" aria-label="Itens por página">
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </div>

      {loading && <SkeletonTable cols={showStatusColumn ? 6 : 5} rows={8} />}
      {!loading && error && (
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <AlertTriangle size={32} className="text-destructive/60" />
          <p>Erro ao carregar clientes</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => void fetchData()}>Tentar novamente</Button>
        </div>
      )}
      {!loading && !error && data.length === 0 && (
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <Users size={36} className="text-fg-muted/40" />
          <p>Nenhum cliente encontrado</p>
          {!search && status === 'active' ? (
            <>
              <p className="text-sm">Cadastre um cliente para começar.</p>
              <Button type="button" onClick={() => navigate?.('/leads/cliente/new')}>
                <UserPlus size={16} />
                Criar cliente
              </Button>
            </>
          ) : (
            <p className="text-sm">Tente ajustar a busca ou os filtros.</p>
          )}
        </div>
      )}
      {!loading && !error && data.length > 0 && (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader><TableRow><TableHead className="w-12"><input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} aria-label="Selecionar todos os clientes" /></TableHead><TableHead>Nome</TableHead><TableHead>E-mail</TableHead><TableHead>Telefone</TableHead>{showStatusColumn && <TableHead>Status</TableHead>}<TableHead className="text-center">Ações</TableHead></TableRow></TableHeader>
              <TableBody>{data.map((row) => <TableRow key={row.id} className="cursor-pointer" onClick={() => navigateToDetail(row.id)}><TableCell onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggleSelected(row.id)} aria-label={`Selecionar ${row.nome || row.id}`} /></TableCell><TableCell className="font-medium">{row.nome || '—'}</TableCell><TableCell className="text-fg-muted">{row.email || '—'}</TableCell><TableCell className="text-fg-muted">{fmtPhone(row.telefone)}</TableCell>{showStatusColumn && <TableCell><span className={`rounded-full px-2 py-0.5 text-xs ${row.status === 'archived' ? 'bg-surface-muted text-fg-muted' : 'bg-success/10 text-success'}`}>{row.status === 'archived' ? 'Arquivado' : 'Ativo'}</span></TableCell>}<TableCell onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-center gap-1"><button type="button" onClick={() => void openDrawer(row)} className="min-h-10 min-w-10 rounded hover:bg-primary/10" aria-label={`Visualização rápida ${row.nome || row.id}`}><Eye size={18} /></button>{row.telefone && <a href={`https://wa.me/${row.telefone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="min-h-10 min-w-10 inline-flex items-center justify-center rounded text-success hover:bg-success/10" title="Abrir conversa no WhatsApp" aria-label={`WhatsApp ${row.nome || row.id}`}><Phone size={18} /></a>}{row.email && <a href={`mailto:${row.email}`} className="min-h-10 min-w-10 inline-flex items-center justify-center rounded hover:bg-surface-muted" aria-label={`E-mail ${row.nome || row.id}`}><Mail size={18} /></a>}<span className="ml-1 border-l border-line pl-1 inline-flex items-center"><button type="button" onClick={() => void toggleArchive(row)} className="min-h-10 min-w-10 inline-flex items-center justify-center rounded text-destructive/60 hover:bg-destructive/10 hover:text-destructive transition-colors" aria-label={`${row.status === 'archived' ? 'Restaurar' : 'Arquivar'} ${row.nome || row.id}`}>{row.status === 'archived' ? <ArchiveRestore size={18} /> : <Archive size={18} />}</button></span></div></TableCell></TableRow>)}</TableBody>
            </Table>
          </div>
          <div className="md:hidden space-y-3">{data.map((row) => <div key={row.id} className="bg-surface rounded-lg border border-line p-4 space-y-2" onClick={() => navigateToDetail(row.id)}><div className="flex items-center justify-between"><span className="font-medium">{row.nome || '—'}</span><span className="text-xs text-fg-muted">{row.status === 'archived' ? 'Arquivado' : 'Ativo'}</span></div><p className="text-xs text-fg-muted">{row.email || '—'}</p><div className="flex gap-1" onClick={(event) => event.stopPropagation()}>{row.telefone && <a href={`https://wa.me/${row.telefone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${row.nome || row.id}`} title="Abrir conversa no WhatsApp" className="min-h-10 min-w-10 inline-flex items-center justify-center text-success"><Phone size={18} /></a>}{row.email && <a href={`mailto:${row.email}`} aria-label={`E-mail ${row.nome || row.id}`} className="min-h-10 min-w-10 inline-flex items-center justify-center"><Mail size={18} /></a>}</div></div>)}</div>
        </>
      )}
      {totalPages > 1 && <div className="flex items-center justify-between text-sm"><span className="text-fg-muted">Página {page} de {totalPages} · {totalRecords} registro{totalRecords === 1 ? '' : 's'}</span><div className="flex gap-1"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { setPage(page - 1); void fetchData(search, page - 1); }}>‹ Anterior</Button>{pageNumbers.map((number) => <Button key={number} variant={number === page ? 'default' : 'outline'} size="sm" onClick={() => { setPage(number); void fetchData(search, number); }}>{number}</Button>)}<Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => { setPage(page + 1); void fetchData(search, page + 1); }}>Próximo ›</Button></div></div>}
      {selectedIds.length > 0 && <div className="fixed inset-x-0 bottom-0 z-40"><div className="mx-auto max-w-[1060px] px-4"><div className="rounded-t-2xl border border-b-0 border-line bg-surface p-4 flex items-center justify-between"><span>{selectedIds.length} cliente{selectedIds.length === 1 ? '' : 's'} selecionado{selectedIds.length === 1 ? '' : 's'}</span><div className="flex gap-2"><Button variant="outline" onClick={() => setSelectedIds([])}>Limpar seleção</Button><Button onClick={requestBulkArchive}>{status === 'archived' ? <ArchiveRestore size={16} /> : <Archive size={16} />} {status === 'archived' ? 'Restaurar clientes' : 'Arquivar clientes'}</Button></div></div></div></div>}

      <DetailDrawer open={drawerOpen} onClose={closeDrawer} title={detail?.display_name || detail?.nome || 'Carregando…'} description={selectedId ? `Cliente · ${selectedId}` : undefined} actions={detail && <div className="space-y-3"><QualityBadges badges={qualityBadges(detail)} /><ContextActions actions={contextActions()} /><div className="flex gap-2">{!editMode ? <Button variant="outline" size="sm" onClick={() => { setEditFields(fieldsFromDetail(detail)); setEditMode(true); }}>Editar</Button> : <><Button size="sm" onClick={() => void updateDetail()} disabled={detailSaving}><Check size={14} /> Salvar</Button><Button variant="outline" size="sm" onClick={() => setEditMode(false)} disabled={detailSaving}><X size={14} /> Cancelar</Button></>}</div></div>}>
        {detailLoading && <div className="py-12 text-center text-sm text-fg-muted">Carregando detalhes…</div>}
        {detailError && !detailLoading && <div className="flex flex-col items-center gap-3 py-12 text-sm text-fg-muted"><AlertTriangle size={24} className="text-destructive/60" /><p>{detailError}</p><Button variant="outline" size="sm" onClick={() => selectedId && detail && void openDrawer(detail)}>Tentar novamente</Button></div>}
        {detail && !detailLoading && !editMode && <div className="space-y-4 text-sm"><div><p className="text-xs uppercase text-fg-muted">Nome</p><p className="font-medium">{detail.display_name || detail.nome || '—'}</p></div><div><p className="text-xs uppercase text-fg-muted">E-mail</p><p>{detail.email || '—'}</p></div><div><p className="text-xs uppercase text-fg-muted">Telefone</p><p>{fmtPhone(detail.telefone) || '—'}</p></div><div><p className="text-xs uppercase text-fg-muted">Documento</p><p>{formatDocument(detail.tax_id || detail.documento)}</p></div><div><p className="text-xs uppercase text-fg-muted">Endereço</p><p>{addressText(detail.address)}</p></div><div><p className="text-xs uppercase text-fg-muted">Observações</p><p className="whitespace-pre-wrap">{detail.notes || detail.observacoes || '—'}</p></div>{detail.latest_quotation && <Button variant="outline" size="sm" onClick={() => navigate?.(`/quotations/${encodeURIComponent(detail.latest_quotation!.name)}`)}>Abrir orçamento recente</Button>}</div>}
        {detail && !detailLoading && editMode && <div className="space-y-3"><label className="block text-xs text-fg-muted">Nome<Input value={editFields.nome} onChange={(event) => setEditFields((current) => ({ ...current, nome: event.target.value }))} /></label><label className="block text-xs text-fg-muted">Email<Input type="email" value={editFields.email} onChange={(event) => setEditFields((current) => ({ ...current, email: event.target.value }))} /></label><label className="block text-xs text-fg-muted">Telefone<Input value={editFields.telefone} onChange={(event) => setEditFields((current) => ({ ...current, telefone: event.target.value }))} /></label><label className="block text-xs text-fg-muted">Documento<Input value={editFields.documento} onChange={(event) => setEditFields((current) => ({ ...current, documento: event.target.value }))} /></label><label className="block text-xs text-fg-muted">Observações<textarea aria-label="Observações" value={editFields.observacoes} onChange={(event) => setEditFields((current) => ({ ...current, observacoes: event.target.value }))} className="mt-1 w-full rounded border border-line bg-surface p-2 text-sm" /></label><p className="text-xs text-fg-muted">{addressText(editFields.endereco)}</p></div>}
      </DetailDrawer>

      <ConfirmDialog
        open={archiveDialog !== null}
        title={archiveDialog?.title}
        message={archiveDialog?.message}
        confirmLabel={archiveDialog?.confirmLabel}
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={confirmPendingArchive}
        onCancel={() => setPendingArchive(null)}
      />
    </div>
  );
}
