import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';

/**
 * ContextActions — grupo de ações rápidas para drawers e páginas de detalhe.
 *
 * Props:
 *   actions: Array<{
 *     label: string,
 *     icon?: React.ComponentType<{className?:string}>,
 *     href?: string,       // abre em nova aba com target=_blank
 *     onClick?: () => void,
 *     disabled?: boolean,
 *     title?: string,      // tooltip
 *   }>
 *   className?: string
 */

export function ContextActions({ actions, className }) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {actions.map((a, i) => {
        const isDisabled = a.disabled === true;
        const isLink = !!a.href && !isDisabled;
        const Icon = a.icon;

        const buttonClasses = cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1',
          isDisabled
            ? 'cursor-not-allowed opacity-35 bg-surface-muted text-fg-muted'
            : 'bg-surface-muted text-fg hover:bg-primary hover:text-white active:scale-[0.97]',
        );

        const content = (
          <>
            {Icon && <Icon className="size-3.5 shrink-0" />}
            <span className="whitespace-nowrap">{a.label}</span>
            {isLink && <ExternalLink className="size-3 shrink-0 opacity-50" />}
          </>
        );

        if (isLink) {
          return (
            <a
              key={i}
              href={a.href}
              target="_blank"
              rel="noopener noreferrer"
              title={a.title || a.label}
              className={buttonClasses}
            >
              {content}
            </a>
          );
        }

        return (
          <button
            key={i}
            type="button"
            onClick={a.onClick}
            disabled={isDisabled}
            title={a.title || a.label}
            className={buttonClasses}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
