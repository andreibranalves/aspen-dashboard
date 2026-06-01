// src/components/WhatsAppSendPanel.jsx
// WhatsApp flow selector + send button for quotation result cards.
// Extracted from AutoQuotePage.jsx.

import { Phone } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.jsx';
import { flowToSequencePayload, getFlowSummary } from '@/lib/whatsappFlows.js';

export default function WhatsAppSendPanel({
  selectedFlowId,
  flows = [],
  status,
  onSelectFlow,
  onSend,
}) {
  const selectedFlow = flows.find(f => f.id === selectedFlowId) || flows[0];
  const sequence = selectedFlow ? flowToSequencePayload(selectedFlow) : null;
  const hasValidSteps = sequence && sequence.steps.length > 0;

  return (
    <>
      <div className="space-y-1 mb-3 mt-4">
        <label className="text-xs font-medium text-framer-ink-muted">Fluxo de WhatsApp</label>
        <select
          className="w-full rounded-[12px] border border-framer-hairline bg-card px-3 py-2 text-sm text-framer-ink"
          value={selectedFlowId}
          onChange={e => onSelectFlow(e.target.value)}
        >
          {flows.map(flow => (
            <option key={flow.id} value={flow.id}>{flow.name}</option>
          ))}
        </select>
        {selectedFlow && (
          <span className="block text-xs leading-5 text-framer-ink-muted">
            {getFlowSummary(selectedFlow)}
          </span>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {hasValidSteps ? (
          <>
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={status?.state === 'sending'}
              onClick={onSend}
            >
              <Phone size={16} />
              {status?.state === 'sent'
                ? 'Enviado pelo WhatsApp'
                : status?.state === 'sending'
                  ? 'Enviando…'
                  : 'Enviar via WhatsApp'}
            </Button>
            {status?.message && (
              <p className={cn(
                'text-xs leading-5 text-center',
                status.state === 'error' ? 'text-red-500' : 'text-framer-ink-muted'
              )}>
                {status.message}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
            {!selectedFlow
              ? 'Nenhum fluxo de WhatsApp selecionado. Configure um fluxo em Configurações.'
              : 'Este fluxo não tem etapas válidas. Configure pelo menos uma mensagem ou mídia em Configurações.'}
          </p>
        )}
      </div>
    </>
  );
}
