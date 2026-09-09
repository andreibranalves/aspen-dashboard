// SendHistoryTab — recent WhatsApp delivery records from the PostgreSQL outbox.
// The existing read-only endpoint and send history data shape are preserved.

import { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  AlertTriangle,
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
}: SendHistoryTabProps) {
  const [events, setEvents] = useState<SendEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      (!from || dateValue.slice(0, 10) >= from) &&
      (!to || dateValue.slice(0, 10) <= to)
    );
  });

  if (loading) return <SkeletonComunicacao />;

  return (
    <section
      className="space-y-4"
      aria-label={embedded ? 'Histórico de envios' : undefined}
      aria-labelledby={embedded ? undefined : 'send-history-title'}
    >
      {!embedded && (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="send-history-title" className="text-base font-semibold text-fg">
              Histórico de envios
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Registros recentes de fluxos executados pelo WhatsApp.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {onOpenDeliveries && (
              <Button type="button" variant="outline" size="sm" onClick={onOpenDeliveries}>
                Abrir em Envios
              </Button>
            )}
            <span className="text-xs text-fg-muted">
              {events.length} {events.length === 1 ? 'registro' : 'registros'} exibidos
            </span>
          </div>
        </div>
      )}

      {error && (
        <div
          className="flex items-start gap-3 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-fg"
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
          className="rounded-md border border-dashed border-line bg-surface py-12"
        />
      )}

      {!error &&
        visibleEvents.length > 0 &&
        (embedded ? (
          <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table
              className="w-full min-w-[860px] table-fixed text-left"
              aria-label="Tabela de histórico de envios"
            >
              <thead className="border-b border-line bg-surface-muted text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="w-[13%] px-4 py-3 font-semibold">Envio</th>
                  <th className="w-[15%] px-4 py-3 font-semibold">Fluxo</th>
                  <th className="w-[11%] px-4 py-3 font-semibold">Destino</th>
                  <th className="w-[10%] px-4 py-3 font-semibold">Documento</th>
                  <th className="w-[12%] px-4 py-3 font-semibold">Estado</th>
                  <th className="w-[10%] px-4 py-3 font-semibold">Etapas</th>
                  <th className="w-[15%] whitespace-nowrap px-4 py-3 font-semibold">Atualização</th>
                  <th className="w-[14%] whitespace-nowrap px-4 py-3 font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visibleEvents.map((event) => {
                  const meta = statusMeta(event.status);
                  return (
                    <tr key={event.id} className="align-top hover:bg-surface-hover">
                      <td className="px-4 py-3 font-mono text-xs text-fg">{event.id}</td>
                      <td className="truncate px-4 py-3 text-sm text-fg" title={event.flow_name || undefined}>
                        {event.flow_name || 'Fluxo sem nome'}
                      </td>
                      <td className="px-4 py-3 text-xs text-fg-muted">
                        {fmtPhone(event.phone) || '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-fg-muted">
                        {event.quotation_id || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={meta.badgeStatus} label={meta.label} />
                      </td>
                      <td className="px-4 py-3 text-xs text-fg-muted">
                        {stepsLabel(event) || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-fg-muted">
                        {formatDateTime(event.sent_at || event.created_at) || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {onOpenDelivery && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Detalhes do envio ${event.id}`}
                            onClick={() => onOpenDelivery(event)}
                          >
                            Detalhes
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {events.length === 200 && (
            <p className="text-xs text-fg-muted">Exibindo os 200 registros mais recentes.</p>
          )}
          </>
        ) : (
          <div className="space-y-2" aria-label="Registros de envio">
            {visibleEvents.map((event) => {
              const meta = statusMeta(event.status);
              const Icon = meta.icon;
              const dateValue = event.sent_at || event.created_at;
              const date = formatDateTime(dateValue);
              const phone = fmtPhone(event.phone);
              const steps = stepsLabel(event);
              const quotationId = event.quotation_id;
              return (
                <article
                  key={event.id}
                  className="rounded-md border border-line bg-surface p-3 transition-colors hover:border-primary/30"
                >
                  <div className="flex items-start gap-3">
                    <Icon
                      size={18}
                      className={`mt-0.5 shrink-0 ${meta.iconClassName}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <h3 className="truncate text-sm font-semibold text-fg">
                            {event.flow_name || 'Fluxo sem nome'}
                          </h3>
                          {quotationId && (
                            <button
                              type="button"
                              className="rounded-sm font-mono text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              aria-label={`Abrir orçamento ${quotationId}`}
                              onClick={() => onOpenQuotation(quotationId)}
                            >
                              {quotationId}
                            </button>
                          )}
                        </div>
                        <span
                          className="inline-flex items-center gap-1.5"
                          role="status"
                          aria-label={`Status: ${meta.label}`}
                        >
                          <StatusBadge status={meta.badgeStatus} label={meta.label} />
                        </span>
                      </div>

                      <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                        <div>
                          <dt className="sr-only">Telefone</dt>
                          <dd>{phone || '—'}</dd>
                        </div>
                        {steps && (
                          <div>
                            <dt className="sr-only">Etapas</dt>
                            <dd>{steps}</dd>
                          </div>
                        )}
                        <div className="inline-flex items-center gap-1">
                          <dt className="sr-only">Data</dt>
                          <dd className="inline-flex items-center gap-1">
                            <Clock size={12} aria-hidden="true" />
                            {date && dateValue ? <time dateTime={dateValue}>{date}</time> : '—'}
                          </dd>
                        </div>
                      </dl>

                      {event.duplicate_warning && (
                        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-warning">
                          <AlertTriangle size={14} aria-hidden="true" /> Possível duplicidade
                          detectada neste envio.
                        </p>
                      )}
                      {event.error_message && (
                        <p className="mt-2 text-xs text-destructive">{event.error_message}</p>
                      )}
                      {onOpenDelivery && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => onOpenDelivery(event)}
                        >
                          Detalhes do envio
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ))}
    </section>
  );
}
