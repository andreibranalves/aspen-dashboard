// src/features/quotations/components/WhatsAppSendPanel.tsx
// Painel de envio WhatsApp: seletor de fluxo + resumo + botão de envio.
// Superfícies: cartão de resultado do Auto (orientation="block") e página de
// detalhe do orçamento (orientation="inline").
//
// `WhatsAppSendConfirm` é a cerimônia compartilhada: eco do destinatário + resumo
// do fluxo + Confirmar/Cancelar. Enviar WhatsApp é a ação mais irreversível do
// produto (mensagem real via Evolution API) e exige confirmação antes de partir —
// tanto no painel (quando `recipient` é informado) quanto no botão próprio do
// cartão de resultado.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { CommunicationFlow } from '@/lib/api/communicationApi';
import {
  communicationFlowSummary,
  renderableFlowStepCount,
} from '@/lib/api/communicationApi';
import { projectDelivery, type DeliveryView } from '@/lib/api/quotationDeliveryApi';

export interface WhatsAppSendRecipient {
  name: string;
  phone: string;
}

/** Confirmação inline de envio: destinatário + fluxo + Confirmar/Cancelar. */
export function WhatsAppSendConfirm({
  recipient,
  flow,
  onConfirm,
  onCancel,
}: {
  recipient: WhatsAppSendRecipient | null;
  flow: Pick<CommunicationFlow, 'name' | 'steps'> | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmButtonRef.current?.focus();
  }, []);

  return (
    <div
      role="group"
      aria-label="Confirmar envio pelo WhatsApp"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-surface-subtle px-3 py-2"
    >
      <p className="text-xs leading-5 text-fg">
        Enviar para <span className="font-semibold">{recipient?.name?.trim() || 'cliente'}</span>
        {recipient?.phone?.trim() ? (
          <span className="text-fg-muted"> · {recipient.phone.trim()}</span>
        ) : null}
      </p>
      {flow && (
        <p className="text-xs leading-5 text-fg-muted">
          {flow.name} · {communicationFlowSummary(flow)}
        </p>
      )}
      <div className="flex gap-2">
        <Button ref={confirmButtonRef} type="button" size="sm" onClick={onConfirm}>
          <Check size={14} /> Confirmar envio
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export interface WhatsAppSendPanelProps {
  selectedFlowId?: string;
  flows?: CommunicationFlow[];
  delivery?: DeliveryView | null;
  pending?: boolean;
  onSelectFlow?: (flowId: string) => void;
  onSend?: () => void;
  hideButton?: boolean;
  /** Destinatário do envio; presente ⇒ o clique pede confirmação inline antes de onSend. */
  recipient?: WhatsAppSendRecipient | null;
  /** Motivo pelo qual o envio está indisponível (ex.: fluxo vencido, sem fluxo selecionado). */
  disabledReason?: string;
  /** Ações extras na mesma linha do botão (usado com orientation="inline"). */
  actions?: ReactNode;
  /** 'block' = coluna do cartão de resultado; 'inline' = linha da página de detalhe. */
  orientation?: 'block' | 'inline';
}

export default function WhatsAppSendPanel({
  selectedFlowId,
  flows = [],
  delivery = null,
  pending = false,
  onSelectFlow,
  onSend,
  hideButton = false,
  recipient = null,
  disabledReason = '',
  actions = null,
  orientation = 'block',
}: WhatsAppSendPanelProps) {
  const flowSelectId = useId();
  const [confirming, setConfirming] = useState(false);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);
  const everConfirmingRef = useRef(false);

  const selectedFlow = flows.length > 0
    ? flows.find((f) => f.id === selectedFlowId) || flows[0]
    : null;
  const hasValidSteps = renderableFlowStepCount(selectedFlow) > 0;
  const deliveryProjection = delivery ? projectDelivery(delivery) : null;
  const isPending = pending;
  const deliveryBlocksSend = Boolean(delivery);
  const sendDisabled = isPending || deliveryBlocksSend || Boolean(disabledReason);

  useEffect(() => {
    if (!confirming && everConfirmingRef.current) {
      everConfirmingRef.current = false;
      sendButtonRef.current?.focus();
    }
  }, [confirming]);

  // Envio disparado (ou bloqueado) encerra a confirmação pendente.
  useEffect(() => {
    if (confirming && (isPending || deliveryBlocksSend)) setConfirming(false);
  }, [confirming, isPending, deliveryBlocksSend]);

  const flowSelector = (
    <label
      htmlFor={flowSelectId}
      className={cn('text-xs font-medium text-fg-muted', orientation === 'inline' && 'min-w-52')}
    >
      <span className="mb-1 block">Fluxo do WhatsApp</span>
      <Select
        id={flowSelectId}
        className="w-full"
        value={selectedFlowId || ''}
        onChange={(e) => onSelectFlow?.(e.target.value)}
        disabled={flows.length === 0}
      >
        {flows.map((flow) => (
          <option key={flow.id} value={flow.id}>
            {flow.name}
          </option>
        ))}
      </Select>
    </label>
  );

  const buttonLabel = delivery
    ? isPending
      ? 'Enviando…'
      : deliveryProjection?.label
    : 'Enviar WhatsApp';

  const buttonTitle =
    disabledReason ||
    (isPending
      ? 'Envio em andamento'
      : deliveryBlocksSend
        ? 'Este orçamento já foi enviado pelo WhatsApp. Acompanhe o status abaixo.'
        : undefined);

  const sendButton = (
    <Button
      ref={sendButtonRef}
      type="button"
      size={orientation === 'inline' ? 'sm' : 'lg'}
      className={cn(orientation === 'block' && 'w-full', confirming && 'hidden')}
      title={buttonTitle}
      disabled={sendDisabled}
      onClick={() => {
        if (!recipient) {
          onSend?.();
          return;
        }
        everConfirmingRef.current = true;
        setConfirming(true);
      }}
    >
      <Phone size={orientation === 'inline' ? 14 : 16} />
      {buttonLabel}
    </Button>
  );

  const confirmArea = (
    <WhatsAppSendConfirm
      recipient={recipient}
      flow={selectedFlow}
      onConfirm={() => {
        setConfirming(false);
        onSend?.();
      }}
      onCancel={() => setConfirming(false)}
    />
  );

  const flowSummary = selectedFlow && (
    <span
      className={cn(
        'block text-xs leading-5 text-fg-muted',
        orientation === 'inline' && 'mt-2',
        confirming && 'hidden'
      )}
    >
      {communicationFlowSummary(selectedFlow)}
    </span>
  );

  const invalidStepsWarning = !hasValidSteps && (
    <p
      className={cn('text-xs leading-5 text-warning', orientation === 'block' ? 'mb-2 mt-3' : 'mt-2')}
      role="status"
    >
      {!selectedFlow
        ? 'Nenhum fluxo de WhatsApp disponível.'
        : 'Este fluxo não tem etapas válidas. Configure pelo menos uma mensagem ou mídia em Comunicação.'}
    </p>
  );

  const sendArea =
    !hideButton && hasValidSteps ? (confirming ? confirmArea : sendButton) : null;

  const sentNote =
    delivery && !isPending && !hideButton ? (
      <p
        className={cn(
          'text-xs leading-5 text-fg-muted',
          orientation === 'block' ? 'text-center' : 'mt-2'
        )}
      >
        Já enviado. Acompanhe o status{' '}
        <a href="#/whatsapp-deliveries" className="text-primary hover:underline">
          em Envios WhatsApp
        </a>
        .
      </p>
    ) : null;

  const errorNote =
    delivery?.publicError && !hideButton ? (
      <p
        className={cn(
          'text-xs leading-5',
          orientation === 'block' && 'text-center',
          delivery.state === 'failed' ? 'text-destructive' : 'text-warning'
        )}
      >
        {delivery.publicError}
      </p>
    ) : null;

  const disabledReasonNote =
    Boolean(disabledReason) && !deliveryBlocksSend && !hideButton ? (
      <p role="status" className="mt-2 text-xs leading-5 text-fg-muted">
        {disabledReason}
      </p>
    ) : null;

  if (orientation === 'inline') {
    return (
      <div aria-busy={isPending} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-end gap-2">
          {flowSelector}
          {sendArea}
          {actions}
        </div>
        {flowSummary}
        {invalidStepsWarning}
        {disabledReasonNote}
        {sentNote}
        {errorNote}
      </div>
    );
  }

  return (
    <div className="mb-3 mt-4" aria-busy={isPending}>
      {flowSelector}
      {flowSummary}
      {invalidStepsWarning}
      {!hideButton && <div className="mt-3 space-y-2">{sendArea}</div>}
      {sentNote}
      {errorNote}
    </div>
  );
}
