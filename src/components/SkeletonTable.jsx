import Skeleton from '@/components/Skeleton.jsx';

/**
 * SkeletonTable — simula uma tabela durante o carregamento.
 * As alturas espelham as classes do componente Table real (h-10 no header, p-4 nas células).
 *
 * @param {number} cols - Quantidade de colunas
 * @param {number} rows - Quantidade de linhas (default 8)
 * @param {'sm'|'md'|'lg'} size - Tamanho das linhas (default 'md')
 */
export default function SkeletonTable({ cols = 4, rows = 8, size = 'md' }) {
  const rowHeight = size === 'sm' ? 'h-10' : size === 'lg' ? 'h-16' : 'h-14';

  // Distribui larguras proporcionais, deixando a primeira coluna mais estreita
  // quando há muitas colunas (simula a coluna de checkbox das tabelas reais).
  // Colunas do meio usam flex-1 para preencher todo o espaço restante.
  const colWidths = Array.from({ length: cols }, (_, i) => {
    if (cols >= 5 && i === 0) return 'w-10 shrink-0';
    if (cols >= 5 && i === cols - 1) return 'w-[15%] min-w-[100px] shrink-0';
    if (cols >= 5) return 'flex-1';
    if (i === 0) return 'w-[30%]';
    if (i === cols - 1) return 'w-[15%]';
    return `${55 / (cols - 2)}%`;
  });

  return (
    <div
      className="rounded-lg border border-line bg-surface shadow-sm w-full overflow-hidden"
      aria-busy="true"
      aria-label="Carregando tabela"
    >
      {/* Header — espelha TableHead (h-10 px-4 text-xs uppercase) */}
      <div className="px-4 border-b border-line flex items-center gap-4 h-10">
        {colWidths.map((w, i) => (
          <Skeleton key={i} className={`h-4 ${w}`} />
        ))}
      </div>

      {/* Rows — espelha TableCell (p-4 text-sm) */}
      <div className="divide-y divide-line">
        {Array.from({ length: rows }, (_, r) => (
          <div
            key={r}
            className={`px-4 flex items-center gap-4 ${rowHeight}`}
          >
            {colWidths.map((w, i) => (
              <Skeleton
                key={i}
                className={`h-4 ${w} ${r % 3 === 0 && i === cols - 1 ? 'opacity-60' : ''}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
