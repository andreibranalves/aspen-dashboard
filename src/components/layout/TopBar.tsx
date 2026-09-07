import { Fragment } from 'react';
import { Menu, ChevronRight, Moon, Sun } from 'lucide-react';
import BackButton from '@/components/ui/back-button';
import { routePath } from '@/app/match-route';
import type { BreadcrumbItem } from './Layout';

export interface TopBarProps {
  /** Kept for compatibility with direct consumers; breadcrumbItems is canonical. */
  route?: string;
  onMenuClick: () => void;
  sidebarOpen?: boolean;
  isMobile?: boolean;
  breadcrumbItems: BreadcrumbItem[];
  onNavigate: (hash: string) => void;
  darkMode?: boolean;
  toggleDarkMode?: () => void;
}

/**
 * TopBar is intentionally limited to navigation context and global utilities.
 * Page-specific actions belong to PageHeader on the rendered screen.
 */
export default function TopBar({
  route,
  onMenuClick,
  sidebarOpen = false,
  isMobile = false,
  breadcrumbItems,
  onNavigate,
  darkMode = false,
  toggleDarkMode,
}: TopBarProps) {
  // Show back button on detail pages (e.g. Início > Orçamentos > ORC-1234).
  const parentItem = breadcrumbItems.length >= 3 ? breadcrumbItems[1] : null;
  const backLabel =
    route && routePath(route).startsWith('/sales-orders/') ? 'Voltar aos pedidos' : undefined;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {isMobile && (
          <button
            type="button"
            onClick={onMenuClick}
            className="min-h-9 min-w-9 shrink-0 rounded-sm p-2 text-fg transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Abrir menu"
            aria-expanded={sidebarOpen}
            aria-controls="aspen-sidebar"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
        )}
        {parentItem?.hash && (
          <BackButton label={backLabel} onClick={() => onNavigate(parentItem.hash!)} />
        )}
        <nav
          className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm"
          aria-label="Trilha de navegação"
        >
          {breadcrumbItems.map((item, i) => (
            <Fragment key={`${item.label}-${i}`}>
              {i > 0 && (
                <ChevronRight size={14} className="shrink-0 text-fg-muted" aria-hidden="true" />
              )}
              {item.hash ? (
                <button
                  type="button"
                  onClick={() => onNavigate(item.hash!)}
                  className="truncate rounded-sm text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {item.label}
                </button>
              ) : (
                <span className="truncate font-medium text-fg" aria-current="page">
                  {item.label}
                </span>
              )}
            </Fragment>
          ))}
        </nav>
      </div>

      {toggleDarkMode && (
        <button
          type="button"
          onClick={toggleDarkMode}
          className="min-h-9 min-w-9 shrink-0 rounded-sm p-2 text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={darkMode ? 'Ativar modo claro' : 'Ativar modo escuro'}
          title={darkMode ? 'Modo claro' : 'Modo escuro'}
        >
          {darkMode ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        </button>
      )}
    </header>
  );
}
