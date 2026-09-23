import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  destructive: { box: 'border-destructive/25 bg-destructive/5', icon: 'text-destructive', Icon: AlertTriangle },
  warning: { box: 'border-warning/30 bg-warning/5', icon: 'text-warning', Icon: AlertTriangle },
  info: { box: 'border-info/25 bg-info/5', icon: 'text-info', Icon: Info },
  success: { box: 'border-success/25 bg-success/5', icon: 'text-success', Icon: CheckCircle2 },
} as const;

export interface InlineAlertProps {
  tone?: keyof typeof tones;
  title?: ReactNode;
  children?: ReactNode;
  /** Usually one outline Button, e.g. "Tentar novamente". */
  action?: ReactNode;
  className?: string;
}

/**
 * InlineAlert — a message inside a page or panel. Color lives in the icon and
 * border; the text stays in the body color so it reads in both themes.
 */
export default function InlineAlert({ tone = 'destructive', title, children, action, className }: InlineAlertProps) {
  const { box, icon, Icon } = tones[tone];
  return (
    <div
      role={tone === 'destructive' ? 'alert' : 'status'}
      className={cn('flex flex-wrap items-start gap-3 rounded-control border p-3 text-sm text-fg', box, className)}
    >
      <Icon size={20} className={cn('mt-px shrink-0', icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5 text-fg-muted' : undefined}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
