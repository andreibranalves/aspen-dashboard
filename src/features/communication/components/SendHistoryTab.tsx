// SendHistoryTab — recent WhatsApp delivery records from the PostgreSQL outbox.
// The existing read-only endpoint and send history data shape are preserved.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  MinusCircle,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import EmptyState from '@/components/shared/EmptyState';
import SkeletonComunicacao from '@/features/communication/components/SkeletonComunicacao';
import { fmtPhone, formatDateTime } from '@/lib/formatting/formatters';
import EntityIdentity from '@/components/shared/EntityIdentity';

type SendStatus = 'sent' | 'failed' | 'skipped' | 'pending';

export interface SendEvent {
  id: string;
  status: SendStatus;
  flow_name?: string | null;
  quotation_id?: string | null;
  phone?: string | null;
  steps_sent?: number;
  steps_planned?: number;
  sent_at?: string | null;
  created_at?: string | null;
  duplicate_warning?: boolean;
  error_message?: string | null;
}

const STATUS_META: Record<
  SendStatus,
  {
    label: string;
    badgeStatus: string;
    icon: typeof CheckCircle2;
    iconClassName: string;
  }
> = {
  sent: {
    label: 'Entregue',
    badgeStatus: 'Issued',
    icon: CheckCircle2,
    iconClassName: 'text-success',
  },
  failed: {
    label: 'Falhou',
    badgeStatus: 'Lost',
    icon: AlertCircle,
    iconClassName: 'text-destructive',
  },
  skipped: {
    label: 'Ignorado',
    badgeStatus: 'Expired',
    icon: MinusCircle,
    iconClassName: 'text-fg-muted',
  },
  pending: {
    label: 'Pendente',
    badgeStatus: 'Replied',
    icon: Loader2,
    iconClassName: 'text-warning animate-spin',
  },
};

function errorMessage(_error: unknown, fallback: string): string {
  return fallback;
}

const SEND_STATUSES = new Set<SendStatus>(['sent', 'failed', 'skipped', 'pending']);

function parseSendEvents(value: unknown): SendEvent[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) {
    throw new Error('Resposta inválida.');
  }
  return (value as { items: unknown[] }).items.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Resposta inválida.');
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string' ||
      !candidate.id.trim() ||
      typeof candidate.status !== 'string' ||
      !SEND_STATUSES.has(candidate.status as SendStatus)
    ) {
      throw new Error('Resposta inválida.');
    }
    for (const key of ['flow_name', 'quotation_id', 'phone', 'sent_at', 'created_at', 'error_message']) {
      if (
        candidate[key] !== undefined &&
        candidate[key] !== null &&
        typeof candidate[key] !== 'string'
      ) {
        throw new Error('Resposta inválida.');
      }
    }
    for (const key of ['steps_sent', 'steps_planned']) {
      if (
        candidate[key] !== undefined &&
        (typeof candidate[key] !== 'number' || !Number.isFinite(candidate[key]))
      ) {
        throw new Error('Resposta inválida.');
      }
    }
    if (
      candidate.duplicate_warning !== undefined &&
      typeof candidate.duplicate_warning !== 'boolean'
    ) {
      throw new Error('Resposta inválida.');
    }
    return candidate as unknown as SendEvent;
  });
}

interface SendHistoryTabProps {
  onOpenQuotation: (quotationId: string) => void;
  embedded?: boolean;
  filters?: {
    status?: 'all' | 'sent' | 'pending' | 'failed';
    search?: string;
    from?: string;
    to?: string;
  };
  onOpenDelivery?: (event: SendEvent) => void;
  refreshKey?: number;
  onOpenDeliveries?: () => void;
  autoInspectId?: string | null;
}

function statusMeta(status: string) {
  return (
    STATUS_META[status as SendStatus] || {
      label: status || 'Status não informado',
      badgeStatus: 'Draft',
      icon: Clock,
      iconClassName: 'text-fg-muted',
    }
  );
}

function stepsLabel(event: SendEvent): string | null {
  if (
    typeof event.steps_sent !== 'number' ||
    typeof event.steps_planned !== 'number' ||
    !Number.isFinite(event.steps_sent) ||
    !Number.isFinite(event.steps_planned)
  )
    return null;
  return `${event.steps_sent}/${event.steps_planned} etapas`;
}

