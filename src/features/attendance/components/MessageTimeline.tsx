import { forwardRef, Fragment, type UIEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AttendanceMessage } from '@/lib/api/attendanceApi';
import { MESSAGE_TYPE_LABELS } from '@/features/attendance/attendanceLabels';

interface MessageTimelineProps {
  messages: AttendanceMessage[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' });

function MessageBubble({ message }: { message: AttendanceMessage }) {
  const outbound = message.direction === 'outbound';
  const typeLabel = message.type === 'text' ? null : MESSAGE_TYPE_LABELS[message.type];
  return (
    <div className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-card px-3 py-2 text-sm shadow-sm',
          outbound ? 'bg-primary-soft text-primary-soft-ink' : 'bg-surface text-fg'
        )}
      >
        {typeLabel && <p className="text-xs font-semibold italic opacity-80">{typeLabel}</p>}
        {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
        <p className="mt-1 text-right text-[10px] opacity-70">
          <span className="sr-only">{outbound ? 'Enviada às ' : 'Recebida às '}</span>
          {timeFormat.format(new Date(message.timestamp))}
        </p>
      </div>
    </div>
  );
}

const MessageTimeline = forwardRef<HTMLDivElement, MessageTimelineProps>(
  ({ messages, hasOlder, loadingOlder, onLoadOlder, onScroll }, ref) => {
    let previousDay = '';
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
        {messages.map((message) => {
          const day = dayFormat.format(new Date(message.timestamp));
          const separator = day !== previousDay;
          previousDay = day;
          return (
            <Fragment key={message.id}>
              {separator && (
                <p className="py-1 text-center text-[11px] font-medium text-fg-muted">{day}</p>
              )}
              <MessageBubble message={message} />
            </Fragment>
          );
        })}
      </div>
    );
  }
);
MessageTimeline.displayName = 'MessageTimeline';

export default MessageTimeline;
