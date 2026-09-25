import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * meta: dado secundário ao lado de um nome; caption: nota curta e contadores;
 * label: rótulo de um valor; value: valor em destaque em listas e resumos;
 * id: identificador ou SKU (única fonte mono).
 */
const variants = {
  body: 'text-sm text-fg',
  meta: 'text-xs text-fg-muted',
  caption: 'text-2xs text-fg-muted',
  label: 'text-xs font-medium text-fg-muted',
  value: 'text-sm font-semibold tabular-nums text-fg',
  id: 'font-mono text-xs text-fg-muted',
} as const;

type TextVariant = keyof typeof variants;
type TextTag = 'span' | 'p' | 'div' | 'dt' | 'dd' | 'small' | 'time';

interface TextProps extends HTMLAttributes<HTMLElement> {
  variant?: TextVariant;
  as?: TextTag;
  truncate?: boolean;
}

const Text = forwardRef<HTMLElement, TextProps>(
  ({ className, variant = 'body', as: Comp = 'span', truncate = false, ...props }, ref) => (
    <Comp
      ref={ref as never}
      className={cn(variants[variant], truncate && 'min-w-0 truncate', className)}
      {...props}
    />
  )
);
Text.displayName = 'Text';

export { Text };
export type { TextProps, TextVariant };
