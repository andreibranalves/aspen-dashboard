import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** section: título de seção; subsection: bloco dentro da seção; card: título de card; eyebrow: rótulo de grupo. */
const levels = {
  section: 'text-base font-semibold text-fg',
  subsection: 'text-sm font-semibold text-fg',
  card: 'text-lead font-semibold leading-5 text-fg',
  eyebrow: 'text-xs font-semibold uppercase tracking-wider text-fg-muted',
} as const;

type HeadingLevel = keyof typeof levels;
type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

const defaultTag: Record<HeadingLevel, HeadingTag> = {
  section: 'h2',
  subsection: 'h3',
  card: 'h3',
  eyebrow: 'h3',
};

interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  level?: HeadingLevel;
  as?: HeadingTag;
}

const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ className, level = 'section', as, ...props }, ref) => {
    const Comp = as ?? defaultTag[level];
    return <Comp ref={ref} className={cn(levels[level], className)} {...props} />;
  }
);
Heading.displayName = 'Heading';

export { Heading };
export type { HeadingLevel, HeadingProps };
