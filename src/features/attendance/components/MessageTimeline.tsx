import { forwardRef, Fragment, useState, type UIEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { openReceivedMedia, type AttendanceMessage } from '@/lib/api/attendanceApi';
import type { ContextDelivery } from '@/lib/api/attendanceContextApi';
import { deliveryLabel, MESSAGE_TYPE_LABELS } from '@/features/attendance/attendanceLabels';

export type MessageActionName = 'cancel' | 'confirm_sent' | 'confirm_not_sent' | 'resend' | 'resend_uncertain';

interface MessageTimelineProps {
  messages: AttendanceMessage[];
  deliveries: ContextDelivery[];
  deliveryPending: string | null;
  onSendDelivery: (delivery: ContextDelivery) => void;
  actionPending: string | null;
  onAction: (messageId: string, action: MessageActionName) => void;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' });

function DeliveryCard({ delivery, pending, onSend }: { delivery: ContextDelivery; pending: boolean; onSend: (delivery: ContextDelivery) => void }) {
  return (
    <article className="mx-auto max-w-sm space-y-1 rounded-card border border-border-subtle bg-surface p-3 text-sm shadow-xs">
      <a href={delivery.url} className="font-semibold text-link hover:underline">Orçamento {delivery.businessNumber}</a>
      <p className="text-xs text-fg-muted">WhatsApp: {delivery.status}</p>
      {delivery.canSend && (
        <Button variant="outline" size="xs" disabled={pending} onClick={() => onSend(delivery)}>
          {pending ? 'Enviando…' : 'Enviar orçamento'}
        </Button>
      )}
    </article>
  );
}

function MessageBubble({
  message,
  actionPending,
  onAction,
}: {
  message: AttendanceMessage;
  actionPending: boolean;
  onAction: (messageId: string, action: MessageActionName) => void;
}) {
  const outbound = message.direction === 'outbound';
  const typeLabel = message.type === 'text' ? null : MESSAGE_TYPE_LABELS[message.type];
  const delivery = deliveryLabel(message);
  const cancellable = message.outboxState === 'queued' || message.outboxState === 'retry_scheduled';
  const reviewable = message.outboxState === 'needs_review';
  const resendable = message.outboxState === 'failed' || message.outboxState === 'cancelled';
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const receivableMedia = !outbound && ['image', 'document', 'audio'].includes(message.type);
  const openMedia = async () => {
    setLoadingMedia(true);
    setMediaError(null);
    try { await openReceivedMedia(message.id); }
    catch (error) { setMediaError(error instanceof Error ? error.message : 'Mídia indisponível na origem.'); }
    finally { setLoadingMedia(false); }
  };
  return (
    <div className={cn('flex flex-col', outbound ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-card px-3 py-2 text-sm shadow-xs',
          outbound ? 'bg-primary-soft text-primary-soft-ink' : 'bg-surface text-fg',
          (message.outboxState === 'failed' || message.outboxState === 'cancelled') && 'opacity-70'
        )}
      >
        {typeLabel && <p className="text-xs font-semibold italic opacity-80">{typeLabel}</p>}
        {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
        {receivableMedia && (
          <Button variant="outline" size="xs" disabled={loadingMedia} onClick={() => void openMedia()}>
            {loadingMedia ? 'Abrindo…' : message.type === 'audio' ? 'Reproduzir áudio' : message.type === 'document' ? 'Baixar PDF' : 'Abrir imagem'}
          </Button>
        )}
        {mediaError && <p role="status" className="text-xs text-destructive">{mediaError}</p>}
        <p className="mt-1 text-right text-xs opacity-70">
          <span className="sr-only">{outbound ? 'Enviada às ' : 'Recebida às '}</span>
          {timeFormat.format(new Date(message.timestamp))}
          {delivery && <span> · {delivery}</span>}
        </p>
      </div>
      {(cancellable || reviewable || resendable) && (
        <div className="mt-1 flex flex-wrap justify-end gap-1">
          {cancellable && (
            <Button variant="ghost" size="xs" disabled={actionPending} onClick={() => onAction(message.id, 'cancel')}>
              Cancelar envio
            </Button>
          )}
          {reviewable && (
            <>
              <Button variant="outline" size="xs" disabled={actionPending} onClick={() => onAction(message.id, 'confirm_sent')}>
                Foi enviada
              </Button>
              <Button variant="outline" size="xs" disabled={actionPending} onClick={() => onAction(message.id, 'confirm_not_sent')}>
                Não foi enviada
              </Button>
              <Button variant="ghost" size="xs" disabled={actionPending} onClick={() => onAction(message.id, 'resend_uncertain')}>
                Enviar de novo
              </Button>
            </>
          )}
          {resendable && (
            <Button variant="ghost" size="xs" disabled={actionPending} onClick={() => onAction(message.id, 'resend')}>
              Reenviar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const MessageTimeline = forwardRef<HTMLDivElement, MessageTimelineProps>(
  ({ messages, deliveries, deliveryPending, onSendDelivery, actionPending, onAction, hasOlder, loadingOlder, onLoadOlder, onScroll }, ref) => {
    let previousDay = '';
    const entries = [
      ...messages.map((message) => ({ id: message.id, timestamp: message.timestamp, message, delivery: null as ContextDelivery | null })),
      ...deliveries.map((delivery) => ({ id: delivery.id, timestamp: delivery.occurredAt, message: null as AttendanceMessage | null, delivery })),
    ].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
    return (
      <div
        ref={ref}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-page px-4 py-3"
        role="log"
        aria-label="Mensagens"
      >
        {hasOlder && (
          <div className="flex justify-center">
            <Button variant="outline" size="xs" onClick={onLoadOlder} disabled={loadingOlder}>
              {loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </Button>
          </div>
        )}
        {entries.map((entry) => {
          const day = dayFormat.format(new Date(entry.timestamp));
          const separator = day !== previousDay;
          previousDay = day;
          return (
            <Fragment key={`${entry.message ? 'message' : 'delivery'}:${entry.id}`}>
              {separator && (
                <p className="py-1 text-center text-2xs font-medium text-fg-muted">{day}</p>
              )}
              {entry.message ? (
                <MessageBubble message={entry.message} actionPending={actionPending === entry.id} onAction={onAction} />
              ) : entry.delivery ? (
                <DeliveryCard delivery={entry.delivery} pending={deliveryPending === entry.id} onSend={onSendDelivery} />
              ) : null}
            </Fragment>
          );
        })}
      </div>
    );
  }
);
MessageTimeline.displayName = 'MessageTimeline';

export default MessageTimeline;
