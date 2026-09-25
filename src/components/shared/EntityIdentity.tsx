import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EntityIdentityProps {
  name: string;
  primary?: ReactNode;
  secondary?: ReactNode;
  className?: string;
}

const AVATAR_COLORS = ['bg-avatar-one', 'bg-avatar-two', 'bg-avatar-three'] as const;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length > 1
    ? `${words[0][0]}${words[words.length - 1][0]}`.toLocaleUpperCase('pt-BR')
    : (words[0] || '?').slice(0, 2).toLocaleUpperCase('pt-BR');
}

export default function EntityIdentity({ name, primary, secondary, className }: EntityIdentityProps) {
  const color = AVATAR_COLORS[(name.codePointAt(0) || 0) % AVATAR_COLORS.length];
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-3xs font-bold text-avatar-ink', color)} aria-hidden="true">
        {initials(name)}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-fg">{primary ?? name}</div>
        {secondary != null && <div className="truncate text-xs text-fg-muted">{secondary}</div>}
      </div>
    </div>
  );
}
