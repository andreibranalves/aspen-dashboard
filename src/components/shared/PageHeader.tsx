import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * PageHeader — cabeçalho de página reutilizável.
 * Título padronizado em text-2xl (igual à página de Produtos).
 */
export interface PageHeaderProps {
  /** título da página (obrigatório) */
  title: string;
  /** ação primária (botão/link, opcional) */
  action?: ReactNode;
  /** classes extras */
  className?: string;
}

export default function PageHeader({ title, action, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 flex-wrap', className)}>
      <div className="space-y-1 min-w-0">
        <h1 className="text-2xl font-semibold text-fg">{title}</h1>
      </div>
      {action && (
        <div className="shrink-0">{action}</div>
      )}
    </div>
  );
}
