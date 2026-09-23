import type { ElementType, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Skeleton — bloco animado base com shimmer.
 */
export interface SkeletonProps extends HTMLAttributes<HTMLElement> {
  /** Elemento HTML a ser renderizado. */
  as?: ElementType;
  /** Forma do skeleton. */
  variant?: 'rect' | 'circle' | 'text';
}

export default function Skeleton({
  className = '',
  as: Component = 'div',
  variant = 'rect',
  ...props
}: SkeletonProps) {
  const variantClass =
    variant === 'circle'
      ? 'rounded-full'
      : variant === 'text'
        ? 'skeleton-text'
        : 'rounded-control';

  return (
    <Component
      className={cn('skeleton', variantClass, className)}
      aria-hidden="true"
      {...props}
    />
  );
}
