import { MessagesSquare } from 'lucide-react';
import EmptyState from '@/components/shared/EmptyState';
import ErrorState from '@/components/shared/ErrorState';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { STATUS_BADGE, STATUS_LABELS } from '@/features/attendance/attendanceLabels';
import { fmtPhone } from '@/lib/formatting/formatters';
import { cn } from '@/lib/utils';
import type { AttendanceConversation } from '@/lib/api/attendanceApi';

interface ConversationListProps {
  items: AttendanceConversation[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  filtered: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onLoadMore: () => void;
}

export function conversationName(conversation: Pick<AttendanceConversation, 'displayName' | 'phone'>): string {
  return conversation.displayName || (conversation.phone ? fmtPhone(conversation.phone) : 'Contato sem nome');
}

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

function listTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return dayFormat.format(date) === dayFormat.format(new Date()) ? timeFormat.format(date) : dayFormat.format(date);
}

export default function ConversationList({
  items,
  selectedId,
  loading,
  error,
  filtered,
  hasMore,
  loadingMore,
  onSelect,
  onRetry,
  onLoadMore,
}: ConversationListProps) {
  if (error && items.length === 0) {
    return <ErrorState title="Não foi possível carregar as conversas" description={error} onRetry={onRetry} />;
  }
  if (loading && items.length === 0) {
    return <p className="px-4 py-6 text-sm text-fg-muted" role="status">Carregando conversas…</p>;
  }
  if (items.length === 0) {
    return filtered ? (
      <EmptyState icon={MessagesSquare} title="Nenhuma conversa encontrada" />
    ) : (
      <EmptyState
        icon={MessagesSquare}
        title="Nenhuma conversa registrada"
        description="As mensagens recebidas pelo WhatsApp aparecem aqui."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <ul className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto" aria-label="Conversas">
        {items.map((item) => {
          const name = conversationName(item);
          const selected = item.id === selectedId;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover',
                  selected && 'bg-surface-selected'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn('truncate text-sm text-fg', item.unreadCount > 0 ? 'font-bold' : 'font-medium')}>
                      {name}
                    </span>
                    <span className="shrink-0 text-[11px] text-fg-muted">{listTime(item.lastMessageAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                      {item.lastMessageDirection === 'outbound' && 'Você: '}
                      {item.lastMessagePreview}
                    </span>
                    {item.status !== 'open' && (
                      <StatusBadge
                        status={STATUS_BADGE[item.status].status}
                        tone={STATUS_BADGE[item.status].tone}
                        className="shrink-0"
                        label={STATUS_LABELS[item.status]}
                      />
                    )}
                    {item.unreadCount > 0 && (
                      <span
                        className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-on-solid"
                        aria-label={`${item.unreadCount} não lidas`}
                      >
                        {item.unreadCount > 99 ? '99+' : item.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div className="border-t border-border-subtle p-2">
          <Button variant="ghost" size="sm" className="w-full" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Carregando…' : 'Carregar mais conversas'}
          </Button>
        </div>
      )}
    </div>
  );
}
