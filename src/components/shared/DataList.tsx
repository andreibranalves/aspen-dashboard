import type { ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface DataListColumn<T> {
  key: string;
  header: ReactNode;
  cell: (item: T) => ReactNode;
  align?: 'left' | 'right';
  /** Célula com controles próprios (checkbox, menu) fica acima do link da linha. */
  interactive?: boolean;
  /** Esconde a coluna abaixo deste breakpoint. */
  hideBelow?: 'lg' | 'xl';
}

interface DataListProps<T> {
  label: string;
  items: ReadonlyArray<T>;
  getKey: (item: T) => string;
  columns: ReadonlyArray<DataListColumn<T>>;
  /** Linha empilhada abaixo de `md`: título, meta e valor. */
  mobileRow: (item: T) => ReactNode;
  /** Controles da linha empilhada (checkbox, menu), fora do link. */
  mobileAside?: (item: T) => ReactNode;
  /** Destino da linha. Com href, a linha é um link de verdade: abre em nova aba e com o botão do meio. */
  getHref?: (item: T) => string | undefined;
  /** Nome acessível do link da linha. */
  getRowLabel?: (item: T) => string;
  isSelected?: (item: T) => boolean;
}

function RowLink({ href, label }: { href: string; label?: string }) {
  return (
    <a href={href} aria-label={label} className="focus-inset absolute inset-0 rounded-control" />
  );
}

/**
 * DataList — lista que funciona nas duas larguras: tabela a partir de `md`,
 * linhas empilhadas abaixo. Estado, busca, seleção e paginação ficam na página.
 */
export default function DataList<T>({
  label,
  items,
  getKey,
  columns,
  mobileRow,
  mobileAside,
  getHref,
  getRowLabel,
  isSelected,
}: DataListProps<T>) {
  // O link cobre a linha a partir da primeira célula sem controles próprios.
  const linkColumn = columns.findIndex((column) => !column.interactive);
  return (
    <>
      <div className="hidden md:block">
        <Table aria-label={label} edges="flush">
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(
                    column.align === 'right' && 'text-right',
                    column.hideBelow === 'lg' && 'hidden lg:table-cell',
                    column.hideBelow === 'xl' && 'hidden xl:table-cell'
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const href = getHref?.(item);
              return (
                <TableRow key={getKey(item)} selected={isSelected?.(item)} className="relative">
                  {columns.map((column, index) => (
                    <TableCell
                      key={column.key}
                      className={cn(
                        column.align === 'right' && 'text-right',
                        column.hideBelow === 'lg' && 'hidden lg:table-cell',
                        column.hideBelow === 'xl' && 'hidden xl:table-cell'
                      )}
                    >
                      {index === linkColumn && href && (
                        <RowLink href={href} label={getRowLabel?.(item)} />
                      )}
                      {column.interactive ? (
                        <div className="relative z-sticky">{column.cell(item)}</div>
                      ) : (
                        column.cell(item)
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ul aria-label={label} className="divide-y divide-line md:hidden">
        {items.map((item) => {
          const href = getHref?.(item);
          return (
            <li
              key={getKey(item)}
              data-state={isSelected?.(item) ? 'selected' : undefined}
              className="relative flex min-h-14 items-center gap-3 py-3 data-[state=selected]:bg-surface-selected"
            >
              {href && <RowLink href={href} label={getRowLabel?.(item)} />}
              <div className="min-w-0 flex-1">{mobileRow(item)}</div>
              {mobileAside && <div className="relative z-sticky shrink-0">{mobileAside(item)}</div>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
