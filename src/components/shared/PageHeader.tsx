import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * PageHeader — cabeçalho de página reutilizável.
 * Título padronizado em text-2xl; descrição em text-sm text-fg-muted.
 * Ações da página ficam aqui (não na TopBar): a secundária à esquerda,
 * a primária à direita, dentro do grupo `actions`.
 */
export interface PageHeaderProps {
  /** título da página (obrigatório) */
  title: string;
  /** descrição curta abaixo do título (opcional) */
  description?: string;
  /** grupo de ações da página (secundária → primária) */
  actions?: ReactNode;
  /** ação única (legado, equivalente a actions com um elemento) */
  action?: ReactNode;
  /** classes extras */
  className?: string;
}

export default function PageHeader({ title, description, actions, action, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 flex-wrap', className)}>
      <div className="space-y-1 min-w-0">
        <h1 className="text-2xl font-semibold text-fg">{title}</h1>
        {description && (
          <p className="text-sm text-fg-muted">{description}</p>
        )}
      </div>
      {(actions || action) && (
        <div className="flex shrink-0 items-center gap-2">{actions ?? action}</div>
      )}
    </div>
  );
}
