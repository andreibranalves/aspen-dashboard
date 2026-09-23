// src/components/WhatsAppSendPanel.tsx
// WhatsApp flow selector + send button for quotation result cards.
// Extracted from AutoQuotePage.jsx.

import { useId } from 'react';
import { Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { CommunicationFlow } from '@/lib/api/communicationApi';
import { isQuotationDeliveryFlow, renderableFlowStepCount } from '@/lib/api/communicationApi';
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
  selectionDisabled?: boolean;
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
  selectionDisabled = false,
}: WhatsAppSendPanelProps) {
  const flowSelectId = useId();
  const selectedFlow = flows.length > 0
    ? flows.find((f) => f.id === selectedFlowId) || flows[0]
    : null;
  const hasValidSteps = isQuotationDeliveryFlow(selectedFlow)
    && renderableFlowStepCount(selectedFlow) > 0;
  const deliveryProjection = delivery ? projectDelivery(delivery) : null;
  const isPending = pending || status?.state === 'sending';
  // A durable delivery always blocks a blind re-send: the request would reuse the
  // same revision/flow and could re-dispatch steps whose outcome is unknown. What
  // each state changes is the reason shown and which explicit action the status
  // component offers (resolution, or the same-revision retry).
  const deliveryBlocksSend = deliveryProjection !== null;
  const legacyStatusMessage =
    status?.state === 'error'
      ? 'Não foi possível enviar pelo WhatsApp. Tente novamente.'
      : status?.state === 'retryable'
        ? 'O envio pode ser tentado novamente.'
        : null;

  return (
    <>
      <div className="mb-3 mt-4 space-y-1" aria-busy={isPending}>
        <label htmlFor={flowSelectId} className="text-xs font-medium text-fg-muted">
          Fluxo WhatsApp
        </label>
        <select
          id={flowSelectId}
          aria-label="Fluxo WhatsApp"
          className="w-full rounded-control border border-border-control bg-raised px-3 py-2 text-sm text-fg"
          value={selectedFlowId || ''}
          onChange={(e) => onSelectFlow?.(e.target.value)}
          disabled={flows.length === 0 || selectionDisabled}
        >
          {flows.map((flow) => (
            <option key={flow.id} value={flow.id}>
              {flow.name}
            </option>
          ))}
        </select>
      </div>
      {!hasValidSteps && (
        <p className="mb-2 mt-3 text-xs leading-5 text-warning" role="status">
          {!selectedFlow
            ? 'Nenhum fluxo de WhatsApp disponível.'
            : 'Este fluxo precisa estar ativo e conter exatamente um PDF ou WebP do orçamento.'}
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
                    : deliveryProjection
                      ? deliveryProjection.sendBlockedReason
                      : status?.state === 'accepted'
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
                  {deliveryProjection?.sendConfirmed
                    ? 'Já enviado. Acompanhe o status'
                    : 'Nenhuma mensagem foi confirmada ainda. Acompanhe o status'}{' '}
                  <a href="#/whatsapp-deliveries" className="text-primary hover:underline">
                    em Envios WhatsApp
                  </a>
                  .
                </p>
              )}
              {(legacyStatusMessage || delivery?.publicError) && (
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
                  {delivery?.publicError || legacyStatusMessage}
                </p>
              )}
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
