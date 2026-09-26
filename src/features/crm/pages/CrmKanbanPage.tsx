import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
} from 'react';
import {
  Search,
  Columns3,
  PlusCircle,
  Rows3,
  Settings2,
  ArrowUpRight,
} from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api/api';
import { useToast } from '@/components/shared/toast';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import { Button } from '@/components/ui/button';
import ErrorState from '@/components/shared/ErrorState';
import PageToolbar from '@/components/shared/PageToolbar';
import { SearchField } from '@/components/ui/search-field';
import { TabBar } from '@/components/ui/tabs';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/EmptyState';
import SkeletonKanban from '@/features/crm/components/SkeletonKanban';
import SkeletonTable from '@/components/shared/SkeletonTable';
import DealProposals from '@/features/crm/components/DealProposals';
import PipelineStagesDialog from '@/features/crm/components/PipelineStagesDialog';
import { parseHashOption, parseHashString, useHashQueryState } from '@/hooks/useHashQueryState';
import { fmtPhone } from '@/lib/formatting/formatters';
import { storeQuotationOriginPrefill } from '@/features/crm/quotationOriginPrefill';
import { useHashRoute } from '@/hooks/useHashRoute';
import EntityIdentity from '@/components/shared/EntityIdentity';
import { Heading } from '@/components/ui/heading';

interface Deal {
  id: string;
  lead_name?: string;
  email?: string;
  telefone?: string;
  client_id?: string | null;
  quote_lead_id?: string | null;
  lead_source?: string | null;
  quotation_id?: string | null;
  quotation?: string;
  follow_up_stage?: number;
  modificado_em?: string;
  criado_em?: string;
  status?: string;
}

interface Column {
  status: string;
  name: string;
  count: number;
  deals: Deal[];
}

interface CrmDealsResponse {
  columns: Column[];
}

interface UpdateDealResult {
  success: boolean;
}

function daysAgo(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'hoje';
  if (diff === 1) return '1 dia';
  return `${diff} dias`;
}

type CrmView = 'list' | 'board';
const parseCrmView = parseHashOption<CrmView>(['list', 'board']);
const CRM_VIEW_TABS = [
  { value: 'list', label: 'Lista', icon: Rows3 },
  { value: 'board', label: 'Quadro', icon: Columns3 },
] as const;
type StageFilter = string;
// Marcador de etapa é marca de gráfico: usa os tokens chart-*.
const BOARD_STAGE_SWATCHES = ['bg-chart-one', 'bg-chart-two', 'bg-chart-three', 'bg-chart-four'] as const;
const parseStageFilter = (raw: string | null, fallback: StageFilter): StageFilter =>
  raw?.trim() || fallback;

function dealName(deal: Deal): string {
  return String(deal.lead_name || '').trim() || 'Sem nome';
}

function dealHref(deal: Deal): string | null {
  if (deal.client_id) return `#/leads/cliente/${deal.client_id}`;
  if (deal.quote_lead_id) return `#/leads/lead/${deal.quote_lead_id}`;
  return null;
}

interface CrmKanbanPageProps {
  embedded?: boolean;
}

