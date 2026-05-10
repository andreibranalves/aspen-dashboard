import { cn } from '@/lib/utils.js';
import { forwardRef } from 'react';

/**
 * Input — Framer dark text input.
 * surface-1 background, hairline border, accent-blue focus ring (level-3).
 */
const Input = forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1',
        'px-3.5 py-2.5 text-[15px] leading-[1.3] text-framer-ink',
        'placeholder:text-framer-ink-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25 focus-visible:ring-offset-0',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export { Input };
