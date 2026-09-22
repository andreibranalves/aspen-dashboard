import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * SearchableSelect — select com busca para listas médias.
 * Navegação por teclado (↑/↓/Enter/Escape), foco gerenciado e estados
 * hover/active/disabled/empty padronizados. Para listas curtas, prefira
 * o Select nativo.
 */
export interface SearchableSelectOption {
  value: string;
  label: string;
}

export interface SearchableSelectProps {
  value: string;
  options: SearchableSelectOption[];
  onValueChange: (value: string) => void;
  /** Texto do gatilho quando nenhuma opção está selecionada. */
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function SearchableSelect({
  value,
  options,
  onValueChange,
  placeholder = 'Selecione…',
  searchPlaceholder = 'Buscar…',
  emptyMessage = 'Nenhuma opção encontrada.',
  ariaLabel,
  disabled,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalized));
  }, [options, query]);

  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
      inputRef.current?.focus();
    }
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [open]);

  useEffect(() => {
    const node = listRef.current?.querySelectorAll('[role="option"]')[activeIndex];
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        aria-label={ariaLabel}
        className={cn(
          'inline-flex h-9 min-w-0 items-center justify-between gap-2 rounded-sm border border-border-control bg-surface px-3 text-sm text-fg-muted opacity-50',
          className
        )}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
    );
  }

  const select = (option: SearchableSelectOption) => {
    onValueChange(option.value);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) select(option);
      return;
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((previous) => !previous)}
        className={cn(
          'inline-flex h-9 min-w-0 items-center justify-between gap-2 rounded-sm border border-border-control bg-surface px-3 text-sm text-fg',
          'transition-colors hover:bg-surface-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page',
          'aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive',
          !selected && 'text-fg-muted'
        )}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={cn('shrink-0 text-fg-muted transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-max min-w-full rounded-md border border-line bg-surface shadow-level-4">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search size={14} className="shrink-0 text-fg-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listboxId}
              aria-activedescendant={`${listboxId}-opt-${activeIndex}`}
              role="combobox"
              aria-expanded
              className="h-9 w-full min-w-32 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
            />
          </div>
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-64 overflow-y-auto p-1"
          >
            {filtered.length === 0 && (
              <li role="presentation" className="px-3 py-6 text-center text-sm text-fg-muted">
                {emptyMessage}
              </li>
            )}
            {filtered.map((option, index) => (
              <li
                key={option.value}
                id={`${listboxId}-opt-${index}`}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(option)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm',
                  index === activeIndex ? 'bg-surface-hover text-fg' : 'text-fg-muted',
                  option.value === value && 'font-medium text-fg'
                )}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {option.value === value && (
                  <Check size={14} aria-hidden="true" className="shrink-0 text-primary" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
