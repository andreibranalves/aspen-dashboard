import { useEffect, useRef } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_ACTION, NAV_DESTINATIONS, NAV_FOOTER, type NavItem } from '@/app/navigation';
import { routePath } from '@/app/match-route';

const logoUrl = new URL('../../../public/logo_marinho.svg', import.meta.url).href;

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
          'mx-3 flex min-h-[45px] w-[calc(100%-1.5rem)] items-center gap-3 rounded-nav px-4 py-2 text-sm font-medium transition-colors',
          collapsed && 'justify-center gap-0 px-0',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage',
          action
            ? 'bg-primary font-semibold text-on-solid hover:bg-sage/90'
            : isActive
              ? 'bg-shell-active text-white'
              : 'text-shell-muted hover:bg-shell-hover hover:text-shell-text'
        )}
        title={collapsed ? (action ? `+ ${item.label}` : item.label) : undefined}
        aria-label={action ? item.label : undefined}
        aria-current={!action && isActive ? 'page' : undefined}
      >
        <Icon
          size={20}
          className={cn(
            'shrink-0',
            action ? 'text-on-solid' : isActive ? 'text-white' : 'text-shell-muted'
          )}
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
          className="fixed inset-0 z-20 bg-black/65"
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
          'z-30 flex h-full shrink-0 flex-col overflow-hidden bg-shell text-shell-text transition-[width,transform] duration-200',
          mobile ? 'fixed inset-y-0 left-0 w-[248px] rounded-none' : 'relative rounded-shell',
          !mobile && (collapsed ? 'w-[74px]' : 'w-[212px] xl:w-[248px]'),
          mobile && collapsed && 'hidden',
          mobile && sidebarOpen && 'shadow-2xl'
        )}
      >
        <div className="flex h-[78px] shrink-0 items-center justify-between px-6 pt-3">
          {!collapsed && (
            <img src={logoUrl} alt="Aspen Estamparia" className="h-9 max-w-[142px] object-contain" />
          )}
          {(!mobile || sidebarOpen) && (
            <button
              type="button"
              onClick={onToggle}
              className="min-h-9 min-w-9 shrink-0 rounded-control p-1.5 text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
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

        <nav className="flex-1 overflow-y-auto pt-3" aria-label="Operação">
          {NAV_ACTION && <div className="mb-5">{renderItem(NAV_ACTION, true)}</div>}
          <div className="space-y-1">{NAV_DESTINATIONS.map((item) => renderItem(item))}</div>
        </nav>
        <div className="shrink-0 pb-4 pt-3">
          {NAV_FOOTER.map((item) => renderItem(item))}
          {!collapsed && (
            <button
              type="button"
              onClick={() => onNavigate('/crm?tab=queue')}
              className="mx-4 mt-4 flex w-[calc(100%-2rem)] flex-col items-start gap-3 rounded-card bg-sage p-4 text-left text-on-solid transition-colors hover:bg-sage/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
            >
              <span className="text-xs font-semibold uppercase tracking-wide">Próximos passos</span>
              <span className="text-lg font-bold leading-tight">Seu dia, organizado.</span>
              <span className="text-xs leading-5">Ações pendentes na fila comercial.</span>
              <span className="flex items-center gap-1 text-xs font-bold">
                Abrir minha fila <ArrowUpRight size={15} aria-hidden="true" />
              </span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
