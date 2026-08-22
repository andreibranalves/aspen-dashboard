import { useState, useEffect, useCallback, useRef, type ChangeEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Search, AlertTriangle, BarChart3, Clipboard, Send, X } from 'lucide-react';
import { apiGet, apiPost, apiPut } from '@/lib/api/api';
import { pipelineLabel } from '@/lib/statusLabels';
import { useToast } from '@/components/shared/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PIPELINE } from '@/lib/constants';
import SkeletonKanban from '@/features/crm/components/SkeletonKanban';
import { parseHashString, useHashQueryState } from '@/hooks/useHashQueryState';

interface Deal {
  id: string;
  lead_name?: string;
  email?: string;
  quotation?: string;
  follow_up_stage?: number;
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
  const [pruneCandidates, setPruneCandidates] = useState<PruneCandidate[]>([]);
  const [pruneLoading, setPruneLoading] = useState<boolean>(false);
  const [pruneError, setPruneError] = useState<string | null>(null);
  const [pruneOpen, setPruneOpen] = useState<boolean>(false);
  const [selectedPruneIds, setSelectedPruneIds] = useState<Set<string>>(new Set());
  const [pruneSubmitting, setPruneSubmitting] = useState<boolean>(false);
  const [pruneSummary, setPruneSummary] = useState<string | null>(null);
  const [visiblePerColumn, setVisiblePerColumn] = useState<Record<string, number>>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pruneDialogRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async (searchVal: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = searchVal ? `/crm-deals?search=${encodeURIComponent(searchVal)}` : '/crm-deals';
      const data = await apiGet<CrmDealsResponse>(url);
      setColumns(data.columns || []);
    } catch (err) {
      setError((err as Error).message || 'Erro ao carregar pipeline CRM.');
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
    } catch (err) {
      setPruneError((err as Error).message || 'Erro ao carregar limpeza de pipeline.');
    } finally {
      setPruneLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(search);
    fetchPruneCandidates();
  }, [fetchData, fetchPruneCandidates]);

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
    } catch (err) {
      setPruneError((err as Error).message || 'Erro ao limpar pipeline.');
    } finally {
      setPruneSubmitting(false);
    }
  }, [fetchData, fetchPruneCandidates, search, selectedPruneIds]);

  const moveDeal = useCallback(
    async (dealId: string, newStatus: string) => {
      // Optimistic update
      setColumns((prev) => {
        const next = prev.map((col) => ({
          ...col,
          deals: [...col.deals],
        }));
        let deal: Deal | null = null;
        for (let i = 0; i < next.length; i++) {
          const idx = next[i].deals.findIndex((d) => d.id === dealId);
          if (idx !== -1) {
            deal = { ...next[i].deals[idx], status: newStatus };
            next[i].deals.splice(idx, 1);
            next[i].count = next[i].deals.length;
            break;
          }
        }
        if (!deal) return prev;

        let newCol = next.find((c) => c.status === newStatus);
        if (newCol) {
          newCol.deals.unshift(deal);
          newCol.count = newCol.deals.length;
        } else {
          next.push({ status: newStatus, count: 1, deals: [deal] });
        }

        // Sort by pipeline order
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

      // API call
      try {
        const result = await apiPut<UpdateDealResult>('/crm-update-deal', {
          deal_id: dealId,
          status: newStatus,
        });
        if (!result.success) {
          toast('Não foi possível mover o negócio. Tente novamente.', 'error');
          await fetchData(search); // reverte a atualização otimista
        }
      } catch (err) {
        toast((err as Error).message || 'Não foi possível mover o negócio.', 'error');
        await fetchData(search); // reverte a atualização otimista
      }
    },
    [search, fetchData, toast]
  );

  const openLeadCard = useCallback((deal: Deal) => {
    const leadId = String(deal.lead_name || '').trim();
    if (!leadId || leadId === 'Sem nome') return;
    window.location.hash = `#/leads/cliente/${encodeURIComponent(leadId)}`;
  }, []);

  const orderedColumns = PIPELINE.map(
    (status) => columns.find((c) => c.status === status) || { status, count: 0, deals: [] }
  );

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Search + persistent primary action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-md flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <Input
            placeholder="Buscar por nome do negócio…"
            value={search}
            onChange={onSearchChange}
            className="pl-9"
          />
        </div>
        <a
          href="#/manual"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-on-solid transition-colors hover:bg-primary/90"
        >
          Novo orçamento
        </a>
      </div>

      {/* Prune summary */}
      {pruneSummary && (
        <div className="rounded-lg border border-success/30 bg-success/10 text-success px-4 py-3 text-sm">
          {pruneSummary}
        </div>
      )}

      {/* Prune error */}
      {pruneError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
          {pruneError}
        </div>
      )}

      {/* Prune banner */}
      {!pruneLoading && pruneCandidates.length > 0 && (
        <div className="rounded-lg border border-line bg-surface-muted px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <p className="font-medium text-sm text-fg">Limpeza de pipeline disponível</p>
            <p className="text-sm text-fg-muted">
              Existem {pruneCandidates.length} orçamentos enviados há 30 dias ou mais sem pedido
              fechado e sem atualização nos últimos 7 dias.
            </p>
          </div>
          <Button variant="outline" onClick={() => setPruneOpen(true)}>
            Revisar e marcar como Perdido
          </Button>
        </div>
      )}

      {/* Loading */}
      {loading && <SkeletonKanban />}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <AlertTriangle size={32} className="text-destructive/60" />
          <p>Erro ao carregar pipeline CRM</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => fetchData(search)}>
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && orderedColumns.every((c) => c.count === 0) && (
        <div className="flex flex-col items-center py-10 text-fg-muted gap-3">
          <BarChart3 size={36} className="text-fg-muted/40" />
          <p>Nenhum negócio no pipeline.</p>
          <p className="text-sm text-center max-w-md">
            Converte clientes em negócios arrastando-os pelo funil. Os leads viram
            negócios quando um orçamento é enviado.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
            <a
              href="#/leads"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-200 border border-line bg-transparent text-fg hover:bg-primary/5 active:scale-[0.97] h-10 px-4 py-2"
            >
              Ver clientes
            </a>
            <a
              href="#/manual"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-200 bg-primary text-on-solid hover:bg-primary/90 active:scale-[0.97] h-10 px-4 py-2"
            >
              Novo orçamento
            </a>
          </div>
        </div>
      )}

      {/* Kanban board — constrained height with own scroll. Hidden while empty: the
          empty-state block above already teaches the conversion flow, and showing
          zero columns beside it duplicated the message. */}
      {!loading && !error && !orderedColumns.every((c) => c.count === 0) && (
        <div className="overflow-auto rounded-lg border border-line bg-page max-h-[calc(100vh-9.5rem)] md:max-h-[calc(100vh-10rem)] [scrollbar-width:thin]">
          <div className="flex gap-3 p-3 min-h-[55vh] w-max">
            {orderedColumns.map((col) => (
              <div
                key={col.status}
                className="flex-shrink-0 w-[17.5rem] bg-surface border border-line rounded-lg flex flex-col"
              >
                {/* Column header */}
                <div className="px-4 py-3 font-medium text-sm flex items-center justify-between">
                  <span>{pipelineLabel(col.status)}</span>
                  <span className="bg-surface-muted text-fg-muted text-xs rounded-full px-2 py-0.5">
                    {col.count}
                  </span>
                </div>

                {/* Cards area */}
                {(() => {
                  const visible = visiblePerColumn[col.status] ?? 10;
                  const shown = col.deals.slice(0, visible);
                  const hidden = col.deals.length - shown.length;
                  return (
                    <>
                      <div
                        className={cn(
                          'flex-1 px-2 pb-2 space-y-2 min-h-[120px] rounded-b-lg transition-colors',
                          draggingId && 'bg-primary/5'
                        )}
                        onDragOver={(e: DragEvent<HTMLDivElement>) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e: DragEvent<HTMLDivElement>) => {
                          e.preventDefault();
                          const dealId = e.dataTransfer.getData('text/plain');
                          if (dealId && col.status) {
                            moveDeal(dealId, col.status);
                          }
                          setDraggingId(null);
                        }}
                      >
                        {shown.map((deal) => {
                          const leadId = String(deal.lead_name || '').trim();
                          const leadClickable = !!leadId && leadId !== 'Sem nome';
                          return (
                            <div
                              key={deal.id}
                              draggable
                              onDragStart={(e: DragEvent<HTMLDivElement>) => {
                                setDraggingId(deal.id);
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', deal.id);
                              }}
                              onDragEnd={() => setDraggingId(null)}
                              onClick={leadClickable ? () => openLeadCard(deal) : undefined}
                              onKeyDown={
                                leadClickable
                                  ? (e: ReactKeyboardEvent<HTMLDivElement>) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        openLeadCard(deal);
                                      }
                                    }
                                  : undefined
                              }
                              role={leadClickable ? 'link' : undefined}
                              tabIndex={leadClickable ? 0 : undefined}
                              aria-label={leadClickable ? `Abrir lead ${deal.lead_name}` : undefined}
                              className={cn(
                                'bg-surface rounded-lg border border-line p-3 transition-all',
                                leadClickable
                                  ? 'cursor-pointer hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-primary'
                                  : 'cursor-grab active:cursor-grabbing hover:border-fg-muted/30',
                                draggingId === deal.id && 'opacity-50'
                              )}
                            >
                              <p className="font-medium text-sm">{deal.lead_name || '—'}</p>
                              {deal.email && (
                                <p className="text-xs text-fg-muted truncate mt-0.5">{deal.email}</p>
                              )}
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                {deal.quotation && (
                                  <a
                                    href={`#/quotations/${encodeURIComponent(deal.quotation)}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center text-xs bg-primary/10 text-primary rounded px-1.5 py-0.5 hover:bg-primary/20 transition-colors"
                                    aria-label={`Abrir orçamento ${deal.quotation}`}
                                  >
                                    <Clipboard size={12} className="mr-1" />
                                    {deal.quotation}
                                  </a>
                                )}
                                {Number(deal.follow_up_stage) > 0 && (
                                  <span className="inline-flex items-center text-xs bg-surface-muted text-fg rounded px-1.5 py-0.5">
                                    <Send size={12} className="mr-1" /> Follow-up{' '}
                                    {deal.follow_up_stage}
                                  </span>
                                )}
                                <span className="text-xs text-fg-muted">
                                  {daysAgo(deal.modificado_em || deal.criado_em)}
                                </span>
                              </div>
                            </div>
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
                          className="px-2 pb-2 text-xs text-fg-muted hover:text-fg transition-colors"
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
    </div>
  );
}
