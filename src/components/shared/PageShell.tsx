import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * PageShell — contrato único de página (largura fluida e ritmo).
 * Barras inferiores fixas reservam o próprio espaço (BulkActionBar, MobileActionBar).
 */
export interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const PageShell = forwardRef<HTMLDivElement, PageShellProps>(({ children, className, ...props }, ref) => (
  <div ref={ref} className={cn('mx-auto w-full space-y-4', className)} {...props}>
    {children}
  </div>
));
PageShell.displayName = 'PageShell';

export default PageShell;
