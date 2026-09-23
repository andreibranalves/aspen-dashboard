import {
  createContext,
  forwardRef,
  useContext,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

/** default: listas; compact: tabelas de documento; dense: tabelas editáveis dentro de cards. */
type TableDensity = 'default' | 'compact' | 'dense';
/** flush: primeira e última coluna alinhadas à borda do conteúdo; inset: primeira coluna recuada. */
type TableEdges = 'default' | 'flush' | 'inset';

const cellDensity = {
  default: 'px-3 py-4',
  compact: 'px-3 py-2',
  dense: 'px-2 py-2',
} as const;

const headDensity = {
  default: 'h-10 px-3 py-2',
  compact: 'h-9 px-3 py-2',
  dense: 'h-10 px-2 py-2',
} as const;

const tableEdges = {
  default: '',
  flush: '[&_tr>*:first-child]:pl-0 [&_tr>*:last-child]:pr-0',
  inset: '[&_tr>*:first-child]:pl-4',
} as const;

const TableDensityContext = createContext<TableDensity>('default');

/**
 * Table is a first-class Aspen data-table primitive.
 * The wrapper stays flat and uses the canonical subtle border treatment.
 */
interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  density?: TableDensity;
  edges?: TableEdges;
  containerClassName?: string;
}

const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, containerClassName, density = 'default', edges = 'default', ...props }, ref) => (
    <TableDensityContext.Provider value={density}>
      <div className={cn('relative w-full overflow-auto', containerClassName)}>
        <table
          ref={ref}
          className={cn('w-full caption-bottom text-xs', tableEdges[edges], className)}
          {...props}
        />
      </div>
    </TableDensityContext.Provider>
  )
);
Table.displayName = 'Table';

const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('[&_tr]:border-b [&_tr]:border-line', className)} {...props} />
  )
);
TableHeader.displayName = 'TableHeader';

const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  )
);
TableBody.displayName = 'TableBody';

const rowTones = {
  default: '',
  warning: 'bg-warning/10',
} as const;

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Enables keyboard activation for rows that already have an onClick handler. */
  interactive?: boolean;
  selected?: boolean;
  tone?: keyof typeof rowTones;
}

const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, onClick, onKeyDown, tabIndex, interactive, selected, tone = 'default', ...props }, ref) => {
    const isInteractive = interactive === true || typeof onClick === 'function';
    const handleKeyDown = (event: ReactKeyboardEvent<HTMLTableRowElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || !isInteractive || typeof onClick !== 'function') return;
      const target = event.target as HTMLElement;
      if (target.closest('a,button,input,select,textarea,summary,[role="button"],[role="menuitem"]')) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.currentTarget.click();
    };

    return (
      <tr
        ref={ref}
        tabIndex={isInteractive ? (tabIndex ?? 0) : tabIndex}
        onClick={onClick}
        onKeyDown={isInteractive ? handleKeyDown : onKeyDown}
        data-state={selected ? 'selected' : undefined}
        className={cn(
          'min-h-11 border-b border-line transition-colors hover:bg-surface-hover data-[state=selected]:bg-surface-selected',
          'focus-inset',
          isInteractive && 'cursor-pointer',
          rowTones[tone],
          className
        )}
        {...props}
      />
    );
  }
);
TableRow.displayName = 'TableRow';

const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => {
    const density = useContext(TableDensityContext);
    return (
      <th
        ref={ref}
        className={cn(
          headDensity[density],
          'text-left align-middle text-xs font-medium text-fg-muted',
          '[&:has([role=checkbox])]:pr-0',
          className
        )}
        {...props}
      />
    );
  }
);
TableHead.displayName = 'TableHead';

const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => {
    const density = useContext(TableDensityContext);
    return (
      <td
        ref={ref}
        className={cn(cellDensity[density], 'align-middle text-fg', '[&:has([role=checkbox])]:pr-0', className)}
        {...props}
      />
    );
  }
);
TableCell.displayName = 'TableCell';

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
export type { TableDensity, TableEdges };
