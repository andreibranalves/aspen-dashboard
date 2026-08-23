import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * EmptyState — estado vazio com ícone, título, explicação e ações opcionais.
 * Ações só quando existe próximo passo válido. Erro de carregamento NÃO é
 * empty state — renderize markup próprio de erro.
 */
export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 py-16 text-center text-fg-muted', className)}>
      <Icon size={36} className="text-fg-muted/40" aria-hidden="true" />
      <p>{title}</p>
      {description && <p className="max-w-md text-sm">{description}</p>}
      {actions && <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
