import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * PageToolbar — composição e espaçamento de linhas de filtros/controles.
 * Compartilha apenas apresentação; estado e lógica permanecem em cada página.
 */
export interface PageToolbarProps {
  children: ReactNode;
  className?: string;
}

export default function PageToolbar({ children, className }: PageToolbarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {children}
    </div>
  );
}
