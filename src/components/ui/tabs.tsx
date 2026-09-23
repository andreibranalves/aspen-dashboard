import { Tabs as RadixTabs } from 'radix-ui';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tabs — the only tab pattern in Aspen. Radix owns roving focus, arrow/Home/End
 * keys and tab ↔ panel wiring.
 *
 * - `page`: sections of one page (Catálogo › Produtos/Conjuntos/Mídias).
 * - `segmented`: alternate views or modes of the same content (Lista/Quadro).
 */

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Short count or marker shown after the label. */
  badge?: ReactNode;
  disabled?: boolean;
}

interface TabsProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs<T extends string>({ value, onValueChange, children, className }: TabsProps<T>) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      className={cn('space-y-5', className)}
    >
      {children}
    </RadixTabs.Root>
  );
}

const listVariants = {
  page: 'flex max-w-full gap-1 overflow-x-auto p-0.5',
  segmented: 'inline-flex max-w-full gap-0.5 overflow-x-auto rounded-control bg-surface-subtle p-1',
} as const;

const triggerVariants = {
  page: 'h-9 rounded-control px-3.5 text-fg-muted hover:bg-raised hover:text-fg data-[state=active]:bg-primary-soft data-[state=active]:text-primary-soft-ink data-[state=active]:hover:bg-primary-soft',
  segmented:
    'h-8 rounded-badge px-3 text-fg-muted hover:text-fg data-[state=active]:bg-segment-active data-[state=active]:text-fg data-[state=active]:shadow-[0_1px_2px_rgb(0_0_0/0.18)]',
} as const;

interface TabListProps<T extends string> {
  label: string;
  items: ReadonlyArray<TabItem<T>>;
  variant?: keyof typeof listVariants;
  /** Wires triggers to panels rendered outside `TabPanel` (`${idPrefix}-panel-${value}`). */
  idPrefix?: string;
  className?: string;
}

export function TabList<T extends string>({ label, items, variant = 'page', idPrefix, className }: TabListProps<T>) {
  return (
    <RadixTabs.List aria-label={label} className={cn(listVariants[variant], className)}>
      {items.map(({ value, label: itemLabel, icon: Icon, badge, disabled }) => (
        <RadixTabs.Trigger
          key={value}
          value={value}
          disabled={disabled}
          {...(idPrefix ? { id: `${idPrefix}-tab-${value}`, 'aria-controls': `${idPrefix}-panel-${value}` } : {})}
          className={cn(
            'inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-[13px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
            triggerVariants[variant]
          )}
        >
          {Icon && <Icon size={15} aria-hidden="true" />}
          {itemLabel}
          {badge != null && <span className="tabular-nums opacity-70">{badge}</span>}
        </RadixTabs.Trigger>
      ))}
    </RadixTabs.List>
  );
}

/** Tab row whose panels live elsewhere on the page, wired through `idPrefix`. */
export function TabBar<T extends string>({
  value,
  onValueChange,
  className,
  ...listProps
}: Omit<TabsProps<T>, 'children'> & TabListProps<T> & { idPrefix: string }) {
  return (
    <RadixTabs.Root value={value} onValueChange={(next) => onValueChange(next as T)} className={className}>
      <TabList {...listProps} />
    </RadixTabs.Root>
  );
}

interface TabPanelProps {
  value: string;
  children: ReactNode;
  className?: string;
  /** Keep the panel mounted (hidden) while inactive, e.g. to preserve unsaved edits. */
  keepMounted?: boolean;
}

export function TabPanel({ value, children, className, keepMounted }: TabPanelProps) {
  return (
    <RadixTabs.Content
      value={value}
      forceMount={keepMounted || undefined}
      className={cn('min-w-0 data-[state=inactive]:hidden', className)}
    >
      {children}
    </RadixTabs.Content>
  );
}
