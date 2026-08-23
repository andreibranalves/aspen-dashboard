import { forwardRef, type HTMLAttributes, type TableHTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Table is a first-class Aspen data-table primitive.
 * The wrapper stays flat and uses the canonical subtle border treatment.
 */
const Table = forwardRef<HTMLTableElement, TableHTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto rounded-md border border-line bg-surface">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('[&_tr]:border-b [&_tr]:border-line', className)} {...props} />
  ),
);
TableHeader.displayName = 'TableHeader';

const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  ),
);
TableBody.displayName = 'TableBody';

const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'min-h-11 border-b border-line transition-colors hover:bg-surface-hover data-[state=selected]:bg-surface-selected',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'h-10 px-4 py-2 text-left align-middle text-xs font-medium text-fg-muted',
        '[&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = 'TableHead';

const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn('px-4 py-3 align-middle text-fg', className)} {...props} />
  ),
);
TableCell.displayName = 'TableCell';

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
