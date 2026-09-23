import { useEffect, useRef } from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import AspenBrand from '@/components/shared/AspenBrand';
import { NAV_ACTION, NAV_DESTINATIONS, NAV_FOOTER, type NavItem } from '@/app/navigation';
import { routePath } from '@/app/match-route';

export interface SidebarProps {
  collapsed: boolean;
  /** True below the mobile breakpoint, where the sidebar is an overlay. */
  mobile?: boolean;
  onToggle: () => void;
  currentRoute: string;
  onNavigate: (hash: string) => void;
  /** @deprecated Theme controls are rendered by TopBar. */
  darkMode?: boolean;
  /** @deprecated Theme controls are rendered by TopBar. */
  toggleDarkMode?: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Sidebar({
  collapsed,
  mobile = false,
  onToggle,
  currentRoute,
  onNavigate,
}: SidebarProps) {
  const asideRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const currentPath = routePath(currentRoute);
  // Fluxos filhos destacam o item-pai correspondente (ex.: /manual pertence a Orçamentos).
  const activeAffinity: Record<string, string> = {
    '/auto': '/novo-orcamento',
    '/manual': '/novo-orcamento',
  };
  const effectivePath = currentPath.startsWith('/products')
    ? '/catalog'
    : activeAffinity[currentPath] ?? currentPath;
  const sidebarOpen = !collapsed;
  const navItems = NAV_ACTION ? [NAV_ACTION, ...NAV_DESTINATIONS] : NAV_DESTINATIONS;

  const renderItem = (item: NavItem) => {
    const isActive = effectivePath === item.hash || effectivePath.startsWith(`${item.hash}/`);
    const Icon = item.icon;
    return (
      <button
        key={item.hash}
        type="button"
        onClick={() => onNavigate(item.hash)}
        className={cn(
          'mx-3 flex min-h-[45px] w-[calc(100%-1.5rem)] items-center gap-3 rounded-nav px-4 py-2 text-sm font-medium transition-colors',
          collapsed && 'justify-center gap-0 px-0',
          'focus-inset',
          isActive ? 'bg-shell-active text-white' : 'text-shell-muted hover:bg-shell-hover hover:text-shell-text'
        )}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        aria-current={isActive ? 'page' : undefined}
      >
        <Icon
          size={20}
          className={cn('shrink-0', isActive ? 'text-white' : 'text-shell-muted')}
          aria-hidden="true"
        />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </button>
    );
  };

  useEffect(() => {
    if (!mobile || !sidebarOpen) return undefined;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstFocusable = asideRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    firstFocusable?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onToggle();
    };
    const handleFocusIn = (event: FocusEvent) => {
      const aside = asideRef.current;
      if (aside && !aside.contains(event.target as Node)) {
        aside.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn);
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [mobile, onToggle, sidebarOpen]);

  return (
    <>
      {mobile && sidebarOpen && (
        <div
          data-sidebar-backdrop="true"
          className="fixed inset-0 z-nav bg-black/65"
          onClick={onToggle}
          aria-hidden="true"
        />
      )}
      <aside
        ref={asideRef}
        id="aspen-sidebar"
        role={mobile && sidebarOpen ? 'dialog' : 'complementary'}
        aria-label="Navegação principal"
        aria-hidden={mobile && collapsed ? true : undefined}
        aria-modal={mobile && sidebarOpen ? true : undefined}
        className={cn(
          'z-nav flex h-full shrink-0 flex-col overflow-hidden bg-shell text-shell-text transition-[width] duration-200',
          mobile ? 'fixed inset-y-0 left-0 w-[248px] rounded-none' : 'relative rounded-shell',
          !mobile && (collapsed ? 'w-[76px]' : 'w-[248px]'),
          mobile && collapsed && 'hidden',
          mobile && sidebarOpen && 'shadow-2xl'
        )}
      >
        <div className={cn('flex h-[62px] shrink-0 items-center pt-2', !mobile && collapsed ? 'justify-center px-0' : 'justify-between pl-5.5 pr-3')}>
          {!collapsed && (
            <AspenBrand />
          )}
          {!mobile && (
            <button
              type="button"
              onClick={onToggle}
              className="grid size-9 shrink-0 place-items-center rounded-control text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-text"
              aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
              title={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
              aria-expanded={!collapsed}
              aria-controls="aspen-sidebar"
            >
              {collapsed ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}
            </button>
          )}
          {mobile && sidebarOpen && (
            <button
              type="button"
              onClick={onToggle}
              className="min-h-9 min-w-9 shrink-0 rounded-control p-1.5 text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-text"
              aria-label={collapsed ? 'Abrir menu' : 'Fechar menu'}
              aria-expanded={sidebarOpen}
              aria-controls="aspen-sidebar"
            >
              {collapsed ? (
                <Menu size={20} aria-hidden="true" />
              ) : (
                <X size={20} aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        <nav className="flex-1 pt-2" aria-label="Operação">
          <div className="space-y-1">{navItems.map((item) => renderItem(item))}</div>
        </nav>
        <div className="shrink-0 pb-3 pt-2">
          {NAV_FOOTER.map((item) => renderItem(item))}
        </div>
      </aside>
    </>
  );
}
