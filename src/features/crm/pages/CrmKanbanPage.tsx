import { useState, useEffect, useCallback, useRef, type ChangeEvent, type DragEvent } from 'react';
import { Search, AlertTriangle, Columns3, Clipboard, Send, X, PlusCircle } from 'lucide-react';
import { apiGet, apiPost, apiPut } from '@/lib/api/api';
import { pipelineLabel } from '@/lib/statusLabels';
import { useToast } from '@/components/shared/toast';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/shared/EmptyState';
import { PIPELINE } from '@/lib/constants';
import SkeletonKanban from '@/features/crm/components/SkeletonKanban';
import { parseHashString, useHashQueryState } from '@/hooks/useHashQueryState';

interface Deal {
  id: string;
  lead_name?: string;
  email?: string;
  telefone?: string;
  quotation?: string;
  follow_up_stage?: number;
  next_step?: string;
  modificado_em?: string;
  criado_em?: string;
  status?: string;
}

interface Column {
  status: string;
  count: number;
  deals: Deal[];
}

interface CrmDealsResponse {
  columns: Column[];
}

interface UpdateDealResult {
  success: boolean;
}

interface PruneCandidate {
  deal_id: string;
  lead_name: string;
  quotation: string;
  quotation_date: string;
  age_days: number;
  deal_modified: string;
  grand_total: number;
}

interface PruneCandidatesResponse {
  candidates: PruneCandidate[];
  meta: {
    threshold_days: number;
    protect_recent_days: number;
    count: number;
  };
}