export default function SendHistoryTab({
  onOpenQuotation,
  embedded = false,
  filters,
  onOpenDelivery,
  refreshKey = 0,
  onOpenDeliveries,
  autoInspectId,
}: SendHistoryTabProps) {
  const [events, setEvents] = useState<SendEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [localSearch, setLocalSearch] = useState('');
  const [localStatus, setLocalStatus] = useState('all');
  const inspectedIdRef = useRef<string | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
      const response = await fetch(`/api/communication-send-events?${params}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${response.status}`);
      }
      setEvents(parseSendEvents(await response.json()));
    } catch (loadError) {
      setError(errorMessage(loadError, 'Não foi possível carregar o histórico de envios.'));
    } finally {
      setLoading(false);
    }
  }, [filters?.status, refreshKey]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!autoInspectId || !onOpenDelivery || loading || inspectedIdRef.current === autoInspectId) return;
    const event = events.find((item) => item.id === autoInspectId);
    if (event) {
      inspectedIdRef.current = autoInspectId;
      onOpenDelivery(event);
    }
  }, [autoInspectId, events, loading, onOpenDelivery]);

  const search = filters?.search?.trim().toLocaleLowerCase() || '';
  const from = filters?.from || '';
  const to = filters?.to || '';
  const visibleEvents = events.filter((event) => {
    const haystack = [
      event.id,
      event.flow_name,
      event.quotation_id,
      event.phone,
      fmtPhone(event.phone),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
    const dateValue = event.sent_at || event.created_at || '';
    return (
      (!search || haystack.includes(search)) &&
      (!localSearch.trim() || haystack.includes(localSearch.trim().toLocaleLowerCase('pt-BR'))) &&
      (localStatus === 'all' || event.status === localStatus) &&
      (!from || dateValue.slice(0, 10) >= from) &&
      (!to || dateValue.slice(0, 10) <= to)
    );
  });

  if (loading) return <SkeletonComunicacao variant="list" />;

  return (
    <section
      className="space-y-4"
      aria-label={embedded ? 'Histórico de envios' : undefined}
      aria-labelledby={embedded ? undefined : 'send-history-title'}
    >
      {!embedded && (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="send-history-title" className="text-sm text-fg-muted">
              Registro de tentativas e resultados de comunicação.
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {onOpenDeliveries && (
              <Button type="button" variant="outline" size="sm" onClick={onOpenDeliveries}>
                Abrir em Envios
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div
          className="flex items-start gap-3 rounded-control border border-destructive/25 bg-destructive/5 p-3 text-sm text-fg"
          role="alert"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">Não foi possível carregar o histórico.</p>
            <p className="mt-1 text-fg-muted">{error}</p>
            <Button className="mt-3" variant="outline" size="sm" onClick={() => void loadEvents()}>
              <RefreshCw size={14} aria-hidden="true" /> Tentar novamente
            </Button>
          </div>
        </div>
      )}

      {!error && !embedded && <div className="flex flex-wrap gap-2 rounded-t-card bg-surface px-5 pt-5">
        <input aria-label="Buscar cliente ou orçamento" placeholder="Buscar cliente ou orçamento" value={localSearch} onChange={(event) => setLocalSearch(event.target.value)} className="h-10 w-52 rounded-control border border-border-control bg-raised px-3 text-xs text-fg" />
        <select aria-label="Filtrar histórico por status" value={localStatus} onChange={(event) => setLocalStatus(event.target.value)} className="h-10 rounded-control border border-border-control bg-raised px-3 text-xs text-fg"><option value="all">Todos os status</option><option value="sent">Enviado</option><option value="pending">Pendente</option><option value="failed">Falhou</option><option value="skipped">Ignorado</option></select>
      </div>}

      {!error && visibleEvents.length === 0 && (
        <EmptyState
          icon={Clock}
          title={
            events.length === 0
              ? 'Nenhum envio registrado ainda.'
              : 'Nenhum envio corresponde aos filtros.'
          }
          description={
            events.length === 0
              ? 'O histórico aparecerá aqui após o primeiro envio de um fluxo WhatsApp.'
              : undefined
          }
          className="rounded-control border border-dashed border-line bg-surface py-12"
        />
      )}

      {!error && visibleEvents.length > 0 && (
        <div className={embedded ? 'overflow-x-auto rounded-card bg-surface px-5 pb-5' : 'overflow-x-auto rounded-b-card bg-surface px-5 pb-5'}>
          <table className="w-full min-w-[720px] table-fixed text-left text-xs" aria-label="Histórico de envios">
            <thead className="border-b border-line text-[10px] text-fg-muted"><tr><th className="w-[25%] px-3 py-3 font-medium">Orçamento / fluxo</th><th className="w-[20%] px-3 py-3 font-medium">Etapa / progresso</th><th className="w-[18%] px-3 py-3 font-medium">Situação</th><th className="w-[20%] px-3 py-3 font-medium">Último evento</th><th className="w-[17%] px-3 py-3 font-medium"><span className="sr-only">Inspecionar</span></th></tr></thead>
            <tbody className="divide-y divide-line">
              {visibleEvents.map((event) => {
                const meta = statusMeta(event.status);
                return <tr key={event.id} className="align-middle hover:bg-surface-hover">
                  <td className="px-3 py-4"><EntityIdentity name={event.flow_name || 'Fluxo sem nome'} secondary={event.quotation_id ? <button type="button" className="text-left hover:underline" onClick={() => onOpenQuotation(event.quotation_id!)}>{event.quotation_id}</button> : undefined} /></td>
                  <td className="px-3 py-4"><span className="block font-medium">WhatsApp</span><span className="mt-1 block text-fg-muted">{stepsLabel(event) || '—'}</span></td>
                  <td className="px-3 py-4"><StatusBadge status={meta.badgeStatus} label={meta.label} />{event.duplicate_warning && <span className="mt-1 block text-warning">Possível duplicidade</span>}{event.error_message && <span className="mt-1 block text-destructive">{event.error_message}</span>}</td>
                  <td className="px-3 py-4 text-fg-muted">{formatDateTime(event.sent_at || event.created_at) || '—'}</td>
                  <td className="px-3 py-4 text-right">{onOpenDelivery && <Button type="button" variant="outline" size="sm" aria-label={`Inspecionar envio ${event.id}`} onClick={() => onOpenDelivery(event)}>Inspecionar</Button>}</td>
                </tr>;
              })}
            </tbody>
          </table>
          {events.length === 200 && <p className="mt-3 text-xs text-fg-muted">Exibindo os 200 registros mais recentes.</p>}
        </div>
      )}
    </section>
  );
}
