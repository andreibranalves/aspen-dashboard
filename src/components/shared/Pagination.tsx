import { Button } from '@/components/ui/button';

/**
 * Pagination — paginação padronizada para listas tabuladas.
 * Janela de páginas centrada na atual; consumidor controla dados e fetch.
 */
export interface PaginationProps {
  page: number;
  totalPages: number;
  /** Exibe o resumo "Página X de Y · N registros". */
  totalRecords?: number;
  onPageChange: (page: number) => void;
  /** aria-label da navegação. */
  label?: string;
}

export default function Pagination({
  page,
  totalPages,
  totalRecords,
  onPageChange,
  label = 'Paginação',
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pageNumbers = Array.from({ length: Math.max(0, totalPages) }, (_, index) => index + 1).slice(
    Math.max(0, page - 3),
    page + 4
  );

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label={label}>
      {typeof totalRecords === 'number' && (
        <span className="text-fg-muted">
          Página {page} de {totalPages} · {totalRecords} registro{totalRecords === 1 ? '' : 's'}
        </span>
      )}
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Página anterior"
        >
          ‹ Anterior
        </Button>
        {pageNumbers.map((number) => (
          <Button
            key={number}
            variant={number === page ? 'default' : 'outline'}
            size="sm"
            aria-current={number === page ? 'page' : undefined}
            onClick={() => onPageChange(number)}
          >
            {number}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Próxima página"
        >
          Próximo ›
        </Button>
      </div>
    </nav>
  );
}
