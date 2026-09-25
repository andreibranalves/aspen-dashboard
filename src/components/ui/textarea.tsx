import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { useFieldControl } from '@/components/ui/field';
import { cn } from '@/lib/utils';

const variants = {
  default: 'rounded-control border border-border-control bg-input-surface px-3 py-2 text-sm',
  /** Edição de código ou template. */
  code: 'rounded-control border border-border-control bg-input-surface px-3 py-2 font-mono text-xs leading-snug',
  /** Sem moldura, para compositores que já estão dentro de um contêiner com borda. */
  bare: 'rounded-control border-0 bg-transparent px-3 py-4 text-sm leading-6',
} as const;

type TextareaVariant = keyof typeof variants;

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: TextareaVariant;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant = 'default', ...rest }, ref) => {
    const props = useFieldControl(rest);
    return (
      <textarea
        ref={ref}
        className={cn(
          'min-h-20 w-full resize-y text-fg',
          variants[variant],
          'placeholder:text-fg-muted',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
export type { TextareaProps, TextareaVariant };
