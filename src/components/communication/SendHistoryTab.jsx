// SendHistoryTab — displays recent WhatsApp send events from KV.
// Fetches from GET /api/communication-send-events.
// Shows quotation_id, phone, flow name, status, steps count, timestamp.

import { useState, useEffect } from 'react';
import { Loader2, CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react';

export default function SendHistoryTab() {
  const [events, setEvents] = useState([]);
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
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-framer-ink-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-500 p-3 rounded-lg bg-red-50 dark:bg-red-900/20">{error}</p>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-framer-ink-muted">
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
          className="flex items-start gap-3 p-3 rounded-lg border border-framer-hairline bg-card hover:border-primary/20 transition-colors"
        >
          <div className="shrink-0 mt-0.5">
            {evt.status === 'sent' && <CheckCircle size={16} className="text-green-500" />}
            {evt.status === 'failed' && <XCircle size={16} className="text-red-500" />}
            {evt.status === 'skipped' && <Clock size={16} className="text-framer-ink-muted" />}
            {evt.status === 'pending' && (
              <Loader2 size={16} className="text-amber-500 animate-spin" />
            )}
            {evt.duplicate_warning && (
              <AlertTriangle
                size={16}
                className="text-amber-500"
                title="Envio duplicado detectado"
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-framer-ink truncate">
                {evt.flow_name || 'Fluxo'}
              </p>
              {evt.quotation_id && (
                <span className="text-xs text-framer-ink-muted font-mono">{evt.quotation_id}</span>
              )}
              {evt.duplicate_warning && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                  Duplicado
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-framer-ink-muted mt-1">
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
            {evt.error_message && <p className="text-xs text-red-500 mt-1">{evt.error_message}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
