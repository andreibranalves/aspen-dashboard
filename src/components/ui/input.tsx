import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const sizes = {
  default: 'h-10 text-sm',
  sm: 'h-8 text-xs',
  xs: 'h-7 text-xs',
} as const;

type InputSize = keyof typeof sizes;

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  /** Esconde as setas nativas de incremento em campos numéricos. */
  hideSpinButtons?: boolean;
}

/**
 * Input is the canonical 40px Aspen text control.
 * Labels, helper text and validation messaging remain with the consumer.
 */
const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size = 'default', hideSpinButtons = false, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex w-full min-w-0 rounded-control border border-border-control bg-input-surface px-3 py-2 leading-5 text-fg',
        sizes[size],
        'placeholder:text-fg-muted',
        'aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        hideSpinButtons &&
          '[appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export { Input };
export type { InputProps, InputSize };
