import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, ListChecks, RefreshCw } from 'lucide-react';
import EmptyState from '@/components/shared/EmptyState';
import SkeletonTable from '@/components/shared/SkeletonTable';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fmtPhone, formatDateTime } from '@/lib/formatting/formatters';
import {
  listCommercialQueue,
  type CommercialQueueItem,
  type CommercialQueuePage,
} from '@/lib/api/commercialQueueApi';

const PAGE_SIZE = 25;

interface CommercialQueuePanelProps {
  navigate: (hash: string) => void;
}

function contactLabel(item: CommercialQueueItem): string {
  return item.clientName || item.contactName;
}

function contactDetail(item: CommercialQueueItem): string | null {
  return fmtPhone(item.contactPhone) || item.contactEmail;
}

export default function CommercialQueuePanel({ navigate }: CommercialQueuePanelProps) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CommercialQueuePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);

  const load = useCallback(async (requestedPage: number) => {
    const requestGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await listCommercialQueue({ page: requestedPage, pageSize: PAGE_SIZE });
      if (requestGeneration !== requestGenerationRef.current) return;
      setResult(next);
      // The server clamps a page that no longer exists to the last valid one.
      // Adopt it so navigation continues from real remaining work instead of
      // an empty page the operator can no longer leave.
      if (next.page !== requestedPage) setPage(next.page);
    } catch (reason) {
      if (requestGeneration !== requestGenerationRef.current) return;
      setResult(null);
      setError(
        reason instanceof Error ? reason.message : 'Não foi possível carregar a fila comercial.'
      );
    } finally {
      if (requestGeneration === requestGenerationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const rows = result?.data || [];
  const total = result?.total ?? 0;
  // The rendered page is always the one the server actually served.
  const currentPage = result?.page ?? page;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showPagination = !loading && !error && total > PAGE_SIZE;

  function openClient(event: MouseEvent<HTMLAnchorElement>, clientId: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(`/leads/cliente/${encodeURIComponent(clientId)}`);
  }

  function clientName(item: CommercialQueueItem) {
    if (!item.clientId) return <span className="font-medium">{contactLabel(item)}</span>;
    return (
      <a
        href={`#/leads/cliente/${encodeURIComponent(item.clientId)}`}
        className="font-medium text-primary hover:underline"
        onClick={(event) => openClient(event, item.clientId!)}
      >
        {contactLabel(item)}
      </a>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {showPagination && (
          <nav
            aria-label="Paginação da fila"
            className="mr-auto flex items-center gap-2 text-sm text-fg-muted"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={loading || currentPage <= 1}
            >
              <ChevronLeft aria-hidden="true" />
              Anterior
            </Button>
            <span aria-live="polite">
              Página {Math.min(currentPage, lastPage)} de {lastPage}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
              disabled={loading || currentPage >= lastPage}
            >
              Próxima
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load(page)}
          disabled={loading}
        >
          <RefreshCw aria-hidden="true" className={loading ? 'animate-spin' : undefined} />
          Atualizar
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          <span>{error}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => void load(page)}
          >
            Tentar novamente
          </Button>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={5} cols={4} />
      ) : error ? null : rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nenhuma próxima ação"
          description="Leads novos entram aqui com o primeiro atendimento pendente."
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface lg:block">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Contato</TableHead>
                  <TableHead>Demanda</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Prazo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <TableRow key={item.actionId}>
                    <TableCell>
                      {clientName(item)}
                      {contactDetail(item) && (
                        <p className="text-xs text-fg-muted">{contactDetail(item)}</p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-96 truncate text-fg-muted">
                      {item.demandSummary || 'Demanda não informada'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.reasonCode} label={item.reasonLabel} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-fg-muted">
                      {formatDateTime(item.dueAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-3 lg:hidden">
            {rows.map((item) => (
              <article key={item.actionId} className="rounded-md border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate">{clientName(item)}</p>
                    {contactDetail(item) && (
                      <p className="mt-1 text-xs text-fg-muted">{contactDetail(item)}</p>
                    )}
                  </div>
                  <StatusBadge status={item.reasonCode} label={item.reasonLabel} />
                </div>
                <p className="mt-3 text-sm text-fg-muted">
                  {item.demandSummary || 'Demanda não informada'}
                </p>
                <p className="mt-2 text-xs text-fg-muted">{formatDateTime(item.dueAt)}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
