import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EntityIdentityProps {
  name: string;
  primary?: ReactNode;
  secondary?: ReactNode;
  imageSrc?: string;
  className?: string;
}

const AVATAR_COLORS = ['bg-avatar-one', 'bg-avatar-two', 'bg-avatar-three'] as const;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length > 1
    ? `${words[0][0]}${words[words.length - 1][0]}`.toLocaleUpperCase('pt-BR')
    : (words[0] || '?').slice(0, 2).toLocaleUpperCase('pt-BR');
}

/** Initials avatar; `imageSrc` covers it once loaded and falls back to the initials on error. */
export function EntityAvatar({ name, imageSrc }: { name: string; imageSrc?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const color = AVATAR_COLORS[(name.codePointAt(0) || 0) % AVATAR_COLORS.length];
  return (
    <span className={cn('relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full text-3xs font-bold text-avatar-ink', color)} aria-hidden="true">
      {initials(name)}
      {imageSrc && failedSrc !== imageSrc && (
        <img src={imageSrc} alt="" loading="lazy" onError={() => setFailedSrc(imageSrc)} className="absolute inset-0 size-full object-cover" />
      )}
    </span>
  );
}

export default function EntityIdentity({ name, primary, secondary, imageSrc, className }: EntityIdentityProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <EntityAvatar name={name} imageSrc={imageSrc} />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-fg">{primary ?? name}</div>
        {secondary != null && <div className="truncate text-xs text-fg-muted">{secondary}</div>}
      </div>
    </div>
  );
}
