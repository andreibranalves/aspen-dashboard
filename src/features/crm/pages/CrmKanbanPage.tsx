import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  Search,
  AlertTriangle,
  Columns3,
  Clipboard,
  Send,
  PlusCircle,
  Rows3,
  Settings2,
} from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api/api';
import { useToast } from '@/components/shared/toast';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import DealProposals from '@/features/crm/components/DealProposals';
import PipelineStagesDialog from '@/features/crm/components/PipelineStagesDialog';
import { parseHashOption, parseHashString, useHashQueryState } from '@/hooks/useHashQueryState';
import { fmtPhone } from '@/lib/formatting/formatters';
import { storeQuotationOriginPrefill } from '@/features/crm/quotationOriginPrefill';
import { useHashRoute } from '@/hooks/useHashRoute';

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
  ['list', 'Lista', Rows3],
  ['board', 'Quadro', Columns3],
] as const;
type StageFilter = string;
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
  const viewTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function navigateFromLink(event: MouseEvent<HTMLAnchorElement>, target: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(target.replace(/^#/, ''));
  }

  function handleViewTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % CRM_VIEW_TABS.length;
    if (event.key === 'ArrowLeft')
      nextIndex = (index - 1 + CRM_VIEW_TABS.length) % CRM_VIEW_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = CRM_VIEW_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setView(CRM_VIEW_TABS[nextIndex][0]);
    viewTabRefs.current[nextIndex]?.focus();
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
    <PageShell className="space-y-5">
      {!embedded && (
        <PageHeader
          title="CRM"
          actions={
            <Button
              onClick={(): void => {
                window.location.hash = '#/manual';
              }}
            >
              <PlusCircle />
              Novo orçamento
            </Button>
          }
        />
      )}
      <div className="space-y-4 rounded-card border border-line bg-surface p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex rounded-control border border-line bg-surface-subtle p-1"
            role="tablist"
            aria-label="Visualização dos negócios"
          >
            {CRM_VIEW_TABS.map(([nextView, label, Icon], index) => (
              <button
                key={nextView}
                ref={(element) => {
                  viewTabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`crm-view-tab-${nextView}`}
                aria-controls="crm-view-panel"
                aria-selected={view === nextView}
                tabIndex={view === nextView ? 0 : -1}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-control px-3 text-sm transition-colors',
                  view === nextView
                    ? 'bg-primary/15 font-medium text-primary'
                    : 'text-fg-muted hover:bg-surface hover:text-fg'
                )}
                onClick={() => setView(nextView)}
                onKeyDown={(event) => handleViewTabKeyDown(event, index)}
              >
                <Icon aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Select
              aria-label="Filtrar por etapa"
              value={stage}
              onChange={(event) => setStage(event.target.value)}
            >
              <option value="all">Todas as etapas ({allDeals.length})</option>
              {orderedColumns.map((column) => (
                <option key={column.status} value={column.status}>
                  {column.name} ({column.deals.length})
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={() => setPipelineDialogOpen(true)}>
              <Settings2 aria-hidden="true" /> Editar etapas
            </Button>
          </div>
        </div>
        {/* Search stays available for an active query so a zero-result filter can be cleared. */}
        {!loading && !error && (hasDeals || hasSearch) && (
          <div className="relative max-w-md">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
              aria-hidden="true"
            />
            <Input
              placeholder="Buscar por nome do negócio…"
              value={search}
              onChange={onSearchChange}
              className="pl-9"
              aria-label="Buscar negócios"
            />
          </div>
        )}
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {/* Loading */}
      {loading && <SkeletonKanban />}

      {/* Error */}
      {!loading && error && (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 py-16 text-center text-fg-muted"
        >
          <AlertTriangle size={32} className="text-destructive/60" aria-hidden="true" />
          <p>Erro ao carregar pipeline CRM</p>
          <p className="max-w-md text-sm">
            Não foi possível carregar os negócios agora. Tente novamente.
          </p>
          <Button variant="outline" onClick={() => fetchData(search)}>
            Tentar novamente
          </Button>
        </div>
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
                <a href="#/manual">Novo orçamento</a>
              </Button>
              <Button variant="outline" asChild>
                <a href="#/quotations">Ver orçamentos</a>
              </Button>
            </>
          }
        />
      )}

      {!loading && !error && hasDeals && view === 'list' && (
        <div className="space-y-3" id="crm-view-panel">
          {!narrowLayout && (
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Negócio</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Orçamento</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead>Atualizado</TableHead>
                    <TableHead className="text-right">Mover</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDeals.map(({ deal, currentStatus }) => {
                    const leadName = dealName(deal);
                    const href = dealHref(deal);
                    const moving = movingDealIds.has(deal.id);
                    const lastUpdate = deal.modificado_em || deal.criado_em;
                    return (
                      <TableRow key={deal.id}>
                        <TableCell className="max-w-56 font-medium">
                          {href && leadName !== 'Sem nome' ? (
                            <a
                              href={href}
                              onClick={(event) => navigateFromLink(event, href)}
                              className="block truncate text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              aria-label={`Abrir lead ${leadName}`}
                            >
                              {leadName}
                            </a>
                          ) : (
                            <span className="block truncate">{leadName}</span>
                          )}
                          {deal.quote_lead_id && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="mt-1 h-7 px-1 text-xs"
                              onClick={() => startQuotation(deal, leadName)}
                            >
                              <PlusCircle aria-hidden="true" /> Novo orçamento
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="max-w-56 text-sm">
                          {deal.email && (
                            <span className="block truncate text-fg-muted">{deal.email}</span>
                          )}
                          {deal.telefone && (
                            <span className="block whitespace-nowrap text-xs text-fg-muted">
                              {fmtPhone(deal.telefone) || deal.telefone}
                            </span>
                          )}
                          {!deal.email && !deal.telefone && (
                            <span className="text-fg-muted">—</span>
                          )}
                        </TableCell>
                        <TableCell>
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
                              <span>{deal.quotation}</span>
                            )
                          ) : (
                            <span className="text-fg-muted">—</span>
                          )}
                          <DealProposals opportunityId={deal.id} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={currentStatus}
                            label={
                              orderedColumns.find((column) => column.status === currentStatus)
                                ?.name || currentStatus
                            }
                            className="tone-neutral-muted"
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-fg-muted">
                          {lastUpdate ? `Atualizado ${daysAgo(lastUpdate)}` : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Select
                            ref={(element) => setMoveMenuRef(deal.id, element)}
                            value={currentStatus}
                            disabled={moving}
                            aria-label={`Mover para ${leadName}`}
                            className="h-8 max-w-44 py-1 text-xs"
                            onChange={(event) => moveDeal(deal.id, event.target.value)}
                          >
                            {moveColumns(currentStatus).map((destinationColumn) => (
                              <option
                                key={destinationColumn.status}
                                value={destinationColumn.status}
                              >
                                {destinationColumn.status === currentStatus ? 'Atual: ' : ''}
                                {destinationColumn.name}
                              </option>
                            ))}
                          </Select>
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
                  <article key={deal.id} className="rounded-lg border border-line bg-surface p-4">
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
                        status={currentStatus}
                        label={
                          orderedColumns.find((column) => column.status === currentStatus)?.name ||
                          currentStatus
                        }
                        className="tone-neutral-muted shrink-0"
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
                        size="sm"
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
                        className="w-full text-sm"
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
          role="region"
          aria-label="Pipeline CRM"
          id="crm-view-panel"
          tabIndex={0}
          className="max-h-[calc(100vh-9.5rem)] overflow-x-auto overflow-y-auto rounded-card border border-line bg-surface-subtle [scrollbar-width:thin] md:max-h-[calc(100vh-10rem)]"
        >
          <div className="flex min-h-[55vh] w-max min-w-full gap-3 p-3">
            {displayColumns.map((col) => (
              <div
                key={col.status}
                className="flex w-[17.5rem] flex-shrink-0 flex-col rounded-card border border-line bg-surface"
              >
                <div className="flex items-center justify-between px-4 py-3 text-sm font-medium">
                  <h2>{col.name}</h2>
                  <span
                    aria-label={`${col.count} ${col.count === 1 ? 'negócio' : 'negócios'}`}
                    className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-fg-muted"
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
                          'min-h-[120px] flex-1 space-y-2 rounded-b-lg px-2 pb-2',
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
                                'rounded-xl border border-line bg-surface-subtle p-4 transition-all',
                                'hover:border-fg-muted/30',
                                draggingId === deal.id && 'cursor-grabbing opacity-50'
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                {leadClickable ? (
                                  <a
                                    href={leadHref || '#'}
                                    onClick={(event) =>
                                      leadHref && navigateFromLink(event, leadHref)
                                    }
                                    className="min-w-0 text-left text-sm font-medium text-fg hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                                    aria-label={`Abrir lead ${displayLeadName}`}
                                  >
                                    <span className="block truncate">{displayLeadName}</span>
                                  </a>
                                ) : (
                                  <h3 className="min-w-0 truncate text-sm font-medium">
                                    {displayLeadName}
                                  </h3>
                                )}
                                {moving && (
                                  <span className="shrink-0 text-xs text-fg-muted">Movendo…</span>
                                )}
                              </div>
                              {deal.email && (
                                <p className="mt-0.5 truncate text-xs text-fg-muted">
                                  {deal.email}
                                </p>
                              )}
                              {deal.telefone && (
                                <p className="mt-0.5 truncate text-xs text-fg-muted">
                                  {fmtPhone(deal.telefone) || deal.telefone}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                {deal.quotation &&
                                  (deal.quotation_id ? (
                                    <a
                                      href={`#/quotations/${deal.quotation_id}`}
                                      onClick={(event) =>
                                        navigateFromLink(event, `#/quotations/${deal.quotation_id}`)
                                      }
                                      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs text-primary transition-colors hover:bg-primary/10"
                                      aria-label={`Abrir orçamento ${deal.quotation}`}
                                    >
                                      <Clipboard size={12} className="mr-1" aria-hidden="true" />
                                      {deal.quotation}
                                    </a>
                                  ) : (
                                    <span
                                      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs text-primary"
                                      aria-label={`Orçamento ${deal.quotation}`}
                                    >
                                      <Clipboard size={12} className="mr-1" aria-hidden="true" />
                                      {deal.quotation}
                                    </span>
                                  ))}
                                {Number(deal.follow_up_stage) > 0 && (
                                  <span className="inline-flex items-center rounded bg-surface-muted px-1.5 py-0.5 text-xs text-fg">
                                    <Send size={12} className="mr-1" aria-hidden="true" />
                                    Follow-up {deal.follow_up_stage}
                                  </span>
                                )}
                                {lastUpdate && (
                                  <time
                                    dateTime={lastUpdate}
                                    className="text-xs text-fg-muted"
                                    title="Última atualização"
                                  >
                                    Atualizado {daysAgo(lastUpdate)}
                                  </time>
                                )}
                              </div>
                              <DealProposals opportunityId={deal.id} />
                              {deal.quote_lead_id && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="mt-2 w-full"
                                  onClick={() => startQuotation(deal, leadName)}
                                >
                                  <PlusCircle />
                                  Novo orçamento
                                </Button>
                              )}
                            </article>
                          );
                        })}
                      </div>
                      {hidden > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setVisiblePerColumn((prev) => ({
                              ...prev,
                              [col.status]: (prev[col.status] ?? 10) + 25,
                            }))
                          }
                          className="px-2 pb-2 text-xs text-fg-muted transition-colors hover:text-fg"
                        >
                          Ver mais ({hidden} restantes)
                        </button>
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
