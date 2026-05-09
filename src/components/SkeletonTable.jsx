import Skeleton from '@/components/Skeleton.jsx';

/**
 * SkeletonTable — simula uma tabela durante o carregamento.
 *
 * @param {number} cols - Quantidade de colunas
 * @param {number} rows - Quantidade de linhas (default 8)
 * @param {string} title - Texto exibido abaixo do skeleton
 * @param {'sm'|'md'|'lg'} size - Tamanho das linhas (default 'md')
 */
export default function SkeletonTable({ cols = 4, rows = 8, title = 'Carregando…', size = 'md' }) {
  const rowHeight = size === 'sm' ? 'h-6' : size === 'lg' ? 'h-12' : 'h-8';
  const headerHeight = size === 'sm' ? 'h-5' : size === 'lg' ? 'h-10' : 'h-7';

  // Varia as larguras das colunas para simular dados reais
  const colWidths = Array.from({ length: cols }, (_, i) => {
    if (i === 0) return 'w-[25%]';
    if (i === cols - 1) return 'w-[15%]';
    return `${70 / (cols - 2)}%`;
  });

  return (
    <div className="flex flex-col items-center gap-3" aria-label="Carregando tabela">
      <div className="bg-white rounded-lg border shadow-sm w-full overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b flex gap-4">
          {colWidths.map((w, i) => (
            <Skeleton key={i} className={`${headerHeight} ${w}`} />
          ))}
        </div>

        {/* Rows */}
        <div className="divide-y">
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="px-4 py-3 flex gap-4">
              {colWidths.map((w, i) => (
                <Skeleton
                  key={i}
                  className={`${rowHeight} ${w} ${
                    // Linhas alternadas ligeiramente diferentes
                    r % 3 === 0 && i === cols - 1 ? 'opacity-40' : ''
                  }`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="text-muted-foreground text-sm">{title}</p>
    </div>
  );
}
