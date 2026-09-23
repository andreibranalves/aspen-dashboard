import { Search } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Width of the field wrapper; defaults to fluid up to the 286px list ceiling. */
  containerClassName?: string;
}

/** SearchField — the single search control for lists and toolbars. */
const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ className, containerClassName, ...props }, ref) => (
    <div className={cn('relative w-full min-w-0 sm:max-w-[286px] sm:flex-1', containerClassName)}>
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
        aria-hidden="true"
      />
      <Input ref={ref} type="search" className={cn('pl-9', className)} {...props} />
    </div>
  )
);
SearchField.displayName = 'SearchField';

export { SearchField };
