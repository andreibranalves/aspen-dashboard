import { useEffect, useRef } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_ACTION, NAV_DESTINATIONS, NAV_FOOTER, type NavItem } from '@/app/navigation';
import { routePath } from '@/app/match-route';

const logoUrl = new URL('../../../public/logo_branca.svg', import.meta.url).href;

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

  const renderItem = (item: NavItem, action = false) => {
    const isActive = effectivePath === item.hash || effectivePath.startsWith(`${item.hash}/`);
    const Icon = item.icon;
    return (
      <button
        key={item.hash}
        type="button"
        onClick={() => onNavigate(item.hash)}
        className={cn(
          'mx-4 flex min-h-10 w-[calc(100%-2rem)] items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors',
          collapsed && 'justify-center gap-0 px-0',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-shell-primary',
          action
            ? 'bg-primary font-medium text-on-solid hover:bg-primary/90'
            : isActive
              ? 'bg-shell-active font-medium text-shell-text'
              : 'text-shell-muted hover:bg-shell-hover'
        )}
        title={collapsed ? (action ? `+ ${item.label}` : item.label) : undefined}
        aria-label={action ? item.label : undefined}
        aria-current={!action && isActive ? 'page' : undefined}
      >
        <Icon
          size={20}
          className={cn(
            'shrink-0',
            action ? 'text-on-solid' : isActive ? 'text-shell-primary' : 'text-shell-muted'
          )}
          aria-hidden="true"
        />
        {!collapsed && <span className="truncate">{action ? '+ Novo' : item.label}</span>}
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
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm"
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
          'fixed left-0 top-0 z-30 flex h-full flex-col overflow-hidden bg-shell text-shell-text',
          'border-r border-shell-border transition-[width,transform] duration-200',
          collapsed ? 'w-0 md:w-16' : 'w-[216px]',
          mobile && collapsed && 'hidden',
          mobile && sidebarOpen && 'shadow-2xl'
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-shell-border px-4">
          {!collapsed && (
            <img src={logoUrl} alt="Aspen Estamparia" className="h-8 w-auto" />
          )}
          {(!mobile || sidebarOpen) && (
            <button
              type="button"
              onClick={onToggle}
              className="min-h-9 min-w-9 shrink-0 rounded-sm p-1.5 text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-primary"
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

        <nav className="flex-1 overflow-y-auto py-2" aria-label="Operação">
          {!collapsed && (
            <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-shell-primary">
              Operação
            </div>
          )}
          {collapsed && (
            <div className="mx-3 my-2 border-t border-shell-border" aria-hidden="true" />
          )}
          {NAV_ACTION && <div className="mb-2">{renderItem(NAV_ACTION, true)}</div>}
          <div className="space-y-0.5">{NAV_DESTINATIONS.map((item) => renderItem(item))}</div>
        </nav>
        <div className="shrink-0 border-t border-shell-border py-2">
          {NAV_FOOTER.map((item) => renderItem(item))}
        </div>
      </aside>
    </>
  );
}
