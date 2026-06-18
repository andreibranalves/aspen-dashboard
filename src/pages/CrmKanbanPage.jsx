import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, AlertTriangle, BarChart3, Clipboard, Send } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { PIPELINE } from '@/lib/constants.js';
import SkeletonKanban from '@/components/SkeletonKanban.jsx';

function daysAgo(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'hoje';
  if (diff === 1) return '1 dia';
  return `${diff} dias`;
}

export default function CrmKanbanPage() {
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [draggingId, setDraggingId] = useState(null);
  const searchTimer = useRef(null);

  const fetchData = useCallback(async (searchVal) => {
    setLoading(true);
    setError(null);
    try {
      const url = searchVal ? `/crm-deals?search=${encodeURIComponent(searchVal)}` : '/crm-deals';
      const data = await apiGet(url);
      setColumns(data.columns || []);
    } catch (err) {
      setError(err.message || 'Erro ao carregar pipeline CRM.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(search);
  }, [fetchData]);

  const onSearchChange = useCallback(
    (e) => {
      const val = e.target.value;
      setSearch(val);
      clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        fetchData(val);
      }, 350);
    },
    [fetchData]
  );

  const moveDeal = useCallback(
    async (dealId, newStatus) => {
      // Optimistic update
      setColumns((prev) => {
        const next = prev.map((col) => ({
          ...col,
          deals: [...col.deals],
        }));
        let deal = null;
        let oldColIdx = -1;
        for (let i = 0; i < next.length; i++) {
          const idx = next[i].deals.findIndex((d) => d.id === dealId);
          if (idx !== -1) {
            deal = { ...next[i].deals[idx], status: newStatus };
            next[i].deals.splice(idx, 1);
            next[i].count = next[i].deals.length;
            oldColIdx = i;
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
          const ai = PIPELINE.indexOf(a.status);
          const bi = PIPELINE.indexOf(b.status);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1;
          if (bi !== -1) return 1;
          return a.status.localeCompare(b.status);
        });

        return next;
      });

      // API call
      try {
        const result = await apiPut('/crm-update-deal', { deal_id: dealId, status: newStatus });
        if (!result.success) {
          fetchData(search); // reload on failure
        }
      } catch {
        fetchData(search);
      }
    },
    [search, fetchData]
  );

  const orderedColumns = PIPELINE.map(
    (status) => columns.find((c) => c.status === status) || { status, count: 0, deals: [] }
  );

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Search */}
      <div className="relative max-w-md">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
        />
        <Input
          placeholder="Buscar por nome do lead…"
          value={search}
          onChange={onSearchChange}
          className="pl-9"
        />
      </div>

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
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <BarChart3 size={36} className="text-fg-muted/40" />
          <p>Nenhum deal no pipeline</p>
          <p className="text-sm">Os deals do CRM aparecerão aqui.</p>
        </div>
      )}

      {/* Kanban board — constrained height with own scroll */}
      {!loading && !error && orderedColumns.some((c) => c.count > 0) && (
        <div className="overflow-auto rounded-lg border border-line bg-page max-h-[calc(100vh-9.5rem)] md:max-h-[calc(100vh-10rem)]">
          <div className="flex gap-4 p-3 min-h-[55vh]">
            {orderedColumns.map((col) => (
              <div
                key={col.status}
                className="flex-shrink-0 w-72 bg-surface border border-line rounded-lg flex flex-col"
              >
                {/* Column header */}
                <div className="px-4 py-3 font-medium text-sm flex items-center justify-between">
                  <span>{col.status}</span>
                  <span className="bg-surface-muted text-fg-muted text-xs rounded-full px-2 py-0.5">
                    {col.count}
                  </span>
                </div>

                {/* Cards area */}
                <div
                  className={cn(
                    'flex-1 px-2 pb-2 space-y-2 min-h-[120px] rounded-b-lg transition-colors',
                    draggingId && 'bg-primary/5'
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const dealId = e.dataTransfer.getData('text/plain');
                    if (dealId && col.status) {
                      moveDeal(dealId, col.status);
                    }
                    setDraggingId(null);
                  }}
                >
                  {col.deals.map((deal) => (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={(e) => {
                        setDraggingId(deal.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', deal.id);
                      }}
                      onDragEnd={() => setDraggingId(null)}
                      className={cn(
                        'bg-surface rounded-lg border border-line p-3 cursor-grab active:cursor-grabbing hover:border-fg-muted/30 transition-all',
                        draggingId === deal.id && 'opacity-50'
                      )}
                    >
                      <p className="font-medium text-sm">{deal.lead_name || '—'}</p>
                      {deal.email && (
                        <p className="text-xs text-fg-muted truncate mt-0.5">
                          {deal.email}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {deal.quotation && (
                          <span className="inline-flex items-center text-xs bg-primary/10 text-primary rounded px-1.5 py-0.5">
                            <Clipboard size={12} className="mr-1" />
                            {deal.quotation}
                          </span>
                        )}
                        {deal.follow_up_stage > 0 && (
                          <span className="inline-flex items-center text-xs bg-surface-muted text-fg rounded px-1.5 py-0.5">
                            <Send size={12} className="mr-1" /> Follow-up {deal.follow_up_stage}
                          </span>
                        )}
                        <span className="text-xs text-fg-muted">
                          {daysAgo(deal.modificado_em || deal.criado_em)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
