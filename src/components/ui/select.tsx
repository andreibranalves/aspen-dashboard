import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { forwardRef, type SelectHTMLAttributes } from 'react';

/**
 * Select — select nativo com aparência pill e chevron.
 * Preserva o comportamento nativo e a acessibilidade do elemento.
 */
const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative inline-flex">
      <select
        ref={ref}
        className={cn(
          'appearance-none rounded-full border border-line bg-surface pl-3 pr-8 py-1.5 text-sm text-fg',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" />
    </div>
  ),
);
Select.displayName = 'Select';

export { Select };
