import { Slot } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes, type Ref } from 'react';
import { cn } from '@/lib/utils';

/**
 * Button is the shared action primitive for Aspen.
 *
 * Filled variants show a tinted disabled state at full opacity so the label
 * stays legible; quiet variants fade instead. Never both.
 */
const variants = {
  default:
    'bg-primary text-on-solid hover:brightness-105 active:scale-[0.98] disabled:bg-primary/10 disabled:text-primary disabled:hover:bg-primary/10',
  destructive:
    'bg-destructive-fill text-destructive-foreground hover:brightness-110 active:scale-[0.98] disabled:bg-destructive/10 disabled:text-destructive disabled:hover:bg-destructive/10',
  outline:
    'border border-line bg-transparent text-fg hover:bg-surface-hover active:scale-[0.98] disabled:opacity-50',
  secondary:
    'bg-raised text-fg hover:brightness-110 active:scale-[0.98] disabled:opacity-50',
  soft: 'bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50',
  'outline-destructive':
    'border border-destructive/20 bg-transparent text-destructive hover:bg-destructive/10 active:scale-[0.98] disabled:opacity-50',
  /** Contorno na cor do texto herdada, para botões sobre painéis coloridos. */
  'outline-ink':
    'border border-current/25 bg-transparent text-current hover:bg-current/10 active:scale-[0.98] disabled:opacity-50',
  ghost: 'text-fg hover:bg-surface-hover disabled:opacity-50',
  'ghost-muted': 'text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50',
  'ghost-destructive': 'text-destructive hover:bg-destructive/10 disabled:opacity-50',
  /** Ação de remover discreta: neutra em repouso, destrutiva no hover. */
  'ghost-muted-destructive':
    'text-fg-muted hover:bg-destructive/10 hover:text-destructive disabled:opacity-50',
  link: 'text-link underline-offset-4 hover:underline disabled:opacity-50',
  success:
    'bg-success-fill text-success-foreground hover:brightness-105 active:scale-[0.98] disabled:bg-success/10 disabled:text-success disabled:hover:bg-success/10',
} as const;

/** Um tamanho de ação (32px); `xs` só em linhas densas. */
const sizes = {
  xs: 'h-7 px-2 text-xs',
  default: 'h-8 px-3 text-sm',
  icon: 'size-8 p-0',
  /** Sem altura, padding nem tamanho de fonte próprio: herda do texto ao redor (ex.: variant="link"). */
  inline: 'h-auto p-0',
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
      'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold transition-colors duration-150',
      'disabled:pointer-events-none',
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

/** Os mesmos tamanhos para itens clicáveis que não são Button (ex.: menu lateral). */
export { Button, sizes as buttonSizes };
export type { ButtonProps, ButtonVariant, ButtonSize };
