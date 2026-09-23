import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Bell, ChevronRight, Menu, Moon, Search, Sun } from 'lucide-react';
import { NAV_ACTION, NAV_DESTINATIONS, NAV_FOOTER } from '@/app/navigation';
import { applyTheme, readTheme } from '@/lib/theme';
import type { BreadcrumbItem } from './Layout';

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
          <button
            type="button"
            onClick={onMenuClick}
            className="flex min-h-10 min-w-10 items-center justify-center rounded-control text-fg transition-colors hover:bg-raised"
            aria-label="Abrir menu"
            aria-expanded={sidebarOpen}
            aria-controls="aspen-sidebar"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
        )}
        <nav
          className={`flex min-w-0 items-center gap-2 overflow-hidden text-xs text-fg-muted ${breadcrumbItems.length > 2 ? 'xl:absolute xl:left-0 xl:top-[96px]' : 'xl:sr-only'}`}
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
            <Search size={17} aria-hidden="true" />
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
              className="w-full min-w-0 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
            />
            <kbd className="whitespace-nowrap rounded-xs border border-line px-1 text-[10px]">
              Ctrl K
            </kbd>
          </label>
          {searchOpen && query.trim() && (
            <div className="absolute right-0 top-[52px] z-40 w-[244px] overflow-hidden rounded-control border border-line bg-surface p-1 shadow-lg">
              {matches.length > 0 ? (
                matches.map((item) => (
                  <button
                    key={item.hash}
                    type="button"
                    onClick={() => navigateFromSearch(item.hash)}
                    className="flex w-full items-center rounded-control px-3 py-2 text-left text-sm text-fg hover:bg-raised"
                  >
                    {item.label}
                  </button>
                ))
              ) : (
                <p className="px-3 py-2 text-xs text-fg-muted">Nenhuma tela encontrada</p>
              )}
            </div>
          )}
        </div>
        <span className="hidden h-6 w-px bg-line lg:block" aria-hidden="true" />
        <button type="button" onClick={() => onNavigate('/crm?tab=queue')} className="grid size-9 place-items-center rounded-control text-fg-muted hover:bg-raised hover:text-fg" aria-label="Abrir fila comercial"><Bell size={17} aria-hidden="true" /></button>
        <button
          type="button"
          onClick={toggleTheme}
          className="grid size-9 place-items-center rounded-control text-fg-muted hover:bg-raised hover:text-fg"
          aria-label={`Ativar modo ${theme === 'dark' ? 'claro' : 'escuro'}`}
          title={`Ativar modo ${theme === 'dark' ? 'claro' : 'escuro'}`}
        >
          {theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
