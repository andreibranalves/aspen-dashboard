import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface ContextAction {
  label: string;
  icon?: LucideIcon;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}

export interface ContextActionsProps {
  actions?: ContextAction[];
  className?: string;
}

/**
 * ContextActions — grupo de ações rápidas para drawers e páginas de detalhe.
 */
export function ContextActions({ actions, className }: ContextActionsProps) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {actions.map((a, i) => {
        const isDisabled = a.disabled === true;
        const isLink = !!a.href && !isDisabled;
        const Icon = a.icon;
        const content = (
          <>
            {Icon && <Icon aria-hidden="true" />}
            <span>{a.label}</span>
            {isLink && <ExternalLink aria-hidden="true" />}
          </>
        );

        if (isLink) {
          return (
            <Button key={i} asChild variant="outline" size="xs">
              <a href={a.href} target="_blank" rel="noopener noreferrer" title={a.title || a.label}>
                {content}
              </a>
            </Button>
          );
        }

        const button = (
          <Button
            key={i}
            type="button"
            variant="outline"
            size="xs"
            onClick={a.onClick}
            disabled={isDisabled}
            title={a.title || a.label}
          >
            {content}
          </Button>
        );
        // Botão desabilitado não recebe hover; o wrapper mantém o motivo no title.
        return isDisabled ? (
          <span key={i} title={a.title || a.label}>
            {button}
          </span>
        ) : (
          button
        );
      })}
    </div>
  );
}
