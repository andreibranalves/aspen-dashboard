import { useEffect, useRef } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_SECTIONS } from '@/app/navigation';
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
  const activeAffinity: Record<string, string> = { '/manual': '/quotations' };
  const effectivePath = activeAffinity[currentPath] ?? currentPath;
  const sidebarOpen = !collapsed;

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
          'fixed left-0 top-0 z-30 flex h-full flex-col overflow-hidden bg-shell text-fg',
          'border-r border-line transition-[width,transform] duration-200',
          collapsed ? 'w-0 md:w-16' : 'w-64',
          mobile && collapsed && 'hidden',
          mobile && sidebarOpen && 'shadow-2xl'
        )}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b border-line px-4"
          style={{ height: '4rem' }}
        >
          {!collapsed && (
            <img
              src="/logo_marinho.svg"
              alt="Aspen Estamparia"
              className="h-8 w-auto dark:hidden"
            />
          )}
          {!collapsed && (
            <img
              src="/logo_branca.svg"
              alt=""
              aria-hidden="true"
              className="hidden h-8 w-auto dark:block"
            />
          )}
          {(!mobile || sidebarOpen) && (
            <button
              type="button"
              onClick={onToggle}
              className="min-h-9 min-w-9 shrink-0 rounded-sm p-1.5 text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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

        <nav className="flex-1 overflow-y-auto py-2" aria-label="Seções">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="mb-2">
              {!collapsed && (
                <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">
                  {section.title}
                </div>
              )}
              {collapsed && <div className="mx-3 my-2 border-t border-line" aria-hidden="true" />}
              {section.items.map(({ hash, label, icon: Icon }) => {
                const isActive = effectivePath === hash || effectivePath.startsWith(`${hash}/`);
                return (
                  <button
                    key={hash}
                    type="button"
                    onClick={() => onNavigate(hash)}
                    className={cn(
                      'flex min-h-9 w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                      collapsed && 'justify-center gap-0 px-0',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                      'hover:bg-primary/5',
                      isActive ? 'bg-primary/10 font-medium text-primary' : 'text-fg-muted'
                    )}
                    title={collapsed ? label : undefined}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon
                      size={20}
                      className={cn('shrink-0', isActive ? 'text-primary' : 'text-fg-muted')}
                      aria-hidden="true"
                    />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
