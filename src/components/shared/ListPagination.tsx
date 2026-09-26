import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

interface ListPaginationProps {
  label: string;
  page: number;
  limit: number;
  hasNext: boolean;
  onPageChange: (page: number) => void;
  /** Known total enables the "1–25 de 312" range. */
  total?: number;
  /** Omit both to hide the page size selector. */
  pageSizes?: readonly number[];
  onLimitChange?: (limit: number) => void;
  disabled?: boolean;
}

export default function ListPagination({
  label,
  page,
  limit,
  hasNext,
  onPageChange,
  total,
  pageSizes,
  onLimitChange,
  disabled = false,
}: ListPaginationProps) {
  const first = (page - 1) * limit + 1;
  const range =
    total === undefined
      ? `Página ${page}`
      : total === 0
        ? 'Nenhum resultado'
        : `${first}–${Math.min(page * limit, total)} de ${total}`;

  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-4">
      {pageSizes && onLimitChange ? (
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <span>Itens por página</span>
          <Select value={limit} onChange={(event) => onLimitChange(Number(event.target.value))}>
            {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
          </Select>
        </label>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        <span className="px-2 text-sm tabular-nums text-fg-muted" aria-live="polite">{range}</span>
        <Button type="button" variant="outline" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft aria-hidden="true" /> Anterior
        </Button>
        <Button type="button" variant="outline" disabled={disabled || !hasNext} onClick={() => onPageChange(page + 1)}>
          Próximo <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
