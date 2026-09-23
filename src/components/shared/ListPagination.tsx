import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

interface ListPaginationProps {
  label: string;
  page: number;
  limit: number;
  pageSizes: readonly number[];
  hasNext: boolean;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

export default function ListPagination({
  label,
  page,
  limit,
  pageSizes,
  hasNext,
  onPageChange,
  onLimitChange,
}: ListPaginationProps) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-4">
      <label className="flex items-center gap-2 text-sm text-fg-muted">
        <span>Itens por página</span>
        <Select value={limit} onChange={(event) => onLimitChange(Number(event.target.value))}>
          {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
        </Select>
      </label>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          ‹ Anterior
        </Button>
        <span className="px-2 text-sm text-fg-muted" aria-live="polite">Página {page}</span>
        <Button type="button" variant="outline" size="sm" disabled={!hasNext} onClick={() => onPageChange(page + 1)}>
          Próximo ›
        </Button>
      </div>
    </nav>
  );
}
