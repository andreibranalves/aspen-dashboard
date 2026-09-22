import { cn } from '@/lib/utils';

/**
 * Avatar — iniciais determinísticas a partir do nome.
 * Decorativo por padrão; o nome acessível é responsabilidade do consumidor.
 */
const SIZES = {
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
} as const;

export type AvatarSize = keyof typeof SIZES;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  className?: string;
}

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full bg-primary/10 font-semibold text-primary-text',
        SIZES[size],
        className
      )}
    >
      {initials(name)}
    </span>
  );
}
