import Skeleton from '@/components/Skeleton';

/**
 * SkeletonKanban — simula o quadro Kanban do CRM durante o carregamento.
 * Espelha CrmKanbanPage: colunas de 72 com header, badge de contagem e cards.
 */
export default function SkeletonKanban() {
  const columns = 4;
  const cardsPerCol = [3, 2, 4, 2];

  return (
    <div
      className="overflow-auto rounded-lg border border-line bg-page max-h-[calc(100vh-9.5rem)] md:max-h-[calc(100vh-10rem)]"
      aria-busy="true"
      aria-label="Carregando kanban"
    >
      <div className="flex gap-4 p-3 min-h-[55vh]">
        {Array.from({ length: columns }, (_, ci) => (
          <div
            key={ci}
            className="flex-shrink-0 w-72 bg-surface border border-line rounded-lg flex flex-col"
          >
            {/* Column header — px-4 py-3 text-sm font-medium */}
            <div className="px-4 py-3 flex items-center justify-between">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>

            {/* Cards area — flex-1 px-2 pb-2 space-y-2 min-h-[120px] */}
            <div className="flex-1 px-2 pb-2 space-y-2 min-h-[120px]">
              {Array.from({ length: cardsPerCol[ci] }, (_, ri) => (
                <div
                  key={ri}
                  className="bg-surface rounded-lg border border-line p-3 space-y-2"
                >
                  <Skeleton className={`h-4 ${ri % 2 === 0 ? 'w-28' : 'w-36'}`} />
                  <Skeleton className="h-3 w-44 opacity-60" />
                  <div className="flex items-center gap-2 pt-1">
                    <Skeleton className="h-4 w-20 rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
