import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Timeline — trilha vertical de interações/eventos de um registro.
 * Consumidor monta os eventos; estado vazio é responsabilidade da tela
 * (use EmptyState).
 */
export interface TimelineEvent {
  id: string;
  title: string;
  description?: ReactNode;
  /** Texto visível da data/hora. */
  timestamp?: string | null;
  /** Atributo dateTime do <time>. */
  dateTime?: string;
  icon?: LucideIcon;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'destructive' | 'info';
}

export interface TimelineProps {
  events: TimelineEvent[];
  className?: string;
}

const TONE_NODE: Record<NonNullable<TimelineEvent['tone']>, string> = {
  neutral: 'bg-surface-muted text-fg-muted',
  primary: 'bg-primary/15 text-primary-text',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/15 text-destructive',
  info: 'bg-info/15 text-info',
};

export function Timeline({ events, className }: TimelineProps) {
  if (events.length === 0) return null;

  return (
    <ol className={className}>
      {events.map((event, index) => {
        const Icon = event.icon;
        const tone = event.tone ?? 'neutral';
        const last = index === events.length - 1;
        return (
          <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-[13px] top-8 w-px bg-border"
              />
            )}
            <span
              className={cn(
                'relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full',
                TONE_NODE[tone]
              )}
            >
              {Icon ? (
                <Icon size={14} aria-hidden="true" />
              ) : (
                <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-medium text-fg">{event.title}</p>
              {event.description && (
                <div className="mt-0.5 text-sm text-fg-muted">{event.description}</div>
              )}
              {event.timestamp && (
                <time dateTime={event.dateTime} className="mt-0.5 block text-xs text-fg-muted">
                  {event.timestamp}
                </time>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
