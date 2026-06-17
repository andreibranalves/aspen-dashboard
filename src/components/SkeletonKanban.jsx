import Skeleton from '@/components/Skeleton.jsx';

/**
 * SkeletonKanban — simula um quadro Kanban durante o carregamento.
 *
 * @param {string} title - Texto de carregamento
 */
export default function SkeletonKanban({ title = 'Carregando…' }) {
  const columns = 4;
  // Cada coluna tem um número diferente de cards para parecer realista
  const cardsPerCol = [3, 2, 4, 2];

  return (
    <div className="flex flex-col items-center gap-3" aria-label="Carregando kanban">
      <div className="flex gap-4 overflow-x-auto pb-4 min-h-[60vh] w-full">
        {Array.from({ length: columns }, (_, ci) => (
          <div key={ci} className="flex-shrink-0 w-72 bg-surface border border-line rounded-lg flex flex-col">
            {/* Column header */}
            <div className="px-4 py-3 flex items-center justify-between">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>

            {/* Cards */}
            <div className="flex-1 px-2 pb-2 space-y-2 min-h-[120px]">
              {Array.from({ length: cardsPerCol[ci] }, (_, ri) => (
                <div key={ri} className="bg-page rounded-lg border border-line shadow-sm p-3 space-y-2">
                  <Skeleton className={`h-4 ${ri % 2 === 0 ? 'w-28' : 'w-36'}`} />
                  <Skeleton className="h-3 w-44 opacity-50" />
                  <div className="flex items-center gap-2 pt-1">
                    <Skeleton className="h-5 w-20 rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-fg-muted text-sm">{title}</p>
    </div>
  );
}
