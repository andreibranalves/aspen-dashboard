import Skeleton from '@/components/shared/Skeleton';
import { PIPELINE } from '@/lib/constants';

/** SkeletonKanban mirrors the dense, horizontally scrollable board while data loads. */
export default function SkeletonKanban() {
  const cardsPerColumn = [3, 2, 4, 2, 3, 2, 1];

  return (
    <div
      role="status"
      className="max-h-[calc(100vh-9.5rem)] overflow-x-auto overflow-y-hidden rounded-lg border border-line bg-page md:max-h-[calc(100vh-10rem)]"
      aria-busy="true"
      aria-label="Carregando pipeline CRM"
    >
      <div className="flex min-h-[55vh] w-max min-w-full gap-3 p-3">
        {PIPELINE.map((status, columnIndex) => (
          <div
            key={status}
            className="flex w-[17.5rem] flex-shrink-0 flex-col rounded-lg border border-line bg-surface"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            <div className="min-h-[120px] flex-1 space-y-2 px-2 pb-2">
              {Array.from({ length: cardsPerColumn[columnIndex] }, (_, cardIndex) => (
                <div
                  key={cardIndex}
                  className="space-y-2 rounded-lg border border-line bg-surface p-3"
                >
                  <Skeleton className={`h-4 ${cardIndex % 2 === 0 ? 'w-28' : 'w-36'}`} />
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
