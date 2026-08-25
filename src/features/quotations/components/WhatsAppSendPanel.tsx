// src/components/WhatsAppSendPanel.tsx
// WhatsApp flow selector + send button for quotation result cards.
// Extracted from AutoQuotePage.jsx.

import { useId } from 'react';
import { Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { flowToSequencePayload, getFlowSummary, normalizeFlow } from '@/lib/api/whatsappFlows';
import type { Flow } from '@/lib/api/whatsappFlows';
import type { CommunicationFlow } from '@/lib/api/communicationApi';
import { projectDelivery, type DeliveryView } from '@/lib/api/quotationDeliveryApi';

export interface WhatsAppSendPanelProps {
  selectedFlowId?: string;
  flows?: CommunicationFlow[];
  delivery?: DeliveryView | null;
  pending?: boolean;
  /** @deprecated Use delivery and pending. Kept for the legacy quotation surface during migration. */
  status?: {
    state?:
      | 'sending'
      | 'sent'
      | 'error'
      | 'reconciling'
      | 'accepted-partial'
      | 'accepted'
      | 'retryable'
      | 'readonly';
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
  delivery = null,
  pending = false,
  status,
  onSelectFlow,
  onSend,
  hideButton = false,
}: WhatsAppSendPanelProps) {
  const flowSelectId = useId();
  const selectedFlow = flows.length > 0
    ? normalizeFlow(
        (flows.find((f) => f.id === selectedFlowId) || flows[0]) as unknown as Partial<Flow>
      )
    : null;
  const sequence = selectedFlow ? flowToSequencePayload(selectedFlow) : null;
  const hasValidSteps = sequence && sequence.steps.length > 0;
  const deliveryProjection = delivery ? projectDelivery(delivery) : null;
  const isPending = pending || status?.state === 'sending';
  const deliveryBlocksSend = Boolean(delivery);

  return (
    <>
      <div className="mb-3 mt-4 space-y-1" aria-busy={isPending}>
        <label htmlFor={flowSelectId} className="text-xs font-medium text-fg-muted">
          Fluxo de WhatsApp
        </label>
        <select
          id={flowSelectId}
          aria-label="Fluxo de WhatsApp"
          className="w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
          value={selectedFlowId || ''}
          onChange={(e) => onSelectFlow?.(e.target.value)}
          disabled={flows.length === 0}
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
        {delivery && (
          <p className="text-xs leading-5 text-fg-muted" role="status" aria-live="polite">
            Status da entrega: {deliveryProjection?.label || 'Em processamento'}.
          </p>
        )}
      </div>
      {!hasValidSteps && (
        <p className="mb-2 mt-3 text-xs leading-5 text-warning" role="status">
          {!selectedFlow
            ? 'Nenhum fluxo de WhatsApp disponível.'
            : 'Este fluxo não tem etapas válidas. Configure pelo menos uma mensagem ou mídia em Comunicação.'}
        </p>
      )}
      {!hideButton && (
        <div className="mt-3 space-y-2">
          {hasValidSteps ? (
            <>
              <Button
                type="button"
                size="lg"
                className="w-full"
                title={
                  isPending
                    ? 'Envio em andamento'
                    : deliveryBlocksSend || status?.state === 'accepted'
                      ? 'Este orçamento já foi enviado pelo WhatsApp. Acompanhe o status abaixo.'
                      : undefined
                }
                disabled={
                  isPending ||
                  deliveryBlocksSend ||
                  status?.state === 'reconciling' ||
                  status?.state === 'accepted-partial' ||
                  status?.state === 'accepted' ||
                  status?.state === 'readonly'
                }
                onClick={onSend}
              >
                <Phone size={16} />
                {delivery
                  ? isPending
                    ? 'Enviando…'
                    : deliveryProjection?.label
                  : status?.state === 'sent'
                    ? 'Enviado pelo WhatsApp'
                    : status?.state === 'accepted' || status?.state === 'accepted-partial'
                      ? 'Envio aceito'
                      : status?.state === 'reconciling'
                        ? 'Reconciliação necessária'
                        : status?.state === 'readonly'
                          ? 'Somente leitura'
                          : status?.state === 'sending'
                            ? 'Enviando…'
                            : 'Enviar WhatsApp'}
              </Button>
              {delivery && !isPending && (
                <p className="text-xs leading-5 text-center text-fg-muted">
                  Já enviado. Acompanhe o status{' '}
                  <a href="#/whatsapp-deliveries" className="text-primary hover:underline">
                    em Envios WhatsApp
                  </a>
                  .
                </p>
              )}
              {(status?.message || delivery?.publicError) && (
                <p
                  className={cn(
                    'text-xs leading-5 text-center',
                    status?.state === 'error' ||
                      status?.state === 'retryable' ||
                      delivery?.state === 'failed'
                      ? 'text-destructive'
                      : status?.deliveryAccepted ||
                          status?.state === 'accepted' ||
                          status?.state === 'accepted-partial'
                        ? 'text-warning'
                        : 'text-fg-muted'
                  )}
                >
                  {delivery?.publicError || status?.message}
                </p>
              )}
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
