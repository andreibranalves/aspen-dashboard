import { useEffect, useState } from 'react';
import { ChevronDown, Info, Mail, MessageCircle } from 'lucide-react';
import {
  fetchDeliveryDiagnostics,
  type DeliveryDiagnostics,
} from '@/lib/api/whatsappDeliveryDiagnosticsApi';
import { formatDateTime } from '@/lib/formatting/formatters';
import { Heading } from '@/components/ui/heading';
import DeliveryAlarm from '@/components/shared/DeliveryAlarm';


function messageSweepSummary(sweep: DeliveryDiagnostics['messageSweep']): string {
  if (!sweep?.lastRunAt) return 'Varredura de respostas: nenhuma registrada.';
  const when = formatDateTime(sweep.lastRunAt);
  if (sweep.result === 'failure') return `Varredura de respostas em ${when}: falhou.`;
  return `Varredura de respostas em ${when}: ${sweep.dispatched} despachadas, ${sweep.requeued} reenfileiradas, ${sweep.toReview} para revisão.`;
}

export default function ChannelsTab() {
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
    <section aria-label="Canais de comunicação" className="space-y-6">
      <DeliveryAlarm diagnostics={diagnostics} failed={diagnosticsError} />
      <div className="grid gap-5 lg:grid-cols-2">
        <article className="rounded-card bg-surface p-5">
          <Heading level="section">WhatsApp operacional</Heading>
          <div className="mt-5 flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-raised text-primary"><MessageCircle size={20} aria-hidden="true" /></span>
            <div>
              <p className="pt-1 text-xs text-fg-muted">Conexão operacional usada pelos fluxos e envios.</p>
              <span className="mt-3 inline-flex rounded-control bg-raised px-2 py-1 text-2xs text-fg-muted">Estado não consultado</span>
            </div>
          </div>
          <dl className="mt-7 text-xs">
            <div className="flex justify-between gap-4 border-b border-line py-3"><dt className="text-fg-muted">Credenciais</dt><dd>Fora do painel</dd></div>
            <div className="flex justify-between gap-4 border-b border-line py-3"><dt className="text-fg-muted">Verificação</dt><dd>Não executada</dd></div>
          </dl>
          <details className="mt-4 text-xs text-fg-muted">
            <summary className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-control border border-line px-3 text-fg"><Info size={14} aria-hidden="true" /> Ver orientação <ChevronDown size={14} aria-hidden="true" /></summary>
            <div className="mt-3 space-y-2 leading-relaxed">
              <p>A configuração da Evolution API é mantida fora deste painel. O estado da conexão não é verificado aqui.</p>
              <p>{diagnosticsError ? 'Não foi possível ler o diagnóstico das entregas.' : !diagnostics ? 'Consultando entregas…' : `Última execução: ${diagnostics.worker?.lastRunAt ? formatDateTime(diagnostics.worker.lastRunAt) : 'nenhuma registrada'}. Etapas em reconciliação: ${diagnostics.reconcilingSteps}. Recibos sem correlação: ${diagnostics.pendingReceipts}.`}</p>
              {diagnostics && !diagnosticsError && <p>{messageSweepSummary(diagnostics.messageSweep)}</p>}
            </div>
          </details>
        </article>

        <article className="rounded-card bg-surface p-5">
          <Heading level="section">E-mail de propostas</Heading>
          <div className="mt-5 flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-raised text-primary"><Mail size={20} aria-hidden="true" /></span>
            <div>
              <p className="pt-1 text-xs text-fg-muted">Canal usado no envio contextual dos orçamentos.</p>
              <span className="mt-3 inline-flex rounded-control bg-raised px-2 py-1 text-2xs text-fg-muted">Estado não consultado</span>
            </div>
          </div>
          <dl className="mt-7 text-xs">
            <div className="flex justify-between gap-4 border-b border-line py-3"><dt className="text-fg-muted">Credenciais</dt><dd>Fora do painel</dd></div>
            <div className="flex justify-between gap-4 border-b border-line py-3"><dt className="text-fg-muted">Verificação</dt><dd>Não executada</dd></div>
          </dl>
          <details className="mt-4 text-xs text-fg-muted">
            <summary className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-control border border-line px-3 text-fg"><Info size={14} aria-hidden="true" /> Ver orientação <ChevronDown size={14} aria-hidden="true" /></summary>
            <p className="mt-3 leading-relaxed">A configuração de e-mail é mantida fora deste painel. O estado do canal não é verificado aqui.</p>
          </details>
        </article>
      </div>
      <p className="rounded-control border border-line bg-surface px-4 py-3 text-xs text-fg-muted"><Info size={14} className="mr-2 inline align-text-bottom" aria-hidden="true" />Credenciais e chaves permanecem fora do painel. Nenhum valor sensível é exibido aqui.</p>
    </section>
  );
}
