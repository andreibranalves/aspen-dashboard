import { cn } from '@/lib/utils';

/**
 * Skeleton — bloco animado base com shimmer.
 *
 * @param {string} [as='div'] - Elemento HTML a ser renderizado.
 * @param {'rect'|'circle'|'text'} [variant='rect'] - Forma do skeleton.
 */
export default function Skeleton({
  className = '',
  as: Component = 'div',
  variant = 'rect',
  ...props
}) {
  const variantClass =
    variant === 'circle'
      ? 'rounded-full'
      : variant === 'text'
        ? 'skeleton-text'
        : 'rounded-md';

  return (
    <Component
      className={cn('skeleton', variantClass, className)}
      aria-hidden="true"
      {...props}
    />
  );
}
