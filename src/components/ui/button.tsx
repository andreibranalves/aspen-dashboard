import { cn } from '@/lib/utils';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

/**
 * Button — Alpine pill button system.
 * DEFAULT: primary pill (CTA)
 * SECONDARY: surface pill
 * OUTLINE: line border pill
 * GHOST: transparent with hover
 * DESTRUCTIVE: destructive pill
 * SUCCESS: success pill
 */
const variants = {
  default:
    'bg-primary text-white hover:bg-primary/90 active:scale-[0.97]',
  destructive:
    'bg-destructive text-on-solid hover:bg-destructive/90 active:scale-[0.97]',
  outline:
    'border border-line bg-transparent text-fg hover:bg-primary/5 active:scale-[0.97]',
  secondary:
    'bg-surface text-fg hover:bg-surface-muted active:scale-[0.97]',
  ghost:
    'text-fg hover:bg-primary/5',
  link:
    'text-primary underline-offset-4 hover:underline',
  success:
    'bg-success text-on-solid hover:bg-success/90 active:scale-[0.97]',
} as const;

const sizes = {
  default: 'h-10 px-4 py-2',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-11 px-5',
  icon: 'h-10 w-10',
} as const;

type ButtonVariant = keyof typeof variants;
type ButtonSize = keyof typeof sizes;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'default',
      asChild: _asChild,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = 'button' as const;
    return (
      <Comp
        className={cn(
          'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-page',
          'disabled:pointer-events-none disabled:opacity-40',
          '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
          variants[variant],
          sizes[size],
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button };
export type { ButtonProps, ButtonVariant, ButtonSize };
