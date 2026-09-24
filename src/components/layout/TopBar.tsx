import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Bell, ChevronRight, Menu, Moon, Search, Sun } from 'lucide-react';
import { NAV_ACTION, NAV_DESTINATIONS, NAV_FOOTER } from '@/app/navigation';
import { applyTheme, readTheme } from '@/lib/theme';
import type { BreadcrumbItem } from './Layout';
import { Button } from '@/components/ui/button';
import { MenuItem } from '@/components/ui/menu-item';
import QuickTaskLauncher from '@/features/tasks/components/QuickTaskLauncher';

export interface TopBarProps {
  route?: string;
  onMenuClick: () => void;
  sidebarOpen?: boolean;
  isMobile?: boolean;
  breadcrumbItems: BreadcrumbItem[];
  onNavigate: (hash: string) => void;
}

const SEARCH_DESTINATIONS = [NAV_ACTION, ...NAV_DESTINATIONS, ...NAV_FOOTER].filter(
  (item): item is NonNullable<typeof item> => item !== null
);

export default function TopBar({
  route = '',
  onMenuClick,
  sidebarOpen = false,
  isMobile = false,
  breadcrumbItems,
  onNavigate,
}: TopBarProps) {
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState(readTheme);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const matches = query.trim()
    ? SEARCH_DESTINATIONS.filter((item) =>
        item.label.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))
      )
    : [];

  useEffect(() => {
    const focusSearch = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  const navigateFromSearch = (hash: string) => {
    onNavigate(hash);
    setQuery('');
    setSearchOpen(false);
    searchRef.current?.blur();
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    setTheme(nextTheme);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setSearchOpen(false);
      searchRef.current?.blur();
    } else if (event.key === 'Enter' && matches[0]) {
      event.preventDefault();
      navigateFromSearch(matches[0].hash);
    }
  };

  return (
    <header className="mb-5 flex min-h-14 shrink-0 items-center justify-between gap-4 bg-page">
      <div className="flex min-w-0 items-center gap-3">
        {isMobile && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            aria-label="Abrir menu"
            aria-expanded={sidebarOpen}
            aria-controls="aspen-sidebar"
          >
            <Menu aria-hidden="true" />
          </Button>
        )}
        <nav
          className="flex min-w-0 items-center gap-2 overflow-hidden text-compact text-fg-muted"
          aria-label="Trilha de navegação"
        >
          {breadcrumbItems.map((item, index) => (
            <Fragment key={`${item.label}-${index}`}>
              {index > 0 && <ChevronRight size={14} className="shrink-0" aria-hidden="true" />}
              {item.hash ? (
                <button
                  type="button"
                  onClick={() => onNavigate(item.hash!)}
                  className="truncate rounded-control py-1 transition-colors hover:text-fg"
                >
                  {item.label}
                </button>
              ) : (
                <span className="truncate font-semibold text-fg" aria-current="page">
                  {item.label}
                </span>
              )}
            </Fragment>
          ))}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div
          ref={searchContainerRef}
          className="relative hidden lg:block"
          onBlur={(event) => {
            if (!searchContainerRef.current?.contains(event.relatedTarget)) setSearchOpen(false);
          }}
        >
          <label className="flex h-[46px] w-[244px] items-center gap-2 rounded-nav bg-surface px-4 text-fg-muted focus-within:ring-2 focus-within:ring-focus">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar uma tela..."
              aria-label="Buscar uma tela"
              className="w-full min-w-0 bg-transparent text-xs text-fg outline-hidden placeholder:text-fg-muted"
            />
            <kbd className="whitespace-nowrap rounded-xs border border-line px-1 text-3xs">
              Ctrl K
            </kbd>
          </label>
          {searchOpen && query.trim() && (
            <div className="absolute right-0 top-[52px] z-floating w-[244px] overflow-hidden rounded-control border border-line bg-surface p-1 shadow-lg">
              {matches.length > 0 ? (
                matches.map((item) => (
                  <MenuItem key={item.hash} onClick={() => navigateFromSearch(item.hash)}>
                    {item.label}
                  </MenuItem>
                ))
              ) : (
                <p className="px-3 py-2 text-xs text-fg-muted">Nenhuma tela encontrada</p>
              )}
            </div>
          )}
        </div>
        <QuickTaskLauncher route={route} />
        <span className="hidden h-6 w-px bg-line lg:block" aria-hidden="true" />
        <Button type="button" variant="ghost-muted" size="icon" onClick={() => onNavigate('/crm?tab=queue')} aria-label="Abrir fila comercial"><Bell aria-hidden="true" /></Button>
        <Button
          type="button"
          variant="ghost-muted"
          size="icon"
          onClick={toggleTheme}
          aria-label={`Ativar modo ${theme === 'dark' ? 'claro' : 'escuro'}`}
          title={`Ativar modo ${theme === 'dark' ? 'claro' : 'escuro'}`}
        >
          {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>
      </div>
    </header>
  );
}
