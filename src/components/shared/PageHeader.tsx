import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * PageHeader — cabeçalho de página reutilizável.
 * Ações específicas da página ficam aqui; a TopBar reserva-se à navegação e utilidades globais.
 */
export interface PageHeaderProps {
  /** título da página (obrigatório) */
  title: string;
  /** contexto operacional abaixo do título (período, contagem). Nunca tutorial. */
  description?: string;
  /** grupo de ações da página (secundária → primária) */
  actions?: ReactNode;
  /** classes extras */
  className?: string;
}

export default function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 flex-wrap', className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-8 tracking-[-0.2px] text-fg">{title}</h1>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
