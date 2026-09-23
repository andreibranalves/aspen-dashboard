import { cn } from '@/lib/utils';
import { AlertTriangle, AlertCircle, Info, CheckCircle2, type LucideIcon } from 'lucide-react';

type BadgeType = 'warning' | 'danger' | 'info' | 'success';

const typeStyles: Record<BadgeType, string> = {
  warning: 'tone-warning-soft',
  danger: 'tone-destructive-soft',
  info: 'tone-info-soft',
  success: 'tone-success-soft',
};

const typeIcons: Record<BadgeType, LucideIcon> = {
  warning: AlertTriangle,
  danger: AlertCircle,
  info: Info,
  success: CheckCircle2,
};

export interface QualityBadge {
  label: string;
  type: BadgeType;
  title?: string;
}

export interface QualityBadgesProps {
  badges?: QualityBadge[];
  className?: string;
}

/**
 * QualityBadges — exibe chips compactos com indicadores de qualidade de dados.
 * Se a lista estiver vazia, renderiza null (sem quebrar layout).
 */
export function QualityBadges({ badges, className }: QualityBadgesProps) {
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
              'inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-2xs font-semibold leading-4 transition-colors',
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
