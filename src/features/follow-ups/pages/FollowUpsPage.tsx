import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import {
  listFollowUps,
  type FollowUpListView,
  type FollowUpPage,
  type FollowUpView,
} from '@/lib/api/followUpApi';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import FollowUpReviewDrawer from '@/features/follow-ups/components/FollowUpReviewDrawer';

const PAGE_SIZE = 25;
const TABS: Array<{ view: FollowUpListView; label: string }> = [
  { view: 'ready', label: 'Prontos' },
  { view: 'waiting', label: 'Aguardando 24h' },
  { view: 'sent', label: 'Enviados' },
  { view: 'dismissed', label: 'Dispensados' },
  { view: 'attention', label: 'Atenção' },
];

const STATE_LABELS: Record<string, string> = {
  ready: 'Pronto',
  waiting: 'Aguardando 24h',
  approved: 'Aprovado',
  processing: 'Processando',
  sent: 'Enviado',
  cancelled: 'Cancelado',
  dismissed: 'Dispensado',
  needs_review: 'Atenção',
  failed: 'Falhou',
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Data indisponível'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function toneForState(value: string): string {
  if (value === 'ready' || value === 'sent' || value === 'approved') return 'tone-success-soft';
  if (value === 'waiting' || value === 'processing') return 'tone-warning-soft';
  if (value === 'failed' || value === 'needs_review') return 'tone-destructive-soft';
  return 'tone-neutral-muted';
}

function formatAmount(value: string): string {
  return value.startsWith('R$') ? value : `R$ ${value}`;
}

export default function FollowUpsPage() {
  const [view, setView] = useState<FollowUpListView>('ready');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<FollowUpPage | null>(null);
  const [selected, setSelected] = useState<FollowUpView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await listFollowUps({ view, page, pageSize: PAGE_SIZE }));
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os follow-ups.');
    } finally {
      setLoading(false);
    }
  }, [page, view]);

  useEffect(() => {
    void load();
  }, [load]);

  function changeView(nextView: FollowUpListView) {
    setView(nextView);
    setPage(1);
    setSelected(null);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const rows = result?.data || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-ups"
        actions={
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw aria-hidden="true" className={loading ? 'animate-spin' : undefined} />
            Atualizar
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1 border-b border-line" role="tablist" aria-label="Filtrar follow-ups">
        {TABS.map((tab) => (
          <button
            key={tab.view}
            type="button"
            role="tab"
            aria-selected={view === tab.view}
            className={
              view === tab.view
                ? 'border-b-2 border-primary px-3 py-2 text-sm font-semibold text-primary'
                : 'border-b-2 border-transparent px-3 py-2 text-sm text-fg-muted hover:text-fg'
            }
            onClick={() => changeView(tab.view)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => void load()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={5} cols={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="Nenhum follow-up"
          description="Não há itens nesta fila."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Orçamento</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Recibo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((item) => (
              <TableRow key={`${item.quotationId}-${item.followUpId || item.eligibilityVersion}`}>
                <TableCell className="font-medium">{item.businessNumber}</TableCell>
                <TableCell>{item.clientName}</TableCell>
                <TableCell>{formatAmount(item.amount)}</TableCell>
                <TableCell>{formatDate(item.firstProviderReceiptAt)}</TableCell>
                <TableCell>
                  <StatusBadge
                    status={item.state}
                    label={STATE_LABELS[item.state] || item.state}
                    className={toneForState(item.state)}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelected(item)}>
                    Revisar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {!loading && result && result.total > result.pageSize && (
        <div className="flex items-center justify-between text-sm text-fg-muted">
          <span>Página {result.page} de {totalPages}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => current - 1)} disabled={page <= 1} aria-label="Página anterior">
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => current + 1)} disabled={page >= totalPages} aria-label="Próxima página">
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      <FollowUpReviewDrawer followUp={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />
    </div>
  );
}
