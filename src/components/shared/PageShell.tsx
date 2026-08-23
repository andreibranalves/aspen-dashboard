import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * PageShell — contrato único de página (largura, centralização, animação e ritmo).
 * Reserva para barras inferiores fixas via className="pb-28".
 */
export interface PageShellProps {
  children: ReactNode;
  className?: string;
}

export default function PageShell({ children, className }: PageShellProps) {
  return (
    <div className={cn('mx-auto max-w-[1060px] space-y-4 animate-fade-in', className)}>
      {children}
    </div>
  );
}
