// SendHistoryTab — recent WhatsApp send events from KV.
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

type SendStatus = 'sent' | 'failed' | 'skipped' | 'pending';

interface SendEvent {
  id: string;
  status: SendStatus;
  flow_name?: string;
  quotation_id?: string;
  phone?: string;
  steps_sent?: number;
  steps_planned?: number;
  sent_at?: string;
  created_at?: string;
  duplicate_warning?: boolean;
  error_message?: string;
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
    label: 'Enviado',
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

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
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

export default function SendHistoryTab() {
  const [events, setEvents] = useState<SendEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/communication-send-events?limit=50');
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${response.status}`);
      }
      const data = await response.json();
      setEvents(data.items || []);
    } catch (loadError) {
      setError(errorMessage(loadError, 'Não foi possível carregar o histórico de envios.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  if (loading) return <SkeletonComunicacao />;

  return (
    <section className="space-y-4" aria-labelledby="send-history-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="send-history-title" className="text-base font-semibold text-fg">
            Histórico de envios
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Registros recentes de fluxos executados pelo WhatsApp.
          </p>
        </div>
        <span className="text-xs text-fg-muted">
          {events.length} {events.length === 1 ? 'registro' : 'registros'} exibidos
        </span>
      </div>

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

      {!error && events.length === 0 && (
        <EmptyState
          icon={Clock}
          title="Nenhum envio registrado ainda."
          description="O histórico aparecerá aqui após o primeiro envio de um fluxo WhatsApp."
          className="rounded-md border border-dashed border-line bg-surface py-12"
        />
      )}

      {!error && events.length > 0 && (
        <div className="space-y-2" aria-label="Registros de envio">
          {events.map((event) => {
            const meta = statusMeta(event.status);
            const Icon = meta.icon;
            const dateValue = event.sent_at || event.created_at;
            const date = formatDate(dateValue);
            const steps = stepsLabel(event);
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
                        {event.quotation_id && (
                          <span className="font-mono text-xs text-fg-muted">
                            {event.quotation_id}
                          </span>
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
                      {event.phone && (
                        <div>
                          <dt className="sr-only">Telefone</dt>
                          <dd>{event.phone}</dd>
                        </div>
                      )}
                      {steps && (
                        <div>
                          <dt className="sr-only">Etapas</dt>
                          <dd>{steps}</dd>
                        </div>
                      )}
                      {date && (
                        <div className="inline-flex items-center gap-1">
                          <dt className="sr-only">Data</dt>
                          <dd className="inline-flex items-center gap-1">
                            <Clock size={12} aria-hidden="true" />
                            <time dateTime={dateValue}>{date}</time>
                          </dd>
                        </div>
                      )}
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
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