export default function CrmKanbanPage({ embedded = false }: CrmKanbanPageProps) {
  const { toast } = useToast();
  const [, navigate] = useHashRoute();
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useHashQueryState('search', '', parseHashString);
  const [view, setView] = useHashQueryState<CrmView>('view', 'list', parseCrmView);
  const [stage, setStage] = useHashQueryState<StageFilter>('stage', 'all', parseStageFilter);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [movingDealIds, setMovingDealIds] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);
  const [visiblePerColumn, setVisiblePerColumn] = useState<Record<string, number>>({});
  const [narrowLayout, setNarrowLayout] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1024
  );
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGenerationRef = useRef(0);
  const moveMenuRefs = useRef<Map<string, HTMLSelectElement>>(new Map());
  const pendingMoveMenuFocusRef = useRef<string | null>(null);

  function navigateFromLink(event: MouseEvent<HTMLAnchorElement>, target: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(target.replace(/^#/, ''));
  }

  function startQuotation(deal: Deal, leadName: string) {
    if (!deal.quote_lead_id) return;
    storeQuotationOriginPrefill({
      quoteLeadId: deal.quote_lead_id,
      crmDealId: deal.id,
      leadName,
      email: deal.email || '',
      telefone: deal.telefone || '',
      source: deal.lead_source || '',
    });
    navigate(
      `/manual?quoteLeadId=${encodeURIComponent(deal.quote_lead_id)}&crmDealId=${encodeURIComponent(deal.id)}`
    );
  }

  const fetchData = useCallback(async (searchVal: string) => {
    const requestGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const url = searchVal ? `/crm-deals?search=${encodeURIComponent(searchVal)}` : '/crm-deals';
      const data = await apiGet<CrmDealsResponse>(url);
      if (requestGeneration !== requestGenerationRef.current) return;
      if (
        !data ||
        !Array.isArray(data.columns) ||
        data.columns.some(
          (column) => !column || typeof column.status !== 'string' || !Array.isArray(column.deals)
        )
      ) {
        throw new Error('Resposta inválida ao carregar o pipeline CRM.');
      }
      setColumns(data.columns || []);
    } catch {
      if (requestGeneration !== requestGenerationRef.current) return;
      setError('Não foi possível carregar o pipeline CRM.');
    } finally {
      if (requestGeneration === requestGenerationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData(search);
  }, [fetchData, search]);

  useEffect(() => {
    if (
      stage !== 'all' &&
      columns.length > 0 &&
      !columns.some((column) => column.status === stage)
    ) {
      setStage('all');
    }
  }, [columns, setStage, stage]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const updateLayout = () => setNarrowLayout(!media.matches);
    updateLayout();
    media.addEventListener?.('change', updateLayout);
    return () => media.removeEventListener?.('change', updateLayout);
  }, []);

  const setMoveMenuRef = useCallback((dealId: string, element: HTMLSelectElement | null) => {
    if (element) moveMenuRefs.current.set(dealId, element);
    else moveMenuRefs.current.delete(dealId);
  }, []);

  useEffect(() => {
    const dealId = pendingMoveMenuFocusRef.current;
    if (!dealId || movingDealIds.has(dealId)) return;
    pendingMoveMenuFocusRef.current = null;
    moveMenuRefs.current.get(dealId)?.focus();
  }, [movingDealIds]);

  const onSearchChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
      }
      searchTimer.current = setTimeout(() => {
        setSearch(val);
      }, 350);
    },
    [setSearch]
  );

  const moveDeal = useCallback(
    async (dealId: string, newStatus: string) => {
      const deal = columns.flatMap((column) => column.deals).find((item) => item.id === dealId);
      if (!deal || deal.status === newStatus) return;

      const leadName = String(deal.lead_name || 'Negócio sem nome').trim();
      const destination = columns.find((column) => column.status === newStatus)?.name || newStatus;
      setMovingDealIds((previous) => new Set(previous).add(dealId));
      setAnnouncement(`Movendo ${leadName} para ${destination}.`);

      // Optimistic update keeps the board responsive while the durable status changes.
      setColumns((prev) => {
        const next = prev.map((col) => ({
          ...col,
          deals: [...col.deals],
        }));
        let movedDeal: Deal | null = null;
        for (let i = 0; i < next.length; i++) {
          const idx = next[i].deals.findIndex((item) => item.id === dealId);
          if (idx !== -1) {
            movedDeal = { ...next[i].deals[idx], status: newStatus };
            next[i].deals.splice(idx, 1);
            next[i].count = next[i].deals.length;
            break;
          }
        }
        if (!movedDeal) return prev;

        const newColumn = next.find((column) => column.status === newStatus);
        if (newColumn) {
          newColumn.deals.unshift(movedDeal);
          newColumn.count = newColumn.deals.length;
        }

        return next;
      });

      try {
        const result = await apiPut<UpdateDealResult>('/crm-update-deal', {
          deal_id: dealId,
          status: newStatus,
        });
        if (!result.success) throw new Error('Atualização recusada.');
        setAnnouncement(`${leadName} movido para ${destination}.`);
      } catch {
        toast('Não foi possível mover o negócio. O pipeline será atualizado novamente.', 'error');
        await fetchData(search); // rollback via server truth after a failed mutation
        setAnnouncement(`Não foi possível mover ${leadName}. O pipeline foi restaurado.`);
      } finally {
        pendingMoveMenuFocusRef.current = dealId;
        setMovingDealIds((previous) => {
          const next = new Set(previous);
          next.delete(dealId);
          return next;
        });
      }
    },
    [columns, fetchData, search, toast]
  );

  const orderedColumns = columns;
  // Encerramento acontece somente pelas vias autorizadas (pedido efetivo ou
  // decisão manual motivada); o seletor nunca oferece etapas terminais.
  const moveColumns = (currentStatus: string | undefined) =>
    orderedColumns.filter(
      (column) =>
        !['Pedido Fechado', 'Perdido'].includes(column.status) || column.status === currentStatus,
    );
  const displayColumns =
    stage === 'all' ? orderedColumns : orderedColumns.filter((column) => column.status === stage);
  const allDeals = orderedColumns.flatMap((column) => column.deals);
  const visibleDeals = displayColumns.flatMap((column) =>
    column.deals.map((deal) => ({ deal, currentStatus: deal.status || column.status }))
  );
  const hasDeals = visibleDeals.length > 0;
  const hasAnyDeals = allDeals.length > 0;
  const hasSearch = search.trim().length > 0;
  const hasSearchResults = hasAnyDeals || !hasSearch;

  return (
    <PageShell className="space-y-9">
      {!embedded && (
        <PageHeader title="CRM" />
      )}
      <PageToolbar>
        <SearchField placeholder="Buscar negócio ou cliente" value={search} onChange={onSearchChange} aria-label="Buscar negócios" />
        <Select aria-label="Filtrar por etapa" value={stage} onChange={(event) => setStage(event.target.value)}>
          <option value="all">Todas as etapas</option>
          {orderedColumns.map((column) => <option key={column.status} value={column.status}>{column.name} ({column.deals.length})</option>)}
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <TabBar
            value={view}
            onValueChange={setView}
            label="Visualização dos negócios"
            idPrefix="crm-view"
            variant="segmented"
            items={CRM_VIEW_TABS}
          />
          <Button variant="outline" onClick={() => setPipelineDialogOpen(true)}>
            <Settings2 aria-hidden="true" /> Etapas
          </Button>
        </div>
      </PageToolbar>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {/* Loading */}
      {loading && (view === 'board' ? <SkeletonKanban /> : <SkeletonTable cols={6} rows={7} size="lg" />)}

      {/* Error */}
      {!loading && error && (
        <ErrorState title="Não foi possível carregar os negócios" onRetry={() => fetchData(search)} />
      )}

      {/* Empty and filtered-empty states stay distinct so search never becomes a dead end. */}
      {!loading && !error && !hasSearchResults && (
        <EmptyState
          icon={Search}
          title="Nenhum negócio encontrado."
          description={`Não encontramos negócios para “${search}”. Ajuste a busca ou limpe o filtro para ver o pipeline.`}
          actions={
            <Button
              variant="outline"
              onClick={() => {
                if (searchTimer.current) clearTimeout(searchTimer.current);
                setSearch('');
              }}
            >
              Limpar busca
            </Button>
          }
        />
      )}

      {!loading && !error && !hasDeals && hasSearchResults && (
        <EmptyState
          icon={Columns3}
          title={stage === 'all' ? 'Nenhum negócio no pipeline.' : 'Nenhum negócio nesta etapa.'}
          description={
            stage === 'all'
              ? 'Um negócio nasce quando um orçamento é enviado a um cliente. Depois, acompanhe cada etapa aqui no funil.'
              : 'Ajuste o filtro de etapa para ver outros negócios.'
          }
          actions={
            <>
              <Button asChild>
                <a href="#/novo-orcamento">Novo orçamento</a>
              </Button>
              <Button variant="outline" asChild>
                <a href="#/quotations">Ver orçamentos</a>
              </Button>
            </>
          }
        />
      )}

      {!loading && !error && hasDeals && view === 'list' && (
        <div className="space-y-3" id="crm-view-panel-list" role="tabpanel" aria-labelledby="crm-view-tab-list">
          {!narrowLayout && (
            <div className="overflow-x-auto rounded-card border border-line bg-surface p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <Heading as="h2" level="subsection">Negócios em acompanhamento</Heading>
              </div>
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Negócio / cliente</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead>Proposta vinculada</TableHead>
                    <TableHead className="text-right"><span className="sr-only">Abrir</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDeals.map(({ deal, currentStatus }) => {
                    const leadName = dealName(deal);
                    const href = dealHref(deal);
                    const moving = movingDealIds.has(deal.id);
                    return (
                      <TableRow key={deal.id} className="group">
                        <TableCell className="max-w-56">
                          <EntityIdentity name={leadName} secondary={deal.telefone ? fmtPhone(deal.telefone) || deal.telefone : undefined} primary={href ? <a href={href} onClick={(event) => navigateFromLink(event, href)} aria-label={`Abrir lead ${leadName}`} className="hover:underline">{leadName}</a> : leadName} />
                        </TableCell>
                        <TableCell className="text-xs">{deal.lead_source || '—'}</TableCell>
                        <TableCell>
                          <StatusBadge
                            tone="tone-neutral-muted"
                            status={currentStatus}
                            label={
                              orderedColumns.find((column) => column.status === currentStatus)
                                ?.name || currentStatus
                            }
                          />
                        </TableCell>
                        <TableCell className="text-xs">{deal.quotation ? deal.quotation_id ? <a href={`#/quotations/${deal.quotation_id}`} onClick={(event) => navigateFromLink(event, `#/quotations/${deal.quotation_id}`)} className="font-medium hover:underline">{deal.quotation}</a> : deal.quotation : '—'}<DealProposals opportunityId={deal.id} /></TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"><Select size="icon" ref={(element) => setMoveMenuRef(deal.id, element)} value={currentStatus} disabled={moving} aria-label={`Mover ${leadName} para outra etapa`} onChange={(event) => moveDeal(deal.id, event.target.value)}>
                              {moveColumns(currentStatus).map((destinationColumn) => <option key={destinationColumn.status} value={destinationColumn.status}>{destinationColumn.name}</option>)}
                            </Select></div>
                            {deal.quote_lead_id && (
                              <Button type="button" variant="ghost" size="xs" onClick={() => startQuotation(deal, leadName)}>
                                <PlusCircle aria-hidden="true" /> Novo orçamento
                              </Button>
                            )}
                            {href ? <a href={href} onClick={(event) => navigateFromLink(event, href)} className="inline-flex h-8 items-center gap-1 rounded-control bg-surface-subtle px-2 text-xs font-medium hover:bg-surface-hover"><ArrowUpRight size={14} aria-hidden="true" />Abrir</a> : <span className="text-fg-muted">—</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {narrowLayout && (
            <div className="grid gap-3">
              {visibleDeals.map(({ deal, currentStatus }) => {
                const leadName = dealName(deal);
                const href = dealHref(deal);
                const moving = movingDealIds.has(deal.id);
                const lastUpdate = deal.modificado_em || deal.criado_em;
                return (
                  <article key={deal.id} className="rounded-control border border-line bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {href && leadName !== 'Sem nome' ? (
                          <a
                            href={href}
                            onClick={(event) => navigateFromLink(event, href)}
                            className="block truncate font-medium text-primary hover:underline"
                            aria-label={`Abrir lead ${leadName}`}
                          >
                            {leadName}
                          </a>
                        ) : (
                          // eslint-disable-next-line no-restricted-syntax -- espelha o link do lead ao lado
                          <h2 className="truncate font-medium">{leadName}</h2>
                        )}
                        {deal.email && (
                          <p className="mt-1 truncate text-xs text-fg-muted">{deal.email}</p>
                        )}
                        {deal.telefone && (
                          <p className="mt-0.5 text-xs text-fg-muted">
                            {fmtPhone(deal.telefone) || deal.telefone}
                          </p>
                        )}
                      </div>
                      <StatusBadge
                        tone="tone-neutral-muted"
                        status={currentStatus}
                        label={
                          orderedColumns.find((column) => column.status === currentStatus)?.name ||
                          currentStatus
                        }
                        className="shrink-0"
                      />
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-fg-muted">Orçamento</dt>
                        <dd className="mt-1 truncate">
                          {deal.quotation ? (
                            deal.quotation_id ? (
                              <a
                                href={`#/quotations/${deal.quotation_id}`}
                                onClick={(event) =>
                                  navigateFromLink(event, `#/quotations/${deal.quotation_id}`)
                                }
                                className="text-primary hover:underline"
                                aria-label={`Abrir orçamento ${deal.quotation}`}
                              >
                                {deal.quotation}
                              </a>
                            ) : (
                              deal.quotation
                            )
                          ) : (
                            '—'
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-fg-muted">Atualizado</dt>
                        <dd className="mt-1 text-xs text-fg-muted">
                          {lastUpdate ? daysAgo(lastUpdate) : '—'}
                        </dd>
                      </div>
                    </dl>
                    <DealProposals opportunityId={deal.id} />
                    {deal.quote_lead_id && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="mt-3 w-full"
                        onClick={() => startQuotation(deal, leadName)}
                      >
                        <PlusCircle aria-hidden="true" /> Novo orçamento
                      </Button>
                    )}
                    <div className="mt-4 border-t border-line/60 pt-3">
                      <label htmlFor={`mobile-move-deal-${deal.id}`} className="sr-only">
                        Mover para {leadName}
                      </label>
                      <Select
                        id={`mobile-move-deal-${deal.id}`}
                        value={currentStatus}
                        disabled={moving}
                        aria-label={`Mover para ${leadName}`}
                        className="w-full"
                        onChange={(event) => moveDeal(deal.id, event.target.value)}
                      >
                        {moveColumns(currentStatus).map((destinationColumn) => (
                          <option key={destinationColumn.status} value={destinationColumn.status}>
                            {destinationColumn.status === currentStatus ? 'Atual: ' : ''}
                            {destinationColumn.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* The board scrolls horizontally on narrow screens; drag/drop is only an enhancement. */}
      {!loading && !error && hasDeals && view === 'board' && (
        <div
          role="tabpanel"
          aria-labelledby="crm-view-tab-board"
          id="crm-view-panel-board"
          tabIndex={0}
          className="overflow-x-auto rounded-card [scrollbar-width:thin]"
        >
          <div className="flex w-max min-w-full gap-3">
            {displayColumns.map((col, columnIndex) => (
              <div
                key={col.status}
                className="flex w-[13.5rem] flex-shrink-0 flex-col rounded-card bg-surface-subtle p-3"
              >
                <div className="flex items-center justify-between gap-3 px-1 py-1 text-xs font-semibold">
                  <h2 className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${BOARD_STAGE_SWATCHES[columnIndex % BOARD_STAGE_SWATCHES.length]}`}
                    />
                    <span className="truncate">{col.name}</span>
                  </h2>
                  <span
                    aria-label={`${col.count} ${col.count === 1 ? 'negócio' : 'negócios'}`}
                    className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-fg-muted"
                  >
                    {col.count}
                  </span>
                </div>

                {(() => {
                  const visible = visiblePerColumn[col.status] ?? 10;
                  const shown = col.deals.slice(0, visible);
                  const hidden = col.deals.length - shown.length;
                  return (
                    <>
                      <div
                        className={cn(
                          'min-h-[120px] flex-1 space-y-3 pt-4',
                          draggingId && 'bg-primary/5'
                        )}
                        onDragOver={(e: DragEvent<HTMLDivElement>) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e: DragEvent<HTMLDivElement>) => {
                          e.preventDefault();
                          const dealId = e.dataTransfer.getData('text/plain');
                          if (
                            dealId &&
                            col.status &&
                            moveColumns(undefined).some((column) => column.status === col.status)
                          ) {
                            moveDeal(dealId, col.status);
                          }
                          setDraggingId(null);
                        }}
                      >
                        {shown.length === 0 && (
                          <p className="px-2 py-6 text-center text-xs text-fg-muted">
                            Nenhum negócio nesta etapa.
                          </p>
                        )}
                        {shown.map((deal) => {
                          const leadName = String(deal.lead_name || '').trim();
                          const displayLeadName = leadName || 'Sem nome';
                          const leadHref = deal.client_id
                            ? `#/leads/cliente/${deal.client_id}`
                            : deal.quote_lead_id
                              ? `#/leads/lead/${deal.quote_lead_id}`
                              : null;
                          const leadClickable = Boolean(
                            leadHref && leadName && leadName !== 'Sem nome'
                          );
                          const moving = movingDealIds.has(deal.id);
                          const lastUpdate = deal.modificado_em || deal.criado_em;
                          return (
                            <article
                              key={deal.id}
                              draggable={!moving}
                              onDragStart={(e: DragEvent<HTMLElement>) => {
                                setDraggingId(deal.id);
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', deal.id);
                              }}
                              onDragEnd={() => setDraggingId(null)}
                              aria-label={`Negócio ${displayLeadName}. Etapa: ${col.name}.`}
                              className={cn(
                                'rounded-card bg-surface-subtle p-4 transition-colors hover:bg-surface-hover',
                                draggingId === deal.id && 'cursor-grabbing opacity-50'
                              )}
                            >
                              <div className="mb-3 text-3xs font-medium uppercase tracking-wider text-fg-muted">{deal.id.slice(0, 8)}</div>
                              <div className="flex items-start justify-between gap-2">
                                {leadClickable ? (
                                  <a
                                    href={leadHref || '#'}
                                    onClick={(event) =>
                                      leadHref && navigateFromLink(event, leadHref)
                                    }
                                    className="min-w-0 text-left text-lead font-semibold leading-5 text-fg hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                                    aria-label={`Abrir lead ${displayLeadName}`}
                                  >
                                    <span className="block truncate">{displayLeadName}</span>
                                  </a>
                                ) : (
                                  <Heading level="card" className="min-w-0 truncate">
                                    {displayLeadName}
                                  </Heading>
                                )}
                                {moving && (
                                  <span className="shrink-0 text-xs text-fg-muted">Movendo…</span>
                                )}
                              </div>
                              <p className="mt-2 truncate text-2xs text-fg-muted">{deal.lead_source || 'Origem não informada'}</p>
                              <div className="mt-5 flex items-center justify-between text-2xs text-fg-muted">
                                <time dateTime={lastUpdate}>{lastUpdate ? daysAgo(lastUpdate) : '—'}</time>
                                <span className="grid size-7 place-items-center rounded-full bg-avatar-one text-3xs font-bold text-avatar-ink">AS</span>
                              </div>
                              {leadHref && <a href={leadHref} onClick={(event) => navigateFromLink(event, leadHref)} className="mt-4 flex items-center justify-center gap-2 border-t border-line pt-3 text-xs text-fg-muted hover:text-fg"><ArrowUpRight size={14} aria-hidden="true" />Ver negócio</a>}
                              <details className="mt-2 text-2xs text-fg-muted"><summary className="cursor-pointer">Mais ações</summary><div className="mt-2 space-y-2"><DealProposals opportunityId={deal.id} />{deal.quote_lead_id && <Button variant="ghost" className="w-full" onClick={() => startQuotation(deal, leadName)}><PlusCircle />Novo orçamento</Button>}<Select ref={(element) => setMoveMenuRef(deal.id, element)} value={deal.status || col.status} disabled={moving} aria-label={`Mover ${displayLeadName} para outra etapa`} className="w-full" onChange={(event) => moveDeal(deal.id, event.target.value)}>{moveColumns(deal.status || col.status).map((destinationColumn) => <option key={destinationColumn.status} value={destinationColumn.status}>{destinationColumn.name}</option>)}</Select></div></details>
                            </article>
                          );
                        })}
                      </div>
                      {hidden > 0 && (
                        <Button
                          type="button"
                          onClick={() =>
                            setVisiblePerColumn((prev) => ({
                              ...prev,
                              [col.status]: (prev[col.status] ?? 10) + 25,
                            }))
                          }
                          variant="ghost-muted"
                          size="xs"
                        >
                          Ver mais ({hidden} restantes)
                        </Button>
                      )}
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      )}

      <PipelineStagesDialog
        open={pipelineDialogOpen}
        onClose={() => setPipelineDialogOpen(false)}
        onChanged={() => {
          void fetchData(search);
        }}
      />
    </PageShell>
  );
}
