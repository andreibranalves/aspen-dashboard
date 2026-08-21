import { cn } from '@/lib/utils';
import { Menu, X, Moon, Sun } from 'lucide-react';
import { NAV_SECTIONS } from '@/app/navigation';
import { routePath } from '@/app/match-route';

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  currentRoute: string;
  onNavigate: (hash: string) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

export default function Sidebar({
  collapsed,
  onToggle,
  currentRoute,
  onNavigate,
  darkMode,
  toggleDarkMode,
}: SidebarProps) {
  const currentPath = routePath(currentRoute);

  return (
    <>
      {!collapsed && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden backdrop-blur-sm"
          onClick={onToggle}
        />
      )}
      <aside
        className={cn(
          'fixed top-0 left-0 z-30 h-full bg-shell text-fg',
          'flex flex-col transition-all duration-300 overflow-hidden',
          collapsed ? 'w-0 lg:w-16' : 'w-64',
        )}
      >
        <div className="flex items-center justify-between px-4 border-b border-line shrink-0" style={{ height: '4rem' }}>
          {!collapsed && (
            <div className="flex items-center gap-2.5 whitespace-nowrap">
              <img
                src={darkMode ? '/logo_branca.svg' : '/logo_marinho.svg'}
                alt="Aspen Estamparia"
                style={{ height: '2rem', width: 'auto' }}
              />
            </div>
          )}
          <button
            onClick={onToggle}
            className="p-1.5 rounded-md hover:bg-surface-muted transition-colors"
            aria-label={collapsed ? 'Abrir menu' : 'Fechar menu'}
          >
            {collapsed ? <Menu size={20} /> : <X size={20} />}
          </button>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="mb-2">
              {!collapsed && (
                <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted/50">
                  {section.title}
                </div>
              )}
              {collapsed && <div className="mx-3 my-2 border-t border-line" />}
              {section.items.map(({ hash, label, icon: Icon }) => (
                <button
                  key={hash}
                  onClick={() => onNavigate(hash)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                    collapsed && 'justify-center gap-0 px-0',
                    'hover:bg-primary/5',
                    currentPath === hash || currentPath.startsWith(`${hash}/`)
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-fg-muted',
                  )}
                  title={collapsed ? label : undefined}
                  aria-current={currentPath === hash ? 'page' : undefined}
                >
                  <Icon
                    size={20}
                    className={cn(
                      'shrink-0',
                      (currentPath === hash || currentPath.startsWith(`${hash}/`))
                        ? 'text-primary'
                        : 'text-fg-muted',
                    )}
                    aria-hidden="true"
                  />
                  {!collapsed && <span className="truncate">{label}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-line shrink-0 space-y-3">
          <button
            type="button"
            onClick={toggleDarkMode}
            className={cn(
              'w-full flex items-center gap-3 rounded-md px-3 py-2 text-xs font-medium transition-colors text-fg-muted',
              'hover:bg-surface-muted hover:text-fg',
              collapsed && 'justify-center px-0',
            )}
            aria-label={darkMode ? 'Ativar modo claro' : 'Ativar modo escuro'}
            title={darkMode ? 'Modo claro' : 'Modo escuro'}
          >
            {darkMode ? <Sun size={16} className="shrink-0" /> : <Moon size={16} className="shrink-0" />}
            {!collapsed && <span>{darkMode ? 'Modo claro' : 'Modo escuro'}</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
