import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const sizes = {
  default: 'h-10 text-sm',
  sm: 'h-8 text-xs',
  xs: 'h-7 text-xs',
  /** Só o chevron visível, para mover/trocar valor a partir de uma ação compacta. */
  icon: 'h-8 w-9 max-w-9 cursor-pointer overflow-hidden border-0 bg-surface-subtle px-0 text-transparent',
} as const;

type SelectSize = keyof typeof sizes;

/**
 * Select keeps the native browser behavior while matching the 40px Aspen
 * control contract.
 */
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: SelectSize;
  containerClassName?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, containerClassName, size = 'default', children, ...props }, ref) => (
    <div className={cn('relative inline-flex', containerClassName)}>
      <select
        ref={ref}
        className={cn(
          'min-w-0 appearance-none rounded-control border border-border-control bg-input-surface pl-3 pr-8 text-fg',
          sizes[size],
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
export type { SelectProps, SelectSize };
