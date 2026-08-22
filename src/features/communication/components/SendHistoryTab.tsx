// SendHistoryTab — displays recent WhatsApp send events from KV.
// Fetches from GET /api/communication-send-events.
// Shows quotation_id, phone, flow name, status, steps count, timestamp.

import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Clock, Loader2 } from 'lucide-react';
import SkeletonComunicacao from '@/features/communication/components/SkeletonComunicacao';

interface SendEvent {
  id: string;
  status: 'sent' | 'failed' | 'skipped' | 'pending';
  flow_name?: string;
  quotation_id?: string;
  phone?: string;
  steps_sent?: number;
  steps_planned?: number;
  sent_at?: string;
  duplicate_warning?: boolean;
  error_message?: string;
}

export default function SendHistoryTab() {
  const [events, setEvents] = useState<SendEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/communication-send-events?limit=50');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Erro ${res.status}`);
        }
        const data = await res.json();
        setEvents(data.items || []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <SkeletonComunicacao />;
  }

  if (error) {
    return (
      <p className="text-sm text-destructive p-3 rounded-lg bg-destructive/10">{error}</p>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-fg-muted">
        <Clock size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">Nenhum envio registrado ainda.</p>
        <p className="text-xs mt-1">
          O histórico de envios aparecerá aqui após o primeiro envio de fluxo WhatsApp.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((evt) => (
        <div
          key={evt.id}
          className="flex items-start gap-3 p-3 rounded-lg border border-line bg-surface hover:border-primary/20 transition-colors"
        >
          <div className="shrink-0 mt-0.5">
            {evt.status === 'sent' && (
              <span role="img" title="Entregue" aria-label="Entregue" className="inline-flex">
                <CheckCircle size={16} className="text-success" aria-hidden="true" />
              </span>
            )}
            {evt.status === 'failed' && (
              <span role="img" title="Falhou" aria-label="Falhou" className="inline-flex">
                <XCircle size={16} className="text-destructive" aria-hidden="true" />
              </span>
            )}
            {evt.status === 'skipped' && (
              <span role="img" title="Pendente" aria-label="Pendente" className="inline-flex">
                <Clock size={16} className="text-fg-muted" aria-hidden="true" />
              </span>
            )}
            {evt.status === 'pending' && (
              <span
                role="img"
                title="Processando"
                aria-label="Processando"
                className="inline-flex"
              >
                <Loader2 size={16} className="text-warning animate-spin" aria-hidden="true" />
              </span>
            )}
            {evt.duplicate_warning && (
              <AlertTriangle
                size={16}
                className="text-warning"
                aria-label="Envio duplicado detectado"
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-fg truncate">
                {evt.flow_name || 'Fluxo'}
              </p>
              {evt.quotation_id && (
                <span className="text-xs text-fg-muted font-mono">{evt.quotation_id}</span>
              )}
              {evt.duplicate_warning && (
                <span className="tone-warning-soft inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                  Duplicado
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-fg-muted mt-1">
              <span>{evt.phone}</span>
              <span>·</span>
              <span>
                {evt.steps_sent}/{evt.steps_planned} etapas
              </span>
              {evt.sent_at && (
                <>
                  <span>·</span>
                  <span>{new Date(evt.sent_at).toLocaleString('pt-BR')}</span>
                </>
              )}
            </div>
            {evt.error_message && <p className="text-xs text-destructive mt-1">{evt.error_message}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
