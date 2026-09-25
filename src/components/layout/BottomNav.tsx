import { Menu } from 'lucide-react';
import { NAV_BOTTOM, isNavActive } from '@/app/navigation';
import { cn } from '@/lib/utils';

interface BottomNavProps {
  currentPath: string;
  onNavigate: (hash: string) => void;
  onMore: () => void;
  moreOpen: boolean;
  /** Contadores por hash do destino. */
  badges?: Record<string, number>;
}

/**
 * BottomNav — navegação do celular: os quatro destinos do dia a dia e "Mais",
 * que abre a sidebar com os demais.
 */
export default function BottomNav({ currentPath, onNavigate, onMore, moreOpen, badges = {} }: BottomNavProps) {
  const onMoreDestination = !NAV_BOTTOM.some((item) => isNavActive(item, currentPath));
  const moreBadge = Object.entries(badges).some(
    ([hash, count]) => count > 0 && !NAV_BOTTOM.some((item) => item.hash === hash)
  );
  const itemClass = (active: boolean) =>
    cn(
      'focus-inset relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-control text-3xs font-semibold transition-colors',
      active ? 'text-primary' : 'text-fg-muted hover:text-fg'
    );

  return (
    <nav
      aria-label="Navegação principal"
      className="pb-safe flex h-(--mobile-nav-h) shrink-0 items-stretch gap-1 border-t border-line bg-surface px-2 pt-1.5 md:hidden"
    >
      {NAV_BOTTOM.map((item) => {
        const active = isNavActive(item, currentPath);
        const Icon = item.icon;
        const count = badges[item.hash] ?? 0;
        return (
          <button
            key={item.hash}
            type="button"
            onClick={() => onNavigate(item.hash)}
            aria-current={active ? 'page' : undefined}
            aria-label={count > 0 ? `${item.label} (${count})` : undefined}
            className={itemClass(active)}
          >
            <span className="relative">
              <Icon size={20} aria-hidden="true" />
              {count > 0 && (
                <span className="absolute -right-1.5 -top-1 size-2 rounded-full bg-destructive" aria-hidden="true" />
              )}
            </span>
            <span className="max-w-full truncate">{item.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        aria-expanded={moreOpen}
        aria-controls="aspen-sidebar"
        aria-current={onMoreDestination ? 'page' : undefined}
        className={itemClass(onMoreDestination)}
      >
        <span className="relative">
          <Menu size={20} aria-hidden="true" />
          {moreBadge && (
            <span className="absolute -right-1.5 -top-1 size-2 rounded-full bg-destructive" aria-hidden="true" />
          )}
        </span>
        Mais
      </button>
    </nav>
  );
}
