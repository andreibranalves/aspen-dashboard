// ChannelsTab — Evolution API configuration display.
// The channel is read-only here; transport configuration remains in the environment.

import { useEffect, useState } from 'react';
import { ChevronDown, Info, KeyRound, MessageCircle, Server, ShieldCheck } from 'lucide-react';
import { StatusBadge } from '@/components/ui/badge';
import {
  fetchDeliveryDiagnostics,
  type DeliveryDiagnostics,
} from '@/lib/api/whatsappDeliveryDiagnosticsApi';
import { formatDateTime } from '@/lib/formatting/formatters';

const CONFIGURATION_ITEMS = [
  { name: 'EVOLUTION_BASE_URL', description: 'URL base da Evolution API', icon: Server },
  { name: 'EVOLUTION_API_KEY', description: 'Chave de autenticação', icon: KeyRound },
  { name: 'EVOLUTION_INSTANCE', description: 'Nome da instância', icon: MessageCircle },
  {
    name: 'BLOB_READ_WRITE_TOKEN',
    description: 'Token usado pela biblioteca de mídias',
    icon: ShieldCheck,
  },
] as const;

export default function ChannelsTab() {
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DeliveryDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState(false);

  useEffect(() => {
    let active = true;
    fetchDeliveryDiagnostics()
      .then((result) => {
        if (active) setDiagnostics(result);
      })
      .catch(() => {
        if (active) setDiagnosticsError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section
      className="rounded-lg border border-line bg-surface p-4 sm:p-6"
      aria-labelledby="channels-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <MessageCircle size={20} className="text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id="channels-title" className="text-base font-semibold text-fg">
              WhatsApp
            </h2>
            <p className="mt-1 text-sm text-fg-muted">Somente leitura</p>
          </div>
        </div>
        <StatusBadge status="Draft" label="Somente leitura" />
      </div>

      <div className="mt-4 border-t border-line pt-4" role="status">
        <p className="text-sm font-medium text-fg">Estado não consultado</p>
        <p className="mt-1 text-sm text-fg-muted">
          O painel não consulta a conexão nem altera a configuração do canal.
        </p>
      </div>

      <div className="mt-4 border-t border-line pt-4" aria-label="Entregas do WhatsApp">
        <p className="text-sm font-medium text-fg">Entregas do WhatsApp</p>
        {diagnosticsError ? (
          <p className="mt-1 text-sm text-fg-muted">
            Não foi possível ler o diagnóstico das entregas.
          </p>
        ) : !diagnostics ? (
          <p className="mt-1 text-sm text-fg-muted">Consultando…</p>
        ) : (
          <dl className="mt-2 space-y-1 text-sm text-fg-muted">
            <div className="flex flex-wrap gap-x-2">
              <dt>Última execução do worker:</dt>
              <dd>
                {diagnostics.worker?.lastRunAt
                  ? diagnostics.worker.result === 'failure'
                    ? `${formatDateTime(diagnostics.worker.lastRunAt)} (falha)`
                    : `${formatDateTime(diagnostics.worker.lastRunAt)} (${diagnostics.worker.processed} etapa(s) processada(s)${
                        diagnostics.worker.remaining ? ', fila restante' : ''
                      })`
                  : 'nenhuma execução registrada'}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt>Etapas em reconciliação:</dt>
              <dd>{diagnostics.reconcilingSteps}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt>Recibos sem correlação:</dt>
              <dd>{diagnostics.pendingReceipts}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <button
          type="button"
          aria-expanded={technicalDetailsOpen}
          onClick={() => setTechnicalDetailsOpen((open) => !open)}
          className="flex min-h-9 items-center gap-1.5 rounded-sm text-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
        >
          Detalhes técnicos
          <ChevronDown
            size={15}
            className={technicalDetailsOpen ? 'rotate-180' : ''}
            aria-hidden="true"
          />
        </button>
        {technicalDetailsOpen && (
          <div className="mt-3 space-y-3" aria-label="Detalhes técnicos">
            <div className="flex items-start gap-2 text-xs text-fg-muted">
              <Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>Nomes de configuração usados pelo transporte. Os valores permanecem ocultos.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {CONFIGURATION_ITEMS.map(({ name, description, icon: Icon }) => (
                <div
                  key={name}
                  className="flex min-w-0 items-start gap-3 rounded-sm border border-line bg-surface-muted/40 px-3 py-2.5"
                >
                  <Icon size={15} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="break-all font-mono text-xs font-medium text-fg">{name}</p>
                    <p className="mt-0.5 text-xs text-fg-muted">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
