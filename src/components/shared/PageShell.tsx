import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * PageShell — contrato único de página (largura fluida, animação e ritmo).
 * Reserva para barras inferiores fixas via className="pb-28".
 */
export interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const PageShell = forwardRef<HTMLDivElement, PageShellProps>(({ children, className, ...props }, ref) => (
  <div ref={ref} className={cn('mx-auto w-full max-w-[1060px] space-y-4 animate-fade-in', className)} {...props}>
    {children}
  </div>
));
PageShell.displayName = 'PageShell';

export default PageShell;
