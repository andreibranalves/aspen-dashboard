import { cn } from '@/lib/utils.js';

/**
 * Skeleton — bloco animado base com animate-pulse.
 * Aceita className para compor tamanhos e formas.
 */
export default function Skeleton({ className = '', ...props }) {
  return (
    <div
      className={cn('animate-pulse bg-surface-muted/50 rounded-md', className)}
      role="status"
      aria-label="Carregando"
      {...props}
    />
  );
}
