import { Menu, Plus } from 'lucide-react';
import { NAV_ACTION, NAV_BOTTOM, isNavActive, type NavItem } from '@/app/navigation';
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
 * BottomNav — navegação do celular: os destinos do dia a dia, o botão de novo
 * orçamento no meio e "Mais", que abre a sidebar com os demais.
 */
export default function BottomNav({
  currentPath,
  onNavigate,
  onMore,
  moreOpen,
  badges = {},
}: BottomNavProps) {
  const onAction = NAV_ACTION !== null && isNavActive(NAV_ACTION, currentPath);
  const onMoreDestination = !onAction && !NAV_BOTTOM.some((item) => isNavActive(item, currentPath));
  const actionIndex = Math.ceil(NAV_BOTTOM.length / 2);
  const moreBadge = Object.entries(badges).some(
    ([hash, count]) => count > 0 && !NAV_BOTTOM.some((item) => item.hash === hash)
  );
  const itemClass = (active: boolean) =>
    cn(
      'focus-inset relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-control text-3xs font-semibold transition-colors',
      active ? 'text-primary' : 'text-fg-muted hover:text-fg'
    );
  const renderDestination = (item: NavItem) => {
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
            <span
              className="absolute -right-1.5 -top-1 size-2 rounded-full bg-destructive"
              aria-hidden="true"
            />
          )}
        </span>
        <span className="max-w-full truncate">{item.label}</span>
      </button>
    );
  };

  return (
    <nav
      aria-label="Navegação principal"
      className="pb-safe flex h-(--mobile-nav-h) shrink-0 items-stretch gap-1 border-t border-line bg-surface px-2 pt-1.5 md:hidden"
    >
      {NAV_BOTTOM.slice(0, actionIndex).map(renderDestination)}
      {NAV_ACTION && (
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => onNavigate(NAV_ACTION.hash)}
            aria-label={NAV_ACTION.label}
            title={NAV_ACTION.label}
            aria-current={onAction ? 'page' : undefined}
            className="focus-inset flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus size={24} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      )}
      {NAV_BOTTOM.slice(actionIndex).map(renderDestination)}
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
            <span
              className="absolute -right-1.5 -top-1 size-2 rounded-full bg-destructive"
              aria-hidden="true"
            />
          )}
        </span>
        Mais
      </button>
    </nav>
  );
}
