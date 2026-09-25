import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** default: superfície da página; outline: superfície com borda; inset: bloco discreto dentro de um card. */
const variants = {
  default: 'bg-surface',
  outline: 'border border-line bg-surface',
  inset: 'bg-surface-subtle',
} as const;

const paddings = {
  none: '',
  sm: 'p-3',
  default: 'p-4 md:p-5',
  lg: 'p-5 md:p-6',
} as const;

type CardVariant = keyof typeof variants;
type CardPadding = keyof typeof paddings;
type CardTag = 'div' | 'section' | 'article' | 'aside' | 'li';

interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  as?: CardTag;
}

/** Card is the only surface for grouped content; features never hand-build `rounded-card`. */
const Card = forwardRef<HTMLElement, CardProps>(
  ({ className, variant = 'default', padding = 'default', as: Comp = 'div', ...props }, ref) => (
    <Comp
      ref={ref as never}
      className={cn('min-w-0 rounded-card', variants[variant], paddings[padding], className)}
      {...props}
    />
  )
);
Card.displayName = 'Card';

export { Card };
export type { CardProps, CardVariant, CardPadding };
