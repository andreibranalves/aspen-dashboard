import { cn } from '@/lib/utils';
import { AlertTriangle, AlertCircle, Info, CheckCircle2 } from 'lucide-react';

/**
 * QualityBadges — exibe chips compactos com indicadores de qualidade de dados.
 *
 * Props:
 *   badges: Array<{ label, type: 'warning'|'danger'|'info'|'success', title? }>
 *   className?: string
 *
 * Se a lista estiver vazia, renderiza null (sem quebrar layout).
 */

const typeStyles = {
  warning: 'tone-warning-soft',
  danger:  'tone-destructive-soft',
  info:    'tone-info-soft',
  success: 'tone-success-soft',
};

const typeIcons = {
  warning: AlertTriangle,
  danger:  AlertCircle,
  info:    Info,
  success: CheckCircle2,
};

export function QualityBadges({ badges, className }) {
  if (!badges || badges.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {badges.map((b, i) => {
        const Icon = typeIcons[b.type] || Info;
        return (
          <span
            key={i}
            title={b.title || b.label}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
              typeStyles[b.type] || typeStyles.info,
            )}
          >
            <Icon className="size-3 shrink-0" />
            {b.label}
          </span>
        );
      })}
    </div>
  );
}
