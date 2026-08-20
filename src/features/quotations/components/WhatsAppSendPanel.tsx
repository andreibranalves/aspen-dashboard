// src/components/WhatsAppSendPanel.tsx
// WhatsApp flow selector + send button for quotation result cards.
// Extracted from AutoQuotePage.jsx.

import { Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { flowToSequencePayload, getFlowSummary, normalizeFlow } from '@/lib/api/whatsappFlows';
import type { Flow } from '@/lib/api/whatsappFlows';
import type { CommunicationFlow } from '@/lib/api/communicationApi';

export interface WhatsAppSendPanelProps {
  selectedFlowId?: string;
  flows?: CommunicationFlow[];
  status?: {
    state?: 'sending' | 'sent' | 'error' | 'reconciling' | 'accepted-partial' | 'accepted' | 'retryable' | 'readonly';
    message?: string;
    deliveryAccepted?: boolean;
  };
  onSelectFlow?: (flowId: string) => void;
  onSend?: () => void;
  hideButton?: boolean;
}

export default function WhatsAppSendPanel({
  selectedFlowId,
  flows = [],
  status,
  onSelectFlow,
  onSend,
  hideButton = false,
}: WhatsAppSendPanelProps) {
  const selectedFlow = normalizeFlow(((flows.find((f) => f.id === selectedFlowId) || flows[0] || {})) as unknown as Partial<Flow>);
  const sequence = selectedFlow ? flowToSequencePayload(selectedFlow) : null;
  const hasValidSteps = sequence && sequence.steps.length > 0;

  return (
    <>
      <div className="space-y-1 mb-3 mt-4">
        <label className="text-xs font-medium text-fg-muted">Fluxo de WhatsApp</label>
        <select
          className="w-full rounded-[12px] border border-line bg-surface px-3 py-2 text-sm text-fg"
          value={selectedFlowId}
          onChange={(e) => onSelectFlow?.(e.target.value)}
        >
          {flows.map((flow) => (
            <option key={flow.id} value={flow.id}>
              {flow.name}
            </option>
          ))}
        </select>
        {selectedFlow && (
          <span className="block text-xs leading-5 text-fg-muted">
            {getFlowSummary(selectedFlow)}
          </span>
        )}
      </div>
      {!hideButton && (
        <div className="mt-3 space-y-2">
          {hasValidSteps ? (
            <>
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={status?.state === 'sending' || status?.state === 'reconciling' || status?.state === 'accepted-partial' || status?.state === 'accepted' || status?.state === 'readonly'}
                onClick={onSend}
              >
                <Phone size={16} />
                {status?.state === 'sent'
                  ? 'Enviado pelo WhatsApp'
                  : status?.state === 'accepted' || status?.state === 'accepted-partial'
                    ? 'Envio aceito'
                    : status?.state === 'reconciling'
                      ? 'Reconciliação necessária'
                      : status?.state === 'readonly'
                        ? 'Somente leitura'
                        : status?.state === 'sending'
                          ? 'Enviando…'
                          : 'Enviar via WhatsApp'}
              </Button>
              {status?.message && (
                <p
                  className={cn(
                    'text-xs leading-5 text-center',
                    status.state === 'error' || status.state === 'retryable'
                      ? 'text-destructive'
                      : status.deliveryAccepted || status.state === 'accepted' || status.state === 'accepted-partial'
                        ? 'text-warning'
                        : 'text-fg-muted'
                  )}
                >
                  {status.message}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-warning mb-2">
              {!selectedFlow
                ? 'Nenhum fluxo de WhatsApp disponível.'
                : 'Este fluxo não tem etapas válidas. Configure pelo menos uma mensagem ou mídia em Comunicação.'}
            </p>
          )}
        </div>
      )}
    </>
  );
}
