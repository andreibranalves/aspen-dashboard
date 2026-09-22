import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Select keeps the native browser behavior while matching the 36px Aspen
 * control contract.
 */
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  containerClassName?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, containerClassName, children, ...props }, ref) => (
    <div className={cn('relative inline-flex', containerClassName)}>
      <select
        ref={ref}
        className={cn(
          'h-10 min-w-0 appearance-none rounded-control border border-border-control bg-raised pl-3 pr-8 text-sm text-fg',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-sage focus-visible:ring-offset-4 focus-visible:ring-offset-page',
          'aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted"
      />
    </div>
  )
);
Select.displayName = 'Select';

export { Select };