interface PruneResult {
  success: boolean;
  updated: number;
  skipped: number;
  skipped_deals: Array<{ deal_id: string; reason: string }>;
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

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function formatDateBR(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function CrmKanbanPage() {
  const { toast } = useToast();
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useHashQueryState('search', '', parseHashString);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [movingDealIds, setMovingDealIds] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [pruneCandidates, setPruneCandidates] = useState<PruneCandidate[]>([]);
  const [pruneLoading, setPruneLoading] = useState<boolean>(false);
  const [pruneError, setPruneError] = useState<string | null>(null);
  const [pruneOpen, setPruneOpen] = useState<boolean>(false);
  const [selectedPruneIds, setSelectedPruneIds] = useState<Set<string>>(new Set());
  const [pruneSubmitting, setPruneSubmitting] = useState<boolean>(false);
  const [pruneSummary, setPruneSummary] = useState<string | null>(null);
  const [visiblePerColumn, setVisiblePerColumn] = useState<Record<string, number>>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveMenuRefs = useRef<Map<string, HTMLSelectElement>>(new Map());
  const pruneDialogRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async (searchVal: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = searchVal ? `/crm-deals?search=${encodeURIComponent(searchVal)}` : '/crm-deals';
      const data = await apiGet<CrmDealsResponse>(url);
      setColumns(data.columns || []);
    } catch {
      setError('Não foi possível carregar o pipeline CRM.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPruneCandidates = useCallback(async () => {
    setPruneLoading(true);
    setPruneError(null);
    try {
      const data = await apiGet<PruneCandidatesResponse>('/crm-prune-candidates');
      const candidates = data.candidates || [];
      setPruneCandidates(candidates);
      setSelectedPruneIds(new Set(candidates.map((candidate) => candidate.deal_id)));
    } catch {
      setPruneError('Não foi possível carregar as oportunidades para revisão.');
    } finally {
      setPruneLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(search);
    fetchPruneCandidates();
  }, [fetchData, fetchPruneCandidates]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const setMoveMenuRef = useCallback((dealId: string, element: HTMLSelectElement | null) => {
    if (element) moveMenuRefs.current.set(dealId, element);
    else moveMenuRefs.current.delete(dealId);
  }, []);

  const restoreMoveMenuFocus = useCallback((dealId: string) => {
    window.requestAnimationFrame(() => moveMenuRefs.current.get(dealId)?.focus());
  }, []);

  // Prune modal: Esc para fechar, foco inicial no diálogo, focus trap e
  // restauração de foco — mesmo comportamento do ConfirmDialog compartilhado.
  useEffect(() => {
    if (!pruneOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    pruneDialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setPruneOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = pruneDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previousFocus?.focus?.();
    };
  }, [pruneOpen]);

  const onSearchChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setSearch(val);
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
      }
      searchTimer.current = setTimeout(() => {
        fetchData(val);
      }, 350);
    },
    [fetchData]
  );

  const togglePruneSelection = useCallback((dealId: string) => {
    setSelectedPruneIds((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }, []);

  const submitPrune = useCallback(async () => {
    const deal_ids = Array.from(selectedPruneIds);
    if (deal_ids.length === 0) {
      setPruneError('Selecione ao menos uma oportunidade para limpar.');
      return;
    }

    setPruneSubmitting(true);
    setPruneError(null);
    setPruneSummary(null);
    try {
      const result = await apiPost<PruneResult>('/crm-prune-candidates', { deal_ids });
      setPruneSummary(
        `${result.updated} oportunidades marcadas como Perdido. ${result.skipped} ignoradas.`
      );
      setPruneOpen(false);
      await Promise.all([fetchData(search), fetchPruneCandidates()]);
    } catch {
      setPruneError('Não foi possível concluir a revisão do pipeline. Tente novamente.');
    } finally {
      setPruneSubmitting(false);
    }
  }, [fetchData, fetchPruneCandidates, search, selectedPruneIds]);

  const moveDeal = useCallback(
    async (dealId: string, newStatus: string) => {
      const deal = columns.flatMap((column) => column.deals).find((item) => item.id === dealId);
      if (!deal || deal.status === newStatus) return;

      const leadName = String(deal.lead_name || 'Negócio sem nome').trim();
      const destination = pipelineLabel(newStatus);
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
        } else {
          next.push({ status: newStatus, count: 1, deals: [movedDeal] });
        }

        next.sort((a, b) => {
          const ai = PIPELINE.indexOf(a.status as (typeof PIPELINE)[number]);
          const bi = PIPELINE.indexOf(b.status as (typeof PIPELINE)[number]);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1;
          if (bi !== -1) return 1;
          return a.status.localeCompare(b.status);
        });

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
        setMovingDealIds((previous) => {
          const next = new Set(previous);
          next.delete(dealId);
          return next;
        });
        restoreMoveMenuFocus(dealId);
      }
    },
    [columns, fetchData, restoreMoveMenuFocus, search, toast]
  );

  const openLeadCard = useCallback((deal: Deal) => {
    const leadName = String(deal.lead_name || '').trim();
    if (!leadName || leadName === 'Sem nome') return;
    // ponytail: deal não traz id do lead/cliente; busca por nome na lista de leads
    window.location.hash = `#/leads?search=${encodeURIComponent(leadName)}&status=all`;
  }, []);

  const orderedColumns = [
    ...PIPELINE.map(
      (status) =>
        columns.find((column) => column.status === status) || { status, count: 0, deals: [] }
    ),
    ...columns.filter((column) => !PIPELINE.includes(column.status as (typeof PIPELINE)[number])),
  ];
  const hasDeals = orderedColumns.some((column) => column.count > 0);
  const hasSearch = search.trim().length > 0;
  const hasSearchResults = hasDeals || !hasSearch;

  return (
    <PageShell>
      <PageHeader
        title="CRM"
        description="Acompanhe cada negócio pelo funil de vendas."
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

      {/* Prune summary */}
      {pruneSummary && (
        <div className="rounded-lg border border-success/30 bg-success/10 text-success px-4 py-3 text-sm">
          {pruneSummary}
        </div>
      )}

      {/* Prune error */}
      {pruneError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive md:flex-row md:items-center md:justify-between"
        >
          <span>{pruneError}</span>
          {!pruneOpen && (
            <Button variant="outline" size="sm" onClick={fetchPruneCandidates}>
              Tentar novamente
            </Button>
          )}
        </div>
      )}

      {/* Review is intentionally secondary; it only exists when candidates are available. */}
      {!pruneLoading && pruneCandidates.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-muted px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-fg">Revisar pipeline</p>
            <p className="text-sm text-fg-muted">
              {pruneCandidates.length}{' '}
              {pruneCandidates.length === 1 ? 'oportunidade antiga' : 'oportunidades antigas'}{' '}
              aguardando revisão antes de serem marcadas como Perdido.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setPruneOpen(true)}
            aria-label={`Revisar pipeline (${pruneCandidates.length})`}
          >
            Revisar pipeline <span aria-hidden="true">({pruneCandidates.length})</span>
          </Button>
        </div>
      )}

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
                fetchData('');
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
          title="Nenhum negócio no pipeline."
          description="Um negócio nasce quando um orçamento é enviado a um cliente. Depois, acompanhe cada etapa aqui no funil."
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

      {/* The board scrolls horizontally on narrow screens; drag/drop is only an enhancement. */}
      {!loading && !error && hasDeals && (
        <div
          role="region"
          aria-label="Pipeline CRM"
          tabIndex={0}
          className="max-h-[calc(100vh-9.5rem)] overflow-x-auto overflow-y-auto rounded-lg border border-line bg-page [scrollbar-width:thin] md:max-h-[calc(100vh-10rem)]"
        >
          <div className="flex min-h-[55vh] w-max min-w-full gap-3 p-3">
            {orderedColumns.map((col) => (
              <div
                key={col.status}
                className="flex w-[17.5rem] flex-shrink-0 flex-col rounded-lg border border-line bg-surface"
              >
                <div className="flex items-center justify-between px-4 py-3 text-sm font-medium">
                  <h2>{pipelineLabel(col.status)}</h2>
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
                          if (dealId && col.status) moveDeal(dealId, col.status);
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
                          const leadClickable = !!leadName && leadName !== 'Sem nome';
                          const currentStatus = deal.status || col.status;
                          const moving = movingDealIds.has(deal.id);
                          const menuId = `move-deal-${deal.id}`;
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
                              aria-label={`Negócio ${displayLeadName}. Etapa: ${pipelineLabel(currentStatus)}.`}
                              className={cn(
                                'rounded-lg border border-line bg-surface p-3 transition-all',
                                'hover:border-fg-muted/30',
                                draggingId === deal.id && 'cursor-grabbing opacity-50'
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                {leadClickable ? (
                                  <a
                                    href={`#/leads?search=${encodeURIComponent(displayLeadName)}&status=all`}
                                    onClick={() => openLeadCard(deal)}
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
                                  {deal.telefone}
                                </p>
                              )}
                              {deal.next_step && (
                                <p className="mt-2 truncate text-xs text-fg-muted">
                                  Próximo passo: {deal.next_step}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                {deal.quotation && (
                                  <a
                                    href={`#/quotations/${encodeURIComponent(deal.quotation)}`}
                                    className="inline-flex items-center rounded px-1.5 py-0.5 text-xs text-primary transition-colors hover:bg-primary/10"
                                    aria-label={`Abrir orçamento ${deal.quotation}`}
                                  >
                                    <Clipboard size={12} className="mr-1" aria-hidden="true" />
                                    {deal.quotation}
                                  </a>
                                )}
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
                              <div className="mt-3 flex items-center gap-2 border-t border-line/60 pt-2">
                                <label htmlFor={menuId} className="shrink-0 text-xs text-fg-muted">
                                  Mover para
                                </label>
                                <Select
                                  id={menuId}
                                  ref={(element) => setMoveMenuRef(deal.id, element)}
                                  value={currentStatus}
                                  disabled={moving}
                                  aria-label={`Mover para ${displayLeadName}`}
                                  className="h-8 min-w-0 flex-1 py-1 text-xs"
                                  onChange={(event) => moveDeal(deal.id, event.target.value)}
                                >
                                  {orderedColumns.map((destinationColumn) => (
                                    <option
                                      key={destinationColumn.status}
                                      value={destinationColumn.status}
                                    >
                                      {destinationColumn.status === currentStatus ? 'Atual: ' : ''}
                                      {pipelineLabel(destinationColumn.status)}
                                    </option>
                                  ))}
                                </Select>
                              </div>
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

      {/* Prune modal */}
      {pruneOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setPruneOpen(false)}
            aria-hidden="true"
          />

          {/* Dialog */}
          <div
            ref={pruneDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Revisar limpeza de pipeline"
            tabIndex={-1}
            className="relative bg-surface border border-line rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col focus:outline-none"
          >
            <div className="px-5 py-4 border-b border-line flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-fg">Revisar limpeza de pipeline</h2>
                <p className="text-sm text-fg-muted mt-1">
                  Selecione os orçamentos antigos que devem ser marcados como Perdido.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPruneOpen(false)}
                className="text-fg-muted hover:text-fg"
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            <div className="overflow-auto p-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="text-left py-2 pr-2 w-10">&nbsp;</th>
                    <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">
                      Lead
                    </th>
                    <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">
                      Orçamento
                    </th>
                    <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">
                      Idade
                    </th>
                    <th className="text-left py-2 pr-2 font-medium text-fg-muted text-xs uppercase tracking-wider">
                      Última alteração
                    </th>
                    <th className="text-right py-2 font-medium text-fg-muted text-xs uppercase tracking-wider">
                      Valor
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pruneCandidates.map((candidate) => (
                    <tr key={candidate.deal_id} className="border-b border-line/50 last:border-0">
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={selectedPruneIds.has(candidate.deal_id)}
                          onChange={() => togglePruneSelection(candidate.deal_id)}
                          aria-label={`Selecionar ${candidate.lead_name}`}
                        />
                      </td>
                      <td className="py-2 pr-2 text-fg">{candidate.lead_name || 'Sem nome'}</td>
                      <td className="py-2 pr-2 font-mono text-xs text-primary">
                        {candidate.quotation}
                      </td>
                      <td className="py-2 pr-2 text-fg-muted">{candidate.age_days} dias</td>
                      <td className="py-2 pr-2 text-fg-muted">
                        {formatDateBR(candidate.deal_modified)}
                      </td>
                      <td className="py-2 text-right text-fg font-medium">
                        {formatBRL(candidate.grand_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-4 border-t border-line flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <p className="text-sm text-fg-muted">
                {selectedPruneIds.size} de {pruneCandidates.length} selecionadas
              </p>
              <div className="flex items-center gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setPruneOpen(false)}
                  disabled={pruneSubmitting}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  onClick={submitPrune}
                  disabled={pruneSubmitting || selectedPruneIds.size === 0}
                >
                  {pruneSubmitting ? 'Marcando...' : 'Marcar selecionados como Perdido'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
