import { forwardRef, type InputHTMLAttributes } from 'react';
import { useFieldControl } from '@/components/ui/field';
import { cn } from '@/lib/utils';

const sizes = {
  default: 'h-8 text-sm',
  xs: 'h-7 text-xs',
} as const;

const variants = {
  default: 'border-border-control bg-input-surface',
  /** Sem moldura até hover ou foco, para células editáveis de uma tabela. */
  ghost: 'border-transparent bg-transparent hover:border-border-control focus-visible:border-border-control focus-visible:bg-input-surface',
} as const;

type InputSize = keyof typeof sizes;
type InputVariant = keyof typeof variants;

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  variant?: InputVariant;
  /** Esconde as setas nativas de incremento em campos numéricos. */
  hideSpinButtons?: boolean;
}

/**
 * Input is the canonical 32px Aspen text control, the same height as Button.
 * Labels, helper text and validation messaging remain with the consumer.
 */
const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size = 'default', variant = 'default', hideSpinButtons = false, ...rest }, ref) => {
    const props = useFieldControl(rest);
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex w-full min-w-0 rounded-control border px-3 py-1 leading-5 text-fg',
          variants[variant],
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
    );
  }
);
Input.displayName = 'Input';

export { Input };
export type { InputProps, InputSize, InputVariant };
