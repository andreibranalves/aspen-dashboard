import { Slot } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes, type Ref } from 'react';
import { cn } from '@/lib/utils';

/**
 * Button is the shared action primitive for Aspen.
 *
 * The public `default` and `success` variants remain for compatibility with
 * existing quotation and CRM actions.
 */
const variants = {
  default:
    'bg-primary text-on-solid hover:bg-primary/90 active:scale-[0.97] disabled:bg-primary/10 disabled:text-primary disabled:hover:bg-primary/10',
  destructive:
    'bg-destructive text-on-solid dark:text-page hover:bg-destructive/90 active:scale-[0.97] disabled:bg-destructive/10 disabled:text-destructive disabled:hover:bg-destructive/10',
  outline: 'border border-line bg-transparent text-fg hover:bg-surface-hover active:scale-[0.97]',
  secondary: 'border border-line bg-surface text-fg hover:bg-surface-hover active:scale-[0.97]',
  ghost: 'text-fg hover:bg-surface-hover',
  link: 'text-primary underline-offset-4 hover:underline',
  success:
    'bg-success text-on-solid dark:text-page hover:bg-success/90 active:scale-[0.97] disabled:bg-success/10 disabled:text-success disabled:hover:bg-success/10',
} as const;

const sizes = {
  xs: 'h-7 px-2 text-xs',
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-3 text-sm',
  default: 'h-9 px-3 text-sm',
  lg: 'h-10 px-4 text-sm',
  icon: 'h-9 w-9 p-0',
} as const;

type ButtonVariant = keyof typeof variants;
type ButtonSize = keyof typeof sizes;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Marca semântica preservada no elemento renderizado. */
  'data-variant'?: string;
  /** Renderiza as classes no elemento filho usando o Slot acessível do Radix. */
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'default',
      asChild = false,
      children,
      'data-variant': dataVariant,
      ...props
    },
    ref
  ) => {
    const classes = cn(
      'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium transition-colors duration-150',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page',
      'disabled:pointer-events-none disabled:opacity-50',
      '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
      variants[variant],
      sizes[size],
      className
    );

    if (asChild) {
      return (
        <Slot.Root
          ref={ref as Ref<HTMLElement>}
          data-variant={dataVariant ?? variant}
          className={classes}
          {...props}
        >
          {children}
        </Slot.Root>
      );
    }

    return (
      <button ref={ref} data-variant={dataVariant ?? variant} className={classes} {...props}>
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

export { Button };
export type { ButtonProps, ButtonVariant, ButtonSize };
