import {
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * Table is a first-class Aspen data-table primitive.
 * The wrapper stays flat and uses the canonical subtle border treatment.
 */
interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  containerClassName?: string;
}

const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, containerClassName, ...props }, ref) => (
    <div className={cn('relative w-full overflow-auto', containerClassName)}>
      <table ref={ref} className={cn('w-full caption-bottom text-xs', className)} {...props} />
    </div>
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

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Enables keyboard activation for rows that already have an onClick handler. */
  interactive?: boolean;
}

const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, onClick, onKeyDown, tabIndex, interactive, ...props }, ref) => {
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
        className={cn(
          'min-h-11 border-b border-line transition-colors hover:bg-surface-hover data-[state=selected]:bg-surface-selected',
          'focus-inset',
          className
        )}
        {...props}
      />
    );
  }
);
TableRow.displayName = 'TableRow';

const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'h-10 px-3 py-2 text-left align-middle text-[10px] font-medium text-fg-muted',
        '[&:has([role=checkbox])]:pr-0',
        className
      )}
      {...props}
    />
  )
);
TableHead.displayName = 'TableHead';

const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn('px-3 py-4 align-middle text-fg', '[&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  )
);
TableCell.displayName = 'TableCell';

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
