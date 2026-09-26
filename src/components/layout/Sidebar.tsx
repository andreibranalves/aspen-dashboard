import { useEffect, useRef, useState } from 'react';
import { Menu, Moon, PanelLeftClose, PanelLeftOpen, PlusCircle, Sun, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import AspenBrand from '@/components/shared/AspenBrand';
import { Button, buttonSizes } from '@/components/ui/button';
import { NAV_ACTION, NAV_FOOTER, NAV_GROUPS, isNavActive, type NavItem } from '@/app/navigation';
import { routePath } from '@/app/match-route';
import { applyTheme, readTheme } from '@/lib/theme';

export interface SidebarProps {
  collapsed: boolean;
  /** True below the mobile breakpoint, where the sidebar is an overlay. */
  mobile?: boolean;
  onToggle: () => void;
  currentRoute: string;
  onNavigate: (hash: string) => void;
  /** Contadores por hash do item de menu. */
  badges?: Record<string, number>;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Sidebar({
  collapsed,
  mobile = false,
  onToggle,
  currentRoute,
  onNavigate,
  badges = {},
}: SidebarProps) {
  const asideRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const currentPath = routePath(currentRoute);
  const sidebarOpen = !collapsed;
  const [theme, setTheme] = useState(readTheme);
  const themeLabel = `Ativar modo ${theme === 'dark' ? 'claro' : 'escuro'}`;

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    setTheme(nextTheme);
  };

  const renderItem = (item: NavItem) => {
    const isActive = isNavActive(item, currentPath);
    const Icon = item.icon;
    const count = badges[item.hash] ?? 0;
    const label = count > 0 ? `${item.label} (${count})` : item.label;
    return (
      <button
        key={item.hash}
        type="button"
        onClick={() => onNavigate(item.hash)}
        className={cn(
          'flex items-center gap-2 rounded-control font-medium transition-colors',
          collapsed
            ? cn(buttonSizes.icon, 'mx-auto justify-center')
            : cn(buttonSizes.default, 'mx-3 w-[calc(100%-1.5rem)]'),
          'focus-inset',
          isActive ? 'bg-shell-hover text-shell-text' : 'text-shell-muted hover:bg-shell-hover hover:text-shell-text'
        )}
        title={collapsed ? label : undefined}
        aria-label={collapsed || count > 0 ? label : undefined}
        aria-current={isActive ? 'page' : undefined}
      >
        <span className="relative shrink-0">
          <Icon
            size={16}
            className={cn(isActive ? 'text-shell-text' : 'text-shell-muted')}
            aria-hidden="true"
          />
          {collapsed && count > 0 && (
            <span className="absolute -right-1 -top-1 size-2 rounded-full bg-destructive" aria-hidden="true" />
          )}
        </span>
        {!collapsed && <span className="truncate">{item.label}</span>}
        {!collapsed && count > 0 && (
          <span
            className="ml-auto min-w-5 rounded-full bg-destructive px-1.5 text-center text-2xs font-semibold leading-5 text-white"
            aria-hidden="true"
          >
            {count}
          </span>
        )}
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
          mobile ? 'fixed inset-y-0 right-0 w-[248px] rounded-none' : 'relative rounded-shell',
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

        {NAV_ACTION && (
          <div className={cn('shrink-0 px-3 pt-3', collapsed && 'flex justify-center')}>
            <Button
              type="button"
              size={collapsed ? 'icon' : 'default'}
              className={collapsed ? undefined : 'w-full'}
              onClick={() => onNavigate(NAV_ACTION.hash)}
              aria-label={collapsed ? NAV_ACTION.label : undefined}
              title={collapsed ? NAV_ACTION.label : undefined}
              aria-current={isNavActive(NAV_ACTION, currentPath) ? 'page' : undefined}
            >
              <PlusCircle aria-hidden="true" />
              {!collapsed && NAV_ACTION.label}
            </Button>
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto pt-4" aria-label="Destinos">
          {NAV_GROUPS.map((group) => (
            <section key={group.id} aria-label={group.label} className="flex flex-col gap-1">
              {collapsed ? (
                group.id !== NAV_GROUPS[0].id && <span className="mx-5 h-px bg-shell-hover" aria-hidden="true" />
              ) : (
                <span className="px-6 pb-1 text-2xs font-semibold uppercase tracking-wider text-shell-muted" aria-hidden="true">
                  {group.label}
                </span>
              )}
              {group.items.map((item) => renderItem(item))}
            </section>
          ))}
        </nav>
        <div className={cn('flex shrink-0 pb-3 pt-2', collapsed ? 'flex-col items-center gap-1' : 'items-center')}>
          <div className={collapsed ? 'w-full' : 'min-w-0 flex-1'}>
            {NAV_FOOTER.map((item) => renderItem(item))}
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className={cn(
              buttonSizes.icon,
              'grid shrink-0 place-items-center rounded-control text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-text focus-inset',
              !collapsed && 'mr-3'
            )}
            aria-label={themeLabel}
            title={themeLabel}
          >
            {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>
      </aside>
    </>
  );
}
