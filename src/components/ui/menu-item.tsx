import { Slot } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  default: 'text-fg hover:bg-surface-hover',
  destructive: 'text-destructive hover:bg-destructive/10',
} as const;

interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: keyof typeof tones;
  /** Aplica as classes no filho (ex.: `<a>` que abre o PDF). */
  asChild?: boolean;
}

/** Item de ação dentro de menus e popovers. */
const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(
  ({ className, tone = 'default', asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : 'button';
    return (
      <Comp
        ref={ref}
        {...(asChild ? {} : { type: 'button' as const })}
        className={cn(
          'flex min-h-9 w-full items-center gap-2 rounded-badge px-3 py-2 text-left text-sm transition-colors focus-inset',
          'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
          tones[tone],
          className
        )}
        {...props}
      />
    );
  }
);
MenuItem.displayName = 'MenuItem';

export { MenuItem };
export type { MenuItemProps };
