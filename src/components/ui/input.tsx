import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Input is the canonical 36px Aspen text control.
 * Labels, helper text and validation messaging remain with the consumer.
 */
const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm leading-5 text-fg',
        'placeholder:text-fg-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
