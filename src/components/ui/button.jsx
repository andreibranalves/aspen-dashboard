import { cn } from '@/lib/utils.js';
import { forwardRef } from 'react';

/**
 * Button — Framer pill button system.
 * DEFAULT: white pill on dark (primary CTA)
 * SECONDARY: surface-1 pill (charcoal)
 * OUTLINE: hairline border pill
 * GHOST: transparent with hover
 * DESTRUCTIVE: red pill
 * SUCCESS: green pill
 */
const variants = {
  default:
    'bg-framer-ink text-framer-canvas hover:bg-framer-ink/90 active:scale-[0.97]',
  destructive:
    'bg-red-600 text-white hover:bg-red-700 active:scale-[0.97]',
  outline:
    'border border-framer-hairline bg-transparent text-framer-ink hover:bg-framer-surface-2 active:scale-[0.97]',
  secondary:
    'bg-framer-surface-1 text-framer-ink hover:bg-framer-surface-2 active:scale-[0.97]',
  ghost:
    'text-framer-ink hover:bg-framer-surface-2',
  link:
    'text-framer-accent-blue underline-offset-4 hover:underline',
  success:
    'bg-framer-success text-white hover:bg-framer-success/90 active:scale-[0.97]',
};

const sizes = {
  default: 'h-10 px-4 py-2',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-11 px-5',
  icon: 'h-10 w-10',
};

const Button = forwardRef(({
  className,
  variant = 'default',
  size = 'default',
  asChild,
  children,
  ...props
}, ref) => {
  const Comp = 'button';
  return (
    <Comp
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/50 focus-visible:ring-offset-2 focus-visible:ring-offset-framer-canvas',
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
});
Button.displayName = 'Button';

export { Button };
